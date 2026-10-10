#!/usr/bin/env python3
"""
Fetch 10 years of S&P 500 daily prices from Quandl WIKI (public domain).

Usage:
    1. pip3 install nasdaq-data-link
    2. python3 fetch_sp500_data.py YOUR_API_KEY
    3. Output: ../data/sp500_wiki_2008_2018.csv  (wide format, ~27 MB)
               ../data/sp500_tickers.txt    (ticker list used)

This fetches ~505 tickers (S&P 500 as of March 2018). Takes ~17-25 minutes
due to per-ticker API calls. The script is deterministic — re-running
produces identical output because the WIKI dataset is frozen.

The S&P 500 constituent list is from Wikipedia's "List of S&P 500
companies" as of March 2018 (factual data, well-sourced).

License: Quandl WIKI is public domain.
  "This data is in the public domain. You may copy, distribute,
   disseminate or include the data in other products for commercial
   and/or noncommercial purposes."
"""

import csv
import math
import os
import sys
import time

# --- S&P 500 constituents as of March 2018 ---
# Source: Wikipedia "List of S&P 500 companies" revision circa March 2018.
# 505 tickers (some companies have dual share classes: GOOG/GOOGL, etc.)
# Tickers with dots converted to hyphens for WIKI compatibility (BRK.B -> BRK-B).
SP500_TICKERS = sorted([
    "MMM", "ABT", "ABBV", "ACN", "ATVI", "AYI", "ADBE", "AMD", "AAP", "AES",
    "AET", "AMG", "AFL", "A", "APD", "AKAM", "ALK", "ALB", "ARE", "ALXN",
    "ALGN", "ALLE", "AGN", "ADS", "LNT", "ALL", "GOOGL", "GOOG", "MO", "AMZN",
    "AEE", "AAL", "AEP", "AXP", "AIG", "AMT", "AWK", "AMP", "ABC", "AME",
    "AMGN", "APH", "APC", "ADI", "ANDV", "ANSS", "ANTM", "AON", "AOS", "APA",
    "AIV", "AAPL", "AMAT", "APTV", "ADM", "ARNC", "AJG", "AIZ", "T", "ADSK",
    "ADP", "AZO", "AVB", "AVY", "BHGE", "BLL", "BAC", "BK", "BAX", "BBT",
    "BDX", "BRK-B", "BBY", "BIIB", "BLK", "HRB", "BA", "BWA", "BXP", "BSX",
    "BMY", "AVGO", "BF-B", "CHRW", "CA", "COG", "CDNS", "CPB", "COF", "CAH",
    "KMX", "CCL", "CAT", "CBOE", "CBRE", "CBS", "CELG", "CNC", "CNP", "CTL",
    "CERN", "CF", "SCHW", "CHTR", "CHK", "CVX", "CMG", "CB", "CHD", "CI",
    "XEC", "CINF", "CTAS", "CSCO", "C", "CFG", "CTXS", "CLX", "CME", "CMS",
    "KO", "CTSH", "CL", "CMCSA", "CMA", "CAG", "CXO", "COP", "ED", "STZ",
    "COO", "GLW", "COST", "COTY", "CCI", "CSRA", "CSX", "CMI", "CVS", "DHI",
    "DHR", "DRI", "DVA", "DE", "DAL", "XRAY", "DVN", "DLR", "DFS", "DISCA",
    "DISCK", "DISH", "DG", "DLTR", "D", "DOV", "DWDP", "DPS", "DTE", "DUK",
    "DRE", "DXC", "ETFC", "EMN", "ETN", "EBAY", "ECL", "EIX", "EW", "EA",
    "EMR", "ETR", "EVHC", "EOG", "EQT", "EFX", "EQIX", "EQR", "ESS", "EL",
    "ES", "RE", "EXC", "EXPE", "EXPD", "ESRX", "EXR", "XOM", "FFIV", "FB",
    "FAST", "FRT", "FDX", "FIS", "FITB", "FE", "FISV", "FLIR", "FLS", "FLR",
    "FMC", "FL", "F", "FTV", "FBHS", "BEN", "FCX", "GPS", "GRMN", "IT",
    "GD", "GE", "GGP", "GIS", "GM", "GPC", "GILD", "GPN", "GS", "GT",
    "GWW", "HAL", "HBI", "HOG", "HRS", "HIG", "HAS", "HCA", "HCP", "HP",
    "HSIC", "HSY", "HES", "HPE", "HLT", "HOLX", "HD", "HON", "HRL", "HST",
    "HPQ", "HUM", "HBAN", "HII", "IDXX", "INFO", "ITW", "ILMN", "IR", "INTC",
    "ICE", "IBM", "INCY", "IP", "IPG", "IFF", "INTU", "ISRG", "IVZ", "IQV",
    "IRM", "JEC", "JBHT", "SJM", "JNJ", "JCI", "JPM", "JNPR", "KSU", "K",
    "KEY", "KMB", "KIM", "KMI", "KLAC", "KSS", "KHC", "KR", "LB", "LEG",
    "LEN", "LUK", "LLY", "LNC", "LKQ", "LMT", "L", "LOW", "LYB", "MTB",
    "MAC", "M", "MRO", "MPC", "MAR", "MMC", "MLM", "MAS", "MA", "MAT",
    "MKC", "MCD", "MCK", "MDT", "MRK", "MET", "MTD", "MGM", "KORS", "MCHP",
    "MU", "MSFT", "MAA", "MHK", "TAP", "MDLZ", "MON", "MNST", "MCO", "MS",
    "MOS", "MSI", "MYL", "NDAQ", "NOV", "NAVI", "NKTR", "NTRS", "NEE", "NWL",
    "NFX", "NEM", "NWSA", "NWS", "NEA", "NLSN", "NKE", "NI", "NBL", "JWN",
    "NSC", "NTAP", "NFLX", "NRG", "NUE", "NVDA", "ORLY", "OXY", "OMC", "OKE",
    "ORCL", "PCAR", "PKG", "PH", "PAYX", "PYPL", "PNR", "PBCT", "PEP", "PKI",
    "PRGO", "PFE", "PCG", "PM", "PSX", "PNW", "PXD", "PNC", "RL", "PPG",
    "PPL", "PX", "PCLN", "PFG", "PG", "PGR", "PLD", "PRU", "PEG", "PSA",
    "PHM", "PVH", "QRVO", "PWR", "QCOM", "DGX", "RRC", "RJF", "RTN", "O",
    "RHT", "REG", "REGN", "RF", "RSG", "RMD", "RHI", "ROK", "COL", "ROP",
    "ROST", "RCL", "CRM", "SBAC", "SCG", "SLB", "SNI", "STX", "SEE", "SRE",
    "SHW", "SPG", "SWKS", "SLG", "SNA", "SO", "LUV", "SPGI", "SWK", "SBUX",
    "STT", "SRCL", "SYK", "STI", "SIVB", "SYMC", "SYF", "SNPS", "SYY", "TROW",
    "TPR", "TGT", "TEL", "FTI", "TXN", "TXT", "TMO", "TIF", "TWX", "TJX",
    "TMK", "TSS", "TSCO", "TDG", "TRIP", "FOXA", "FOX", "TSN", "UDR", "ULTA",
    "USB", "UAA", "UA", "UNP", "UAL", "UNH", "UPS", "URI", "UTX", "UHS",
    "UNM", "VFC", "VLO", "VAR", "VTR", "VRSN", "VRSK", "VZ", "VRTX", "VIAB",
    "V", "VNO", "VMC", "WMT", "WBA", "DIS", "WM", "WAT", "WEC", "WFC",
    "WELL", "WDC", "WU", "WRK", "WY", "WHR", "WMB", "WLTW", "WIN", "WYNN",
    "XEL", "XRX", "XLNX", "XL", "XYL", "YUM", "ZBH", "ZION", "ZTS",
])

START_DATE = "2008-03-28"
END_DATE = "2018-03-27"
WIKI_COLUMNS = ["date", "close", "ex-dividend", "split_ratio", "adj_close"]
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
OUTPUT_CSV = os.path.join(OUTPUT_DIR, "sp500_wiki_2008_2018.csv")
TICKER_LIST = os.path.join(OUTPUT_DIR, "sp500_tickers.txt")


def fetch_ticker(ticker, api_key):
    """Fetch one ticker from WIKI/PRICES datatable."""
    import nasdaqdatalink
    nasdaqdatalink.ApiConfig.api_key = api_key
    try:
        df = nasdaqdatalink.get_table(
            "WIKI/PRICES",
            ticker=ticker,
            date={"gte": START_DATE, "lte": END_DATE},
            qopts={"columns": WIKI_COLUMNS},
            paginate=True,
        )
    except Exception as e:
        return None, str(e)
    rows = {}
    for _, row in df.iterrows():
        date_str = str(row["date"].date())
        rows[date_str] = {
            "close": float(row["close"]),
            "ex_dividend": float(row["ex-dividend"]),
            "split_ratio": float(row["split_ratio"]),
            "adj_close": float(row["adj_close"]),
        }
    return rows, None


def main():
    if len(sys.argv) < 2:
        print("Usage: python3 fetch_sp500_data.py YOUR_API_KEY")
        print()
        print("Fetches all S&P 500 tickers from Quandl WIKI (public domain).")
        print(f"Tickers: {len(SP500_TICKERS)}")
        print(f"Estimated time: ~17-25 minutes")
        print(f"Estimated output size: ~27 MB")
        sys.exit(1)

    try:
        import nasdaqdatalink
    except ImportError:
        print("Install first: pip3 install nasdaq-data-link")
        sys.exit(1)

    api_key = sys.argv[1]
    print(f"Fetching {len(SP500_TICKERS)} S&P 500 tickers from Quandl WIKI...")
    print(f"Date range: {START_DATE} to {END_DATE}")
    print()

    # Fetch all tickers
    ticker_data = {}
    failed = []
    for i, ticker in enumerate(SP500_TICKERS):
        print(f"  [{i+1}/{len(SP500_TICKERS)}] {ticker}...", end="", flush=True)
        data, err = fetch_ticker(ticker, api_key)
        if data and len(data) > 0:
            ticker_data[ticker] = data
            print(f" {len(data)} days")
        else:
            failed.append((ticker, err or "no data"))
            print(f" FAILED: {err or 'no data'}")
        # Gentle rate limiting
        if (i + 1) % 50 == 0:
            print(f"  ... {i+1}/{len(SP500_TICKERS)} done, pausing 2s ...")
            time.sleep(2)

    if failed:
        print(f"\nFailed tickers ({len(failed)}):")
        for t, e in failed:
            print(f"  {t}: {e}")

    # Successful tickers only — filter out tickers with <1000 trading days
    # (short-lived tickers like WELL=14 days, WLTW=560 days destroy the
    # date intersection; 1000 days ≈ 4 years is a reasonable minimum)
    MIN_DAYS = 2400
    good_tickers = sorted(t for t in ticker_data if len(ticker_data[t]) >= MIN_DAYS)
    short_tickers = sorted(t for t in ticker_data if len(ticker_data[t]) < MIN_DAYS)
    if short_tickers:
        print(f"\nDropped {len(short_tickers)} tickers with <{MIN_DAYS} days:")
        for t in short_tickers:
            print(f"  {t}: {len(ticker_data[t])} days")
    print(f"\nUsable tickers: {len(good_tickers)} / {len(SP500_TICKERS)}")

    # Find common dates across usable tickers
    common_dates = sorted(
        set.intersection(*[set(ticker_data[t].keys()) for t in good_tickers])
    )
    print(f"Common trading days: {len(common_dates)}")
    print(f"  First: {common_dates[0]}")
    print(f"  Last:  {common_dates[-1]}")

    # Write CSV
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    with open(OUTPUT_CSV, "w", newline="") as f:
        writer = csv.writer(f)
        header = ["Date"]
        for t in good_tickers:
            header.extend([f"{t}_Close", f"{t}_ExDiv", f"{t}_Split", f"{t}_AdjClose"])
        writer.writerow(header)
        for date in common_dates:
            row = [date]
            for t in good_tickers:
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
    print(f"  {len(common_dates)} rows x {len(good_tickers)} tickers x 4 columns")
    print(f"  Size: {csv_size:,} bytes ({csv_size/1024/1024:.1f} MB)")

    # Write ticker list
    with open(TICKER_LIST, "w") as f:
        f.write(f"# S&P 500 tickers fetched from Quandl WIKI on {time.strftime('%Y-%m-%d')}\n")
        f.write(f"# Source: Wikipedia 'List of S&P 500 companies' as of March 2018\n")
        f.write(f"# Successful: {len(good_tickers)} / {len(SP500_TICKERS)}\n")
        if failed:
            f.write(f"# Failed: {', '.join(t for t, _ in failed)}\n")
        for t in good_tickers:
            f.write(f"{t}\n")
    print(f"Ticker list: {TICKER_LIST}")


if __name__ == "__main__":
    main()
