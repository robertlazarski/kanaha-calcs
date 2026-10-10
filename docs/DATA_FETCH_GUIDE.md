---
type: reference
created: 2026-05-05
---

# Data Fetch Guide

How to reproduce all bundled datasets for kanaha-calcs. Run these scripts
before demos or when updating data. All datasets are public domain and
can be freely redistributed.

---

## Overview

| Dataset | Script | Output | Size | Time | API Key? |
|---------|--------|--------|------|------|----------|
| 5 core equities | `fetch_wiki_data.py` | `wiki_2008_2018_daily_closes.csv` | 301 KB | ~10s | Nasdaq Data Link (free) |
| S&P 500 (full) | `fetch_sp500_data.py` | `sp500_wiki_2008_2018.csv` | ~27 MB | ~20 min | Nasdaq Data Link (free) |
| FX rates + DTWEXBGS | `fetch_fx_data.py` | `fed_h10_fx_10yr.csv` | ~1 MB | ~5s | None |
| ACWI monthly returns | `fetch_acwi_nav.py` | `acwi_monthly_returns.csv` | ~5 KB | ~2 min | None |

All output goes to `/data/`. All scripts are deterministic — re-running
produces identical output (WIKI is frozen; H.10 historical data doesn't
change; EDGAR filings are immutable).

The two WIKI files carry `2008_2018` in their names on purpose. That
decade is the whole of the public-domain record — the dedication stopped
on 2018-03-27 — so these are historical sets, never a current market
picture, and the name has to say so wherever a person or a tool reads it.

---

## 1. Core Equities (5 Tickers)

**Script**: `scripts/fetch_wiki_data.py`

```bash
pip3 install nasdaq-data-link
python3 scripts/fetch_wiki_data.py $NASDAQ_DATA_LINK_API_KEY
```

- **Source**: Quandl WIKI EOD Stock Prices (public domain)
- **Tickers**: MSFT, AAPL, AMZN, JPM, JNJ
- **Period**: 2008-03-28 to 2018-03-27 (10 years, 2,516 trading days)
- **Columns**: Close (raw), ExDiv, Split, AdjClose per ticker
- **License**: Public domain — "You may copy, distribute, disseminate
  or include the data in other products"
- **API key**: Free at https://data.nasdaq.com/sign-up (Personal account).
  After sign-up, find the key at https://data.nasdaq.com/account/profile
  (look for "API Key" section — it's a separate login from signin.nasdaq.com).
  Store it in your shell:
  ```bash
  echo 'export NASDAQ_DATA_LINK_API_KEY="YOUR_KEY_HERE"' >> ~/.bashrc
  source ~/.bashrc
  ```
  Then use `$NASDAQ_DATA_LINK_API_KEY` in all fetch commands.
- **Note**: WIKI dataset is frozen (last updated March 27, 2018).
  Re-running always produces identical output.

---

## 2. S&P 500 (Full ~505 Tickers)

**Script**: `scripts/fetch_sp500_data.py`

```bash
pip3 install nasdaq-data-link
python3 scripts/fetch_sp500_data.py $NASDAQ_DATA_LINK_API_KEY
```

- **Source**: Same Quandl WIKI dataset (public domain)
- **Tickers**: ~505 S&P 500 constituents as of March 2018
  (source: Wikipedia "List of S&P 500 companies" historical revision)
- **Period**: 2008-03-28 to 2018-03-27
- **Columns**: Same 4 columns per ticker as core equities
- **Output**: `sp500_wiki_2008_2018.csv` (~27 MB) + `sp500_tickers.txt`
- **Time**: ~17-25 minutes (sequential API calls, 1 per ticker)
- **Rate limiting**: Pauses 2 seconds every 50 tickers
- **Known failures**: BRK-B (Berkshire Hathaway), BF-B (Brown-Forman),
  and NEA are not in WIKI under hyphenated names. These 3 tickers are
  skipped and logged.
- **Short-lived tickers**: Some tickers joined or left the S&P 500
  during the 10-year window and have <1000 trading days (e.g., WELL=14,
  WLTW=560, WRK=694). These are automatically dropped because they
  destroy the common date intersection. The script logs which tickers
  were dropped and why.
- **Expected result**: ~475-485 tickers with full 10-year coverage out
  of 499 attempted.

### S&P 500 Constituent List

The ticker list is hardcoded in the script from Wikipedia's historical
revision. For educational purposes this is reliable — the constituent
list is factual data, well-sourced, and widely cross-referenced.

To verify: check Wikipedia article revision history for late March 2018
at https://en.wikipedia.org/w/index.php?title=List_of_S%26P_500_companies&action=history

---

## 3. Foreign Exchange Rates

**Script**: `scripts/fetch_fx_data.py`

```bash
python3 scripts/fetch_fx_data.py
```

- **Source**: Federal Reserve Board H.10 Foreign Exchange Rates
- **No API key required** — direct download from the Board of Governors
  Data Download Program (DDP)
- **Series**: 18 total
  - DTWEXBGS (Broad Trade-Weighted Dollar Index)
  - 17 spot exchange rates: EURUSD, USDJPY, GBPUSD, USDCHF, USDCAD,
    AUDUSD, USDCNY, USDKRW, USDMXN, USDINR, USDBRL, USDSEK, USDNOK,
    USDSGD, USDHKD, USDTWD, USDZAR
- **Period**: 2008-03-28 to 2018-03-27
- **Frequency**: Daily (business days)
- **License**: US public domain (17 U.S.C. §105)
  "may be copied and distributed without permission"
- **Output format**: Same column convention as equities (ExDiv=0,
  Split=1.0, AdjClose=Close). The app treats FX series identically
  to equity series.

### How the Fed DDP Works

The script fetches two data packages by their opaque hash IDs:

| Hash | Content | Series suffix |
|------|---------|---------------|
| `122e3bcb...` | Dollar indexes (Broad, AFE, EME) | `.B` (business daily) |
| `60f32914...` | Spot exchange rates (23 currencies) | `.B` (business daily) |

These hashes were discovered by inspecting the Choose.aspx page at
https://www.federalreserve.gov/datadownload/Choose.aspx?rel=H10

**Important**: Fetch from the Board of Governors DDP directly, NOT from
FRED. FRED (St. Louis Fed Bank) adds its own restrictive terms of use
including an AI/ML prohibition. The underlying H.10 data is public
domain at source.

---

## 4. ACWI Monthly Returns (SEC EDGAR)

**Script**: `scripts/fetch_acwi_nav.py`

```bash
python3 scripts/fetch_acwi_nav.py
```

- **Source**: SEC EDGAR NPORT-P filings for iShares MSCI ACWI ETF
  (ticker: ACWI, managed by BlackRock under iShares Trust)
- **No API key required** — SEC EDGAR is public
- **Identifiers**:
  - CIK: `0001100663` (iShares Trust)
  - Series: `S000021461` (iShares MSCI ACWI ETF)
  - Class: `C000061364`
- **Coverage**: ~October 2019 to present (~6 years of monthly data)
  NPORT-P was mandated starting 2019 for large fund groups.
- **Data extracted**: `monthlyTotReturn` (rtn1, rtn2, rtn3) from each
  quarterly filing — gives 3 monthly return percentages per filing
- **Output format**: Date, ACWI_MonthlyReturn (decimal), ACWI_IndexValue
  (price index reconstructed from returns, base=100)
- **License**: not a government work. NPORT-P filings are prepared and
  filed by the fund (iShares Trust), so 17 U.S.C. §105 does not apply to
  them. This project keeps only the monthly total-return figures, which are
  facts reported in a public regulatory filing, and copies no MSCI index
  values and no text from the filing
- **Rate limiting**: EDGAR allows 10 requests/second. Script uses 0.5s
  delay between requests. User-Agent header is required.

### Why Only ~6 Years

NPORT-P filings began in 2019. Older filings (N-CSR, N-CSRS) contain
annual/semi-annual NAV data but in unstructured HTML, not XML. There is
no public-domain source for daily or monthly ACWI data before 2019.

MSCI ACWI index data is proprietary — MSCI charges for redistribution
and actively enforces licensing. The iShares ACWI ETF price is
proprietary exchange data (NYSE). The only legally clean path is SEC
EDGAR filings, which are limited to the NPORT-P era.

### How to Use ACWI Data in the App

The ACWI monthly return data is lower frequency than the daily equity
and FX data. For correlation analysis:

1. **Resample equity/FX to monthly**: compute monthly returns from
   daily data (last trading day of each month)
2. **Align dates**: match ACWI monthly returns with equity/FX monthly
   returns by year-month
3. **Compute correlation**: the covariance matrix works on any return
   frequency — monthly returns give fewer data points but are perfectly
   valid for demonstrating relationships

The app should provide a "Monthly Returns" view alongside the daily
view, specifically for cross-asset analysis involving ACWI.

---

## Data File Inventory

After running all four scripts:

```
data/
├── wiki_2008_2018_daily_closes.csv  # 5 core equities, frozen decade (301 KB)
├── sp500_wiki_2008_2018.csv         # Full S&P 500, same decade (~27 MB)
├── sp500_tickers.txt                # Ticker list with notes
├── fed_h10_fx_10yr.csv              # 18 FX series (~1 MB)
├── acwi_monthly_returns.csv         # ACWI monthly (~5 KB)
├── DATA_LICENSE.txt                 # Quandl WIKI license (verbatim)
└── FED_H10_LICENSE.txt              # Fed Board disclaimer (verbatim)
```

### License Summary

| Dataset | Source | License | Redistribution |
|---------|--------|---------|----------------|
| Equities | Quandl WIKI | Public domain (explicit dedication) | Yes — "copy, distribute, disseminate" |
| FX rates | Fed Board H.10 | US public domain (17 USC §105) | Yes — "copied and distributed without permission" |
| ACWI returns | SEC EDGAR NPORT-P, filed by iShares Trust | Not a government work; facts from a public filing | Monthly return figures only; no MSCI index data |

---

## Pre-Demo Checklist

Before a demo of kanaha-calcs:

1. Verify data files exist: `ls -la data/*.csv`
2. Check file sizes match expectations (see table above)
3. Spot-check: `head -2 data/fed_h10_fx_10yr.csv` should show DTWEXBGS
4. Spot-check: `tail -1 data/acwi_monthly_returns.csv` should show
   the most recent month of ACWI data
5. If data needs refreshing (ACWI gets new monthly returns as new
   NPORT-P filings appear): `python3 scripts/fetch_acwi_nav.py`

The equity and FX data never change (frozen datasets / fixed date range).
Only ACWI data grows over time as new EDGAR filings are published.
