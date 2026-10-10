# Kanaha Calcs

Portfolio math on a phone. Kanaha Calcs serves [Apache Axis2/C](https://github.com/apache/axis-axis2-c-core)'s financial benchmark service from Apache httpd running on the phone:

- portfolio variance
- covariance from volatilities and correlations, from returns, or from a CSV file
- Monte Carlo value-at-risk, using geometric Brownian motion, Merton jump diffusion or a correlated book
- scenario analysis

It serves them over HTTP/2 with mutual TLS. A WebView front end adds fifteen textbook formulas, each traced to its published source. An MCP binary hands the same seven operations to an AI assistant. Apache 2.0, with no GPL dependencies.

**What makes it unusual:** the compute engine is the Axis2/C sample, compiled unchanged. It runs as a C child process that the app starts, not as a library the app loads. Kanaha Calcs adds about 1,100 lines of its own C around it: an adapter that checks numeric limits before the engine runs, and the two CSV operations. The whole server, TLS through service, runs at about 15 MB resident on a Pixel. Java never loads C: the WebView's calls go through a small Java bridge that speaks HTTP/2 to the server over loopback, presenting the phone's own certificate.

**Why this exists:** [Apache Axis2/C 2.0.0](https://github.com/apache/axis-axis2-c-core) added HTTP/2, JSON-RPC and Android support. Kanaha Calcs is the third Kanaha showcase, after [Kanaha Camera](https://github.com/robertlazarski/kanaha) and [Kanaha Audio](https://github.com/robertlazarski/kanaha-audio). Together they show that the same engine can serve camera control, audio analysis and numerical work. See [Axis2/C HTTP/2 on Android](https://github.com/apache/axis-axis2-c-core/blob/master/docs/HTTP2_ANDROID.md) for the technical foundation.

| Feature | Details |
|---------|---------|
| Engine | Apache Axis2/C `FinancialBenchmarkService`, HTTP/2 JSON-RPC, port 8444 |
| Operations | 7: five from the upstream sample, plus `covarianceFromCsv` and `listCsvFiles` |
| In-app calculations | 15 JavaScript formulas, each with author, paper and year on a "Learn More" card |
| Data | Public-domain prices (2008–2018), Federal Reserve FX rates, ACWI monthly returns. Load your own CSV through the file picker |
| Security | HTTPS + mTLS; each phone mints its own key and must be provisioned before it serves |
| AI integration | MCP (Model Context Protocol), the same 7 operations as tools |
| Discovery | mDNS/DNS-SD (`_https._tcp`, `api=kanaha-calcs`) |
| License | **Apache 2.0** (all dependencies permissive) |

Kanaha Calcs is an educational tool. It teaches the vocabulary and the math of portfolio analysis; it does not manage portfolios or give investment advice. See [DESIGN_PRINCIPLES.md](docs/DESIGN_PRINCIPLES.md).

## Example

```bash
curl -s --http2 --cert client.crt --key client.key --cacert ca.crt \
  -H "Content-Type: application/json" \
  -d '{"n_assets": 2, "weights": [0.6, 0.4], "covariance_matrix": [0.04, 0.006, 0.006, 0.09]}' \
  "https://$PHONE:8444/services/FinancialBenchmarkService/portfolioVariance"
```

```json
{"status": "SUCCESS", "portfolio_variance": 0.03168, "portfolio_volatility": 0.17799, ...}
```

`covariance_matrix` is the row-major `n_assets × n_assets` matrix, already annualized. [MCP.md](docs/MCP.md) documents every operation's parameters.

## Architecture

```
laptop / other phone ─┐
                      │  HTTPS, HTTP/2, client certificate
WebView (JavaScript) ─┤
  → Java bridge       │  loopback, the phone's own certificate
  (HttpClient 5)      ▼
            Apache httpd (mod_ssl, mod_http2, mod_axis2), port 8444
                      │
            finbench_static_adapter.c   numeric limits, then dispatch
                      ├─► FinancialBenchmarkService   (Axis2/C sample)
                      └─► calcs_csv_source.c          files/csv on the phone

adb run-as ──► kanaha-calcs-mcp    the same service code over MCP stdio
```

[CPP_AND_JAVA_DESIGN.md](docs/CPP_AND_JAVA_DESIGN.md) draws the lines between C, Java and JavaScript.

## Quick Start

### 1. Build

The native libraries — Apache httpd, Axis2/C, OpenSSL and the others — are shared by all three Kanaha apps and built by [kanaha-android-deps](https://github.com/robertlazarski/kanaha-android-deps). Then:

```bash
bash build-android.sh                  # links the server and the MCP binary into jniLibs
cd kanaha-calcs-app && ./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Gradle 8.12 needs JDK 21 (`JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64`). The app needs Android 9 (API 28) or later.

### 2. Provision the phone

Kanaha uses mutual TLS with a small private CA whose key never leaves your machine. The [Kanaha Camera README](https://github.com/robertlazarski/kanaha#1-set-up-mtls-ca) shows how to create the CA and a client certificate.

On first run the app mints its own key and a CSR, and refuses to serve until you sign that CSR and push the certificate back:

```bash
adb shell "run-as org.kanaha.calcs cat files/csr/calcs.csr" > calcs.csr
openssl x509 -req -days 365 -in calcs.csr -CA ca.crt -CAkey ca.key -CAcreateserial \
  -out calcs.crt \
  -extfile <(printf "subjectAltName=IP:<phone-ip>,DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth,clientAuth")
adb push calcs.crt /data/local/tmp/server.crt && adb push ca.crt /data/local/tmp/ca.crt
adb shell "run-as org.kanaha.calcs sh -c 'cp /data/local/tmp/server.crt files/apache/ssl/server.crt && cp /data/local/tmp/ca.crt files/apache/ssl/ca.crt'"
```

Until then, the notification reads "Awaiting provisioning".

### 3. Run

Launch the app, or start the server headless with the screen off:

```bash
adb shell am start-foreground-service -a org.kanaha.calcs.START_SERVER -n org.kanaha.calcs/.CalcsService
```

## MCP Support

The seven operations are MCP tools, each with a full input schema. The MCP binary runs the same service code over stdio, with no httpd, no TLS and no Java at runtime:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' | \
  adb shell run-as org.kanaha.calcs ./files/kanaha-calcs-mcp
```

See [MCP.md](docs/MCP.md).

## Device Discovery

Finds every Kanaha app on the network (Calcs, Camera and Audio) and checks each over mTLS. The same script ships in all three projects.

```bash
./tools/kanaha-discover.sh --kind calcs
```

## Data

Only data that may be redistributed is bundled:

| Dataset | Source | License |
|---------|--------|---------|
| Daily prices, 5 US equities, 2008–2018 | Quandl WIKI EOD (now Nasdaq Data Link) | Public domain; see [data/DATA_LICENSE.txt](data/DATA_LICENSE.txt) |
| Daily FX rates, 2008–2018 | Federal Reserve Board H.10 | Public domain; see [data/FED_H10_LICENSE.txt](data/FED_H10_LICENSE.txt) |
| ACWI monthly returns | iShares MSCI ACWI ETF's SEC NPORT-P filings | Return figures only; no MSCI index data |

Any other CSV, including licensed vendor data, can be loaded through the file picker. It stays on the phone under its own license. [DATA_PROVENANCE.md](docs/DATA_PROVENANCE.md) records where every number came from, and [DATA_FETCH_GUIDE.md](docs/DATA_FETCH_GUIDE.md) shows how to fetch it again.

## License

Apache License 2.0. See [LICENSE](LICENSE).

| Dependency | License |
|-----------|---------|
| Apache Axis2/C | Apache 2.0 |
| Apache httpd, APR | Apache 2.0 |
| Apache HttpComponents 5 | Apache 2.0 |
| OpenSSL | Apache 2.0 |
| nghttp2 | MIT |
| json-c | MIT |
| expat | MIT |
| PCRE2 | BSD |
| Bouncy Castle | MIT |
| Chart.js | MIT |

## Documentation

| Document | Description |
|----------|-------------|
| [SECURITY.md](SECURITY.md) | Threat model and how to report a vulnerability |
| [DESIGN_PRINCIPLES.md](docs/DESIGN_PRINCIPLES.md) | What the app calculates, the gates every calculation passes, and the sources behind each formula |
| [CPP_AND_JAVA_DESIGN.md](docs/CPP_AND_JAVA_DESIGN.md) | Where C, Java and JavaScript each start and end |
| [MCP.md](docs/MCP.md) | The seven MCP tools and their parameters |
| [AXIS2C_TESTING.md](docs/AXIS2C_TESTING.md) | Where the Axis2/C service code is tested, and where it cannot be |
| [DATA_PROVENANCE.md](docs/DATA_PROVENANCE.md) | Every bundled dataset, its source and its license |
| [DATA_FETCH_GUIDE.md](docs/DATA_FETCH_GUIDE.md) | Re-fetching the bundled data |
| [NOTICE](NOTICE) | Third-party attribution |
| [TRADEMARKS.md](TRADEMARKS.md) | Trademark acknowledgments |
