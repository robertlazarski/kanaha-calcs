# C, Java and JavaScript in Kanaha Calcs: where each one starts and ends

Kanaha Calcs is three languages in one APK, each doing one thing:

- **C** is the compute engine: `FinancialBenchmarkService`, compiled straight
  from the Apache Axis2/C sample sources, running behind Apache httpd with
  mod_axis2 on port 8444 over HTTP/2 and mTLS. About 1,160 lines of C live
  in this repository: the static adapter, which checks numeric limits before
  the engine runs, and the two CSV operations.
- **JavaScript** is the calculator and the UI: about 2,800 lines in a WebView
  that parse the data, run the fifteen textbook formulas, draw the charts and
  show the provenance.
- **Java** is 1,135 lines that satisfy Android and bridge the other two: a
  foreground service that launches the httpd, a WebView host, and an mTLS
  loopback client the JavaScript cannot be without.

This document draws those lines precisely. The companion documents in the
kanaha-audio and kanaha-camera repositories (same file name) describe the two
other shapes: C as the program with a Java supervisor, and Java as the program
with a C control plane. Calcs is the third: two front ends, one engine.

## The shape

```
WebView (JavaScript, file:///android_asset)      Java (app process)                    C child process (same UID)
──────────────────────────────────────────       ───────────────────────────────       ──────────────────────────────────
index.html  3 tabs: Calculate / Fund / Glossary  MainActivity                          libkanaha_calcs_httpd.so (httpd -X)
data.js     CSV parser, bundled sample data        hosts the WebView                     mod_ssl + mod_http2 + mod_axis2
calcs.js    15 formulas, run here                  WebAppInterface ("Android")           axis2_json_rpc_msg_recv
charts.js   Chart.js                                 callAxis2(path, json) ──────▶          └─ static registry
provenance.js, glossary.js, fund.js                  openFilePicker()          mTLS         └─ finbench_static_adapter.c
scenario.js ── Android.callAxis2() ──────────▶   Axis2Client                  127.0.0.1        └─ financial_benchmark_service.c
              portfolioVariance                    HttpClient 5, HTTP/2,       :8444              (upstream Axis2/C sample)
              monteCarlo                           client cert = device cert                         portfolioVariance
              scenarioAnalysis                                                                       monteCarlo (GBM, Merton)
                                                 CalcsService (foreground)                           scenarioAnalysis
                                                   deploys config + MCP binary
                                                   CertProvisioning
                                                   ProcessBuilder ──exec────────────▶
                                                 NetworkDiscoveryService (mDNS)
                                                                                       libkanaha_mcp.so → files/kanaha-calcs-mcp
                                                                                         same engine, JSON-RPC over stdio
```

Two front doors reach one engine. The WebView reaches it through Java over
loopback mTLS; an MCP client reaches it over `adb shell run-as` with no Java
involved at all. Java never loads C: the httpd is a child process started with
`ProcessBuilder`, exactly as in the other two apps.

## C: the engine is upstream, not here

There are two C files in this repository. `finbench_static_adapter.c` exports
the strong symbol `financial_benchmark_service_invoke_json` that overrides the
weak stub in Axis2/C core, and does three things in order: logs a bounded,
control-character-free excerpt of the request; answers this app's own two
operations; and otherwise pre-flights the numeric limits (asset counts,
simulation size, the asset-step budget) against the engine's own constants,
which is the clamp point `AGENTS.md` describes, before handing the request to
`finbench_dispatch_json_obj()`, the upstream router.

`calcs_csv_source.c` is those two operations: `covarianceFromCsv` and
`listCsvFiles`. They exist here rather than upstream because the file is this
app's: the sample takes a return matrix in the request and has nothing of its
own to read, while this app has CSVs the user imported. It reads the named
columns of a named file under `files/csv`, turns prices into log returns, and
hands them to the upstream estimator, adding the file, columns and date range
to its response. The file name is validated to one plain name, the read is
bounded in bytes, lines, columns and rows, and a cell that is neither a number
nor blank is refused by row and column. On the MCP side the same two tools
arrive through the transport's weak `finbench_mcp_extra_tools()` and
`finbench_mcp_extra_dispatch()` hooks, so `tools/list` shows seven tools
without the upstream transport knowing anything about CSVs.

The adapter cannot see the URL, but since 2026-09-19 the engine puts the
operation the URL resolved to into the request as an `operation` field before
calling it, and the upstream router honours that name (or a caller's `action`)
first. Only a request with neither falls back to shape inference, and then the
Monte Carlo parameters are tested before `weights`, because a correlated
monteCarlo request carries `weights` and `covariance_matrix` exactly as a
portfolioVariance request does. One residual ambiguity is documented in the
router: a correlated request that relies on every default and carries nothing
but those two fields is routed to portfolioVariance; naming the operation
avoids it, and over HTTP the engine always does.

Those functions, and everything behind them, are compiled by `build-android.sh`
from `samples/user_guide/financial-benchmark-service/src` in the
`axis-axis2-c-core` repository: `financial_benchmark_service.c` (the math),
`axis2_json_secure_fault.c`, `mcp_catalog_handler.c`, and for the MCP binary
`finbench_mcp.c` and `finbench_mcp_main.c`. The server-side handler object is
deliberately left out of the Android archive because it exports the
four-argument form of the same `_invoke_json` symbol (see `HTTP2_ANDROID.md`
in axis2-c-core, "The two signatures share one symbol name").

Two things follow from the engine living upstream:

- **The same sources build on Linux with autotools** and run under httpd there.
  The math on the phone is the math on a server, byte for byte in source,
  and the deterministic outputs match to the last digit across the two builds.
  Both are compiled with `-fsigned-char` so that the C means the same thing on
  x86-64 and arm64.
- **Numeric-input validation lives in the engine, and the adapter pre-flights
  it.** The upstream service rejects weights that do not sum, probabilities
  outside tolerance, matrices that are not positive definite, and any run over
  its budgets. The in-repo adapter checks the size limits first, using the
  engine's own constants so the two cannot disagree: it is the one place this
  repository can bound inputs ahead of the engine, which is why `AGENTS.md`
  names it as the chokepoint, and where an Android build could tighten a
  limit below the engine's if a device needed it.

`build-android.sh` links two binaries with two different link lines, both
copied into `jniLibs/arm64-v8a/`:

- **The httpd** (`libkanaha_calcs_httpd.so`): Apache's objects plus
  `libaxis2_engine.a` and `libfinbench_services.a` under `--whole-archive`, so
  the adapter's strong symbol overrides the engine's weak stub.
- **The MCP server** (`libkanaha_mcp.so`): `finbench_mcp_main.o`,
  `finbench_mcp.o`, `financial_benchmark_service.o`,
  `axis2_json_secure_fault.o` and `calcs_csv_source.o` linked directly, plus
  `libaxis2_engine.a`. It does not link the service archive at all: there is no
  Axis2 dispatch and no adapter in that binary. `finbench_mcp.c` calls the
  `finbench_*_json_only()` functions itself, and `calcs_csv_source.o` supplies
  the extra-tools hook.

A library or object added to one line and not the other builds one binary and
breaks the other. There is no C++ in this app.

## JavaScript: the calculator, where the data lives

The WebView loads `file:///android_asset/index.html` and never navigates
anywhere else. What runs there:

| File | Lines | Owns |
|---|---|---|
| `data.js` | 418 | CSV parsing with the `TICKER_Field` column convention, the bundled sample dataset, adjusted versus raw close handling, the file-picker hand-off |
| `calcs.js` | 409 | The fifteen formulas: Kelly fraction and odds, Sharpe ratio, normal CDF, percent change, median, covariance matrix from log returns, max drawdown, NAV, portfolio weight and return, excess return, dividend yield, information ratio, return decomposition |
| `scenario.js` | 484 | The Bull/Base/Bear scenario UI and the three calls into the C engine |
| `charts.js` + `lib/chart.min.js` | 411 | Chart.js rendering |
| `provenance.js` | 125 | The paper behind every formula, with the code shown beside it |
| `fund.js`, `glossary.js` | 353 | The Fund tab positions and the glossary |
| `index.html`, `style.css` | 1,155 | Three tabs and the styling |

The division between JavaScript and C is deliberate and worth stating as a
rule: **JavaScript runs the O(n) textbook formulas where the data already is;
C runs what is compute-heavy or shared with a server.** A Sharpe ratio over
250 returns is microseconds in any language, and moving it across a TLS
connection would cost more than computing it. A 10,000-path Monte Carlo, a
covariance-matrix multiply, or a scenario benchmark is the C engine's job, and
it is the same engine that answers the same request on a server.

The formulas in `calcs.js` are implemented from the cited papers, with
`provenance.js` carrying the citation for each. `docs/DESIGN_PRINCIPLES.md`
defines what may and may not be implemented here.

## Java: what is required, and what is bridge

| File | Lines | Role | Required by Android? |
|---|---|---|---|
| `CalcsService.java` | 344 | Foreground service. `startForeground` within the deadline, deploys the Apache config set and the MCP binary, runs `CertProvisioning`, launches the httpd with `ProcessBuilder`, registers mDNS. Exported so `adb shell am start-foreground-service` can start it headless ("server mode"). | The service and the launch: **yes**. Deployment and mDNS: **no**, convenience. |
| `MainActivity.java` | 292 | Hosts the `WebView`, exposes `WebAppInterface` to JavaScript as `Android`, opens the Storage Access Framework picker for a user CSV, guards the WebView against oversized files, initialises `Axis2Client`. | The WebView host and the `@JavascriptInterface` bridge: **yes**. |
| `Axis2Client.java` | 175 | The loopback client: Apache HttpClient 5 with HTTP/2, presenting the provisioned device certificate (which carries clientAuth) as the client cert and trusting the Kanaha CA. Hostname verification is off because the peer is `127.0.0.1` and the cert names the device. | **Yes**, given the WebView. See below. |
| `NetworkDiscoveryService.java` | 188 | `NsdManager` registration, `_https._tcp` with `api=kanaha-calcs`. | **No.** Movable to C. |
| `CertProvisioning.java` | 136 | Mints the device keypair and CSR (BouncyCastle); the key never leaves the device. | **No.** OpenSSL is already in the httpd. |

### Why the JavaScript cannot call the engine directly

`scenario.js` says it in its header, and it is the single most important line
in the Java layer's justification:

1. Axis2/C JSON requires HTTP/2, which the WebView only negotiates over TLS.
2. The listener requires a client certificate.
3. WebView `fetch()` cannot present a client certificate and has no hook to
   add one.
4. `HttpsURLConnection` does not speak HTTP/2 either.

So the JavaScript calls `Android.callAxis2(path, json)`, a synchronous
`@JavascriptInterface` method, and Java's `Axis2Client` makes the HTTP/2 mTLS
POST to `https://127.0.0.1:8444/services/FinancialBenchmarkService/<op>` and
returns the body. Synchronous means what it says: the WebView's JavaScript
thread blocks until the engine answers or the client's 120-second wait
expires. That is not an ANR, because the bridge runs off the Android main
thread, but the page cannot repaint or handle input while a long Monte Carlo
runs. A message-channel bridge would make it asynchronous; the current design
accepts the freeze because a run near the engine's work cap is the only case
that lasts more than a second or two. This is the one place in the three Kanaha apps where two
languages share a process and cross a language bridge, and it is a
JavaScript-to-Java bridge, not JNI. C is still reached only over a socket.

The listener is mTLS-gated in both modes. In server mode a LAN client presents
a cert issued by the same CA; in standalone mode the app's own WebView presents
the device's cert over loopback. Nothing is fail-open for the local case.

### What Android forces through Java

- **An entry point and a foreground service.** As in the other apps, a Java
  `Service` with `startForeground` is the only way to keep a process alive and
  to launch the httpd. The type is `specialUse`; this app needs no microphone or
  camera. It was `dataSync` until 2026-09-26, when Android 15's limit on that
  type (6 hours in any 24) stopped the server mid-rehearsal and refused every
  restart until the app came to the foreground. A server that stays up is not
  a data sync; `specialUse` has no time limit and carries a one-line
  `PROPERTY_SPECIAL_USE_FGS_SUBTYPE` saying what the service is for.
- **The WebView.** A `WebView` is a Java view. If the UI is HTML and
  JavaScript, Java must host it.
- **The file picker.** User CSVs come in through the Storage Access Framework,
  an Activity API.
- **The loopback client.** Not strictly forced by Android, but forced by the
  WebView's inability to present a client cert. The alternative would be a
  second, unauthenticated listener for loopback, which the security model
  refuses.

Everything else in the Java layer is convenience and could move to C.

## Two modes, two Java footprints

- **Standalone mode.** Launch the activity; it starts the service. Java is the
  supervisor plus the WebView host plus the bridge. All three tabs and the
  fifteen formulas run in JavaScript; the three engine operations go through
  `Axis2Client`.
- **Server mode.** `adb shell am start-foreground-service -a
  org.kanaha.calcs.START_SERVER -n org.kanaha.calcs/.CalcsService`. No activity,
  no WebView, no JavaScript. Java is the supervisor only, about the same
  thousand lines the audio app needs. The engine serves LAN clients over mTLS
  and advertises itself over mDNS.

And the MCP path needs neither mode's Java at runtime:
`adb shell run-as org.kanaha.calcs ./files/kanaha-calcs-mcp` runs the engine
under the app's UID with stdio transport, no httpd, no TLS and no provisioning.
Java's only contribution was copying the binary into `files/` once.

## Summary: the boundary in one table

| Concern | Lives in | Because |
|---|---|---|
| Portfolio variance, Monte Carlo (GBM and Merton), scenario analysis | C (upstream sample) | Compute-heavy, and the same code serves the same contract on a server |
| Input clamping before the engine | C (in-repo adapter) | The one in-repo chokepoint |
| CSV parsing, the fifteen textbook formulas, charts, provenance, tabs | JavaScript | O(n) work where the data already is; the UI is HTML |
| Calling the engine from the UI | Java bridge | The WebView cannot present a client cert or negotiate HTTP/2 without TLS |
| Foreground service, launching httpd | Java | `startForeground`, `ProcessBuilder` |
| Hosting the UI, the file picker | Java | `WebView` and Storage Access Framework are Java APIs |
| Certificates, mDNS, deployment | Java today | Convenience; movable to C |
| HTTP/2, TLS, mTLS, routing | C | Apache httpd and mod_axis2 |
| MCP server | C | Same engine, stdio transport, no Java at runtime |

JavaScript starts at `index.html` and ends at `Android.callAxis2()`. Java
starts at the manifest, ends at `ProcessBuilder.start()`, and reopens for one
method that turns a JavaScript call into an HTTP/2 request. C starts at the
socket and never knows an app is there.
