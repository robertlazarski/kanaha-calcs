#!/usr/bin/env python3
"""
Fetch 10 years of daily FX rates from the Federal Reserve Board H.10
release (public domain).

Usage:
    python3 fetch_fx_data.py
    Output: ../data/fed_h10_fx_10yr.csv

No API key required. Data is fetched directly from the Board of Governors
Data Download Program (DDP), NOT from FRED (which adds restrictive terms).

License: US public domain (17 U.S.C. section 105).
  "Unless otherwise indicated, information on Board's website is in the
   public domain and may be copied and distributed without permission."
Source: https://www.federalreserve.gov/releases/h10/hist/

DDP series hashes (discovered via Choose.aspx?rel=H10):
  122e3bcb627e8e53f1bf72a1a09cfb81 = Daily broad dollar indexes (DTWEXBGS, AFE, EME)
  c5d6e0edf324b2fb28d73bcacafaaa02 = Daily spot exchange rates (~23 currencies)
"""

import csv
import io
import os
import sys
import urllib.request

# --- Configuration ---
START_DATE = "2008-03-28"
END_DATE = "2018-03-27"
OUTPUT_CSV = os.path.join(os.path.dirname(__file__), "..", "data", "fed_h10_fx_10yr.csv")
USER_AGENT = "kanaha-calcs/1.0 (educational finance app; fetch_fx_data.py)"

# Two Fed DDP data packages for the H.10 release:
# 1. Dollar indexes (daily): Broad (DTWEXBGS), Advanced (AFE), Emerging (EME)
# 2. Spot exchange rates (daily): 23 currencies
DOLLAR_INDEX_HASH = "122e3bcb627e8e53f1bf72a1a09cfb81"   # Daily (.B) dollar indexes
SPOT_RATES_HASH = "60f32914ab61dfab590e0e470153e3ae"    # Daily (.B) spot exchange rates

# Column mapping: Fed unique identifier suffix -> our name
# Series codes ending in .B = business daily, .M = monthly
# We use the .B (daily) series from both hashes
COLUMN_MAP = {
    # From dollar index series (hash: 122e...)
    "JRXWTFB_N.B": "DTWEXBGS",      # Broad Trade-Weighted Dollar Index (daily)
    # From spot rates series (hash: 60f...)
    "RXI$US_N.B.EU": "EURUSD",      # Euro / USD
    "RXI_N.B.JA": "USDJPY",         # USD / Japanese Yen
    "RXI$US_N.B.UK": "GBPUSD",      # British Pound / USD
    "RXI_N.B.SZ": "USDCHF",         # USD / Swiss Franc
    "RXI_N.B.CA": "USDCAD",         # USD / Canadian Dollar
    "RXI$US_N.B.AL": "AUDUSD",      # Australian Dollar / USD
    "RXI_N.B.CH": "USDCNY",         # USD / Chinese Yuan
    "RXI_N.B.KO": "USDKRW",         # USD / South Korean Won
    "RXI_N.B.MX": "USDMXN",         # USD / Mexican Peso
    "RXI_N.B.IN": "USDINR",         # USD / Indian Rupee
    "RXI_N.B.BZ": "USDBRL",         # USD / Brazilian Real
    "RXI_N.B.SD": "USDSEK",         # USD / Swedish Krona
    "RXI_N.B.NO": "USDNOK",         # USD / Norwegian Krone
    "RXI_N.B.SI": "USDSGD",         # USD / Singapore Dollar
    "RXI_N.B.HK": "USDHKD",         # USD / Hong Kong Dollar
    "RXI_N.B.TA": "USDTWD",         # USD / Taiwan Dollar
    "RXI_N.B.SF": "USDZAR",         # USD / South African Rand
}


def fetch_ddp_csv(series_hash, start, end):
    """Fetch a CSV from the Fed DDP and parse it into {date: {series_code: value}}."""
    url = (
        f"https://www.federalreserve.gov/datadownload/Output.aspx"
        f"?rel=H10&series={series_hash}"
        f"&from={start.replace('-','/')[-8:]}&to={end.replace('-','/')[-8:]}"
        f"&filetype=csv&label=include&layout=seriescolumn"
    )
    # Fed DDP wants dates as MM/DD/YYYY
    from_date = f"{start[5:7]}/{start[8:10]}/{start[:4]}"
    to_date = f"{end[5:7]}/{end[8:10]}/{end[:4]}"
    url = (
        f"https://www.federalreserve.gov/datadownload/Output.aspx"
        f"?rel=H10&series={series_hash}"
        f"&from={from_date}&to={to_date}"
        f"&filetype=csv&label=include&layout=seriescolumn"
    )

    print(f"  Fetching {series_hash[:16]}... ", end="", flush=True)
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=60) as resp:
        raw = resp.read().decode("utf-8")

    reader = csv.reader(io.StringIO(raw))
    rows = list(reader)
    print(f"{len(rows)} rows")

    if len(rows) < 7:
        print(f"  WARNING: unexpected format (only {len(rows)} rows)")
        return {}, []

    # Row 4: unique identifiers (e.g., "H10/H10/JRXWTFB_N.B")
    uid_row = rows[4]
    # Row 5: series codes (column headers)
    header_row = rows[5]

    # Map column index -> series code suffix
    col_series = {}
    for i, uid in enumerate(uid_row):
        uid = uid.strip().strip('"')
        # Extract suffix after last "/"
        if "/" in uid:
            suffix = uid.split("/")[-1]
            col_series[i] = suffix

    # Parse data rows
    data = {}
    for row in rows[6:]:
        if len(row) < 2:
            continue
        date_str = row[0].strip().strip('"')
        if not date_str or len(date_str) != 10:
            continue
        record = {}
        for i, series_code in col_series.items():
            if i < len(row):
                val = row[i].strip().strip('"')
                if val and val != "ND":
                    try:
                        record[series_code] = float(val)
                    except ValueError:
                        pass
        if record:
            data[date_str] = record

    return data, sorted(col_series.values())


def main():
    print("Fetching FX data from Federal Reserve Board H.10 (public domain)")
    print(f"  Date range: {START_DATE} to {END_DATE}")
    print(f"  No API key required")
    print()

    # Fetch both series packages
    index_data, index_series = fetch_ddp_csv(DOLLAR_INDEX_HASH, START_DATE, END_DATE)
    spot_data, spot_series = fetch_ddp_csv(SPOT_RATES_HASH, START_DATE, END_DATE)

    # Merge: combine dollar index and spot rate data by date
    all_dates = sorted(set(list(index_data.keys()) + list(spot_data.keys())))
    merged = {}
    for date in all_dates:
        record = {}
        if date in index_data:
            record.update(index_data[date])
        if date in spot_data:
            record.update(spot_data[date])
        merged[date] = record

    # Filter to dates in our range
    dates = [d for d in sorted(merged.keys()) if START_DATE <= d <= END_DATE]
    print(f"\nMerged {len(dates)} trading days")
    if dates:
        print(f"  First: {dates[0]}")
        print(f"  Last:  {dates[-1]}")

    # Map Fed series codes to our column names
    our_columns = []
    code_to_name = {}
    for code, name in COLUMN_MAP.items():
        # Check if this series code exists in the data
        for d in dates[:10]:  # spot check first 10 dates
            if code in merged.get(d, {}):
                code_to_name[code] = name
                if name not in our_columns:
                    our_columns.append(name)
                break

    # Sort: DTWEXBGS first, then alphabetical
    our_columns = sorted(our_columns, key=lambda x: (0 if x == "DTWEXBGS" else 1, x))
    print(f"  Series mapped: {len(our_columns)}")
    for name in our_columns:
        print(f"    {name}")

    # Reverse map: name -> code
    name_to_code = {v: k for k, v in code_to_name.items()}

    # Write CSV in same format as equities: Date, TICKER_Close, TICKER_ExDiv, TICKER_Split, TICKER_AdjClose
    os.makedirs(os.path.dirname(os.path.abspath(OUTPUT_CSV)), exist_ok=True)
    with open(OUTPUT_CSV, "w", newline="") as f:
        writer = csv.writer(f)
        header = ["Date"]
        for name in our_columns:
            header.extend([f"{name}_Close", f"{name}_ExDiv", f"{name}_Split", f"{name}_AdjClose"])
        writer.writerow(header)

        rows_written = 0
        for date in dates:
            record = merged[date]
            # Require DTWEXBGS to be present (it's the primary series)
            dtwexbgs_code = name_to_code.get("DTWEXBGS")
            if dtwexbgs_code not in record:
                continue

            row = [date]
            for name in our_columns:
                code = name_to_code[name]
                val = record.get(code)
                if val is not None:
                    row.extend([round(val, 4), 0.0, 1.0, round(val, 4)])
                else:
                    row.extend(["", 0.0, 1.0, ""])
            writer.writerow(row)
            rows_written += 1

    csv_size = os.path.getsize(OUTPUT_CSV)
    print(f"\nCSV written: {OUTPUT_CSV}")
    print(f"  {rows_written} rows x {len(our_columns)} series x 4 columns")
    print(f"  Size: {csv_size:,} bytes ({csv_size/1024:.0f} KB)")
    print(f"\nFormat: same column convention as equities (ExDiv=0, Split=1.0, AdjClose=Close)")
    print(f"License: US public domain (17 U.S.C. §105) — Board of Governors data")
    print(f"Source: https://www.federalreserve.gov/releases/h10/hist/")


if __name__ == "__main__":
    main()
