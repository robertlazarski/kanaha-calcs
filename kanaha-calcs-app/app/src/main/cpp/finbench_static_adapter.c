/*
 * Kanaha Calcs — Axis2/C Static Service Adapter for FinancialBenchmarkService
 *
 * Bridges the Android 2-param json_object* signature (static registry) to the
 * upstream service in financial_benchmark_service.c. Three jobs, in order:
 *
 *   1. Log a bounded, control-character-free excerpt of the request. The body
 *      is untrusted; a raw copy could forge log lines.
 *   2. Pre-flight the numeric limits (AGENTS.md: this file is the one place
 *      calcs can bound inputs before the engine sees them). The engine checks
 *      the same limits itself; this is defence in depth, and it is where an
 *      Android build could tighten them below the engine's if a device needed.
 *   3. Dispatch. The app's own operations (covarianceFromCsv, listCsvFiles)
 *      are handled here because they read a file only this app has; everything
 *      else goes through finbench_dispatch_json_obj(), the upstream router. It
 *      honours the "operation" field the engine adds on the Android path (or a
 *      caller's "action"), and only infers the operation from request shape
 *      when neither is present. One router upstream, none here.
 *
 * Android static registry calls:
 *   json_object* financial_benchmark_service_invoke_json(env, json_request)
 * and this file provides that strong symbol, overriding the weak stub in
 * axis2_json_rpc_msg_recv.c.
 */

#include <axutil_env.h>
#include <axutil_log.h>
#include <json-c/json.h>
#include <string.h>
#include <stdio.h>
#include <stdint.h>

#include "financial_benchmark_service.h"
#include "calcs_csv_source.h"

/* ------------------------------------------------------------------------- */

static json_object *
adapter_fail(const axutil_env_t *env, const char *msg)
{
    json_object *r = json_object_new_object();
    json_object_object_add(r, "status", json_object_new_string(FINBENCH_STATUS_FAILED));
    json_object_object_add(r, "error_message", json_object_new_string(msg));
    if (env && env->log) {
        AXIS2_LOG_WARNING(env->log, AXIS2_LOG_SI, "[FinBench Adapter] refused: %s", msg);
    }
    return r;
}

static int
opt_int(json_object *o, const char *key, int dflt)
{
    json_object *v = NULL;
    if (json_object_object_get_ex(o, key, &v) &&
        (json_object_is_type(v, json_type_int) || json_object_is_type(v, json_type_double))) {
        return json_object_get_int(v);
    }
    return dflt;
}

static int
array_len(json_object *o, const char *key)
{
    json_object *v = NULL;
    if (json_object_object_get_ex(o, key, &v) && json_object_is_type(v, json_type_array)) {
        return (int)json_object_array_length(v);
    }
    return -1;   /* absent or not an array */
}

/*
 * Pre-flight limits. Returns NULL when the request may proceed, else a
 * message for the caller. Mirrors the engine's own constants so the two can
 * never disagree on a number; the checks that need a parse (matrix shape,
 * symmetry, positive definiteness) stay in the engine.
 */
static const char *
preflight_limits(json_object *req, char *buf, size_t buf_len)
{
    int n_vols = array_len(req, "volatilities");
    int n_weights = array_len(req, "weights");
    int n_assets = opt_int(req, "n_assets", -1);
    int has_cov = (array_len(req, "covariance_matrix") >= 0);

    /* composeCovariance: n_assets ≤ FINBENCH_MAX_COV_ASSETS (O(n^3) check, n^2 reply) */
    if (n_vols >= 0) {
        int n = (n_assets > 0) ? n_assets : n_vols;
        if (n > FINBENCH_MAX_COV_ASSETS || n_vols > FINBENCH_MAX_COV_ASSETS) {
            snprintf(buf, buf_len, "composeCovariance is limited to %d assets on this device; got %d.",
                     FINBENCH_MAX_COV_ASSETS, (n > n_vols) ? n : n_vols);
            return buf;
        }
        return NULL;
    }

    /* monteCarlo: simulation size, and for a correlated book the asset count
     * and the asset-step budget. A request with weights and a covariance
     * matrix but no simulation parameter is portfolioVariance's shape; the
     * engine routes it there, so only the variance limit applies to it. */
    {
        int n_sims = opt_int(req, "n_simulations", -1);
        int n_periods = opt_int(req, "n_periods", -1);
        int is_mc = (n_sims >= 0 || n_periods >= 0 ||
                     json_object_object_get_ex(req, "initial_value", NULL) ||
                     json_object_object_get_ex(req, "expected_return", NULL) ||
                     json_object_object_get_ex(req, "expected_returns", NULL) ||
                     json_object_object_get_ex(req, "volatility", NULL) ||
                     json_object_object_get_ex(req, "random_seed", NULL) ||
                     json_object_object_get_ex(req, "model", NULL));
        if (is_mc) {
            int sims = (n_sims >= 0) ? n_sims : 10000;
            int periods = (n_periods >= 0) ? n_periods : 252;
            int n = has_cov ? ((n_assets > 0) ? n_assets : (n_weights > 0 ? n_weights : 1)) : 1;
            if (sims > FINBENCH_MAX_SIMULATIONS) {
                snprintf(buf, buf_len, "n_simulations=%d exceeds %d.", sims, FINBENCH_MAX_SIMULATIONS);
                return buf;
            }
            if (periods > FINBENCH_MAX_PERIODS) {
                snprintf(buf, buf_len, "n_periods=%d exceeds %d.", periods, FINBENCH_MAX_PERIODS);
                return buf;
            }
            if (has_cov && n > FINBENCH_MAX_MC_ASSETS) {
                snprintf(buf, buf_len, "a correlated monteCarlo book is limited to %d assets; got %d.",
                         FINBENCH_MAX_MC_ASSETS, n);
                return buf;
            }
            if ((int64_t)sims * periods * n > FINBENCH_MAX_WORK) {
                snprintf(buf, buf_len,
                         "n_simulations * n_periods * n_assets = %lld exceeds the budget of %ld asset-steps.",
                         (long long)sims * periods * n, (long)FINBENCH_MAX_WORK);
                return buf;
            }
            return NULL;
        }
    }

    /* portfolioVariance / scenarioAnalysis: asset count */
    {
        int n = (n_assets > 0) ? n_assets : n_weights;
        if (n > FINBENCH_MAX_ASSETS) {
            snprintf(buf, buf_len, "n_assets=%d exceeds %d.", n, FINBENCH_MAX_ASSETS);
            return buf;
        }
    }
    return NULL;
}

/*
 * Turn one of the CSV operations' response strings into the json_object the
 * registry expects, freeing the string. A response that will not parse is a
 * bug here, not a caller's doing, so it reports itself rather than returning
 * an empty body.
 */
static json_object *
calcs_json_string_to_obj(const axutil_env_t *env, axis2_char_t *json_str)
{
    json_object *obj;

    if (!json_str) {
        return adapter_fail(env, "The CSV operation returned no response.");
    }
    obj = json_tokener_parse(json_str);
    AXIS2_FREE(env->allocator, json_str);
    if (!obj) {
        return adapter_fail(env, "The CSV operation's response did not parse.");
    }
    return obj;
}

/* ------------------------------------------------------------------------- */

/**
 * Strong symbol — overrides the weak stub in axis2_json_rpc_msg_recv.c.
 * Called by the Android static service registry for FinancialBenchmarkService.
 */
json_object* financial_benchmark_service_invoke_json(
    const axutil_env_t *env,
    json_object *json_request)
{
    char excerpt[FINBENCH_LOG_EXCERPT];
    char limit_msg[256];
    const char *limit_err;

    if (!env) {
        return NULL;
    }
    if (!json_request || !json_object_is_type(json_request, json_type_object)) {
        return adapter_fail(env, "Request must be a JSON object");
    }

    if (env->log) {
        finbench_log_excerpt(json_object_to_json_string_ext(json_request, JSON_C_TO_STRING_PLAIN),
                             excerpt, sizeof(excerpt));
        AXIS2_LOG_INFO(env->log, AXIS2_LOG_SI, "[FinBench Adapter] request: %s", excerpt);
    }

    /* The app's own operations, named and never inferred: they read a CSV
     * under the app's files directory, which is this app's business and not
     * the sample's. Both are answered here and never reach the upstream
     * router, which has no operation by either name. The engine has already
     * refused a body that names a different operation than the URL, so a name
     * that arrives here came from the URL or from an MCP tool call. */
    {
        json_object *op_obj = NULL;
        const char *op = NULL;

        if (json_object_object_get_ex(json_request, "operation", &op_obj) ||
            json_object_object_get_ex(json_request, "action", &op_obj)) {
            if (json_object_is_type(op_obj, json_type_string)) {
                op = json_object_get_string(op_obj);
            }
        }
        if (op && (strcmp(op, "covarianceFromCsv") == 0 ||
                   strcmp(op, "covariance_from_csv") == 0)) {
            return calcs_json_string_to_obj(env,
                kanaha_calcs_csv_covariance_json(env,
                    json_object_to_json_string_ext(json_request, JSON_C_TO_STRING_PLAIN)));
        }
        if (op && (strcmp(op, "listCsvFiles") == 0 ||
                   strcmp(op, "list_csv_files") == 0)) {
            return calcs_json_string_to_obj(env, kanaha_calcs_csv_list_json(env, "{}"));
        }
    }

    limit_err = preflight_limits(json_request, limit_msg, sizeof(limit_msg));
    if (limit_err) {
        return adapter_fail(env, limit_err);
    }

    /* The upstream router owns operation selection: "operation" (added by the
     * engine from the URL) or "action" first, request shape as the fallback.
     * It returns a fresh json_object the caller owns. */
    return finbench_dispatch_json_obj(env, json_request);
}
