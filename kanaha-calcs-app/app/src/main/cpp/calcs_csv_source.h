/*
 * Kanaha Calcs — CSV data source for the financial benchmark operations
 *
 * The upstream sample has no file of its own to read: covarianceFromReturns
 * takes a return matrix in the request. This file is the app's side of that
 * line. It reads a CSV the phone already holds under files/csv, turns the
 * chosen columns into returns, and hands them to the upstream estimator, so
 * the matrix can come from the device's own data with no laptop in the path.
 *
 * Exposed two ways, both named by the caller and never by shape:
 *   - over HTTP/2, through the static adapter (operations covarianceFromCsv
 *     and listCsvFiles in services.xml)
 *   - over MCP, through the transport's weak extension point
 *     (finbench_mcp_extra_tools / finbench_mcp_extra_dispatch)
 *
 * SPDX-License-Identifier: Apache-2.0
 */

#ifndef KANAHA_CALCS_CSV_SOURCE_H
#define KANAHA_CALCS_CSV_SOURCE_H

#include <axutil_env.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Longest CSV file name accepted, including the extension. */
#define CALCS_CSV_MAX_NAME      128

/** Largest CSV read, in bytes. Matches the app's own 10 MB import cap. */
#define CALCS_CSV_MAX_BYTES     (10 * 1024 * 1024)

/** Longest CSV line accepted. A row of 512 columns fits comfortably. */
#define CALCS_CSV_MAX_LINE      65536

/** Most columns read from the header. */
#define CALCS_CSV_MAX_COLUMNS   512

/**
 * Covariance from a CSV the device holds.
 *
 * Arguments (JSON object):
 *   file                    required, exact name under the CSV directory
 *   columns                 required, header names to use (1..50)
 *   column_kind             "price" (default, log returns between rows) or
 *                           "return" (values used as they are)
 *   n_periods_per_year      default 252
 *   max_obs                 default and cap 5000, counted from the newest row
 *   check_positive_definite default true
 *   asset_ids               optional labels; the column names by default
 *   request_id              optional, echoed
 *
 * @return Response JSON allocated with the env's allocator, never NULL for a
 *         well-formed call: a refusal is a FAILED status with a message.
 */
axis2_char_t *
kanaha_calcs_csv_covariance_json(
    const axutil_env_t *env,
    const axis2_char_t *args_json);

/**
 * List the CSVs the device holds, with their size, modification time and
 * header columns. Takes no arguments. This is how a caller that cannot see
 * the filesystem learns what it may name in "file".
 */
axis2_char_t *
kanaha_calcs_csv_list_json(
    const axutil_env_t *env,
    const axis2_char_t *args_json);

#ifdef __cplusplus
}
#endif

#endif /* KANAHA_CALCS_CSV_SOURCE_H */
