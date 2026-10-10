---
type: architecture
created: 2026-05-02
---

# kanaha-calcs Design Principles

## BLUF

kanaha-calcs is an offline-first Android educational app that teaches
financial math using real market data and first-principles algorithms.
Every calculation has verified academic provenance. No proprietary logic.
No GPL dependencies. Two gates govern all features: the **generic-math
test** (a textbook formula, not a firm's product workflow) and the
**provenance requirement** (traceable to a published paper).

---

## What This App Does and Does Not Do

This app teaches the **vocabulary and math** of portfolio management.
It does not manage portfolios.

The gap between knowing a formula and building a production system
around it is enormous. This app lives deliberately on the formula side
of that gap:

| This app does | This app does not do |
|---------------|---------------------|
| Kelly fraction: f* = (bp − q) / b | Position sizing with fund constraints, sector limits, or liquidity rules |
| Sharpe ratio from user-entered numbers | Risk-adjusted ranking across thousands of live positions |
| Portfolio variance from a covariance matrix | Real-time covariance estimation from streaming market data |
| Scenario expected value (Bull/Base/Bear) | Turning scenarios into position-sizing recommendations |
| Market impact: σ × √(Q/V) | Execution algorithms that minimize impact across dark pools and exchanges |
| Correlation heatmap from historical prices | Forward-looking correlation forecasts for hedging |

Every row in the right column requires proprietary data, real-time
infrastructure, and years of domain-specific engineering that an
educational app cannot and should not replicate. Professional portfolio
management tools earn their fee in that gap.

This app also does not do macroeconomic forecasting — oil prices, CPI,
interest rates, geopolitical scenarios. This reflects a bottom-up
investment philosophy: size positions based on company-specific
fundamentals, not macro predictions.

---

## Gate 1: The Generic-Math Test

Every math result exposed in the app must be a formula, not a product.
Specifically:

**PASS**: Generic mathematical formulas traceable to published academic
papers, implemented from first principles without any firm-specific
workflow.

**FAIL**: Anything that turns those formulas into a portfolio-construction
workflow: chaining them into position-sizing recommendations with fund
constraints, the kind of system commercial portfolio tools are built on.

The formula `f* = (pb - q) / b` is Kelly 1956 — that passes. A sizing
function with fund-structure branching, min/max investment constraints
and sector limits is a product, not a formula, and fails.

Even if the underlying math is public domain, the *framing* matters: a
calculator should present the formula and its inputs, not a decision
process built around them. A "Normal Distribution Probability"
calculator that takes "return and volatility" is generic statistics and
passes.

## Gate 2: Provenance Requirement

Every calculation must cite its original published source with:
- Author name(s)
- Paper/book title
- Journal/publisher
- Volume, issue, pages
- Year

The app displays this information when the user taps "Learn More" on any
calculation. If we cannot find a specific published academic source, the
calculation is rejected regardless of how useful it would be.

## Gate 3: Data Legality

All bundled data must have an explicit public domain or permissive license
that allows redistribution. "Free to access" (like Stooq) is not sufficient —
the source must affirmatively grant redistribution rights.

Two datasets meet this bar:

**1. Quandl WIKI EOD Stock Prices** (equities):
> "This data is in the public domain. You may copy, distribute, disseminate
>  or include the data in other products for commercial and/or noncommercial
>  purposes."

**2. Federal Reserve Board H.10 Foreign Exchange Rates** (currencies):
> "Unless otherwise indicated, information on Board's website is in the
>  public domain and may be copied and distributed without permission."
>
> Legal basis: 17 U.S.C. §105 (works of US government employees).

No data obtained through a licensed market data feed may be shipped in
the app. Users may load their own data (from a vendor, Stooq, etc.) via the
file picker — that is their data under their license.

---

## Architecture

```
┌─────────────────────────────────────────────────┐
│  Android App                                    │
│                                                 │
│  ┌──────────────────┐  localhost  ┌────────────────────┐
│  │  WebView UI      │───HTTP/2──→│ Apache httpd        │
│  │  (HTML/CSS/JS)   │  (mTLS)    │ + mod_axis2         │
│  │                  │            │ (Axis2/C services)  │
│  │  JS calcs (15):  │            │                     │
│  │  - Kelly         │            │ C calcs (3):        │
│  │  - Sharpe        │            │ - portfolioVariance │
│  │  - normalCDF     │            │ - monteCarlo        │
│  │  - covariance    │            │ - scenarioAnalysis  │
│  │  - IR            │            │                     │
│  │  - returnDecomp  │            │                     │
│  │  - pctChange     │            │                     │
│  │  - median        │            │                     │
│  └──────────────────┘            └────────────────────┘
│         │                               │
│  Remote (optional):                     │
│  External clients ─── mTLS ────────────→│
└─────────────────────────────────────────────────┘
```

### Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| UI framework | Plain WebView | Simplest; fetch() → localhost is natural; no framework overhead |
| Native layer | Apache httpd + mod_axis2 (Axis2/C) | Proven in kanaha-camera and kanaha-audio |
| IPC | Localhost HTTPS/HTTP2 via Java bridge | WebView JS → `@JavascriptInterface` → Apache HC5 → httpd over loopback. HTTPS required because Axis2/C JSON only works over HTTP/2, and HTTP/2 requires TLS ALPN. The bridge presents the device's provisioned client cert (mTLS). |
| HTTP client | Apache HttpComponents 5 | Preferred over OkHttp: kanaha projects use Apache httpd, Robert is Apache Axis2 committer. HC5 supports HTTP/2 via ALPN. `HttpsURLConnection` does NOT support HTTP/2 — eliminated during testing. |
| mTLS | Required (`SSLVerifyClient require`) | Per-device cert minted on-device and CA-signed (serverAuth+clientAuth); the WebView bridge presents it. Network-bound on 8444, consistent with camera/audio. |
| New C services | None | Three existing services are sufficient |
| JS calcs | First-principles only | Lightweight math; no HTTP round-trip needed |
| Portfolio-construction logic | Excluded | No position-sizing algorithm, no fund-structure rules |
| Licensing | Permissive only, no GPL | Apache-2.0, MIT, BSD |
| React Native | Rejected | Fights Axis2/C architecture; 7-15MB overhead |
| Cordova | Rejected | Maintenance mode; plain WebView is simpler |
| Bundled data | Quandl WIKI (equities) + Fed H.10 (FX) | Both explicit public domain with redistribution rights |
| Charting library | Chart.js (MIT, 60KB) | Lowest learning curve for a backend programmer; line/bar/scatter cover all chart types needed (price history, dividend timeline, correlation); 200K+ GitHub stars, massive Stack Overflow coverage |
| State persistence | WebView localStorage | 5 keys (fund_positions, fund_cash, cash_excluded, loaded_csv_path, last_tab); ~10 lines of JS; persists across app restarts; no permissions needed |
| Scenario UI | 3-row Bull/Base/Bear default | Ticker dropdown from CSV, probabilities must sum to 100%, expected value computed in JS. Generic textbook expected value calculator |

---

## Calculations

### JS Calculations (in WebView) — 15 total

Each must pass both gates. Implement from the cited academic papers only —
do NOT port code from any proprietary codebase.

#### 1. Kelly Fraction
- **f* = (b × p - q) / b**
- Kelly, J.L., Jr. (1956). "A New Interpretation of Information Rate."
  *Bell System Technical Journal*, 35(4): 917-926.


#### 2. Kelly Odds (Payoff Ratio)
- **odds = |reward| / |risk|**
- Same Kelly 1956, Section III.


#### 3. Sharpe Ratio
- **SR = (R_portfolio - R_f) / σ_portfolio** where R_f = risk-free rate
- Sharpe, W.F. (1966). "Mutual Fund Performance."
  *The Journal of Business*, 39(1): 119-138.
- The risk-free rate is user-entered (default: 0, which reduces to the
  simplified return/volatility ratio). A CFA charterholder will expect
  the risk-free rate input — omitting it entirely would be incorrect per
  the original 1966 paper and the CFA curriculum.
- Implement the one-line formula only — no short-flipping or implied-vol
  variants.

#### 4. Normal Distribution Probability
- **z = return / volatility → Φ(z)**
- Abramowitz, M. & Stegun, I.A. (1964). *Handbook of Mathematical
  Functions*. NBS Applied Mathematics Series 55, §26.2.
  Original distribution: Gauss, C.F. (1809). *Theoria motus corporum
  coelestium*.
- Do NOT use a lookup table. Implement Abramowitz & Stegun rational
  approximation (formula 26.2.17) directly.

#### 5. Percent Change
- **(new - old) / old × 100**
- Fibonacci (1202). *Liber Abaci*.
- Generic formula only.

#### 6. Median
- **Sort, take middle value**
- Galton, F. (1881). "Report of the Anthropometric Committee."
  *Report of the British Association for the Advancement of Science*,
  51: 225-272.
- Standard 5-line implementation.

#### 7. Covariance Matrix from Daily Prices
- **r_t = ln(P_t / P_{t-1}); cov(i,j) = Σ(r_i - μ_i)(r_j - μ_j)/(n-1); annualize × 252**
- Pearson, K. (1896). "Mathematical Contributions to the Theory of
  Evolution. III." *Philosophical Transactions of the Royal Society A*,
  187: 253-318.
- First-principles implementation from Pearson's original formulation.

#### 8. NAV (Net Asset Value)
- **NAV = Σ(price_i × quantity_i)**
- Pacioli, L. (1494). *Summa de Arithmetica, Geometria, Proportioni
  et Proportionalita*. (Double-entry bookkeeping — the foundation of
  asset valuation by summation of position values.)
- Fund Mode calculation. User assigns quantities to tickers; NAV is
  the sum of all position values including optional cash position.

#### 9. Portfolio Weight
- **weight_i = value_i / NAV**
- Markowitz, H. (1952). "Portfolio Selection."
  *The Journal of Finance*, 7(1): 77-91. (Weights are the fundamental
  input to mean-variance optimization.)
- Fund Mode calculation. Derived from NAV. Demonstrates how excluding
  cash inflates all other weights (the cash drag toggle).

#### 10. Portfolio Return
- **R_portfolio = Σ(weight_i × return_i)**
- Markowitz, H. (1952). Same paper. (Equation 1: expected portfolio
  return as the weighted sum of individual expected returns.)
- Fund Mode calculation. Shows how the weighted average return changes
  when cash (near-zero return) is included or excluded.

#### 11. Maximum Drawdown
- **MaxDD = min((P_t - P_peak) / P_peak) for all t**
- Grossman, S.J. & Zhou, Z. (1993). "Optimal Investment Strategies
  for Controlling Drawdowns." *Mathematical Finance*, 3(3): 241-276.
- Computed from the CSV price series. Shows the largest peak-to-trough
  decline for each ticker. The bundled 2008-2018 data captures the
  financial crisis — JPM's max drawdown is a dramatic educational
  example. Also returned by the Monte Carlo service (`maxDrawdown`
  field), providing a simulated forward-looking complement to the
  historical measurement.

#### 12. Excess Return (vs. Benchmark)
- **ExcessReturn = R_portfolio - R_benchmark**
- Jensen, M.C. (1968). "The Performance of Mutual Funds in the Period
  1945-1964." *Journal of Finance*, 23(2): 389-416.
- In Fund Mode, the user can designate one ticker or group as the
  benchmark. Excess return is the simple difference — the number that
  determines whether an active fund earns performance fees. Directly
  relevant to understanding how actively managed funds are measured
  against their benchmarks.

#### 13. Dividend Yield
- **yield = (sum of trailing 4 quarterly dividends) / price × 100**
- Williams, J.B. (1938). *The Theory of Investment Value*. Harvard
  University Press. (Introduced the dividend discount model — a stock's
  value is the present value of all future dividends. Yield is the
  simplest expression of that relationship.)
- Computed from CSV `ExDiv` and `Close` columns. Can show yield at any
  point in the 10-year history. The bundled data tells a clear story:
  JNJ is a Dividend King (39 payments, $24.84 total, increasing every
  year); JPM cut its dividend during the 2008 crisis then rebuilt it;
  AAPL started paying in 2012; AMZN pays nothing.

#### 14. Information Ratio
- **IR = mean(R_excess) / σ(R_excess)** where R_excess = R_portfolio - R_benchmark
- Grinold, R.C. (1989). "The Fundamental Law of Active Management."
  *Journal of Portfolio Management*, 15(3): 30-37. (Original source —
  introduced IR and the Fundamental Law: IR = IC × √BR.)
  Comprehensive treatment: Grinold, R.C. & Kahn, R.N. (2000). *Active
  Portfolio Management: A Quantitative Approach for Producing Superior
  Returns and Controlling Risk*. 2nd ed. McGraw-Hill. ISBN 978-0-07-024882-2.
- Fund Mode calculation. Requires a designated benchmark. Sharpe measures
  return per unit of *total* risk; IR measures return per unit of *active*
  risk (tracking error). IR > 1.0 is strong; IR > 2.0 is rare. Computed
  from the excess return time series — same inputs as Excess Return (#12)
  but over the full series, not a single period.

#### 15. Return Decomposition (Local vs. Currency)
- **R_total_USD ≈ R_local + R_fx** where R_fx = ln(FX_t / FX_{t-1})
- Brinson, G.P., Hood, L.R. & Beebower, G.L. (1986). "Determinants
  of Portfolio Performance." *Financial Analysts Journal*, 42(4): 39-44.
  [JSTOR](https://www.jstor.org/stable/4478947). (The foundational
  performance attribution paper — introduced decomposition of portfolio
  returns into allocation, selection, and interaction effects.)
  Currency extension: Karnosky, D.S. & Singer, B.D. (1994). *Global
  Asset Management and Performance Attribution*. Research Foundation of
  the Institute of Chartered Financial Analysts (now CFA Institute).
  ISBN 978-0-943205-28-1. Freely available from CFA Institute Research
  Foundation. (Extended BHB to multi-currency portfolios — separates
  currency return from local-market return.)
- Fund Mode calculation. Requires equity price series + FX rate series
  for the same date range. Decomposes each period's USD return into the
  local-currency component and the FX component. For example, if a
  global index outperforms a domestic index by 5%, the decomposition
  might reveal that international stocks returned ~13% in local terms
  but a weakening dollar added a ~9% currency tailwind — inflating the
  USD return to ~22%. Without FX data alongside equity data, this
  decomposition is invisible.

### Axis2/C Services (existing, no new code) — 3 total

#### 16. Portfolio Variance
- **σ²_p = w' × Σ × w**
- Markowitz, H. (1952). "Portfolio Selection."
  *The Journal of Finance*, 7(1): 77-91.
- Wire: `POST /services/FinancialBenchmarkService/portfolioVariance`
  with snake_case flat JSON.

#### 17. Monte Carlo VaR
- **GBM: S(t+dt) = S(t) × exp((μ - σ²/2)·dt + σ·√dt·Z)**
- Metropolis, N. & Ulam, S. (1949). "The Monte Carlo Method."
  *Journal of the American Statistical Association*, 44(247): 335-341.
- Wire: `POST /services/FinancialBenchmarkService/monteCarlo`

#### 18. Scenario Analysis
- **EV = Σ(p_i × value_i)**
- Bernoulli, D. (1738). "Specimen Theoriae Novae de Mensura Sortis."
  *Commentarii Academiae Scientiarum Imperialis Petropolitanae*,
  5: 175-192. English: Sommer (1954). *Econometrica*, 22(1): 23-36.
  Earlier: Huygens, C. (1657). *De Ratiociniis in Ludo Aleae*.
- Wire: `POST /services/FinancialBenchmarkService/scenarioAnalysis`

### Calculation Count: 18 total (15 JS + 3 Axis2/C)

### Explicitly Rejected Calculations

| Calculation | Gate failed | Reason |
|-------------|-------------|--------|
| Scenario outputs feeding a sizing decision | Generic math | A portfolio-construction workflow, not a formula |
| Market cap classification | Provenance | No single academic source; arbitrary thresholds |
| Moving average % distance | Provenance | Practitioner-derived, no academic origin |
| Consensus deviation | Provenance | No academic origin for "consensus estimate" |
| Beta calculation | Generic math | No single canonical form; implementations differ by firm |
| Position sizing | Generic math | A sizing algorithm with fund constraints is a product, not a formula |
| **Macro scenario modeling** | **Philosophy** | **See below** |
| CAPE ratio | Data | Requires earnings data not in the CSV; add to glossary as manual-entry concept |

### Why No Macro Scenario Modeling

kanaha-calcs deliberately excludes oil price sensitivity, CPI forecasts,
interest rate scenarios, and all other macroeconomic prediction features.
This is not a technical limitation — it is a philosophical choice aligned
with a company-specific bottom-up investment philosophy.

with a bottom-up investment philosophy focused on company-specific
fundamentals. Two Warren Buffett quotes capture this position directly:

> *"We will continue to ignore political and economic forecasts, which
> are an expensive distraction for many investors and businessmen."*
> — Warren Buffett, 1994 Letter to Shareholders

> *"Imagine the cost to us if we had let a fear of unknowns cause us
> to defer or alter the deployment of capital. Indeed, we have usually
> made our best purchases when apprehensions about some macro event
> were at a peak."*
> — Warren Buffett

kanaha-calcs teaches the math behind this philosophy: Kelly, Sharpe,
portfolio variance, and scenario analysis all operate on asset-level
inputs, not macro predictions. Adding oil price or CPI modeling would
contradict a bottom-up fundamental approach.

---

## Data Architecture

### Bundled Data (ships with APK)

**Dataset 1: US Equities**

**Source**: Quandl WIKI EOD Stock Prices (public domain)
**License**: Explicit public domain dedication with redistribution rights
**Tickers**: MSFT, AAPL, AMZN, JPM, JNJ (initial bundle)
**Period**: March 2008 - March 2018 (10 years)
**Column**: Adj. Close (split- and dividend-adjusted)
**Files**:
  - `data/wiki_2008_2018_daily_closes.csv` — 2,516 rows × 5 tickers × 4 columns (301KB)
    Columns per ticker: Close (raw), ExDiv, Split, AdjClose
  - `data/DATA_LICENSE.txt` — verbatim public domain notice

**Generation**: `pip3 install nasdaq-data-link && python3 scripts/fetch_wiki_data.py API_KEY`
(free signup at https://data.nasdaq.com/sign-up, Personal account).
Uses the `WIKI/PRICES` datatable endpoint via the `nasdaqdatalink` library
(the older `WIKI/{TICKER}` time-series endpoint is WAF-blocked by Incapsula).
The dataset is frozen at March 27, 2018, so the script is deterministic —
re-running produces identical output.

**Initial fetch**: Performed 2026-05-02. Data committed to the repo.
The script exists for reproducibility.

**Dataset 2: Foreign Exchange Rates**

**Source**: Federal Reserve Board H.10 Foreign Exchange Rates
**License**: US public domain (17 U.S.C. §105) — "may be copied and
distributed without permission"
**Symbols**: ~25 major currencies (EUR, JPY, GBP, CHF, CAD, AUD, CNY,
KRW, MXN, etc.) + DTWEXBGS (broad trade-weighted dollar index)
**Period**: March 2008 - March 2018 (matched to equity dataset)
**Frequency**: Daily (business days)
**Files**:
  - `data/fed_h10_fx_10yr.csv` — same column convention as equities
    (ExDiv=0, Split=1.0, AdjClose=Close for all FX/index rows)
  - `data/FED_H10_LICENSE.txt` — verbatim Board of Governors disclaimer

**Download**: https://www.federalreserve.gov/datadownload/choose.aspx?rel=h10
**Important**: Fetch directly from the Board of Governors, NOT from FRED.
FRED (St. Louis Fed Bank) adds restrictive terms including an AI/ML
prohibition. The underlying H.10 data is public domain at source.

**Why DTWEXBGS, not DXY**: DXY is proprietary (ICE/NYSE). DTWEXBGS is
the Fed's equivalent — a broader, GDP-weighted basket (~26 currencies
vs. DXY's 6). Better for educational purposes because it covers
emerging-market currencies relevant to ACWI-benchmarked portfolios.

### ACWI Coverage and S&P 500 Expansion

A common institutional benchmark is **MSCI ACWI** (All Country
World Index) — 2,514 constituents across 23 developed and 24 emerging
market countries. The Quandl WIKI dataset covers ~3,000 US equities
across **all three US exchanges** (NYSE, Nasdaq, AMEX), not just
Nasdaq-listed stocks. JPM and JNJ in our bundled data are NYSE-listed.

| ACWI segment | Weight | In Quandl WIKI? |
|-------------|--------|:---------------:|
| **US stocks** | **~62%** | **Yes** — virtually all US ACWI constituents |
| Japan | 5.4% | No |
| UK | 3.5% | No |
| Other developed (EU, Canada, Australia) | 15.5% | No |
| Emerging markets | 12.1% | No |

**S&P 500 expansion (future option):** The entire S&P 500 is available
in WIKI (all list on NYSE or Nasdaq, both covered). A full S&P 500 CSV
with 10 years of history would be ~11 MB (still smaller than a phone
photo) and take ~15-20 minutes to fetch (500 API calls, well within
free tier rate limits). The JS covariance computation for 500 tickers
takes ~1 second on a modern phone. The Axis2/C `portfolioVariance`
service handles 500-asset matrices in 153 μs (measured on a Linux desktop).
No architecture changes needed — just expand the ticker list in the
fetch script.

| Metric | 5 tickers (current) | 500 tickers (S&P 500) |
|--------|--------------------:|----------------------:|
| CSV file size | 301 KB | ~30 MB |
| JS covariance computation | microseconds | ~1 second |
| Covariance matrix memory | 25 floats | 250,000 floats (~2 MB) |
| Axis2/C portfolioVariance | instant | 153 μs |
| Fetch time (one-time) | ~10 seconds | ~17 minutes |

**International stocks** (the ~38% of ACWI that's non-US) have no
public-domain data source. Institutional users can load international
tickers from vendor CSV exports via the file picker — that's their data
under their license.

### User-Loaded Data ("Bring Your Own Data")

The app supports loading arbitrary CSV data via the Android file picker.
This is the mechanism for data that cannot be bundled (licensed vendor
data, proprietary indices, international equities).

| User type | Data source | How |
|-----------|-------------|-----|
| Institutional users | Licensed vendor feeds (FactSet, Bloomberg, and similar) | Export CSV, transfer to phone, load via file picker |
| Institutional users | Licensed vendor feeds (FactSet, Bloomberg, and similar) | Export to CSV with currency symbols (USDJPY, EURGBP, etc.) |
| Everyone else | Stooq (free, no registration) | Download CSV from stooq.com, load via file picker |

**CSV format contract** (same as bundled):
```csv
Date,TICKER1,TICKER2,...
2026-04-08,374.33,258.90,...
```

One column per ticker. One row per trading day. Adj. Close prices.
The app computes covariance in JS (O(n² × T), instant for ≤50 tickers).

**Key design principle: the app does not validate ticker names.** A
"ticker" is any column header string. `AAPL`, `USDJPY`, `DXY`,
`BRENT`, `VIX`, `FUND_vs_BENCH` — all work identically. The app treats
every column as a price series. This means:

- **Mixed asset portfolios**: Load equities + currencies + indices in
  one CSV. Fund Mode computes NAV, weights, covariance, IR, and VaR
  across the mix. A portfolio containing AAPL + USDJPY + DTWEXBGS shows
  how currency exposure affects portfolio variance.

- **Institutional workflow**: Export vendor time series for fund holdings +
  benchmark + FX pairs → save as CSV → load in app → see IR,
  tracking error, and currency correlation. Designate a benchmark column
  → IR computes automatically.

- **No special handling for asset types**: Currencies have no dividends
  or splits, so ExDiv=0 and Split=1.0 (same as AMZN in the bundled
  data). Indices behave identically. The CSV schema handles all asset
  types uniformly.

### Corporate Action Adjustment

All prices in the bundled CSV are Adj. Close — retroactively adjusted for
splits and dividends. The app does NOT process raw corporate actions.

**UI explanation** (displayed in "About this data" panel):

> Prices are *adjusted* for corporate actions — stock splits and
> dividends — so that returns are comparable across the full 10-year
> history.
>
> For example, Apple executed a 7-for-1 stock split on June 9, 2014.
> A share trading at $645 became 7 shares at $92 each. Without
> adjustment, this would appear as an 86% loss. The adjusted prices
> divide all pre-split history by 7, so the return series is continuous.
>
> Similarly, dividend-paying stocks (Microsoft, JPMorgan, Johnson &
> Johnson) have their historical prices reduced by the cumulative value
> of dividends paid after each date, ensuring that total return is
> captured in the price series.
>
> Amazon paid no dividends and had no splits during this period, so
> its raw and adjusted prices are identical.

### Data That Must NOT Be Shipped

| Source | Why not |
|--------|---------|
| FactSet | Licensed data; same restriction |
| Stooq | Terms explicitly prohibit redistribution without consent |
| Yahoo Finance | Terms prohibit automated downloads and redistribution |
| CRSP/WRDS | Subscription-only academic data |
| Bloomberg | Licensed terminal data |
| CBOE VIX | Proprietary index; redistribution requires paid Data Agreement ($2K+/year) |
| ICE DXY | Proprietary index; use DTWEXBGS (public domain Fed data) instead |
| FRED (for any data) | FRED adds restrictive terms on top of public-domain source data including AI/ML prohibition; fetch directly from the originating agency instead |
| Bank of England FX rates | Excluded from Open Government Licence — FX data owned by LSEG |

---

## Feature: Algorithm Provenance ("Learn More")

Each calculation has a "Learn More" expandable panel that shows:
1. The formula in mathematical notation
2. The original paper citation
3. A 2-3 sentence historical narrative
4. For JS calculations: the implementation (visible inline)
5. For Axis2/C services: wire format example + link to source

This feature serves three purposes:
- **Educational**: intern on a plane learns where Kelly comes from
- **OSS defense**: if anyone questions whether the math is proprietary,
  the in-app citations prove each algorithm predates any commercial product by decades
- **Developer reference**: engineers can read the math and trace it to
  the implementation in either JS (inline) or C (linked)

### JS Math: Visible In-App

The 15 JS calculations are simple enough to show inline. Each "Learn
More" panel includes the actual implementation — typically 1-5 lines.
The user can read the formula, the citation, AND the code in one view.

```javascript
// #1 Kelly Fraction — the entire implementation
function kellyFraction(p, b) {
  const q = 1 - p;
  return (b * p - q) / b;
}

// #3 Sharpe Ratio
function sharpeRatio(ret, rf, vol) {
  return (ret - rf) / vol;
}

// #7 Covariance Matrix (annualized, from log returns)
function covarianceMatrix(priceArrays, annualize = 252) {
  const returns = priceArrays.map(prices =>
    prices.slice(1).map((p, i) => Math.log(p / prices[i]))
  );
  const n = returns.length;
  const T = returns[0].length;
  const means = returns.map(r => r.reduce((a, b) => a + b, 0) / T);
  const cov = Array.from({length: n}, () => Array(n).fill(0));
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      let s = 0;
      for (let t = 0; t < T; t++)
        s += (returns[i][t] - means[i]) * (returns[j][t] - means[j]);
      cov[i][j] = (s / (T - 1)) * annualize;
    }
  return cov;
}

// #11 Maximum Drawdown
function maxDrawdown(prices) {
  let peak = prices[0], maxDD = 0;
  for (const p of prices) {
    if (p > peak) peak = p;
    const dd = (p - peak) / peak;
    if (dd < maxDD) maxDD = dd;
  }
  return maxDD;
}

// #14 Information Ratio
function informationRatio(portfolioReturns, benchmarkReturns) {
  const excess = portfolioReturns.map((r, i) => r - benchmarkReturns[i]);
  const mean = excess.reduce((a, b) => a + b, 0) / excess.length;
  const variance = excess.reduce((a, e) => a + (e - mean) ** 2, 0) / (excess.length - 1);
  return mean / Math.sqrt(variance);
}

// #15 Return Decomposition
function decomposeReturn(totalUsdReturn, fxReturn) {
  // Approximation for log returns: R_total ≈ R_local + R_fx
  return { local: totalUsdReturn - fxReturn, fx: fxReturn };
}
```

Every JS calculation follows this pattern: a pure function, no side
effects, no dependencies, 1-10 lines. The user sees the code directly
in the "Learn More" panel.

### Axis2/C Math: Linked to OSS Source

The 3 Axis2/C services run as native C code on the phone. The math is
too complex to show inline (portfolio variance is ~100 lines including
validation, Monte Carlo is ~200 lines with GBM, seeding, and statistics,
scenario analysis is ~300 lines with hash table benchmarking). Instead,
the "Learn More" panel links to the Apache-licensed source on GitHub.

**Source location**: `axis-axis2-c-core/samples/user_guide/financial-benchmark-service/src/`

The C source contains extensive documentation comments that explain
every mathematical decision. These comments were written specifically
for developers porting or reviewing the algorithms:

**Portfolio Variance** (`financial_benchmark_service.c` lines 370-386):
```c
/**
 * Core Portfolio Variance Calculation
 *
 * Formula: σ²_p = Σ_i Σ_j w_i * w_j * σ_ij
 *
 * The output basis matches the input basis — if the caller passes a
 * daily covariance matrix, σ²_p is a daily variance, and the caller
 * can annualize by sqrt(252) externally. The service additionally
 * emits an annualized_volatility field computed as
 *   portfolio_volatility * sqrt(n_periods_per_year)
 * which is correct for a PER-PERIOD input matrix. Callers who pass a
 * pre-annualized matrix should pass n_periods_per_year=1, which makes
 * the field equal portfolio_volatility; leaving the 252 default
 * double-annualizes it by sqrt(252) ~ 15.9. Kanaha's own covariance
 * helper annualizes (cov * 252), so calls from this app are in that
 * case and must pass 1.
 */
```

**Monte Carlo GBM** (`financial_benchmark_service.c` lines 826-874):
```c
/**
 * GBM update rule per step:
 *   S(t+dt) = S(t) * exp((μ − σ²/2) * dt  +  σ * sqrt(dt) * Z)
 *
 * The Itô correction (−σ²/2) is NOT optional:
 *   Without the −σ²/2 drift adjustment, the expected terminal value
 *   would be S(0) * exp((μ + σ²/2) * T), drifting upward with vol.
 *   WITH the correction, E[S(T)] = S(0) * exp(μ * T), which is what
 *   any reader of Black-Scholes expects. Home-grown GBM implementations
 *   frequently omit this; the code here preserves it verbatim.
 *
 * Reproducibility:
 *   xorshift128plus seeded from request->random_seed (or time(NULL)
 *   if seed == 0). Reproducibility is PER-PRNG only — callers
 *   reconciling against NumPy (PCG64), R (Mersenne Twister), or
 *   java.util.Random (LCG) will get different numbers for the SAME
 *   seed even with identical inputs.
 */
```

**Scenario Analysis** (`financial_benchmark_service.c` lines 1233-1245):
```c
/**
 * Financial calculation per asset:
 *   expected_return = Σ(probability_i × (scenario_price_i / current_price - 1))
 *   upside  = Σ(probability_i × max(0, price_i - current) × position_size)
 *   downside = Σ(probability_i × max(0, current - price_i) × position_size)
 *
 * Benchmark: N_LOOKUPS = n_assets × 10 lookups measured for both
 * O(n) linear scan and O(1) hash table methods.
 */
```

The "Learn More" panels for these three calculations show:
1. The formula and citation (same as JS calcs)
2. The wire format (JSON request/response example)
3. A "View Source" link to the GitHub-hosted C file with line numbers
4. Key excerpts from the C comments (Ito correction explanation,
   double-annualization warning, reproducibility caveat)

### Provenance Display Content

| # | Calculation | Display text |
|---|-------------|-------------|
| 1 | Kelly fraction | "Developed at Bell Labs in 1956 to optimize signal transmission over noisy telephone lines. Ed Thorp later applied it to blackjack (1962) and then to Wall Street portfolio sizing." |
| 2 | Kelly odds | "The payoff ratio measures how much you stand to win relative to how much you stand to lose. Kelly uses this to determine what fraction of your capital to risk." |
| 3 | Sharpe ratio | "William Sharpe introduced this ratio in 1966 to measure risk-adjusted return: how much excess return (above the risk-free rate) do you earn per unit of volatility? A ratio above 1.0 means each unit of risk earned more than one unit of excess return. Setting the risk-free rate to zero reduces this to a simple return-over-volatility ratio. Sharpe won the Nobel Prize in Economics in 1990." |
| 4 | Normal CDF | "The normal (bell curve) distribution was formalized by Carl Friedrich Gauss in 1809. The efficient approximation used here comes from Abramowitz & Stegun's 1964 Handbook, the most cited mathematical reference in history." |
| 5 | Percent change | "The percentage — 'per centum,' per hundred — has been used in commercial arithmetic since at least Fibonacci's 1202 Liber Abaci, which introduced Hindu-Arabic numerals and commercial math to Europe." |
| 6 | Median | "Francis Galton formalized the median as a statistical measure in 1881. Unlike the mean, the median is resistant to extreme outliers — one reason it's used for household income statistics." |
| 7 | Covariance matrix | "Karl Pearson formalized the correlation coefficient in 1896 to study heredity. The covariance matrix extends this to measure how multiple variables move together — the foundation of Markowitz's 1952 portfolio theory." |
| 8 | NAV | "Luca Pacioli published the first systematic description of double-entry bookkeeping in 1494 — the same system that underlies NAV computation today. Every position has a debit (quantity) and a credit (value). The sum is the fund's net worth." |
| 9 | Portfolio weight | "Markowitz's 1952 insight was that portfolio risk depends not on individual assets but on how they're weighted together. Weights are the bridge between individual holdings and portfolio-level risk — change a weight and you change the portfolio's variance." |
| 10 | Portfolio return | "The weighted average return was central to Markowitz's original 1952 paper. It seems simple — just multiply each return by its weight and sum — but the subtlety is that cash (with near-zero return) pulls down the average, which is why excluding cash overstates performance." |
| 11 | Maximum drawdown | "The largest peak-to-trough decline measures the worst historical loss an investor would have experienced. Grossman and Zhou formalized optimal drawdown-control strategies in 1993, but the concept is intuitive: the 2008 financial crisis shows JPM's drawdown in the bundled data — a number that makes volatility statistics concrete." |
| 12 | Excess return | "Michael Jensen introduced alpha — the return above a benchmark — in his landmark 1968 study of mutual fund performance. He found that most funds failed to beat their benchmarks after fees. The question 'did the fund beat the index?' is the single number that determines whether active managers earn performance fees." |
| 13 | Dividend yield | "John Burr Williams argued in 1938 that a stock is worth the present value of all future dividends — the dividend discount model. Dividend yield is the simplest expression of this idea: how much income does the stock pay relative to its price? JNJ's 50+ year streak of increasing dividends makes it a 'Dividend King' — a term for companies that have raised dividends for at least 50 consecutive years." |
| 14 | Information ratio | "Richard Grinold introduced the Information Ratio and the Fundamental Law of Active Management (IR = IC × √BR) in a 1989 *Journal of Portfolio Management* paper. The IR is the Sharpe ratio of active management — excess return per unit of tracking error. IR > 1.0 is considered strong; IR > 2.0 is exceptional and rare. The metric answers: for every 1% you deviate from your benchmark, how many percentage points of alpha do you generate? Grinold & Kahn expanded this into the definitive textbook *Active Portfolio Management* (2000)." |
| 15 | Return decomposition | "Gary Brinson, Randolph Hood, and Gilbert Beebower published the foundational performance attribution paper in *Financial Analysts Journal* in 1986 — decomposing portfolio returns into allocation, selection, and interaction effects. Denis Karnosky and Brian Singer extended this to multi-currency portfolios in a 1994 CFA Institute Research Foundation monograph, separating local-market return from currency return. For example, if in a given year MSCI ACWI outperforms the S&P 500 by 5%, the decomposition might reveal that international stocks returned only ~13% in local terms — but a ~9% fall in the US dollar added a currency tailwind, inflating USD returns to ~22%. Without decomposition, you would attribute all the outperformance to stock selection rather than currency movement." |
| 16 | Portfolio variance | "Harry Markowitz was a PhD student at Chicago when he published this in 1952. His dissertation committee, which included Milton Friedman, was initially skeptical — the work was considered outside traditional economics. He won the Nobel Prize for it in 1990, and mean-variance optimization remains the foundation of modern portfolio theory." |
| 17 | Monte Carlo VaR | "Invented at Los Alamos in the 1940s to simulate nuclear chain reactions. Stanislaw Ulam was playing solitaire while recovering from brain surgery and wondered about the probability of winning — then realized random sampling could solve intractable physics problems. The code name 'Monte Carlo' was suggested by Nicholas Metropolis, a reference to Ulam's uncle who gambled there." |
| 18 | Scenario analysis | "The concept of expected value was first formalized by Christiaan Huygens in 1657 for analyzing games of chance. Daniel Bernoulli extended it in 1738 with the St. Petersburg paradox — showing that people don't value outcomes proportionally to their probability, which led to utility theory." |

---

## Feature: Fund Mode

Fund Mode lets the user group tickers into a portfolio by assigning
quantities (shares) and an optional cash position. The app computes
NAV, weights, portfolio return, portfolio variance (via Axis2/C),
Monte Carlo VaR (via Axis2/C), and — when a benchmark is designated —
excess return, tracking error, and information ratio (IR) — all from
quantities the user enters and the loaded price series.

### Generic-math test: PASS

Fund Mode: user assigns quantities → NAV → weights → portfolio variance →
VaR. It describes a portfolio the user already holds; it recommends no
positions. Bloomberg PORT, FactSet PA and Morningstar Direct all do the
same: every portfolio analytics tool computes NAV, weights and portfolio
variance from positions. It is generic, not proprietary.

### How it works

The user sees the bundled tickers (or loaded CSV tickers) with input
fields for quantity and an optional cash amount:

```
Fund: "My Portfolio"              NAV: $10,000,000
──────────────────────────────────────────────────────
Ticker  Qty      Price      Value        Weight
MSFT    1,000    $89.47     $89,470       0.89%
AAPL    500      $168.34    $84,170       0.84%
AMZN    50       $1,497.05  $74,853       0.75%
JPM     800      $108.17    $86,536       0.87%
JNJ     600      $127.21    $76,326       0.76%
Cash    —        $1.00      $9,588,645   95.89%
──────────────────────────────────────────────────────
Portfolio Volatility: 1.2%    99% VaR: $28,000
```

Prices come from the last row of the bundled CSV (or user-loaded CSV).
Quantities and cash are user-entered. Everything else is computed.

### The Cash Drag Demo ("What If?")

A toggle: **"Exclude cash from NAV"**. This recreates the exact data
quality bug described in `game3_pregame_data_quality_nav_cash.md` — the
cascade where a missing cash position corrupts every downstream metric.

When toggled, the app recomputes everything with cash excluded:

```
Fund: "My Portfolio" (CASH EXCLUDED)  NAV: $411,355
──────────────────────────────────────────────────────
Ticker  Qty      Price      Value        Weight
MSFT    1,000    $89.47     $89,470      21.75%  ↑
AAPL    500      $168.34    $84,170      20.46%  ↑
AMZN    50       $1,497.05  $74,853      18.20%  ↑
JPM     800      $108.17    $86,536      21.04%  ↑
JNJ     600      $127.21    $76,326      18.55%  ↑
──────────────────────────────────────────────────────
Portfolio Volatility: 28.9%   99% VaR: $118,000
```

The UI highlights what changed and why:
- **NAV dropped** from $10M to $411K (cash excluded from sum)
- **Every weight inflated** (denominator shrank, numerators unchanged)
- **Volatility jumped** from 1.2% to 28.9% (no cash ballast)
- **VaR jumped** ~4x (variance scales as w², so ~w² effect)

### Why this matters

**For portfolio managers**: This is a common data quality issue in real
portfolios. Industry estimates suggest 5-10% of funds have invalid
data caused by cash miscounting. Seeing the cascade interactively,
with real tickers, makes the problem concrete.

**For systems programmers**: Every term (NAV, AUM, ROIC, VaR, weighted
average) becomes concrete. You're not reading definitions — you're
toggling a switch and watching numbers move. The cascade (cash wrong →
NAV wrong → weights wrong → variance wrong → VaR wrong) is visible
in one screen.

**For interns**: The same toggle teaches why data quality matters more
than algorithm sophistication. The fanciest Monte Carlo simulation
produces garbage if the input weights are wrong because someone forgot
to count cash.

### Fund Mode "Learn More" content

> **What is a Fund?**
>
> A fund is a collection of investments (positions) managed together.
> Each position has a quantity (shares) and a price, giving it a value.
> The sum of all position values is the fund's Net Asset Value (NAV).
>
> NAV was formalized through double-entry bookkeeping, first published
> by Luca Pacioli in *Summa de Arithmetica* (1494) — the same book
> that taught Renaissance merchants how to track assets and liabilities.
>
> **Why cash matters**
>
> Cash is a position with price = $1.00 and near-zero return. Including
> cash in the portfolio reduces volatility because cash doesn't
> fluctuate with the market. Excluding cash — accidentally or
> intentionally — inflates every stock's weight and overstates the
> portfolio's risk and return metrics.
>
> **The cascade**
>
> If NAV is wrong, weights are wrong. If weights are wrong, portfolio
> return, variance, VaR, and ROIC are all wrong. A single missing cash
> position corrupts every downstream metric. This is why data quality
> in portfolio management starts with getting NAV right.

---

## Feature: Corporate Action Visualization

The bundled CSV includes raw Close, Ex-Dividend, Split Ratio, and
Adj. Close for each ticker. This enables corporate action visualization
without any new data or services.

### What the data shows (actual from the bundled CSV)

| Ticker | Splits | Dividend payments | Total dividends/share |
|--------|:------:|:-----------------:|----------------------:|
| MSFT | 0 | 39 | $9.40 |
| AAPL | **1** (7:1, June 9 2014) | 21 | $30.47 |
| AMZN | 0 | 0 | $0.00 |
| JPM | 0 | 39 | $12.30 |
| JNJ | 0 | 39 | $24.84 |

### Visualizations (all from existing CSV columns, no new data)

**1. Raw vs. Adjusted overlay**: Plot `AAPL_Close` and `AAPL_AdjClose`
together. On June 6, 2014: Close = $645.57. On June 9, 2014:
Close = $93.70 (7:1 split). The raw line shows an 85% cliff; the
adjusted line is smooth ($86.80 → $88.19). This is the single most
powerful educational visual in the app — and directly illustrates
what market data vendors compute when they adjust historical prices:
making price histories comparable across corporate actions.

**2. Dividend timeline**: Highlight rows where `ExDiv > 0`. Show
dividend amounts on a timeline. JNJ's 39 payments over 10 years —
every quarter, increasing — is the Dividend King story in data.
AMZN's zero dividends is the growth-stock counter-example.

**3. Adjustment factor**: `AdjClose / Close` on any date = the
cumulative corporate action adjustment factor. This is conceptually
identical to how any market data vendor (FactSet, Bloomberg, Refinitiv)
provides adjustment factors for historical price series. Plotting this
ratio over time shows how dividends and splits compound backward.

### Connection to Professional Practice

This feature directly parallels how institutional market data pipelines
work. The bundled CSV columns map to standard vendor concepts:

| kanaha-calcs column | Industry equivalent |
|---------------------|---------------------|
| `AAPL_Split = 7.0` | Corporate action split ratio |
| `MSFT_ExDiv = 0.28` | Ex-dividend amount |
| `AdjClose / Close` ratio | Cumulative adjustment factor |
| `AdjClose` column | Split-and-dividend-adjusted closing price |

The kanaha-calcs visualization shows the *result* of what market data
pipelines compute. Same math, public domain data, educational context.

---

## Feature: Glossary

The app includes a glossary of financial terms. These are business
definitions, not calculations — they do not require academic provenance
(the provenance gate applies to formulas that produce numerical results,
not to vocabulary definitions). The glossary exists so that a systems
programmer can look up what their colleagues are talking about.

| Term | Definition | Where computed in the app |
|------|-----------|--------------------------|
| **NAV** | Net Asset Value — the total value of all positions in a fund, computed as Σ(price × quantity). | Fund Mode: the sum at the top |
| **AUM** | Assets Under Management — the total market value of all investments managed by a firm. The sum of all fund NAVs. Unlike NAV, AUM changes when investors add or withdraw money. | Not computed — defined only. Conceptually: sum of multiple fund NAVs. |
| **Weight** | A position's value as a fraction of the fund's NAV. Weights must sum to 100% (or 1.0). | Fund Mode: the % column |
| **Portfolio Return** | The weighted sum of individual position returns: R = Σ(w_i × r_i). Cash contributes near-zero return but pulls down the weighted average. | Fund Mode: computed from weights and per-ticker returns |
| **VaR** | Value at Risk — the maximum expected loss at a given confidence level (e.g., 95% or 99%) over a specific time period. "There is a 99% probability we won't lose more than $X in one year." | Monte Carlo service output |
| **CVaR** | Conditional VaR (Expected Shortfall) — the average loss in the worst cases beyond the VaR threshold. "If we're in the worst 5%, the average loss is $Y." Always worse than VaR. | Monte Carlo service output |
| **Volatility** | Annualized standard deviation of returns. Measures how much an asset's price fluctuates. Higher vol = more uncertainty. JNJ (16.7%) is low-vol defensive; JPM (42.7%) is high-vol because the 2008 crisis is in the data. | Covariance matrix diagonal: vol = √(cov_ii) |
| **Correlation** | How two assets move relative to each other. Range: -1 (perfect opposite) to +1 (perfect together). Low correlation = diversification benefit. | Covariance matrix: corr = cov_ij / (vol_i × vol_j) |
| **Covariance** | Like correlation but not normalized — measures both direction AND magnitude of co-movement. The raw input to portfolio variance. | Covariance matrix: cov_ij |
| **ROIC** | Return on Invested Capital — profit divided by the capital invested. If NAV is wrong (e.g., cash excluded), ROIC is overstated because the denominator is too small. | Fund Mode: user can enter a profit amount; ROIC = profit / NAV |
| **Cash Drag** | The reduction in portfolio return caused by holding non-invested cash. Cash earns near-zero return, so it dilutes the portfolio's overall performance. But it also reduces volatility — a feature, not a bug, for risk-averse portfolios. | Fund Mode: toggle cash on/off to see the effect |
| **Corporate Action** | An event by a company that changes its stock — splits, dividends, mergers. A 7:1 split means each share becomes 7 shares at 1/7th the price. Adjusted prices (Adj. Close) account for these so historical returns are comparable. | Data explanation panel; AAPL 7:1 split is the primary example |
| **Adj. Close** | The closing price after retroactive adjustment for all corporate actions (splits and dividends). This is the column used for computing returns and covariance matrices because it ensures return continuity. | All price data in the app uses Adj. Close from the Quandl WIKI dataset |
| **Drawdown** | The decline from a peak to a subsequent trough. Maximum drawdown is the worst peak-to-trough loss over a period. More intuitive than volatility — "you lost 55% from the peak" is scarier than "your annualized vol was 42%." | Calculation #11: computed from the CSV price series |
| **Excess Return (Alpha)** | A fund's return minus its benchmark's return. If a fund returns 15% and its benchmark returns 12%, excess return is +3%. This is the number that determines performance fees — you only get paid for the value you add above what an index fund delivers for free. | Calculation #12: simple subtraction in Fund Mode |
| **Benchmark** | The index a fund is measured against. For example, a global equity fund might benchmark to MSCI ACWI. If your fund doesn't beat its benchmark after fees, investors should buy a passive ETF instead. | Fund Mode: user designates a benchmark ticker or group |
| **Performance Fees** | The share of profits (typically 20%) a fund manager earns on returns above the benchmark or hurdle rate. No excess return = no performance fees. This is why benchmarks matter. | Not computed — defined only |
| **Long Position** | Buying a security with the expectation that its price will rise. You profit when the price goes up and lose when it goes down. This is what most people think of as "investing." If you buy 100 shares of MSFT at $89, you are "long" MSFT. Your maximum loss is the amount you invested (MSFT goes to $0); your potential gain is unlimited. | Fund Mode: every position with a positive quantity is a long position |
| **Short Position** | Borrowing and immediately selling a security you don't own, with the expectation that its price will fall. You profit when the price goes *down*. To close the position, you buy the shares back ("cover") and return them to the lender. If you short 100 shares at $89 and the price drops to $70, you profit $19/share. But if the price rises to $120, you lose $31/share — and unlike a long position, your potential loss is *unlimited* because a stock can rise indefinitely. This asymmetry is why shorting is considered higher-risk. | Glossary only — Fund Mode does not simulate shorts |
| **Alpha** | The return a fund generates above (or below) what's explained by market exposure. A fund with 12% return in a year when its benchmark returned 10% generated 2% alpha. Alpha represents the value added by the manager's skill — stock selection, timing, research — beyond what you'd get from passively holding the benchmark. Jensen (1968) formalized alpha in his study of mutual fund performance. In practice, most active managers fail to generate persistent alpha after fees, which is why passive index funds have grown. | Calculation #12 (Excess Return) is the simplest measure of alpha |
| **Beta** | A measure of how much a portfolio moves relative to the market. Beta = 1.0 means the portfolio moves exactly with the market. Beta > 1.0 means it amplifies market moves (more volatile); beta < 1.0 means it dampens them. Beta = 0 means zero correlation with the market — a truly market-neutral strategy. A 130/30 active extension fund targets beta ≈ 1.0 (100% net exposure). A market-neutral fund targets beta ≈ 0. Beta explains *how much* of a portfolio's return comes from market direction vs. manager skill (alpha). | Glossary only — requires a regression against a benchmark to compute formally |
| **Active Extension (130/30)** | A portfolio structure that is 130% long and 30% short, netting to 100% market exposure (beta ≈ 1.0). The short positions fund additional long positions — the proceeds from selling borrowed shares are reinvested in more longs. Longs have ~4.3x more impact than shorts because of the asymmetry (130% vs 30%). The manager can express both positive views (long) and negative views (short) without changing overall market exposure. | Glossary only — not simulated |
| **Market Neutral** | A strategy that holds roughly equal long and short positions, targeting zero net market exposure (beta ≈ 0). Returns come from stock selection (alpha), not market direction (beta). If the market falls 20%, a well-constructed market-neutral portfolio should be largely unaffected — the short positions gain approximately as much as the long positions lose. Many hedge funds run market-neutral strategies to isolate alpha from market beta. | Glossary only — not simulated |
| **Information Ratio (IR)** | Excess return divided by tracking error: IR = mean(R_excess) / σ(R_excess). The Sharpe ratio of active management — Sharpe measures return per unit of *total* risk, IR measures return per unit of *active* risk (deviation from benchmark). IR > 1.0 is strong; IR > 2.0 is rare. A fund with 11.85% excess return and 4.7% tracking error has an IR of 2.53 — meaning 2.53% of alpha generated per 1% of benchmark deviation. Introduced by Grinold (1989), "The Fundamental Law of Active Management," *Journal of Portfolio Management*, 15(3): 30-37. | Calculation #14: computed in Fund Mode when a benchmark is designated |
| **Tracking Error** | The standard deviation of excess returns — how much a portfolio's returns deviate from its benchmark period to period. Low tracking error (~2-3%) means the portfolio hugs the benchmark closely (index-like). High tracking error (~8-10%) means the manager takes large active bets. Tracking error is the denominator of the information ratio. | Computed as part of IR calculation (#14) |
| **DXY / DTWEXBGS** | The DXY (US Dollar Index) measures USD strength against 6 major currencies (EUR 57.6%, JPY 13.6%, GBP 11.9%, CAD 9.1%, SEK 4.2%, CHF 3.6%). DXY itself is proprietary (ICE). The app bundles **DTWEXBGS** — the Federal Reserve's Broad Trade-Weighted Dollar Index — which measures the same concept using a broader GDP-weighted basket (~26 currencies). **Why it matters**: DTWEXBGS does not directly predict whether the S&P 500 goes up or down — correlating DTWEXBGS with bundled US stocks like MSFT or JPM shows a weak relationship (~0.1-0.2). Instead, DTWEXBGS predicts whether a global index (like MSCI ACWI) *beats or trails* the S&P 500. The mechanism: ACWI is ~62% US stocks + ~38% international stocks. When USD strengthens, the ~38% international sleeve is worth less in dollar terms — even if those stocks rose in their local currencies. So ACWI underperforms SPY. When USD weakens, the reverse: international returns get a currency tailwind and ACWI outperforms. Use the app's covariance matrix to see the weak DTWEXBGS↔equity correlation, and the return decomposition (#15) to split any return into local vs. currency components. | Bundled H.10 data: DTWEXBGS price history available for charting and correlation with equities |
| **Return Decomposition** | Splitting a portfolio's USD return into local-currency return + FX return. A Japanese stock that returned 8% in yen but the yen strengthened 5% against USD delivered ~13% in USD terms. Without decomposition, you'd attribute all 13% to stock selection. Brinson, Hood & Beebower (1986) introduced the attribution framework; Karnosky & Singer (1994) extended it to currency. | Calculation #15: decompose any return into local + FX when both equity and FX data are loaded |
| **Earnings Surprise** | The difference between a company's actual reported earnings and the Wall Street consensus estimate: surprise = (actual - consensus) / consensus. If analysts expected AAPL to earn $1.50/share and Apple reported $1.62, that's a +8% surprise. This is one of the most-watched numbers in finance — it moves stock prices on earnings day and feeds into analyst research and portfolio models. Ball & Brown documented in 1968 that prices continue drifting in the direction of the surprise for weeks after announcement (see PEAD entry). Consensus estimates are proprietary data from providers like FactSet Estimates, Bloomberg, and Refinitiv — there is no public-domain source. | Glossary only — requires consensus estimates (proprietary). No public-domain source. |
| **PEAD** | Post-Earnings Announcement Drift — the empirical finding that stock prices continue moving in the direction of an earnings surprise for 60-90 days after announcement. One of the most persistent and well-documented market anomalies. First documented by Ball & Brown (1968), "An Empirical Evaluation of Accounting Income Numbers," *Journal of Accounting Research*, 6(2): 159-178. [JSTOR](https://www.jstor.org/stable/2490232). Further characterized by Bernard & Thomas (1989). PEAD persists despite decades of academic publication — suggesting either market inefficiency or compensation for a risk factor not yet identified. | Glossary only — requires earnings surprise data (see above) |
| **CAPE** | Cyclically Adjusted Price-to-Earnings ratio (Shiller P/E) — current price divided by 10-year average inflation-adjusted earnings. High CAPE suggests overvaluation relative to history. Introduced by Campbell & Shiller (1988). | Glossary only — requires earnings data not in the CSV |
| **VIX** | The CBOE Volatility Index — implied volatility of S&P 500 options over the next 30 days. VIX 12-20 is normal; VIX 30+ indicates elevated fear; VIX 70+ is crisis (2008 levels). At extreme VIX levels, bid-ask spreads widen dramatically and rebalancing costs for large portfolios can increase by orders of magnitude. High VIX → correlations spike (everything moves together); low VIX → normal dispersion. VIX data is proprietary (CBOE charges for redistribution) so it cannot be bundled — defined only. | Glossary only — not computed (CBOE proprietary) |
| **Market Impact** | *"Doubling a fund's assets doesn't double its returns — it quadruples its market impact."* The cost of your own trading — your buy orders push the price up before you finish buying, and your sell orders push it down. Impact scales as the **square root** of trade size relative to daily volume (impact ≈ σ × √(Q/V)): doubling your trade size increases impact by ~1.41x, not 2x. But to a systems programmer, the important insight is the O(√n) scaling — alpha is O(1) (constant regardless of AUM) while impact cost is O(√AUM). There's always a crossover. Kyle (1985) introduced the price impact parameter lambda; Almgren & Chriss (2001) formalized the square root law used by every execution desk. The "Scale it up" table in the calculator makes this visible — see how impact grows from 0.24% at $500M to 1.07% at $10B while alpha stays fixed. | Glossary with calculator — user enters AUM, number of positions, avg daily volume → estimated impact cost + "Scale it up" table |
| **Capacity Constraint** | *"Alpha doesn't scale. AUM does. That's the problem."* The AUM ceiling above which a fund's own trading costs destroy its alpha. A market-neutral strategy with 700 positions trading both sides might hit capacity at ~$2-2.5B — frequent rebalancing across small edges gets eaten by market impact. An active extension (130/30) with ~500 positions trading less frequently might scale to $5-10B. A pure index fund has no capacity constraint because it has no alpha to destroy — it IS the market. The paradox: success attracts inflows → inflows increase market impact → alpha degrades → the strategy that attracted the money can no longer generate the returns that attracted it. This is counterintuitive for anyone from a technology background, where scale is always good. In fund management, scale is the enemy of alpha. This is why the best-performing funds close to new investors. | Glossary only — conceptual. Market Impact calculator demonstrates the mechanism. |
| **Bond** | A loan to a government or corporation that pays a fixed interest rate (the "coupon") and returns the principal at maturity. A 10-year US Treasury bond paying 4.5% gives you $45/year per $1,000 invested, then your $1,000 back after 10 years. Bond prices move **inversely** to interest rates — when rates rise, existing bonds lose value (why would you pay full price for a 3% bond when new bonds pay 4.5%?). This inverse relationship is critical: when the Fed raises rates to fight inflation, bond portfolios lose money. A systems programmer can think of it as: coupon = fixed annual return, price = present value of remaining coupons discounted at current rates. | Glossary only — no bond data bundled (Fed H.10 covers currencies, not yields) |
| **US Treasury Bonds (Safe Haven)** | US government debt — considered the safest investment in the world because the US government has never defaulted and can print the currency it borrows in. In market stress (2008, 2020, geopolitical crises), investors sell risky assets (stocks, corporate bonds, emerging markets) and buy Treasuries — "flight to quality." This pushes Treasury prices up and yields down. The 10-year Treasury yield is the single most important number in finance: it sets the baseline for mortgage rates, corporate borrowing costs, and stock valuations (via the discount rate in DCF models). When the 10-year yield rises, stock valuations compress because future cash flows are worth less today. | Glossary only — Treasury yield data available from Fed but not currently bundled |
| **Inflation** | The rate at which prices rise over time, eroding purchasing power. Measured by CPI (Consumer Price Index). Inflation matters to investors because it determines the **real return**: if your portfolio returns 8% but inflation is 5%, your real return is only 3%. High inflation forces central banks (the Fed) to raise interest rates, which hurts bond prices, compresses stock valuations, and strengthens the dollar (higher rates attract foreign capital → DXY rises). The 2022-2024 inflation cycle demonstrated this chain: CPI above 8% → Fed raised rates from 0% to 5.25% → bonds lost 15%+ → growth stocks fell 30%+ → DXY surged. For portfolio construction, inflation is the hidden tax that turns nominal returns into real returns. | Glossary only — CPI data available from BLS (public domain) but not currently bundled |
| **TINA (There Is No Alternative)** | A market regime where interest rates are so low that bonds offer near-zero returns, forcing investors into stocks regardless of valuation. When the 10-year Treasury yields 0.5% (as in 2020-2021), a pension fund that needs 7% returns has no choice but to buy equities — even at historically high CAPE ratios. TINA inflates stock valuations because the denominator in every DCF model (the discount rate) is near zero, making future cash flows worth more today. When rates rise and bonds offer 4-5% again, TINA ends — investors have an alternative, capital flows out of stocks into bonds, and elevated CAPE ratios compress. The acronym was popularized by Margaret Thatcher in a political context; it was adopted by Wall Street in the 2010s to describe the post-2008 low-rate environment. | Glossary only — conceptual |
| **Breakeven / Payback** | The time (in years) for an investment's cash flows to recover the initial cost. Payback = cost / annual cash flow. Example: a $100K upfront cost with $5K/year cash flow takes 20 years to break even; at $25K/year it takes 4 years. The calculation is simple division but the insight is powerful — small changes in annual cash flow dramatically change the payback period. | Glossary with simple calculator (two user-entered numbers) |

---

## UI Theme: Dark Mode

Dark mode by default. Bloomberg Terminal, TradingView, and every serious
finance UI ships dark. Charts read better on dark backgrounds, correlation
heatmaps have more visual range, and it signals "this is a tool, not a
brochure." On OLED displays (Pixel phones), dark backgrounds also save
battery — near-black pixels consume almost zero power.

### Color Palette

```css
:root {
  --bg:       #1a1a2e;   /* deep navy-black (not pure black — avoids
                            OLED "black smearing" when scrolling) */
  --surface:  #16213e;   /* card background — slightly lighter navy */
  --border:   #0f3460;   /* subtle blue edge on cards and inputs */
  --text:     #e0e0e0;   /* soft white (not harsh #fff) */
  --muted:    #8a8a9a;   /* secondary text: labels, "Learn More" */
  --accent:   #00d4aa;   /* teal-green — the one pop of color */
  --negative: #ff6b6b;   /* coral-red for losses / negative values */
}
```

**Why teal-green, not blue**: Blue is overused in finance (every bank,
every fintech). Teal-green reads as "data/science" rather than
"corporate finance," has excellent contrast on dark backgrounds, and
is what TradingView and modern quant dashboards use.

**Why deep navy, not pure black**: Pure black (#000000) on OLED causes
visible smearing when scrolling — pixels take time to turn from fully
off to on. Deep navy (#1a1a2e) avoids this while still looking dark
and saving battery.

### Base Styles

```css
body {
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 16px;
  -webkit-text-size-adjust: 100%;  /* respect Android font size setting */
  margin: 0;
  padding: 8px;
}
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 16px;
  margin: 8px 0;
}
.tab.active {
  border-bottom: 2px solid var(--accent);
  color: var(--accent);
}
.result { color: var(--accent); font-weight: 600; }
.negative { color: var(--negative); }
input, select {
  background: var(--bg);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 6px 8px;
  border-radius: 2px;
}
button {
  background: var(--accent);
  color: var(--bg);
  border: none;
  padding: 8px 16px;
  font-weight: 600;
  border-radius: 2px;
}
details summary { color: var(--muted); cursor: pointer; }
details[open] summary { color: var(--accent); }
```

### Chart Colors

Chart.js uses these from the palette:

```javascript
const CHART_COLORS = [
  '#00d4aa',  // teal-green (primary)
  '#4ecdc4',  // lighter teal
  '#45b7d1',  // sky blue
  '#96ceb4',  // sage green
  '#ffd93d',  // gold
  '#ff6b6b',  // coral-red
  '#c9b1ff',  // lavender
  '#ff9ff3',  // pink
];
const HEATMAP_LOW  = '#1a1a2e';  // background color (low correlation)
const HEATMAP_HIGH = '#00d4aa';  // accent color (high correlation)
```

### Design Rules

- **No gradients. No shadows. No rounded corners larger than 4px.**
  Flat, dense, data-forward.
- **Positive values**: `var(--accent)` (#00d4aa teal-green)
- **Negative values**: `var(--negative)` (#ff6b6b coral-red)
- **Neutral values**: `var(--text)` (#e0e0e0 soft white)
- The app should look like it was built by someone who reads data,
  not someone who designs landing pages.

---

## Feature: Charts (Chart.js)

The app uses **Chart.js** (MIT license, 60KB) for all visualizations.
Chart.js is declarative — you pass a config object and it renders the
chart. No SVG manipulation, no DOM math.

### Chart types used

| Chart | Type | Data source | What it shows |
|-------|------|-------------|---------------|
| **Price history** | Line | CSV `AdjClose` columns | 10-year price trajectory for selected tickers |
| **Raw vs. Adjusted overlay** | Line (dual series) | CSV `Close` + `AdjClose` for one ticker | The AAPL split cliff — raw shows 85% drop, adjusted is smooth |
| **Drawdown curve** | Line | Computed from `AdjClose` | Peak-to-trough decline over time; 2008 crisis visible |
| **Dividend timeline** | Bar | CSV `ExDiv` column | Dividend payments over time; JNJ's increasing quarterly pattern |
| **Volatility comparison** | Bar | Computed from covariance diagonal | Side-by-side vol bars: JNJ 16.7% vs JPM 42.7% |
| **Correlation heatmap** | Colored grid (custom) | Computed correlation matrix | 5×5 color-coded matrix; dark = high correlation |

### Chart.js in the project

```
assets/
├── index.html          ← <canvas> elements for each chart
├── calcs.js            ← chart creation after computation
└── lib/
    └── chart.min.js    ← Chart.js 4.x (MIT, ~60KB minified)
```

No CDN, no npm, no build step. The minified JS file ships in `assets/lib/`
and loads via `<script src="lib/chart.min.js">`. Works offline.

---

## Feature: State Persistence (localStorage)

The WebView's `localStorage` persists across app restarts (backed by
SQLite in the WebView's data directory on Android). No permissions needed.

### What is saved

| Key | Type | Purpose |
|-----|------|---------|
| `fund_positions` | JSON object `{MSFT: 1000, AAPL: 500, ...}` | Fund Mode quantities |
| `fund_cash` | Number | Cash position amount |
| `cash_excluded` | Boolean | Cash Drag Demo toggle state |
| `loaded_csv_path` | String | Display name of user-loaded CSV |
| `fund_benchmark` | String or null | Ticker designated as benchmark (e.g., `"ACWI"`) for excess return and IR |
| `last_tab` | String (`"calculators"` / `"fund"` / `"glossary"`) | Reopen to last-used tab |

### What is NOT saved

Calculation results, covariance matrices, chart data — anything derivable
from inputs. Computed fresh on load (instant for 5 tickers, ~1 second
for 500).

### Implementation

```javascript
function saveState() {
    localStorage.setItem('fund_positions', JSON.stringify(positions));
    localStorage.setItem('fund_cash', cashAmount);
    localStorage.setItem('cash_excluded', cashExcluded);
    localStorage.setItem('last_tab', currentTab);
}

function loadState() {
    positions = JSON.parse(localStorage.getItem('fund_positions') || '{}');
    cashAmount = parseFloat(localStorage.getItem('fund_cash') || '0');
    cashExcluded = localStorage.getItem('cash_excluded') === 'true';
    currentTab = localStorage.getItem('last_tab') || 'calculators';
}
```

---

## Feature: Scenario Analysis UI

The Axis2/C `scenarioAnalysis` service is calculation #15. This section
specifies the user interface for entering scenarios.

### Design: 3-row Bull/Base/Bear default

```
┌─ Scenario Analysis ──────────────────────────┐
│                                               │
│ Ticker: [ AAPL ▼ ]    Current: $168.34       │
│                                               │
│ Scenarios:                                    │
│ ┌──────────┬───────────┬─────────────┐       │
│ │ Name     │ Price     │ Probability │       │
│ ├──────────┼───────────┼─────────────┤       │
│ │ Bull     │ [  210  ] │ [  40  ] %  │       │
│ │ Base     │ [  170  ] │ [  40  ] %  │       │
│ │ Bear     │ [  120  ] │ [  20  ] %  │       │
│ └──────────┴───────────┴─────────────┘       │
│ [ + Add scenario ]                            │
│                                               │
│ Probabilities sum: 100% ✓                    │
│                                               │
│ Expected value:  $176.00                      │
│ Expected return: +4.6%                        │
│                                               │
│ ▸ Learn More (Huygens 1657, Bernoulli 1738)  │
└───────────────────────────────────────────────┘
```

### Design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Default rows | 3 (Bull/Base/Bear) | Industry standard — every PM thinks in threes |
| Add more rows | Yes, via "Add scenario" button | Some users want 5-7 scenarios |
| Probability validation | Must sum to exactly 100% | Standard constraint — probabilities must be exhaustive; blocks calculation if not met |
| Ticker source | Dropdown populated from CSV headers | Picks up current price from last row automatically |
| Names | Freeform text, defaults are "Bull/Base/Bear" | The textbook names for three scenarios |
| Computation | JS for single-asset expected value | No Axis2/C call needed; the service is for multi-asset batch calls from Fund Mode |

### Generic-math test: PASS

This is a generic expected-value calculator with user-entered price
targets and probabilities — textbook material (Huygens 1657, Bernoulli
1738). Its result is shown, not fed into any position-sizing step. Every
finance textbook has this exact exercise.

---

## Feature: Market Impact Calculator

The Market Impact glossary entry includes an interactive calculator that
demonstrates the square root law of market impact. This is not one of
the 18 numbered calculations — it is a glossary-embedded calculator
(like the Breakeven/Payback calculator) that uses user-entered inputs
rather than CSV data.

### Generic-math test: PASS

Every execution desk at every fund computes market impact. Bloomberg
TCA (Transaction Cost Analysis), ITG POSIT, and Virtu Analytics all
provide this. The square root law is published in Kyle (1985) and
Almgren & Chriss (2001). It is not proprietary to any firm.

### Design

```
┌─ Market Impact Calculator ────────────────┐
│                                           │
│  AUM ($M):              [ 500   ]         │
│  Number of positions:   [ 700   ]         │
│  Avg daily volume ($M): [  50   ]         │
│  Avg daily volatility:  [ 0.02  ]  (2%)   │
│                                           │
│  [ Calculate ]                            │
│                                           │
│  Avg position size:     $714K             │
│  Position as % of ADV:  1.43%             │
│  Est. impact per trade: 0.24%  ($1,700)   │
│                                           │
│  ── Scale it up ──                        │
│  ┌────────┬──────────┬──────────┬───────┐ │
│  │ AUM    │ Pos size │ % of ADV │Impact │ │
│  ├────────┼──────────┼──────────┼───────┤ │
│  │ $500M  │ $714K    │  1.4%    │ 0.24% │ │
│  │ $1B    │ $1.43M   │  2.9%    │ 0.34% │ │
│  │ $2B    │ $2.86M   │  5.7%    │ 0.48% │ │
│  │ $5B    │ $7.14M   │ 14.3%    │ 0.76% │ │
│  │ $10B   │ $14.3M   │ 28.6%   │ 1.07% │ │
│  └────────┴──────────┴──────────┴───────┘ │
│                                           │
│  At $2B, impact costs ~$9.6M/year —       │
│  if your alpha is 2%, impact alone eats   │
│  half of it. That's the capacity wall.    │
│                                           │
│  ▸ Learn More (Kyle 1985, Almgren 2001)   │
└───────────────────────────────────────────┘
```

### Implementation

```javascript
function calcMarketImpact() {
  const aum = parseFloat(document.getElementById('mi-aum').value) * 1e6;
  const positions = parseInt(document.getElementById('mi-positions').value);
  const adv = parseFloat(document.getElementById('mi-adv').value) * 1e6;
  const vol = parseFloat(document.getElementById('mi-vol').value);

  const posSize = aum / positions;
  const pctAdv = posSize / adv;
  const impact = vol * Math.sqrt(pctAdv);  // Almgren-Chriss square root law

  // "Scale it up" table — show the same fund at 1x, 2x, 4x, 10x, 20x AUM
  const multipliers = [1, 2, 4, 10, 20];
  const rows = multipliers.map(m => {
    const scaledAum = aum * m;
    const scaledPos = scaledAum / positions;
    const scaledPct = scaledPos / adv;
    const scaledImpact = vol * Math.sqrt(scaledPct);
    return { aum: scaledAum, posSize: scaledPos, pctAdv: scaledPct, impact: scaledImpact };
  });
  // render table...
}
```

The formula is one line: `impact = volatility * sqrt(position_size / daily_volume)`.
The "Scale it up" table auto-generates from that formula at multiple AUM levels.

### "Learn More" content

> "Albert Kyle introduced the concept of price impact as a linear
> function of order flow in his landmark 1985 *Econometrica* paper
> 'Continuous Auctions and Insider Trading.' He showed that informed
> traders optimally spread their orders over time to minimize impact —
> and that the market maker's response (the lambda parameter) sets the
> price of information. Robert Almgren and Neil Chriss formalized the
> practical square root law in 2001: impact ≈ σ × √(Q/V), where σ is
> volatility, Q is trade size, and V is daily volume. This formula is
> used by every major execution desk and is the foundation of
> Transaction Cost Analysis (TCA). The insight for fund managers: alpha
> is constant regardless of AUM, but impact cost grows as √(AUM). There
> is always a crossover point where the fund's own trading destroys the
> edge it was built to exploit."

---

## Project Structure

```
kanaha-calcs/
├── app/src/main/
│   ├── java/org/kanaha/calcs/
│   │   └── MainActivity.java
│   ├── cpp/
│   │   ├── axis2c/
│   │   └── apache-httpd/
│   ├── assets/
│   │   ├── index.html
│   │   ├── calcs.js
│   │   ├── provenance.js
│   │   ├── style.css
│   │   ├── lib/
│   │   │   └── chart.min.js          # Chart.js 4.x (MIT, ~60KB)
│   │   └── sample_data/
│   │       ├── wiki_2008_2018_daily_closes.csv
│   │       ├── fed_h10_fx_10yr.csv
│   │       ├── DATA_LICENSE.txt
│   │       └── FED_H10_LICENSE.txt
│   ├── jniLibs/arm64-v8a/
│   │   └── libhttpd.so
│   └── res/layout/
│       └── activity_main.xml
├── data/                          # Source data (not shipped in APK)
│   ├── wiki_2008_2018_daily_closes.csv
│   ├── fed_h10_fx_10yr.csv
│   ├── DATA_LICENSE.txt
│   └── FED_H10_LICENSE.txt
├── docs/
│   ├── DESIGN_PRINCIPLES.md       # This file
│   └── DATA_PROVENANCE.md         # How data was sourced
├── scripts/
│   └── fetch_wiki_data.py         # One-time data fetch script
└── build.gradle
```

---

## Cross-Project Relationships

| Project | Relationship |
|---------|-------------|
| kanaha-camera (`~/repos/kanaha/kanaha-camera-app`) | Shares Apache httpd + Axis2/C native stack and cross-compile toolchain; uses IPC Intent (not JNI) for Java↔C communication |
| kanaha-audio (`~/repos/kanaha-audio`) | Shares one-button Activity pattern; kanaha-calcs replaces button with WebView |
| Axis2/C on a LAN build server | Same FinancialBenchmarkService code runs on both the build server and Android |
| DATA_API_AXIS2_PROPOSAL.md | Documents the 3 benchmark services, wire formats, and performance |
