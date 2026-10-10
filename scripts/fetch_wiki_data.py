#!/usr/bin/env python3
"""
Fetch 10 years of daily prices with corporate action data from the
Quandl WIKI EOD Stock Prices dataset (public domain).

Usage:
    1. Sign up for a free API key at https://data.nasdaq.com/sign-up
    2. pip3 install nasdaq-data-link
    3. Run:  python3 fetch_wiki_data.py YOUR_API_KEY
    4. Output: ../data/wiki_2008_2018_daily_closes.csv

Columns per ticker: Close (raw), Ex-Dividend, Split Ratio, Adj. Close
- Close: actual closing price printed on the tape that day
- Ex-Dividend: dividend amount on ex-dates (0.0 on non-ex-dates)
- Split Ratio: split factor on split dates (1.0 on non-split dates)
- Adj. Close: retroactively adjusted for all splits and dividends

The WIKI dataset is public domain:
  "This data is in the public domain. You may copy, distribute,
   disseminate or include the data in other products for commercial
   and/or noncommercial purposes."

Source: https://data.nasdaq.com/data/WIKI-wiki-eod-stock-prices
"""

import csv
import io
import math
import os
import sys
import urllib.request
import urllib.error

# --- Configuration ---
TICKERS = ["MSFT", "AAPL", "AMZN", "JPM", "JNJ"]
START_DATE = "2008-03-28"
END_DATE = "2018-03-27"
WIKI_COLUMNS = ["date", "close", "ex-dividend", "split_ratio", "adj_close"]
OUTPUT_CSV = os.path.join(os.path.dirname(__file__), "..", "data", "wiki_2008_2018_daily_closes.csv")


def fetch_ticker_library(ticker, api_key):
    """Fetch via nasdaqdatalink library using WIKI/PRICES datatable.

    The WIKI/PRICES datatable endpoint works reliably (the older WIKI/{ticker}
    time-series endpoint returns 403 due to Incapsula WAF).
    Requires: pip3 install nasdaq-data-link
    """
    try:
        import nasdaqdatalink
    except ImportError:
        raise SystemExit(
            "Install the library first: pip3 install nasdaq-data-link"
        )
    nasdaqdatalink.ApiConfig.api_key = api_key
    print(f"  Fetching {ticker}...", end="", flush=True)
    df = nasdaqdatalink.get_table(
        "WIKI/PRICES",
        ticker=ticker,
        date={"gte": START_DATE, "lte": END_DATE},
        qopts={"columns": WIKI_COLUMNS},
        paginate=True,
    )
    # Build dict: date -> {close, ex_dividend, split_ratio, adj_close}
    rows = {}
    splits = 0
    dividends = 0
    for _, row in df.iterrows():
        date_str = str(row["date"].date())
        ex_div = float(row["ex-dividend"])
        split_r = float(row["split_ratio"])
        rows[date_str] = {
            "close": float(row["close"]),
            "ex_dividend": ex_div,
            "split_ratio": split_r,
            "adj_close": float(row["adj_close"]),
        }
        if split_r != 1.0:
            splits += 1
        if ex_div > 0:
            dividends += 1
    print(f" {len(rows)} days, {splits} splits, {dividends} dividends")
    return rows


def compute_log_returns(prices):
    """Compute log returns from a sorted list of prices."""
    returns = []
    for i in range(1, len(prices)):
        if prices[i - 1] > 0 and prices[i] > 0:
            returns.append(math.log(prices[i] / prices[i - 1]))
    return returns


def compute_covariance_matrix(all_returns, annualize=252):
    """Compute annualized covariance matrix from log returns."""
    n = len(all_returns)
    means = [sum(r) / len(r) for r in all_returns]
    T = len(all_returns[0])

    cov = [[0.0] * n for _ in range(n)]
    for i in range(n):
        for j in range(n):
            s = sum(
                (all_returns[i][t] - means[i]) * (all_returns[j][t] - means[j])
                for t in range(T)
            )
            cov[i][j] = round((s / (T - 1)) * annualize, 6)
    return cov


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 fetch_wiki_data.py YOUR_API_KEY")
        print()
        print("Get a free API key at: https://data.nasdaq.com/sign-up")
        print("Requires: pip3 install nasdaq-data-link")
        sys.exit(1)

    api_key = sys.argv[1]

    print(f"Fetching {len(TICKERS)} tickers from Quandl WIKI (public domain)...")
    print(f"  Date range: {START_DATE} to {END_DATE}")
    print(f"  Columns: {', '.join(WIKI_COLUMNS)}")
    print()

    # Fetch all tickers
    ticker_data = {}
    for ticker in TICKERS:
        ticker_data[ticker] = fetch_ticker_library(ticker, api_key)

    # Find common dates (intersection of all tickers)
    common_dates = sorted(
        set.intersection(*[set(d.keys()) for d in ticker_data.values()])
    )
    print(f"\nCommon trading days: {len(common_dates)}")
    print(f"  First: {common_dates[0]}")
    print(f"  Last:  {common_dates[-1]}")

    # Write CSV — 4 columns per ticker: Close, Ex-Dividend, Split Ratio, Adj. Close
    os.makedirs(os.path.dirname(os.path.abspath(OUTPUT_CSV)), exist_ok=True)
    with open(OUTPUT_CSV, "w", newline="") as f:
        writer = csv.writer(f)
        # Header: Date, MSFT_Close, MSFT_ExDiv, MSFT_Split, MSFT_AdjClose, AAPL_Close, ...
        header = ["Date"]
        for t in TICKERS:
            header.extend([f"{t}_Close", f"{t}_ExDiv", f"{t}_Split", f"{t}_AdjClose"])
        writer.writerow(header)
        for date in common_dates:
            row = [date]
            for t in TICKERS:
                d = ticker_data[t][date]
                row.extend([
                    round(d["close"], 4),
                    round(d["ex_dividend"], 4),
                    round(d["split_ratio"], 4) if d["split_ratio"] != 1.0 else 1.0,
                    round(d["adj_close"], 4),
                ])
            writer.writerow(row)
    csv_size = os.path.getsize(OUTPUT_CSV)
    print(f"\nCSV written: {OUTPUT_CSV}")
    print(f"  {len(common_dates)} rows x {len(TICKERS)} tickers x 4 columns")
    print(f"  Size: {csv_size:,} bytes ({csv_size/1024:.0f} KB)")

    # Corporate action summary
    print(f"\n{'='*60}")
    print("CORPORATE ACTION SUMMARY")
    print(f"{'='*60}")
    for ticker in TICKERS:
        data = ticker_data[ticker]
        splits = [(d, data[d]["split_ratio"]) for d in sorted(data.keys()) if data[d]["split_ratio"] != 1.0]
        divs = [(d, data[d]["ex_dividend"]) for d in sorted(data.keys()) if data[d]["ex_dividend"] > 0]
        total_divs = sum(data[d]["ex_dividend"] for d in data if data[d]["ex_dividend"] > 0)
        print(f"\n  {ticker}:")
        if splits:
            for date, ratio in splits:
                print(f"    SPLIT  {date}  ratio={ratio}")
        else:
            print(f"    No splits in this period")
        print(f"    Dividends: {len(divs)} payments, total ${total_divs:.2f}/share over 10 years")

    # Compute covariance matrix from Adj. Close prices (for verification only —
    # the app computes this in JavaScript from the CSV at runtime)
    all_prices = [[ticker_data[t][d]["adj_close"] for d in common_dates] for t in TICKERS]
    all_returns = [compute_log_returns(p) for p in all_prices]
    cov_matrix = compute_covariance_matrix(all_returns)

    # Compute volatilities and correlation matrix
    vols = [round(math.sqrt(cov_matrix[i][i]), 4) for i in range(len(TICKERS))]
    corr = [[0.0] * len(TICKERS) for _ in range(len(TICKERS))]
    for i in range(len(TICKERS)):
        for j in range(len(TICKERS)):
            if vols[i] > 0 and vols[j] > 0:
                corr[i][j] = round(cov_matrix[i][j] / (vols[i] * vols[j]), 4)

    # Print summary
    print(f"\n{'='*60}")
    print("COVARIANCE SUMMARY (from Adj. Close)")
    print(f"{'='*60}")
    print(f"\nAnnualized volatilities:")
    for t, v in zip(TICKERS, vols):
        print(f"  {t:5s}  {v*100:.1f}%")
    print(f"\nCorrelation matrix:")
    print(f"{'':8s}", "  ".join(f"{t:>7s}" for t in TICKERS))
    for i, t in enumerate(TICKERS):
        print(f"{t:8s}", "  ".join(f"{corr[i][j]:7.2f}" for j in range(len(TICKERS))))
    print(f"\nCovariance matrix (annualized, for portfolioVariance service):")
    print(f"{'':8s}", "  ".join(f"{t:>9s}" for t in TICKERS))
    for i, t in enumerate(TICKERS):
        print(f"{t:8s}", "  ".join(f"{cov_matrix[i][j]:9.4f}" for j in range(len(TICKERS))))


if __name__ == "__main__":
    main()
