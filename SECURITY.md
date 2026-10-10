# Security Threat Model — Kanaha Calcs

## Project Description

Kanaha Calcs is an Android app that runs portfolio calculations on the phone:

- portfolio variance and covariance
- Monte Carlo value-at-risk, using geometric Brownian motion, Merton jump
  diffusion or correlated paths
- scenario analysis

A statically linked **Apache httpd** runs as a child process and serves
`FinancialBenchmarkService` as JSON over HTTP/2 with mutual TLS on port 8444.
The app's WebView front end calls that same service over loopback, through a
Java bridge. An MCP binary offers the same operations to an AI assistant over
adb.

The calculation engine is **not in this repository**. It is Apache Axis2/C's
financial benchmark sample, compiled unchanged from the Axis2/C source tree by
`build-android.sh`. This repository owns:

- `finbench_static_adapter.c`, which checks numeric limits before the engine
  sees a request
- `calcs_csv_source.c`, behind the app's own `covarianceFromCsv` and
  `listCsvFiles` operations
- the Java app, its configuration and its WebView front end

The app is intended for **small trusted LANs** or a single phone. It is not
meant to be exposed to the internet, and the network listener requires a client
certificate.

| Component | Version | Role |
|---|---|---|
| Apache httpd | 2.4.69 | HTTP server, mod_ssl + mod_http2 |
| OpenSSL | 3.5.9 | TLS 1.2+, mutual authentication |
| Axis2/C | 2.0.0 | Service container, JSON-RPC dispatch, the calculation engine |
| nghttp2 | 1.64.0 | HTTP/2 |
| json-c | 0.18 | JSON parsing |
| Apache HttpClient 5 | 5.4.3 | The Java bridge's HTTP/2 client |
| Bouncy Castle | 1.84 | On-device key and CSR generation |

The native libraries are built by
[kanaha-android-deps](https://github.com/robertlazarski/kanaha-android-deps).

## Roles and Trust Levels

| Role | Trust Level | Description |
|---|---|---|
| **Device owner** | Fully trusted | Physical control of the phone. Installs the app, imports CSV files, can enable adb. |
| **adb user** | Fully trusted | Can `run-as` the app on a debuggable build and read everything it stores. The MCP binary is reached this way. |
| **Operator** | Fully trusted | Holds the off-device Kanaha CA key, signs each phone's CSR and issues client certificates. |
| **mTLS client** | Trusted | Holds a client certificate issued by the Kanaha CA. Can invoke every operation. |
| **The app's own WebView** | Trusted | Loads only the app's bundled `file:///android_asset` pages. It reaches the service through the Java bridge, which presents the phone's own certificate. |
| **LAN peer** | Untrusted | Can reach port 8444, but is rejected during the TLS handshake without a client certificate. |
| **Request values** | Untrusted input | Simulation counts, matrix sizes and arrays in a request. A short request can ask for an enormous computation. |
| **Imported CSV files** | Untrusted input | Chosen by the user from anywhere on the phone. Both the native parser and the WebView read their content and file name. |

There is no privilege separation *within* the mTLS client role. A client
certificate is a full-access credential.

## Security Boundaries

### What IS a security issue

- **Numeric input driving allocation or time without a bound.** Examples: a
  `n_simulations`, `n_periods` or matrix size that passes
  `finbench_static_adapter.c`'s limits and still exhausts memory or pins a
  worker; integer overflow in a size calculation; NaN or infinity reaching an
  index or an allocation.
  - **Where to report:** if the defect is in the engine itself, report it to
    Apache Axis2/C, since that is where the fix lands. If the adapter lets an
    input through that it should have refused, report it here.
- **CSV parsing faults.** A crafted CSV that overruns a buffer, escapes
  `files/csv`, or defeats the size, line, column or observation limits in
  `calcs_csv_source.c`.
- **Script injection into the WebView.** An imported file's content or name
  reaching the page as script. The app Base64-encodes both before handing them
  to the page. Any other path where caller or file data reaches
  `evaluateJavascript` or the page is a finding.
- **The WebView loading content that is not the app's.** A page that can load
  remote content can call `Android.callAxis2` with the phone's certificate.
  External `http(s)` links must keep opening in the browser, never in the
  WebView.
- **Authentication bypass.** Reaching the service from the network without a
  client certificate, or `SSLVerifyClient require` not holding on some path.
- **Concurrency faults.** httpd runs the worker MPM with several threads, and
  mod_axis2 does not serialise calls. Shared random-number state or scratch
  buffers raced by concurrent requests count. Engine-side races are reported
  to Axis2/C, as above.
- **Response escaping.** A caller string, file name or error message breaking
  the JSON returned to a client or to the page.
- **Key disclosure.** A private key in the APK or in git, a key returned by an
  API or written to a log, or a key reachable through backup (`allowBackup` is
  `false`).
- **Committed market-data credentials or licensed data.** Data the project may
  not redistribute, or an API key for a data provider, must not appear in
  source, assets or history.
- **HTTP/2 protocol abuse** that crashes or exhausts the server.

### What is NOT a security issue

- **Physical access to an unlocked device, and adb access.** By design,
  `run-as` on a debuggable build grants app-level access, and the MCP
  integration depends on it.
- **Numerical accuracy.** A result that differs from another library's, or a
  model's assumptions, is a quality issue. A result that is wrong because
  memory was corrupted is not.
- **The loopback client skipping hostname verification.** `Axis2Client`
  connects to `127.0.0.1`, which the phone's certificate does not name. It
  still verifies the chain against the Kanaha CA and presents the phone's
  certificate.
- **The fixed in-memory keystore password in `Axis2Client`.** It protects a
  keystore that exists only in memory. The key it holds is the app's own,
  already readable by the app.
- **Certificate revocation not yet wired up.** Phones receive one-year
  certificates signed by the Kanaha CA. CRL/OCSP is a pre-production item,
  not a vulnerability.
- **Exposure to a hostile network.** The model assumes a private LAN.
  Publishing port 8444 to the internet is a deployment decision outside it.
- **Vulnerabilities in Android or an unmodified upstream library.** Report
  those upstream. Report here if this app *uses* one unsafely or ships a
  version known to be affected.
- **Network-layer denial of service,** such as SYN floods.

## Architecture and Attack Surface

### Request paths

```
mTLS client (laptop)                 WebView (file:///android_asset only)
   │  HTTP/2 + client cert, :8444       │  Android.callAxis2(path, json)
   │                                    ▼
   │                                 Axis2Client (HttpClient 5, phone's cert)
   │                                    │  HTTPS to 127.0.0.1:8444
   ▼                                    ▼
Apache httpd child process  (mod_ssl → mod_http2 → mod_axis2)
   │
   ▼
finbench_static_adapter.c   numeric limits, then dispatch
   │
   ├─► FinancialBenchmarkService   (Apache Axis2/C sample, upstream)
   └─► calcs_csv_source.c          files/csv  ◄── imported and bundled CSVs
```

The MCP binary, `kanaha-calcs-mcp`, is a second entry point to the same
service code. It is reached over adb stdio with `run-as`, has no TLS, and
relies on adb for access control.

### Attack surface by component

| Component | Exposure | Notes |
|---|---|---|
| `finbench_static_adapter.c` | **Untrusted JSON** | The chokepoint for numeric limits before the upstream engine. |
| `calcs_csv_source.c` | **Untrusted files** | File-name validation, size and line limits, cell parsing. |
| `MainActivity.java` | WebView, imported files | JavaScript bridge, navigation rules, CSV import into the page and into `files/csv`. |
| `Axis2Client.java` | Loopback TLS | Presents the phone's certificate; trusts only the Kanaha CA. |
| Upstream engine | **Untrusted numbers** | Reviewed and fixed in Apache Axis2/C. |
| Apache + Axis2/C + OpenSSL | Network | Upstream code linked statically, so it stays current only by relinking and releasing the app. |

## Dependency Security

The app ships its native libraries inside the APK, so an upstream fix does not
reach a phone until the app is relinked and released:

| Component | Minimum | Reason |
|---|---|---|
| Apache httpd | 2.4.69 | HTTP/2 double-free and HTTP/2 Bomb fixes (2.4.67/2.4.68) |
| OpenSSL | 3.5.9 | 3.5 LTS; 3.0 and 3.2 no longer receive fixes |
| nghttp2 | 1.64.0 | HTTP/2 protocol handling |
| Axis2/C | 2.0.0 | Current release; also the source of the calculation engine |

To update: raise the pin in kanaha-android-deps, rebuild it, then run this
repository's `build-android.sh` and build the APK.

## Reporting Security Issues

**Do not open a public issue for a security vulnerability.**

Report privately through GitHub's security advisory form on this repository
(*Security* → *Report a vulnerability*). That opens a private thread visible
only to the maintainer.

Please include:

- The affected component and file
- A description of the issue and its impact
- Steps to reproduce, ideally the JSON request or CSV file that triggers it
- The device and Android version, if relevant

Expect an initial response within a few days. This is a personal project rather
than a funded one, so please allow reasonable time for a fix before public
disclosure. Credit will be given in the release notes unless you prefer
otherwise.
