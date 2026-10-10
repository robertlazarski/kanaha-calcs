/*
 * Kanaha Calcs — CSV data source for the financial benchmark operations
 *
 * See calcs_csv_source.h for what this is and why it lives here rather than
 * upstream. Two operations: covarianceFromCsv and listCsvFiles.
 *
 * Threat model, in the same shape as the audio service's file handling. The
 * caller may be an AI client over MCP or anything holding a client
 * certificate over HTTPS, so nothing it sends may reach the filesystem
 * unchecked:
 *
 *   - "file" is one exact name, never a path: no separators, no "..", no
 *     leading dot, no wildcards, and it must end in .csv. The directory is
 *     fixed, so there is nothing to traverse to.
 *   - the read is bounded in bytes, lines, columns and rows before any
 *     allocation depends on the file's content.
 *   - a cell that is neither a number nor one of the blank markers is a
 *     refusal naming the row and column, not a silent zero.
 *   - the estimator's own caps still apply: this code refuses above them
 *     rather than passing a request the engine would reject anyway.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

#include "calcs_csv_source.h"
#include "financial_benchmark_service.h"
#include "finbench_mcp.h"

#include <axutil_log.h>
#include <axutil_string.h>
#include <json-c/json.h>

#include <ctype.h>
#include <dirent.h>
#include <math.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>

/* Markers that mean "not observed" in a cell, besides an empty one. */
static const char *CALCS_CSV_BLANKS[] = { "na", "n/a", "nan", "null", "-", NULL };

/* ------------------------------------------------------------------------- */
/* Failure helpers                                                           */
/* ------------------------------------------------------------------------- */

static axis2_char_t *
csv_fail(const axutil_env_t *env, const char *fmt, ...)
{
    char buf[400];
    char logged[400];
    json_object *o;
    axis2_char_t *out;
    size_t i;
    va_list ap;

    va_start(ap, fmt);
    vsnprintf(buf, sizeof(buf), fmt, ap);
    va_end(ap);

    /* Build the message through json-c: the text can quote a column name or
     * a file name that came from the request, and hand-rolled escaping is
     * how a quote in either turns into a broken response. The serialised
     * string is returned as json-c made it -- escaping can double the text,
     * and a fixed-size copy would cut it into invalid JSON. */
    o = json_object_new_object();
    json_object_object_add(o, "status", json_object_new_string(FINBENCH_STATUS_FAILED));
    json_object_object_add(o, "error_message", json_object_new_string(buf));
    out = axutil_strdup(env, json_object_to_json_string_ext(o, JSON_C_TO_STRING_PLAIN));
    json_object_put(o);

    /* The log gets a copy with control characters replaced: a column name
     * from the request carrying a newline must not write a line of its own. */
    if (env && env->log) {
        for (i = 0; buf[i] && i < sizeof(logged) - 1; i++)
            logged[i] = ((unsigned char)buf[i] < 0x20 || buf[i] == 0x7f) ? '?' : buf[i];
        logged[i] = '\0';
        AXIS2_LOG_WARNING(env->log, AXIS2_LOG_SI, "[Calcs CSV] refused: %s", logged);
    }
    return out;
}

/* ------------------------------------------------------------------------- */
/* Directory and name validation                                             */
/* ------------------------------------------------------------------------- */

/*
 * Where the app keeps imported CSVs. The service is launched by CalcsService
 * with KANAHA_CALCS_CSV_DIR set to <files>/csv; the MCP binary is launched by
 * an MCP client through run-as, whose working directory is the app's data
 * directory, so the relative path resolves there. Both are fixed locations:
 * nothing the caller sends contributes to this string.
 */
static const char *
csv_dir(void)
{
    static char resolved[512];
    const char *env_dir;
    struct stat st;

    if (resolved[0]) return resolved;

    env_dir = getenv("KANAHA_CALCS_CSV_DIR");
    if (env_dir && env_dir[0] == '/' && strstr(env_dir, "..") == NULL &&
        strlen(env_dir) < sizeof(resolved)) {
        snprintf(resolved, sizeof(resolved), "%s", env_dir);
        return resolved;
    }

    if (stat("files/csv", &st) == 0 && S_ISDIR(st.st_mode)) {
        snprintf(resolved, sizeof(resolved), "files/csv");
        return resolved;
    }

    snprintf(resolved, sizeof(resolved), "files/csv");
    return resolved;
}

/* AXIS2_TRUE when the name is one plain CSV file name and nothing else. */
static axis2_bool_t
csv_name_ok(const char *name)
{
    size_t len, i;

    if (!name) return AXIS2_FALSE;
    len = strlen(name);
    if (len == 0 || len >= CALCS_CSV_MAX_NAME) return AXIS2_FALSE;
    if (name[0] == '.') return AXIS2_FALSE;
    if (strstr(name, "..")) return AXIS2_FALSE;

    for (i = 0; i < len; i++) {
        char c = name[i];
        if (!(isalnum((unsigned char)c) || c == '-' || c == '_' || c == '.')) {
            return AXIS2_FALSE;
        }
    }
    if (len < 5) return AXIS2_FALSE;
    return (strcasecmp(name + len - 4, ".csv") == 0) ? AXIS2_TRUE : AXIS2_FALSE;
}

/* ------------------------------------------------------------------------- */
/* CSV reading                                                               */
/* ------------------------------------------------------------------------- */

/*
 * Split one line on commas in place, storing up to max_fields pointers.
 * Returns the field count, which may exceed max_fields: the caller decides
 * whether that is a refusal. Quoted fields are not supported and a line that
 * contains a double quote is refused by the caller, because a half-supported
 * quoting rule silently mis-parses rather than failing.
 */
static int
csv_split(char *line, char **fields, int max_fields)
{
    int n = 0;
    char *p = line;

    if (n < max_fields) fields[n] = p;
    n++;
    for (; *p; p++) {
        if (*p == ',') {
            *p = '\0';
            if (n < max_fields) fields[n] = p + 1;
            n++;
        }
    }
    return n;
}

/* Trim leading and trailing whitespace in place. */
static char *
csv_trim(char *s)
{
    char *end;
    while (*s && isspace((unsigned char)*s)) s++;
    end = s + strlen(s);
    while (end > s && isspace((unsigned char)end[-1])) end--;
    *end = '\0';
    return s;
}

static axis2_bool_t
csv_is_blank(const char *s)
{
    int i;
    if (!s || s[0] == '\0') return AXIS2_TRUE;
    for (i = 0; CALCS_CSV_BLANKS[i]; i++) {
        if (strcasecmp(s, CALCS_CSV_BLANKS[i]) == 0) return AXIS2_TRUE;
    }
    return AXIS2_FALSE;
}

/*
 * Parse one cell. Returns 0 and writes NAN for a blank, 0 and the value for a
 * number, and -1 for anything else.
 */
static int
csv_cell(const char *s, double *out)
{
    char *end = NULL;
    double v;

    if (csv_is_blank(s)) {
        *out = NAN;
        return 0;
    }
    v = strtod(s, &end);
    if (end == s || (end && *end != '\0')) return -1;
    if (!isfinite(v)) return -1;
    *out = v;
    return 0;
}

/* ------------------------------------------------------------------------- */
/* covarianceFromCsv                                                         */
/* ------------------------------------------------------------------------- */

typedef struct {
    char   **names;        /* column names requested, n_cols of them */
    int      n_cols;
    int     *index;        /* header index of each requested column */
    int      date_index;   /* header index of a Date column, or -1 */
} csv_selection_t;

static void
selection_free(const axutil_env_t *env, csv_selection_t *sel)
{
    int i;
    if (sel->names) {
        for (i = 0; i < sel->n_cols; i++) {
            if (sel->names[i]) AXIS2_FREE(env->allocator, sel->names[i]);
        }
        AXIS2_FREE(env->allocator, sel->names);
        sel->names = NULL;
    }
    if (sel->index) {
        AXIS2_FREE(env->allocator, sel->index);
        sel->index = NULL;
    }
}

axis2_char_t *
kanaha_calcs_csv_covariance_json(
    const axutil_env_t *env,
    const axis2_char_t *args_json)
{
    json_object *args = NULL, *v = NULL, *cols = NULL;
    csv_selection_t sel;
    const char *file = NULL, *kind = "price";
    char path[768];
    char first_date[32] = "", last_date[32] = "";
    double n_periods_per_year = 252.0;
    int max_obs = FINBENCH_MAX_OBS;
    axis2_bool_t check_pd = AXIS2_TRUE;
    axis2_bool_t prices;
    FILE *fp = NULL;
    char *line = NULL;
    char **fields = NULL;
    double *values = NULL;          /* n_cols x n_rows, row-major by column */
    int n_rows_total = 0, n_rows_used = 0, n_obs = 0, stride = 0;
    int i, j, row;
    struct stat st;
    finbench_covariance_from_returns_request_t *req = NULL;
    finbench_covariance_from_returns_response_t *resp = NULL;
    axis2_char_t *resp_json = NULL, *out = NULL;
    json_object *resp_obj = NULL;

    memset(&sel, 0, sizeof(sel));
    sel.date_index = -1;

    if (!env) return NULL;

    args = args_json ? json_tokener_parse(args_json) : NULL;
    if (!args || !json_object_is_type(args, json_type_object)) {
        if (args) json_object_put(args);
        return csv_fail(env, "Arguments must be a JSON object with at least "
                             "\"file\" and \"columns\".");
    }

    /* --- file --- */
    if (!json_object_object_get_ex(args, "file", &v) ||
        !json_object_is_type(v, json_type_string)) {
        json_object_put(args);
        return csv_fail(env, "Missing required field: \"file\" (a CSV name from listCsvFiles).");
    }
    file = json_object_get_string(v);
    if (!csv_name_ok(file)) {
        axis2_char_t *r = csv_fail(env,
            "\"file\" must be one plain CSV file name: letters, digits, '-', '_' and '.', "
            "no path separators, not starting with '.', ending in .csv.");
        json_object_put(args);
        return r;
    }
    snprintf(path, sizeof(path), "%s/%s", csv_dir(), file);

    /* --- columns --- */
    if (!json_object_object_get_ex(args, "columns", &cols) ||
        !json_object_is_type(cols, json_type_array)) {
        json_object_put(args);
        return csv_fail(env, "Missing required field: \"columns\" (header names to use).");
    }
    sel.n_cols = (int)json_object_array_length(cols);
    if (sel.n_cols < 1 || sel.n_cols > FINBENCH_MAX_RET_ASSETS) {
        axis2_char_t *r = csv_fail(env,
            "\"columns\" must name between 1 and %d columns; got %d.",
            FINBENCH_MAX_RET_ASSETS, sel.n_cols);
        json_object_put(args);
        return r;
    }
    sel.names = AXIS2_MALLOC(env->allocator, (size_t)sel.n_cols * sizeof(char *));
    sel.index = AXIS2_MALLOC(env->allocator, (size_t)sel.n_cols * sizeof(int));
    if (!sel.names || !sel.index) {
        selection_free(env, &sel);
        json_object_put(args);
        return csv_fail(env, "Memory allocation failed.");
    }
    memset(sel.names, 0, (size_t)sel.n_cols * sizeof(char *));
    for (i = 0; i < sel.n_cols; i++) {
        json_object *c = json_object_array_get_idx(cols, i);
        const char *name = (c && json_object_is_type(c, json_type_string))
            ? json_object_get_string(c) : NULL;
        sel.index[i] = -1;
        if (!name || name[0] == '\0') {
            axis2_char_t *r = csv_fail(env, "columns[%d] must be a non-empty string.", i);
            selection_free(env, &sel);
            json_object_put(args);
            return r;
        }
        sel.names[i] = axutil_strdup(env, name);
    }

    /* --- the rest ---
     * Every optional field below is either absent (the default applies) or
     * the right JSON type. A present field of the wrong type is refused, not
     * defaulted: "max_obs":"252" silently becoming the whole file is a
     * different window with nothing in the answer to show it. */
    if (json_object_object_get_ex(args, "column_kind", &v)) {
        if (!json_object_is_type(v, json_type_string)) {
            selection_free(env, &sel);
            json_object_put(args);
            return csv_fail(env, "\"column_kind\" must be the string \"price\" or \"return\".");
        }
        kind = json_object_get_string(v);
    }
    if (strcmp(kind, "price") != 0 && strcmp(kind, "return") != 0) {
        axis2_char_t *r = csv_fail(env,
            "\"column_kind\" must be \"price\" (log returns between rows) or "
            "\"return\" (values used as they are); got \"%s\".", kind);
        selection_free(env, &sel);
        json_object_put(args);
        return r;
    }
    prices = (strcmp(kind, "price") == 0) ? AXIS2_TRUE : AXIS2_FALSE;

    if (json_object_object_get_ex(args, "n_periods_per_year", &v)) {
        if (!json_object_is_type(v, json_type_double) && !json_object_is_type(v, json_type_int)) {
            selection_free(env, &sel);
            json_object_put(args);
            return csv_fail(env, "\"n_periods_per_year\" must be a number (252 daily, 12 monthly, "
                                 "1 to keep the file's basis); omit it for 252.");
        }
        n_periods_per_year = json_object_get_double(v);
    }
    if (json_object_object_get_ex(args, "max_obs", &v)) {
        if (!json_object_is_type(v, json_type_int)) {
            selection_free(env, &sel);
            json_object_put(args);
            return csv_fail(env, "\"max_obs\" must be a whole number of observations; "
                                 "omit it for the whole file (up to %d).", FINBENCH_MAX_OBS);
        }
        max_obs = json_object_get_int(v);
    }
    if (max_obs < 2 || max_obs > FINBENCH_MAX_OBS) {
        axis2_char_t *r = csv_fail(env,
            "\"max_obs\" must be between 2 and %d; got %d.", FINBENCH_MAX_OBS, max_obs);
        selection_free(env, &sel);
        json_object_put(args);
        return r;
    }
    if (json_object_object_get_ex(args, "check_positive_definite", &v)) {
        check_pd = json_object_get_boolean(v) ? AXIS2_TRUE : AXIS2_FALSE;
    }

    /* --- open and size-check --- */
    if (stat(path, &st) != 0 || !S_ISREG(st.st_mode)) {
        axis2_char_t *r = csv_fail(env,
            "No such CSV on this device: \"%s\". listCsvFiles names the ones there are.", file);
        selection_free(env, &sel);
        json_object_put(args);
        return r;
    }
    if (st.st_size > CALCS_CSV_MAX_BYTES) {
        axis2_char_t *r = csv_fail(env,
            "\"%s\" is %lld bytes; the limit is %d.",
            file, (long long)st.st_size, CALCS_CSV_MAX_BYTES);
        selection_free(env, &sel);
        json_object_put(args);
        return r;
    }

    fp = fopen(path, "r");
    line = AXIS2_MALLOC(env->allocator, CALCS_CSV_MAX_LINE);
    fields = AXIS2_MALLOC(env->allocator, CALCS_CSV_MAX_COLUMNS * sizeof(char *));
    if (!fp || !line || !fields) {
        axis2_char_t *r = csv_fail(env, "Could not read \"%s\".", file);
        if (fp) fclose(fp);
        if (line) AXIS2_FREE(env->allocator, line);
        if (fields) AXIS2_FREE(env->allocator, fields);
        selection_free(env, &sel);
        json_object_put(args);
        return r;
    }

    /* --- header --- */
    {
        int n_fields;
        if (!fgets(line, CALCS_CSV_MAX_LINE, fp)) {
            axis2_char_t *r = csv_fail(env, "\"%s\" is empty.", file);
            fclose(fp); AXIS2_FREE(env->allocator, line); AXIS2_FREE(env->allocator, fields);
            selection_free(env, &sel); json_object_put(args);
            return r;
        }
        if (strchr(line, '"')) {
            axis2_char_t *r = csv_fail(env,
                "\"%s\" has a quoted header field. This reader splits on commas and does "
                "not implement CSV quoting; export the file without quotes.", file);
            fclose(fp); AXIS2_FREE(env->allocator, line); AXIS2_FREE(env->allocator, fields);
            selection_free(env, &sel); json_object_put(args);
            return r;
        }
        n_fields = csv_split(line, fields, CALCS_CSV_MAX_COLUMNS);
        if (n_fields > CALCS_CSV_MAX_COLUMNS) n_fields = CALCS_CSV_MAX_COLUMNS;
        for (j = 0; j < n_fields; j++) {
            char *name = csv_trim(fields[j]);
            for (i = 0; i < sel.n_cols; i++) {
                if (sel.index[i] < 0 && strcmp(name, sel.names[i]) == 0) {
                    sel.index[i] = j;
                }
            }
            if (sel.date_index < 0 && strcasecmp(name, "date") == 0) {
                sel.date_index = j;
            }
        }
        for (i = 0; i < sel.n_cols; i++) {
            if (sel.index[i] < 0) {
                axis2_char_t *r = csv_fail(env,
                    "\"%s\" has no column named \"%s\". listCsvFiles reports each file's columns.",
                    file, sel.names[i]);
                fclose(fp); AXIS2_FREE(env->allocator, line); AXIS2_FREE(env->allocator, fields);
                selection_free(env, &sel); json_object_put(args);
                return r;
            }
        }
    }

    /* --- pass 1: count data rows, so only the newest ones are held --- */
    while (fgets(line, CALCS_CSV_MAX_LINE, fp)) {
        if (csv_trim(line)[0] == '\0') continue;
        n_rows_total++;
    }

    {
        int want_rows = prices ? max_obs + 1 : max_obs;
        n_rows_used = (n_rows_total < want_rows) ? n_rows_total : want_rows;
    }
    if (n_rows_used < 2) {
        axis2_char_t *r = csv_fail(env,
            "\"%s\" has %d data rows; at least 2 are needed.", file, n_rows_total);
        fclose(fp); AXIS2_FREE(env->allocator, line); AXIS2_FREE(env->allocator, fields);
        selection_free(env, &sel); json_object_put(args);
        return r;
    }

    stride = n_rows_used;
    values = AXIS2_MALLOC(env->allocator,
        (size_t)sel.n_cols * stride * sizeof(double));
    if (!values) {
        axis2_char_t *r = csv_fail(env, "Memory allocation failed for %d columns x %d rows.",
                                   sel.n_cols, n_rows_used);
        fclose(fp); AXIS2_FREE(env->allocator, line); AXIS2_FREE(env->allocator, fields);
        selection_free(env, &sel); json_object_put(args);
        return r;
    }

    /* --- pass 2: read the last n_rows_used rows --- */
    rewind(fp);
    if (!fgets(line, CALCS_CSV_MAX_LINE, fp)) {   /* header again */
        axis2_char_t *r = csv_fail(env, "Could not re-read \"%s\".", file);
        fclose(fp); AXIS2_FREE(env->allocator, line); AXIS2_FREE(env->allocator, fields);
        AXIS2_FREE(env->allocator, values); selection_free(env, &sel); json_object_put(args);
        return r;
    }
    row = 0;
    {
        int seen = 0;
        int skip = n_rows_total - n_rows_used;
        while (row < n_rows_used && fgets(line, CALCS_CSV_MAX_LINE, fp)) {
            int n_fields;
            char *raw = line;

            if (csv_trim(raw)[0] == '\0') continue;
            if (seen++ < skip) continue;
            if (strchr(raw, '"')) {
                axis2_char_t *r = csv_fail(env,
                    "\"%s\" row %d has a quoted field; this reader does not implement "
                    "CSV quoting.", file, seen);
                fclose(fp); AXIS2_FREE(env->allocator, line); AXIS2_FREE(env->allocator, fields);
                AXIS2_FREE(env->allocator, values); selection_free(env, &sel); json_object_put(args);
                return r;
            }
            n_fields = csv_split(raw, fields, CALCS_CSV_MAX_COLUMNS);
            for (i = 0; i < sel.n_cols; i++) {
                double cell;
                const char *text = (sel.index[i] < n_fields && sel.index[i] < CALCS_CSV_MAX_COLUMNS)
                    ? csv_trim(fields[sel.index[i]]) : "";
                if (csv_cell(text, &cell) != 0) {
                    axis2_char_t *r = csv_fail(env,
                        "\"%s\" row %d, column \"%s\": \"%s\" is neither a number nor blank.",
                        file, seen, sel.names[i], text);
                    fclose(fp); AXIS2_FREE(env->allocator, line);
                    AXIS2_FREE(env->allocator, fields); AXIS2_FREE(env->allocator, values);
                    selection_free(env, &sel); json_object_put(args);
                    return r;
                }
                values[(size_t)i * stride + row] = cell;
            }
            if (sel.date_index >= 0 && sel.date_index < n_fields) {
                const char *d = csv_trim(fields[sel.date_index]);
                if (row == 0) snprintf(first_date, sizeof(first_date), "%s", d);
                snprintf(last_date, sizeof(last_date), "%s", d);
            }
            row++;
        }
    }
    fclose(fp);
    AXIS2_FREE(env->allocator, line);
    AXIS2_FREE(env->allocator, fields);
    n_rows_used = row;

    /* Row order. "max_obs newest rows" takes the LAST rows, and a price
     * column's log return is log(row[t+1] / row[t]); both assume the file
     * runs oldest-first, which is how every bundled file and the import path
     * write it. Many exports run newest-first. With ISO dates that would
     * silently select the oldest rows and flip the sign of every mean return
     * (the covariance itself is unchanged, which is what makes it silent), so
     * when a Date column is present and both ends parse as ISO dates, a
     * descending file is refused rather than guessed at. */
    if (first_date[0] && last_date[0] &&
        isdigit((unsigned char)first_date[0]) && isdigit((unsigned char)last_date[0]) &&
        strlen(first_date) >= 8 && strlen(last_date) >= 8 &&
        strcmp(first_date, last_date) > 0) {
        axis2_char_t *r = csv_fail(env,
            "\"%s\" runs newest-first (first row %s, last row %s). This reader takes "
            "the last rows as the newest and computes returns forward in time, so it "
            "needs the file sorted oldest-first.", file, first_date, last_date);
        AXIS2_FREE(env->allocator, values); selection_free(env, &sel); json_object_put(args);
        return r;
    }

    /* --- returns --- */
    n_obs = prices ? n_rows_used - 1 : n_rows_used;
    if (n_obs < 2) {
        axis2_char_t *r = csv_fail(env,
            "\"%s\" yields %d observations; at least 2 are needed.", file, n_obs);
        AXIS2_FREE(env->allocator, values); selection_free(env, &sel); json_object_put(args);
        return r;
    }

    req = AXIS2_MALLOC(env->allocator, sizeof(finbench_covariance_from_returns_request_t));
    if (!req) {
        axis2_char_t *r = csv_fail(env, "Memory allocation failed.");
        AXIS2_FREE(env->allocator, values); selection_free(env, &sel); json_object_put(args);
        return r;
    }
    memset(req, 0, sizeof(*req));
    req->n_assets = sel.n_cols;
    req->n_obs = n_obs;
    req->obs_provided = n_obs;
    req->rows_provided = sel.n_cols;
    req->ragged_at = -1;
    req->bad_value_row = -1;
    req->bad_value_col = -1;
    req->n_periods_per_year = n_periods_per_year;
    req->check_positive_definite = check_pd;
    req->returns = AXIS2_MALLOC(env->allocator,
        (size_t)sel.n_cols * n_obs * sizeof(double));
    if (!req->returns) {
        axis2_char_t *r = csv_fail(env, "Memory allocation failed for %d columns x %d observations.",
                                   sel.n_cols, n_obs);
        AXIS2_FREE(env->allocator, req);
        AXIS2_FREE(env->allocator, values); selection_free(env, &sel); json_object_put(args);
        return r;
    }

    for (i = 0; i < sel.n_cols; i++) {
        for (j = 0; j < n_obs; j++) {
            double r_val;
            if (prices) {
                double p0 = values[(size_t)i * stride + j];
                double p1 = values[(size_t)i * stride + j + 1];
                /* A non-positive or missing price makes this one return
                 * unobserved rather than the whole column unusable; the
                 * estimator's complete-case rule takes it from there. */
                r_val = (isnan(p0) || isnan(p1) || p0 <= 0.0 || p1 <= 0.0)
                    ? NAN : log(p1 / p0);
            } else {
                r_val = values[(size_t)i * stride + j];
            }
            req->returns[(size_t)i * n_obs + j] = r_val;
        }
    }
    AXIS2_FREE(env->allocator, values);
    values = NULL;

    /* asset_ids: the caller's labels, or the column names */
    req->asset_ids = AXIS2_MALLOC(env->allocator, (size_t)sel.n_cols * sizeof(char *));
    if (req->asset_ids) {
        json_object *ids = NULL;
        axis2_bool_t have_ids =
            (json_object_object_get_ex(args, "asset_ids", &ids) &&
             json_object_is_type(ids, json_type_array) &&
             (int)json_object_array_length(ids) == sel.n_cols) ? AXIS2_TRUE : AXIS2_FALSE;
        for (i = 0; i < sel.n_cols; i++) {
            const char *label = sel.names[i];
            if (have_ids) {
                json_object *c = json_object_array_get_idx(ids, i);
                if (c && json_object_is_type(c, json_type_string)) {
                    label = json_object_get_string(c);
                }
            }
            req->asset_ids[i] = axutil_strdup(env, label);
        }
    }
    if (json_object_object_get_ex(args, "request_id", &v) &&
        json_object_is_type(v, json_type_string)) {
        req->request_id = axutil_strdup(env, json_object_get_string(v));
    }

    /* --- the upstream estimator does the statistics --- */
    resp = finbench_covariance_from_returns(env, req);
    resp_json = resp ? finbench_covariance_from_returns_response_to_json(resp, env) : NULL;

    if (resp) finbench_covariance_from_returns_response_free(resp, env);
    finbench_covariance_from_returns_request_free(req, env);

    if (!resp_json) {
        selection_free(env, &sel);
        json_object_put(args);
        return csv_fail(env, "The estimator returned no response.");
    }

    /* --- add provenance: which file, which columns, which window --- */
    resp_obj = json_tokener_parse(resp_json);
    AXIS2_FREE(env->allocator, resp_json);
    if (!resp_obj) {
        selection_free(env, &sel);
        json_object_put(args);
        return csv_fail(env, "The estimator's response did not parse.");
    }
    json_object_object_add(resp_obj, "csv_file", json_object_new_string(file));
    json_object_object_add(resp_obj, "csv_rows_used", json_object_new_int(n_rows_used));
    json_object_object_add(resp_obj, "csv_rows_total", json_object_new_int(n_rows_total));
    json_object_object_add(resp_obj, "column_kind", json_object_new_string(kind));
    {
        json_object *arr = json_object_new_array();
        for (i = 0; i < sel.n_cols; i++) {
            json_object_array_add(arr, json_object_new_string(sel.names[i]));
        }
        json_object_object_add(resp_obj, "columns", arr);
    }
    if (first_date[0]) {
        json_object_object_add(resp_obj, "first_row_date", json_object_new_string(first_date));
        json_object_object_add(resp_obj, "last_row_date", json_object_new_string(last_date));
    }

    out = axutil_strdup(env, json_object_to_json_string_ext(resp_obj, JSON_C_TO_STRING_PLAIN));
    json_object_put(resp_obj);

    if (env->log) {
        /* Before the arguments are freed: "file" points into them. */
        AXIS2_LOG_INFO(env->log,
            "[Calcs CSV] covarianceFromCsv: %d columns x %d rows of %s",
            sel.n_cols, n_rows_used, file);
    }
    selection_free(env, &sel);
    json_object_put(args);
    return out;
}

/* ------------------------------------------------------------------------- */
/* listCsvFiles                                                              */
/* ------------------------------------------------------------------------- */

axis2_char_t *
kanaha_calcs_csv_list_json(
    const axutil_env_t *env,
    const axis2_char_t *args_json)
{
    DIR *d;
    struct dirent *ent;
    json_object *out_obj, *arr;
    const char *dir = csv_dir();
    axis2_char_t *out;
    int count = 0;

    (void)args_json;   /* no arguments */
    if (!env) return NULL;

    out_obj = json_object_new_object();
    arr = json_object_new_array();

    d = opendir(dir);
    if (!d) {
        json_object_object_add(out_obj, "status",
            json_object_new_string(FINBENCH_STATUS_SUCCESS));
        json_object_object_add(out_obj, "files", arr);
        json_object_object_add(out_obj, "note",
            json_object_new_string("No CSV directory yet: import a CSV in the app first."));
        out = axutil_strdup(env, json_object_to_json_string_ext(out_obj, JSON_C_TO_STRING_PLAIN));
        json_object_put(out_obj);
        return out;
    }

    while ((ent = readdir(d)) != NULL && count < 200) {
        char path[768];
        struct stat st;
        json_object *entry;
        FILE *fp;
        char *line;

        if (!csv_name_ok(ent->d_name)) continue;
        snprintf(path, sizeof(path), "%s/%s", dir, ent->d_name);
        if (stat(path, &st) != 0 || !S_ISREG(st.st_mode)) continue;

        entry = json_object_new_object();
        json_object_object_add(entry, "file", json_object_new_string(ent->d_name));
        json_object_object_add(entry, "size_bytes", json_object_new_int64((int64_t)st.st_size));
        json_object_object_add(entry, "modified_ms",
            json_object_new_int64((int64_t)st.st_mtime * 1000));

        /* The header is what a caller needs to name columns, so read just it. */
        line = AXIS2_MALLOC(env->allocator, CALCS_CSV_MAX_LINE);
        fp = line ? fopen(path, "r") : NULL;
        if (fp && fgets(line, CALCS_CSV_MAX_LINE, fp)) {
            char **fields = AXIS2_MALLOC(env->allocator, CALCS_CSV_MAX_COLUMNS * sizeof(char *));
            if (fields) {
                int n = csv_split(line, fields, CALCS_CSV_MAX_COLUMNS);
                json_object *cols = json_object_new_array();
                int k;
                if (n > CALCS_CSV_MAX_COLUMNS) n = CALCS_CSV_MAX_COLUMNS;
                for (k = 0; k < n; k++) {
                    json_object_array_add(cols, json_object_new_string(csv_trim(fields[k])));
                }
                json_object_object_add(entry, "columns", cols);
                AXIS2_FREE(env->allocator, fields);
            }
        }
        if (fp) fclose(fp);
        if (line) AXIS2_FREE(env->allocator, line);

        json_object_array_add(arr, entry);
        count++;
    }
    closedir(d);

    json_object_object_add(out_obj, "status",
        json_object_new_string(FINBENCH_STATUS_SUCCESS));
    json_object_object_add(out_obj, "n_files", json_object_new_int(count));
    json_object_object_add(out_obj, "files", arr);

    out = axutil_strdup(env, json_object_to_json_string_ext(out_obj, JSON_C_TO_STRING_PLAIN));
    json_object_put(out_obj);
    return out;
}

/* ------------------------------------------------------------------------- */
/* MCP extension point (strong definitions override the transport's weak ones)*/
/* ------------------------------------------------------------------------- */

static const char SCHEMA_COVARIANCE_FROM_CSV[] =
    "{"
    "\"type\":\"object\","
    "\"properties\":{"
        "\"file\":{\"type\":\"string\","
            "\"description\":\"CSV file name on the device, exactly as listCsvFiles reports it\"},"
        "\"columns\":{\"type\":\"array\",\"items\":{\"type\":\"string\"},"
            "\"description\":\"Header names to use, one per asset (max 50). listCsvFiles reports "
                "each file's columns\"},"
        "\"column_kind\":{\"type\":\"string\",\"enum\":[\"price\",\"return\"],"
            "\"description\":\"price (default): log returns between consecutive rows. "
                "return: the values are already periodic returns\"},"
        "\"n_periods_per_year\":{\"type\":\"number\","
            "\"description\":\"Annualization factor, 252 by default (daily). 12 for monthly, "
                "1 to keep the file's own basis\"},"
        "\"max_obs\":{\"type\":\"integer\","
            "\"description\":\"Use at most this many observations, counted from the newest row. "
                "Default and maximum 5000\"},"
        "\"check_positive_definite\":{\"type\":\"boolean\","
            "\"description\":\"Cholesky check on the result. Default true\"},"
        "\"asset_ids\":{\"type\":\"array\",\"items\":{\"type\":\"string\"},"
            "\"description\":\"Optional labels, one per column; the column names by default\"},"
        "\"request_id\":{\"type\":\"string\"}"
    "},"
    "\"required\":[\"file\",\"columns\"]"
    "}";

static const char SCHEMA_LIST_CSV_FILES[] =
    "{\"type\":\"object\",\"properties\":{}}";

static const finbench_mcp_tool_t calcs_extra_tools[] = {
    {
        "covarianceFromCsv",
        "Covariance matrix from a CSV this device already holds. Reads the named columns of the "
        "named file under the app's CSV directory, turns prices into log returns (or takes the "
        "values as returns), and runs the same estimator as covarianceFromReturns, annualized. "
        "Returns the flat row-major covariance_matrix that portfolioVariance and monteCarlo take, "
        "plus the correlations, volatilities, annualized means, observations per pair, and which "
        "file, columns and date range produced them. The data never leaves the device.",
        SCHEMA_COVARIANCE_FROM_CSV
    },
    {
        "listCsvFiles",
        "List the CSV files on this device with their size, modification time and header columns. "
        "Call this first: it is how you learn what covarianceFromCsv may be given.",
        SCHEMA_LIST_CSV_FILES
    },
    { NULL, NULL, NULL }
};

const finbench_mcp_tool_t *
finbench_mcp_extra_tools(void)
{
    return calcs_extra_tools;
}

axis2_char_t *
finbench_mcp_extra_dispatch(
    const axutil_env_t *env,
    const axis2_char_t *tool_name,
    const axis2_char_t *args_json)
{
    if (!tool_name) return NULL;
    if (strcmp(tool_name, "covarianceFromCsv") == 0) {
        return kanaha_calcs_csv_covariance_json(env, args_json);
    }
    if (strcmp(tool_name, "listCsvFiles") == 0) {
        return kanaha_calcs_csv_list_json(env, args_json);
    }
    return NULL;   /* not ours; the transport reports an unknown tool */
}
