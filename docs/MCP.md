# MCP Support for Kanaha Calcs

**Summary**: Kanaha Calcs exposes its native financial-computation engine over
MCP (Model Context Protocol), so an AI assistant (Claude Desktop, Claude API,
custom agents) can discover and run the calculators as tools. The MCP server is
a native ARM64 binary on the phone speaking JSON-RPC 2.0 over stdio — no JVM.

MCP uses three required methods: `initialize`, `tools/list`, `tools/call`. The
transport is stdio (the client launches the binary as a subprocess). The same
operations available to the WebView over HTTP/2 JSON are reachable through MCP
with identical request/response semantics.

The MCP binary is built from the Apache Axis2/C financial-benchmark service
(`finbench_mcp.c` in `axis-axis2-c-core`) — the same source that ships the
standalone `financial-benchmark-mcp` tool. Kanaha Calcs packages that code as
`libkanaha_mcp.so` following the same jniLibs/deploy convention as the other
Kanaha apps. Protocol framing, the static tool catalog, and dispatch are shared;
only packaging and the launch path differ.

---

## MCP Tools (7 operations)

| Tool | Description | Required Parameters |
|------|-------------|---------------------|
| `portfolioVariance` | Portfolio variance via O(n²) covariance-matrix multiplication; returns variance, volatility, annualized volatility, op count, and µs timing | `n_assets`, `weights`, `covariance_matrix` |
| `composeCovariance` | Builds the covariance matrix `portfolioVariance` consumes from per-asset volatilities and either a full correlation matrix or one uniform correlation (Σ = D·R·D); Cholesky-checks it and refuses a matrix that is not positive definite, naming the failing index | `volatilities`, plus one of `correlation` / `correlation_matrix` |
| `covarianceFromReturns` | Sample covariance of a return matrix passed in the request, Bessel-corrected and annualized; complete-case for missing values, with observations per pair reported; same Cholesky check | `returns` |
| `covarianceFromCsv` | The same estimator over a CSV the phone already holds: names the file and the columns, turns prices into log returns, and reports which file, columns and dates produced the matrix. The app's own operation, not the upstream sample's | `file`, `columns` |
| `listCsvFiles` | The CSVs on the device with size, modification time and header columns. What a caller reads before naming a file | *(none)* |
| `monteCarlo` | Monte Carlo VaR under Geometric Brownian Motion or Merton jump-diffusion; a single asset by `volatility`, or a correlated buy-and-hold book when `covariance_matrix` + `weights` are supplied (shocks through the matrix's Cholesky factor); returns VaR at caller percentiles, CVaR, max drawdown, probability of profit, sims/sec, and for a book `portfolio_volatility` | *(none — empty `{}` is valid)* |
| `scenarioAnalysis` | Probability-weighted multi-asset scenario analysis; returns expected return, upside/downside, and O(1) vs O(n) lookup benchmark | `assets` |

All seven tools carry a full `inputSchema` (types, descriptions, defaults), so
the assistant constructs valid calls without external documentation. Key
optional parameters:

- **portfolioVariance**: `normalize_weights` (default false), `n_periods_per_year`
  (default 1: the matrix is taken as already annualized, which is what
  `composeCovariance`, `covarianceFromReturns` and `covarianceFromCsv` return;
  pass 252 only for a daily matrix, 52 weekly, 12 monthly), `request_id`.
  `covariance_matrix` is the flattened row-major `n_assets × n_assets` matrix.
  Max 3000 assets. The response echoes `n_periods_per_year` and
  `covariance_basis` (`annualized` | `per_period`). Builds from upstream before
  2026-09-20 defaulted to 252 and over-reported `annualized_volatility` on an
  annualized matrix by √252; passing `n_periods_per_year: 1` explicitly is
  correct on both. Refused rather than guessed: `covariance_basis:
  "annualized"` alongside any `n_periods_per_year` other than 1 (the shape of a
  `covarianceFromCsv` or `covarianceFromReturns` response passed straight back,
  whose 252 is the factor already applied), a non-finite matrix entry including
  the diagonal, and a non-finite `w'Σw`.
- **composeCovariance**: `n_assets` (inferred from `volatilities` if absent),
  `check_positive_definite` (default true; O(n³)), `asset_ids` (echoed),
  `request_id`. Vols are decimals (0.22 = 22 %) and the matrix inherits their
  time basis; the response stamps `covariance_basis: "annualized"` and
  `portfolioVariance` takes it as such by default. This is the validated front door for hypothetical
  regimes ("every vol 22 %, correlation 0.5"): vols and correlations are short
  and bounded; a raw covariance matrix is not.
- **covarianceFromReturns**: `n_assets` / `n_obs` (inferred from a nested
  `returns` array), `n_periods_per_year` (default 252, 1 keeps the input's
  basis; the output is annualized by it and stamped `covariance_basis:
  "annualized"`), `check_positive_definite`, `asset_ids`, `request_id`. A `null`
  element means that observation is missing, and an observation where any
  asset is missing is dropped for every asset. Max 50 assets × 5000
  observations: the request itself carries the data.
- **covarianceFromCsv**: `column_kind` (`price`, the default, takes log
  returns between rows; `return` uses the values as they are),
  `n_periods_per_year`, `max_obs` (newest rows first, default and max 5000),
  `check_positive_definite` (a boolean), `asset_ids` (one non-empty label per
  column, same length as `columns`), `request_id`. A field of the wrong type
  or length is refused, not defaulted. `file` must be one plain name from `listCsvFiles`: no
  separators, no `..`, ending in `.csv`. Imported CSVs land in the app's
  `files/csv` when the user picks one; nothing else is readable.
- **monteCarlo**: `n_simulations` (max 1,000,000; default 10,000), `n_periods`
  (default 252), `initial_value`, `expected_return`, `volatility`, `random_seed`
  (0 = non-deterministic), `n_periods_per_year`, `percentiles` (max 8; default
  `[0.01, 0.05]` → 99% and 95% VaR), `model` (`gbm` | `merton`) with
  `jump_intensity` / `jump_mean` / `jump_vol`. **Correlated book:**
  `covariance_matrix` (from `composeCovariance`) + `weights` (≥ 0, long-only),
  optional `expected_returns` and `normalize_weights`; max 100 assets, work cap
  `n_simulations × n_periods × n_assets` (asset-steps, 10⁹). One asset with Σ = [σ²] reproduces
  the scalar run bit-for-bit for the same seed.

**The basis and window fields are absent or correct, never coerced.** A
`n_periods_per_year`, `max_obs` or `column_kind` that is present with the wrong
type or out of range is refused with a message naming it; only an absent field
takes its default. `n_periods_per_year` must be a JSON number > 0 (a whole number for
`portfolioVariance` and `monteCarlo`, which count periods; `covarianceFromCsv`
and `covarianceFromReturns` accept a fraction, since they scale by it), and
`max_obs` must be a JSON integer. A string such as `"252"` is refused rather
than parsed, and `252.25` is refused rather than truncated.

- **scenarioAnalysis**: each asset needs `asset_id`, `current_price`, and a
  `scenarios` list (≥2 entries whose probabilities sum to 1.0); optional
  `use_hash_lookup` (default true), `prob_tolerance` (default 1e-4).

---

## Architecture

```
MCP client (Claude Desktop / API)
    ↓ stdin (JSON-RPC 2.0)
libkanaha_mcp.so  →  deployed to files/kanaha-calcs-mcp (native ARM64 binary)
    ↓ tools/call dispatches to finbench_*_json_only()
financial_benchmark_service.c (native C math: covariance, GBM, scenarios)
    ↓ stdout (JSON-RPC 2.0)
MCP client (displays result)
```

The MCP binary links json-c and the Axis2/C libraries needed by the service
math; it does **not** run Apache httpd or mod_ssl. It is a plain subprocess
launched over stdio — there is no JNI. (Packaging it as `libkanaha_mcp.so` is
only Android's convention for getting a file extracted to `nativeLibraryDir`;
`CalcsService` then copies it to the stable `files/kanaha-calcs-mcp` path and
marks it executable.)

This is the same on-device engine the WebView UI calls over HTTP/2 + mTLS
(`Axis2Client` → `https://127.0.0.1:8444/services/FinancialBenchmarkService`).
MCP is a second front door to the identical calculations, bypassing the HTTP
layer entirely.

---

## Relationship to the other Kanaha MCP servers

| | Kanaha Calcs | Kanaha Camera | Kanaha Audio |
|---|---|---|---|
| Packaged binary | `libkanaha_mcp.so` | `libkanaha_mcp.so` | `libkanaha_mcp.so` |
| Deployed to | `files/kanaha-calcs-mcp` | `files/kanaha-camera-mcp` | `files/kanaha-audio-mcp` |
| Source | `finbench_mcp.c` (axis2-c-core) | `kanaha_mcp.c` | `kanaha_mcp.c` (audio) |
| Tools | 4 (finance) | 9 (camera) | 14 (audio) |
| Protocol | MCP 2024-11-05 | MCP 2024-11-05 | MCP 2024-11-05 |
| Built by | `build-android.sh` | CMake (externalNativeBuild) | `build-android.sh` |

The same MCP client connects to all three — the protocol is identical; only the
tool names and parameter schemas differ.

---

## Claude Desktop Configuration

Launched over ADB with `run-as`, so the binary runs under the app's own UID and
can reach app-private storage. The `files/` path is stable across reinstalls
(the `/data/app/...` install path carries a hash that changes every reinstall):

```json
{
  "mcpServers": {
    "kanaha-calcs": {
      "command": "adb",
      "args": ["-s", "PIXEL_SERIAL", "shell",
               "run-as", "org.kanaha.calcs", "./files/kanaha-calcs-mcp"]
    }
  }
}
```

Sanity check before use:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | \
  adb -s PIXEL_SERIAL shell run-as org.kanaha.calcs ./files/kanaha-calcs-mcp
```

Expect seven tools with full JSON schemas.

---

## Example: monteCarlo

**MCP request:**
```json
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{
  "name":"monteCarlo","arguments":{
    "n_simulations":10000,"expected_return":0.08,"volatility":0.20,
    "percentiles":[0.01,0.05]}}}
```

The result carries VaR at each requested percentile, CVaR (Expected Shortfall at
95%), max drawdown, probability of profit, and simulations-per-second — the same
payload the WebView renders in the Monte Carlo panel.

---

## Build

The MCP binary is built by `build-android.sh` alongside the httpd binary:

```bash
./build-android.sh
# produces app/src/main/jniLibs/arm64-v8a/libkanaha_mcp.so
```

`CalcsService.deployMcpBinary()` copies it to `files/kanaha-calcs-mcp` and marks
it executable on first service start. The `.so` files are gitignored and built
at release time.

---

## Files

| File | Purpose |
|------|---------|
| `finbench_mcp.c` (axis2-c-core) | MCP stdio loop, 3-tool catalog, dispatch |
| `finbench_mcp_main.c` (axis2-c-core) | Standalone binary entry point |
| `financial_benchmark_service.c` (axis2-c-core) | Native C math (shared with HTTP service) |
| `CalcsService.java` | Deploys `libkanaha_mcp.so` → `files/kanaha-calcs-mcp` |
| `build-android.sh` | Cross-compiles the binary for arm64-v8a |
