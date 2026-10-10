# AGENTS.md — Kanaha Calcs

## Security threat model

See [SECURITY.md](SECURITY.md) for the full threat model: roles and trust
levels, what is and is not a security issue, attack surface by component, and
how to report a vulnerability.

This file is the scan-priority guide for the calcs service: where the risk is,
ranked, and — importantly — which risks live in a **different** repository.

## What this is

An Android app that runs a statically-linked Apache httpd (mod_ssl + mod_http2 +
mod_axis2) as a child process, serving `FinancialBenchmarkService` — Monte Carlo
VaR, GBM and Merton jump-diffusion — as JSON over HTTP/2. A WebView front end
calls it through a Java bridge; there is also an MCP binary.

Two facts shape the whole model:

- **The compute engine source is not in this repo.** `financial_benchmark_service.c`
  (and the MCP/handler code) is compiled from Apache Axis2/C's
  `samples/user_guide/financial-benchmark-service/src`, at the commit pinned
  in kanaha-android-deps (`AXIS2C_REF` in its `BUILD-INFO`), per
  `build-android.sh`. The numeric-domain vulnerabilities below must be
  reviewed **in that repository**; they cannot be fixed here. The in-repo
  `finbench_static_adapter.c` is the one place calcs can clamp inputs before the
  engine sees them. The exception is `calcs_csv_source.c`: `covarianceFromCsv`
  and `listCsvFiles` are this app's own operations because they read files
  under `files/csv`, so their filename validation, read bounds and cell
  parsing are reviewable here and belong to this repository's threat model.
- **The service is network-exposed and mTLS-gated.** In *server mode* it binds
  `0.0.0.0:8444` and requires a client certificate signed by the Kanaha CA
  (`SSLVerifyClient require`) — the same posture as kanaha-camera and kanaha-audio.
  The device mints its own key on-device and is provisioned with a CA-signed cert;
  no private key ships (see #3). The in-app WebView reaches the same listener over
  `127.0.0.1`, presenting the provisioned cert.

## Operation modes

Two ways to run, consistent with the other Kanaha server apps:

- **Server mode (headless).** Start the foreground service directly, no UI:

      adb shell am start-foreground-service \
        -a org.kanaha.calcs.START_SERVER -n org.kanaha.calcs/.CalcsService

  `CalcsService` is `exported="true"` so adb/other apps can start it — a
  non-exported service cannot be started this way on modern Android (API 31+).
  It launches the mTLS httpd on 8444 and advertises mDNS, with the screen off and
  the WebView never opened.
- **Standalone mode.** Launch the activity; it starts the same service. The
  WebView demo UI is a convenience, not required for the server.

Like every Kanaha server app, calcs advertises **mDNS/DNS-SD** (`_https._tcp`,
TXT `api=kanaha-calcs`) so clients discover it without a static IP.
`tools/kanaha-discover.sh` finds it and the other Kanaha apps (camera, audio)
and checks each over mTLS; the same script ships in all three projects.

## Highest-value scan areas

### 1. Untrusted numeric input → allocation and math (engine is upstream)
The service accepts `n_simulations`, `n_periods`, `weights[]`,
`covariance_matrix[][]`, `scenarios[]`. `LimitRequestBody` caps request *text*,
not numeric *values* — `{"n_simulations": 2147483647}` is tiny but huge in
effect. Scan for: integer overflow in `malloc(count * size)`; unbounded
allocation or iteration from a request field; division by a request-supplied
zero; NaN/Inf from parsed doubles reaching indexing or allocation; array lengths
from JSON used without bounds. **These live in the upstream engine**; in this
repo, `finbench_static_adapter.c` is the chokepoint to clamp
`n_simulations`/`n_periods`/array lengths before forwarding.

### 2. Concurrency under worker MPM (engine is upstream)
`httpd.conf` runs worker MPM with multiple threads and mod_axis2 does not
serialise invocations. If the Monte Carlo engine uses a global/`static` RNG or a
shared scratch buffer, concurrent requests race. Verify per-call RNG state in the
upstream engine, or serialise.

### 3. On-device keys, provisioning required (in-repo, deployment)
The listener is mTLS-gated (`SSLVerifyClient require`), so there is no
unauthenticated path, and **no private key ships**: on first run the app mints its
own RSA key + CSR (`CertProvisioning`; the key never leaves the device) and refuses
to serve until an operator signs the CSR with the off-device Kanaha CA and pushes
back a CA-signed cert. Caller/client certs are issued from that same CA. Revocation
(CRL/OCSP) is a pre-production item; device certs are one-year.

### 4. Client cert / CA handling (in-repo)
`Axis2Client` presents the **provisioned device cert** (`server.crt`/`server.key`
from `files/apache/ssl`, which carries serverAuth+clientAuth EKU) and trusts the
Kanaha CA; hostname verification is disabled for the `127.0.0.1` loopback call. The
WebView `onReceivedSslError` path governs only the `file://` UI page; service calls
go through the Java bridge, not the WebView.

### 5. Response and error JSON escaping (in-repo)
Caller strings (ticker symbols, model names, echoed errors) inserted into JSON
responses must be escaped. The WebView error path in particular must escape the
exception message and guard a null message (it can otherwise NPE inside its own
error handler).

### 6. Deployment (in-repo)
`allowBackup` must be `false`. Private keys must never be **committed or shipped**
— the device mints its own key on-device and is provisioned with a CA-signed cert
(nothing under `assets/` ships a private key; see #3). The SSL/mTLS directives in
`httpd.conf` must not be `<IfModule>`-guarded into a fail-open state.
No market-data credentials (a vendor's, or a Nasdaq Data Link API key) may
appear in source or assets — they belong in gitignored env-driven scripts.

## Testing
- On-device or on the LAN box where the cross-compiled engine and Apache exist.
- Confirm HTTP/2 negotiates (ALPN `h2`), and that the WebView→bridge→native path
  returns a well-formed result.

## Reporting
Report vulnerabilities privately through GitHub's security advisory form on this
repository. Do not open a public issue. See [SECURITY.md](SECURITY.md).
