---
type: reference
created: 2026-05-02
---

# Data Provenance: How kanaha-calcs Data Was Sourced

## BLUF

The app bundles two public-domain datasets:

1. **Quandl WIKI EOD Stock Prices** — explicitly public-domain US equity
   data hosted by Nasdaq. Fetched via the Nasdaq Data Link API (free
   account, no payment). Contains corporate-action-adjusted daily closing
   prices for ~3,000 US equities from 1996 through March 27, 2018. We
   use 10 years (March 2008 - March 2018) for 5 tickers: MSFT, AAPL,
   AMZN, JPM, JNJ.

   **This is a historical dataset and the filename says so**
   (`wiki_2008_2018_daily_closes.csv`). The dedication froze on
   2018-03-27, so that decade is the entire redistributable record and it
   will never extend. Nothing computed from it is a current risk
   estimate; it is the 2008 crisis and the decade after it, which is
   exactly what makes it a good teaching set and a bad proxy for today.
   Anything that names this file — a doc, a tool argument, a spoken
   request — should carry the years with it.

2. **Federal Reserve Board H.10 Foreign Exchange Rates** — US government
   public domain (17 U.S.C. §105). Daily exchange rates for ~25 major
   currencies plus the DTWEXBGS broad trade-weighted dollar index.
   Published by the Board of Governors, not FRED (which adds restrictive
   terms). Enables currency correlation analysis and mixed-asset
   portfolios in Fund Mode.

---

## Source Dataset

| Field | Value |
|-------|-------|
| **Name** | Quandl WIKI EOD Stock Prices |
| **URL** | https://data.nasdaq.com/data/WIKI-wiki-eod-stock-prices |
| **Owner** | Nasdaq, Inc. (acquired Quandl in 2018) |
| **License** | Public domain (see exact text below) |
| **Coverage** | ~3,000 US equities across NYSE, Nasdaq, and AMEX, 1996 - March 27, 2018 |
| **Last update** | March 27, 2018 (discontinued April 11, 2018) |
| **Reason discontinued** | A primary data source became unavailable |
| **Data origin** | Community-sourced from public sources (not from licensed exchange feeds) |

### License Text (verbatim from dataset metadata)

> "This data is in the public domain. You may copy, distribute,
>  disseminate or include the data in other products for commercial
>  and/or noncommercial purposes. This data is part of Quandl's Wiki
>  initiative to get financial data permanently into the public domain."

This license was verified via the Nasdaq Data Link API response metadata
and is documented in multiple third-party references:
- https://data.nasdaq.com/data/WIKI-wiki-eod-stock-prices/documentation
- https://www.kaggle.com/datasets/marketneutral/quandl-wiki-prices-us-equites

### Exchange Coverage

**Important**: "Nasdaq Data Link" is the data platform (formerly Quandl).
It is not limited to stocks listed on the Nasdaq exchange. The WIKI
dataset covers all three major US exchanges:

| Exchange | In WIKI? | Examples from our bundled data |
|----------|:--------:|-------------------------------|
| **NYSE** | Yes | JPM (JPMorgan Chase), JNJ (Johnson & Johnson) |
| **Nasdaq** | Yes | MSFT (Microsoft), AAPL (Apple), AMZN (Amazon) |
| **AMEX** | Yes | Smaller-cap stocks |

This means the **entire S&P 500** is available (all S&P 500 constituents
list on either NYSE or Nasdaq). A future expansion to 500 tickers would
produce an ~11 MB CSV — still smaller than a phone photo.

### ACWI Relevance

A common institutional benchmark is **MSCI ACWI** (All Country World
Index, 2,514 constituents). WIKI covers the US portion (~62% of ACWI
by weight), which includes all top ACWI holdings (NVDA, AAPL, MSFT,
AMZN, GOOG, META). The remaining ~38% (international) has no
public-domain data source — institutional users can load those via
vendor CSV exports through the file picker.

### Why This Source (and Not Others)

| Source considered | Outcome | Reason |
|-------------------|---------|--------|
| **Quandl WIKI** | **SELECTED** | Explicit public domain dedication with redistribution rights |
| FactSet | Rejected | Licensed data; redistribution prohibited |
| Stooq | Rejected | Terms §5.3: "Redistribution of data found on the website is not allowed without the consent of Stooq" |
| Yahoo Finance | Rejected | Terms prohibit redistribution |
| CRSP/WRDS | Rejected | Subscription-only academic data |
| Synthetic/fake data | Rejected | Fake data undermines educational credibility with sophisticated users |
| Pre-1978 newspaper archives | Rejected | Would exclude AMZN (IPO 1997); access requires library subscriptions |
| SEC EDGAR | Rejected | EDGAR has financial statements, not daily price history |
| FRED (Federal Reserve) | Rejected | Has stock market indices, not individual stock prices |
| FRED (for FX data) | **Rejected** | FRED adds restrictive terms on top of public-domain source data (including AI/ML prohibition). Go directly to the Fed Board H.10 instead. |
| Bank of England | Rejected | FX rates excluded from Open Government Licence — underlying data owned by LSEG |
| CBOE (VIX) | Rejected | VIX is proprietary; redistribution requires signed Data Agreement + annual fees ($2K+ minimum) |
| IMF Exchange Rates | Rejected | Commercial redistribution requires emailing copyright@imf.org for permission — not a blanket grant |
| ECB Reference Rates | Rejected | Free reuse with attribution, but "no modification" clause prohibits deriving USD-based cross rates from EUR-based data |
| fawazahmed0/exchange-api (GitHub) | Rejected | CC0 license on the *compilation*, but upstream FX data was scraped from unnamed sources. A CC0 dedication on a compiled dataset does not remove the copyright of the underlying data — without a clear provenance chain to permissively licensed sources, redistribution is legally risky |

---

## Second Bundled Dataset: Federal Reserve H.10 Foreign Exchange Rates

### Source

| Field | Value |
|-------|-------|
| **Name** | Federal Reserve Board H.10 Foreign Exchange Rates |
| **URL** | https://www.federalreserve.gov/releases/h10/hist/ |
| **Download** | https://www.federalreserve.gov/datadownload/choose.aspx?rel=h10 |
| **Owner** | Board of Governors of the Federal Reserve System |
| **License** | US public domain (17 U.S.C. §105 — works of US government employees) |
| **Coverage** | ~25 major currencies + DTWEXBGS (broad trade-weighted dollar index) |
| **Frequency** | Daily (business days) |
| **History** | Back to 1971 for some pairs |

### License Text (from Board of Governors disclaimer)

> "Unless otherwise indicated, information on Board's website is in
>  the public domain and may be copied and distributed without permission.
>  However, the Board requests that in any subsequent use of its work,
>  the Board be cited as the source of the information."

**Legal basis**: The Board of Governors is a US government agency. Its
employees are federal employees. Works they produce are public domain
under 17 U.S.C. §105 — the same statute that makes Census data,
weather data, and GPS signals public domain.

**Important distinction**: The H.10 data is produced by the **Board of
Governors** (federal agency = public domain). FRED at the St. Louis Fed
is a **Federal Reserve Bank** (not a federal agency; employees are not
government employees). FRED adds its own terms of use, including an
AI/ML prohibition. Always fetch H.10 data directly from the Board, not
through FRED.

### Why DXY vs. DTWEXBGS

The **DXY** (US Dollar Index) is a proprietary index calculated and
owned by ICE (Intercontinental Exchange). It cannot be redistributed.

The Fed publishes **DTWEXBGS** — the Broad Trade-Weighted Dollar Index —
which measures the same concept (USD strength against a basket of foreign
currencies) but uses a broader, GDP-weighted basket (~26 currencies vs.
DXY's 6) and is public domain. For educational purposes, DTWEXBGS is a
better teaching tool than DXY because it covers emerging-market currencies
that matter to ACWI-benchmarked portfolios.

### Currencies Available

Major currencies include: EUR, JPY, GBP, CHF, CAD, AUD, CNY, KRW, MXN,
INR, BRL, SEK, NOK, DKK, SGD, HKD, TWD, THB, MYR, ZAR, and others.
Plus the DTWEXBGS broad dollar index.

### Why This Data Matters for the App

Currency data enables two features that equity-only data cannot:

1. **Fund Mode with mixed assets**: Users can build a portfolio containing
   AAPL + USDJPY + DTWEXBGS and see how currency exposure affects
   portfolio variance and correlation. The covariance matrix computes
   across any mix of price series.

2. **DXY/DTWEXBGS as a glossary-with-data entry**: Instead of defining
   the dollar index in words only, users can see its 10-year history
   alongside equity prices and observe the relationship firsthand.

### CSV Format

Currency data follows the same column convention as equities. For
currencies and indices: ExDiv = 0, Split = 1.0, AdjClose = Close
(no corporate actions apply).

```csv
Date,DTWEXBGS_Close,DTWEXBGS_ExDiv,DTWEXBGS_Split,DTWEXBGS_AdjClose,USDJPY_Close,...
2008-03-28,95.1234,0.0,1.0,95.1234,99.85,0.0,1.0,99.85,...
```

The app does not care whether a "ticker" is a stock, currency pair, or
index — it is simply a price series with a date column.

### Data That Remains NOT Bundleable

| Data | Source | Why not |
|------|--------|---------|
| **VIX** | CBOE | Proprietary index; redistribution requires paid license ($2K+/year) |
| **DXY (exact)** | ICE/NYSE | Proprietary index; use DTWEXBGS (public domain) instead |
| **CAPE** | Requires earnings data | No public-domain source for individual-company earnings time series |
| **BOE exchange rates** | Bank of England | FX data excluded from Open Government Licence — owned by LSEG |
| **Licensed vendor data** (FactSet, Bloomberg, and similar) | Vendor | Vendor license prohibits redistribution |

---

## Data We Extracted

### Tickers

| Ticker | Company | Why selected |
|--------|---------|-------------|
| MSFT | Microsoft Corporation | Quarterly dividends demonstrate corporate action adjustment |
| AAPL | Apple Inc. | 7:1 split (June 2014) is a perfect educational example |
| AMZN | Amazon.com Inc. | No dividends/splits = raw equals adjusted (control case) |
| JPM | JPMorgan Chase & Co. | Financial sector diversification; highest volatility (2008 crisis) |
| JNJ | Johnson & Johnson | Negative correlation with tech; Dividend King |

These 5 tickers were selected for educational diversity: two tech (MSFT,
AAPL), one growth (AMZN), one financial (JPM), one defensive healthcare
(JNJ). Together they demonstrate splits, dividends, sector diversification,
and the 2008 financial crisis — all from public domain data.

### Column: Adj. Close

The WIKI dataset provides 13 columns per ticker per day:

| Column | Index | Description |
|--------|-------|-------------|
| Date | 0 | Trading date |
| Open | 1 | Opening price (raw) |
| High | 2 | Day high (raw) |
| Low | 3 | Day low (raw) |
| Close | 4 | Closing price (raw) |
| Volume | 5 | Shares traded |
| Ex-Dividend | 6 | Dividend amount on ex-date |
| Split Ratio | 7 | Split ratio (e.g., 7.0 for 7:1) |
| Adj. Open | 8 | Split+dividend adjusted open |
| Adj. High | 9 | Split+dividend adjusted high |
| Adj. Low | 10 | Split+dividend adjusted low |
| **Adj. Close** | **11** | **Split+dividend adjusted close** |
| Adj. Volume | 12 | Split-adjusted volume |

We extract **four columns** per ticker: Close (raw), Ex-Dividend,
Split Ratio, and Adj. Close. Adj. Close is used for computing returns
and covariance matrices (ensures return continuity). The other three
columns enable corporate action visualization — showing the raw
events (splits, dividends) that the adjustment corrects for.

### Corporate Actions in Our 10-Year Window

| Ticker | Event | Date | Effect on raw price | Effect on Adj. Close |
|--------|-------|------|--------------------|--------------------|
| AAPL | 7-for-1 split | June 9, 2014 | Drops from ~$645 to ~$92 | All pre-split prices divided by 7 |
| MSFT | Quarterly dividends | Every quarter | Small ex-date drops | Historical prices reduced by cumulative dividends |
| JPM | Quarterly dividends | Every quarter | Small ex-date drops | Historical prices reduced by cumulative dividends |
| JNJ | Quarterly dividends | Every quarter | Small ex-date drops | Historical prices reduced by cumulative dividends |
| AMZN | None | — | No effect | Raw = Adjusted (identical) |

**The AAPL 7:1 split is a key educational example.** If you plot raw
Close, there is a cliff in June 2014 that looks like AAPL lost 86% of
its value overnight. If you plot Adj. Close, the series is smooth and
continuous. That is the entire lesson of corporate action adjustment
in one chart.

---

## How the Data Was Fetched

### Prerequisites
- Python 3.6+
- `nasdaq-data-link` library: `pip3 install nasdaq-data-link`
- Free Nasdaq Data Link API key (https://data.nasdaq.com/sign-up)
  - Sign up as **Personal** account
  - Usage: **"for a personal software project"**
  - API key is on your profile page at https://data.nasdaq.com/account/profile
- Internet connection (one-time fetch only)

### API Endpoint

**Important**: There are two WIKI API endpoints. Only one works:

| Endpoint | URL pattern | Status |
|----------|-------------|--------|
| Time-series (old) | `GET /api/v3/datasets/WIKI/{TICKER}.csv` | **Blocked** — returns 403. Nasdaq's Incapsula WAF rejects these requests regardless of API key or User-Agent. |
| Datatable (current) | `GET /api/v3/datatables/WIKI/PRICES.json?ticker={TICKER}` | **Works** — the `nasdaqdatalink.get_table("WIKI/PRICES", ...)` library call uses this endpoint. |

The fetch script defaults to the datatable endpoint via the
`nasdaqdatalink` Python library. A `--direct` flag exists for the
time-series endpoint but it will fail due to WAF blocking.

### Procedure

```bash
pip3 install nasdaq-data-link
cd ~/repos/kanaha-calcs
python3 scripts/fetch_wiki_data.py YOUR_API_KEY
```

The script:
1. Calls `nasdaqdatalink.get_table("WIKI/PRICES", ticker=TICKER, ...)`
   for each of the 5 tickers, requesting `date`, `close`, `ex-dividend`,
   `split_ratio`, and `adj_close` columns, with `date >= 2008-03-28`
   and `date <= 2018-03-27`.
2. Intersects dates across all 5 tickers (result: 2,516 common trading days).
3. Writes `data/wiki_2008_2018_daily_closes.csv` — 4 columns per ticker
   (`{TICKER}_Close`, `{TICKER}_ExDiv`, `{TICKER}_Split`,
   `{TICKER}_AdjClose`), one row per trading day, oldest first.
4. Prints corporate action summary (splits and dividend counts per ticker).
5. Computes log returns, covariance matrix, volatilities, and correlation
   matrix for verification (printed to stdout). The app computes these
   in JavaScript at runtime from the CSV — nothing is pre-computed.

### Data fetched on 2026-05-02

The initial fetch was performed on May 2, 2026. The script is
deterministic — running it again with any valid API key will produce
identical output because the WIKI dataset is frozen (last updated
March 27, 2018).

### Output Files

**`data/wiki_2008_2018_daily_closes.csv`** (301KB, 2,517 lines including header)

4 columns per ticker: `{TICKER}_Close`, `{TICKER}_ExDiv`, `{TICKER}_Split`, `{TICKER}_AdjClose`

```csv
Date,MSFT_Close,MSFT_ExDiv,MSFT_Split,MSFT_AdjClose,AAPL_Close,AAPL_ExDiv,AAPL_Split,AAPL_AdjClose,...
2008-03-28,27.91,0.0,1.0,21.8442,143.01,0.0,1.0,18.3788,...
...
2014-06-06,...,645.57,0.0,1.0,86.8044,...     ← AAPL last day before split
2014-06-09,...,93.7,0.0,7.0,88.1934,...       ← AAPL split: Close drops 85%, Split=7.0, AdjClose smooth
...
2018-03-27,89.47,0.0,1.0,89.47,168.34,0.0,1.0,168.34,...
```

**Corporate action data in the CSV (actual counts):**

| Ticker | Splits | Dividend payments | Total dividends/share |
|--------|:------:|:-----------------:|----------------------:|
| MSFT | 0 | 39 | $9.40 |
| AAPL | 1 (7:1, June 9 2014) | 21 | $30.47 |
| AMZN | 0 | 0 | $0.00 |
| JPM | 0 | 39 | $12.30 |
| JNJ | 0 | 39 | $24.84 |

No pre-computed JSON is shipped. The app's WebView JavaScript computes
the covariance matrix from the `AdjClose` columns at runtime (calculation
\#7). The `Close`, `ExDiv`, and `Split` columns are used for corporate
action visualization. The fetch script prints covariance verification
to stdout.

### Computed Results Summary

**Annualized volatilities (2008-2018):**

| Ticker | Volatility | Note |
|--------|-----------|------|
| MSFT | 27.7% | Moderate — mature tech |
| AAPL | 30.4% | Higher — growth + 7:1 split period |
| AMZN | 37.6% | High — no dividends, pure growth |
| JPM | **42.7%** | Highest — includes 2008 financial crisis |
| JNJ | **16.7%** | Lowest — defensive healthcare, Dividend King |

JPM's 42.7% volatility vs JNJ's 16.7% is the most dramatic contrast.
The 2008 financial crisis is visible in JPM's data — this is more
educational than a calmer period would be.

**Correlation highlights:**
- MSFT-JNJ: 0.50 (moderate positive — tech and healthcare move somewhat together)
- AAPL-JNJ: 0.37 (lowest pair — best diversification benefit)
- JPM-AMZN: 0.41 (moderate — financials and tech)
- All correlations positive in this 10-year window; other periods can
  differ, which is why the app labels the dataset with its decade

---

## How Covariance Feeds the Axis2/C Services

The covariance matrix computed from the bundled CSV is passed directly
to the `portfolioVariance` Axis2/C service. Example using actual computed
values from the bundled dataset:

```json
{
  "n_assets": 5,
  "weights": [0.20, 0.20, 0.20, 0.20, 0.20],
  "covariance_matrix": [
    0.076697, 0.040324, 0.052595, 0.057055, 0.022890,
    0.040324, 0.092653, 0.051493, 0.059769, 0.018643,
    0.052595, 0.051493, 0.141669, 0.066267, 0.023765,
    0.057055, 0.059769, 0.066267, 0.182325, 0.030401,
    0.022890, 0.018643, 0.023765, 0.030401, 0.027793
  ],
  "normalize_weights": true,
  "n_periods_per_year": 1
}
```

`n_periods_per_year: 1` states that this covariance matrix is already
annualized (`cov(log_returns) x 252`), so the per-period basis is one year.
Since the upstream change of 2026-09-20 that is also the service's default, and
the response echoes `covariance_basis: "annualized"`; on a build from before
that date the default was 252 and omitting the field double-annualized
`annualized_volatility` (reporting ~250% against a true ~16%). Passing 1
explicitly is correct on both. The deterministic `portfolio_variance` /
`portfolio_volatility` fields are unaffected either way.

Note: Axis2/C uses a **flat row-major array** for the covariance matrix
(not nested arrays like Axis2/Java). The WebView JS computes the nested
covariance matrix from the CSV, then flattens it before calling the service.

The same volatilities feed `monteCarlo`. Example using JPM's crisis-era
volatility (the most dramatic ticker in the dataset):
```json
{
  "n_simulations": 100000,
  "n_periods": 252,
  "initial_value": 1000000,
  "expected_return": 0.10,
  "volatility": 0.427,
  "n_periods_per_year": 252
}
```

---

## Math Result Provenance (Complete Reference)

Every numerical result the app can produce traces back to one of these
published sources:

| Result | Formula | Source | Year | Verified |
|--------|---------|-------|------|----------|
| Kelly fraction | f* = (bp - q) / b | Kelly, J.L., Jr. "A New Interpretation of Information Rate." *BSTJ* 35(4): 917-926. | 1956 | [Wiley](https://onlinelibrary.wiley.com/doi/abs/10.1002/j.1538-7305.1956.tb03809.x) |
| Kelly odds | \|reward\| / \|risk\| | Same Kelly 1956 | 1956 | Same |
| Sharpe ratio | (R - R_f) / vol | Sharpe, W.F. "Mutual Fund Performance." *J. Business* 39(1, Part 2: Supplement on Security Prices): 119-138. | 1966 | [JSTOR](https://www.jstor.org/stable/2340416) |
| Normal CDF | Rational approx. of Φ(z) | Abramowitz, M. & Stegun, I.A. *Handbook of Mathematical Functions.* NBS AMS 55, §26.2. | 1964 | [NIST](https://www.nist.gov/mathematics-statistics/handbook-mathematical-functions-abramowitz-and-stegun) |
| Percent change | (new - old) / old × 100 | Fibonacci. *Liber Abaci.* | 1202 | [Archive](https://archive.org/details/LiberAbaci) |
| Median | Sort, take middle | Galton, F. "Report of the Anthropometric Committee." *Rep. BAAS* 51: 225-272. | 1881 | — |
| Log return | ln(P_t / P_{t-1}) | Napier, J. *Mirifici Logarithmorum Canonis Descriptio.* | 1614 | — |
| Sample covariance | Σ(r_i - μ_i)(r_j - μ_j) / (n-1) | Pearson, K. "Mathematical Contributions III." *Phil. Trans. A* 187: 253-318. | 1896 | [Royal Society](https://royalsocietypublishing.org/doi/10.1098/rsta.1896.0007) |
| Annualization | cov × 252 | Convention: 252 trading days/year. See Hull, J.C. *Options, Futures, and Other Derivatives.* | — | Standard |
| NAV | Σ(price_i × qty_i) | Pacioli, L. *Summa de Arithmetica.* (Double-entry bookkeeping.) | 1494 | [Archive](https://archive.org/details/summadearithmeti00paci) |
| Portfolio weight | value_i / NAV | Markowitz 1952 (same as portfolio variance) | 1952 | Same |
| Portfolio return | Σ(w_i × r_i) | Markowitz 1952, Equation 1 | 1952 | Same |
| Max drawdown | min((P_t - P_peak) / P_peak) | Grossman, S.J. & Zhou, Z. "Optimal Investment Strategies for Controlling Drawdowns." *Math. Finance* 3(3): 241-276. | 1993 | — |
| Dividend yield | annual_divs / price × 100 | Williams, J.B. *The Theory of Investment Value.* Harvard University Press. | 1938 | [Archive](https://archive.org/details/theoryofinvestme0000will) |
| Excess return | R_portfolio - R_benchmark | Jensen, M.C. "The Performance of Mutual Funds in the Period 1945-1964." *J. Finance* 23(2): 389-416. | 1968 | [Wiley](https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1540-6261.1968.tb00815.x) |
| Information ratio | mean(R_excess) / σ(R_excess) | Grinold, R.C. "The Fundamental Law of Active Management." *J. Portfolio Management* 15(3): 30-37. Expanded: Grinold, R.C. & Kahn, R.N. *Active Portfolio Management.* 2nd ed. McGraw-Hill. ISBN 978-0-07-024882-2. | 1989/2000 | — |
| Return decomposition | R_total ≈ R_local + R_fx | Brinson, G.P., Hood, L.R. & Beebower, G.L. "Determinants of Portfolio Performance." *Financial Analysts Journal* 42(4): 39-44. Currency extension: Karnosky, D.S. & Singer, B.D. *Global Asset Management and Performance Attribution.* Research Foundation of CFA Institute. ISBN 978-0-943205-28-1. | 1986/1994 | [JSTOR](https://www.jstor.org/stable/4478947) |
| Market impact (√ law) | impact ≈ σ × √(Q/V) | Kyle, A.S. "Continuous Auctions and Insider Trading." *Econometrica* 53(6): 1315-1335. Almgren, R. & Chriss, N. "Optimal Execution of Portfolio Transactions." *J. Risk* 3(2): 5-39. | 1985/2001 | [JSTOR](https://www.jstor.org/stable/1913210) |
| Portfolio variance | w'Σw | Markowitz, H. "Portfolio Selection." *J. Finance* 7(1): 77-91. | 1952 | [Wiley](https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1540-6261.1952.tb01525.x) |
| Monte Carlo VaR | GBM simulation | Metropolis, N. & Ulam, S. "The Monte Carlo Method." *JASA* 44(247): 335-341. | 1949 | [Taylor & Francis](https://www.tandfonline.com/doi/abs/10.1080/01621459.1949.10483310) |
| Scenario EV | Σ(p_i × v_i) | Bernoulli, D. "Specimen Theoriae Novae de Mensura Sortis." *Commentarii* 5: 175-192. Tr: *Econometrica* 22(1): 23-36 (1954). | 1738 | [JSTOR](https://www.jstor.org/stable/1909829) |
| Expected value concept | E = Σ(p_i × a_i) | Huygens, C. *De Ratiociniis in Ludo Aleae.* | 1657 | [Dartmouth](https://math.dartmouth.edu/~doyle/docs/huygens/huygens.pdf) |

---

## Reproducibility

To independently verify any result in the app:

1. **Download source data**: Sign up at https://data.nasdaq.com/sign-up,
   then `python3 scripts/fetch_wiki_data.py YOUR_KEY`.
2. **Verify CSV prices**: Compare against the Kaggle mirror at
   https://www.kaggle.com/datasets/marketneutral/quandl-wiki-prices-us-equites
3. **Verify covariance**: Load the CSV into Python/R/Excel, compute
   `cov(log_returns) × 252`, compare against the app's JS output or
   the fetch script's stdout summary.
4. **Verify Axis2/C results**: Pass the covariance matrix to
   `portfolioVariance` on a Linux host and compare.
5. **Verify formulas**: Each formula is a single expression traceable
   to the cited paper. Open the paper and compare.
