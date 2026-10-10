#!/usr/bin/env python3
"""
Fetch monthly ACWI ETF returns from SEC EDGAR NPORT-P filings (public domain).

Usage:
    python3 fetch_acwi_nav.py
    Output: ../data/acwi_monthly_returns.csv

This extracts monthly total returns from iShares MSCI ACWI ETF (ticker: ACWI)
NPORT-P filings. NPORT-P was mandated starting 2019, so coverage is ~2019-10
to present (~6 years). Monthly returns are reconstructed into a price index
starting at 100.

The script uses EDGAR full-text search to find only filings containing
the ACWI series ID (S000021461), then fetches those ~27 XMLs — not all
8,000+ iShares Trust filings.

License: NPORT-P filings are filed by the fund, not by the US government, so
they are not public domain under 17 U.S.C. section 105. This script keeps only
the monthly total-return figures, which are facts reported in the filing, and
copies no MSCI index data.

Source: https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=0001100663
Series: S000021461 (iShares MSCI ACWI ETF)
Class:  C000061364
"""

import csv
import json
import os
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET

# --- Configuration ---
SERIES_ID = "S000021461"    # iShares MSCI ACWI ETF
CLASS_ID = "C000061364"     # ACWI share class
OUTPUT_CSV = os.path.join(os.path.dirname(__file__), "..", "data", "acwi_monthly_returns.csv")
USER_AGENT = "kanaha-calcs/1.0 (educational finance app; fetch_acwi_nav.py)"

# EDGAR rate limit: 10 requests/second. We'll be conservative.
REQUEST_DELAY = 0.5  # seconds between requests


def edgar_get(url):
    """Fetch a URL from EDGAR with proper User-Agent and rate limiting."""
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    time.sleep(REQUEST_DELAY)
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.read()


def find_acwi_filings():
    """Use EDGAR full-text search to find NPORT-P filings containing ACWI series ID.

    This searches for the series ID string inside filing XML, returning only
    the ~27 filings that actually contain ACWI data (not all 8,000+ iShares filings).
    """
    print("Searching EDGAR for ACWI NPORT-P filings...")
    url = (
        f"https://efts.sec.gov/LATEST/search-index"
        f"?q=%22{SERIES_ID}%22&forms=NPORT-P"
        f"&dateRange=custom&startdt=2019-01-01&enddt=2030-12-31"
        f"&_source=file_date,period_ending&size=100"
    )

    data = json.loads(edgar_get(url))
    hits = data.get("hits", {}).get("hits", [])
    print(f"  Found {len(hits)} filings containing series {SERIES_ID}")

    filings = []
    for hit in hits:
        doc_id = hit["_id"]  # e.g., "0001752724-19-203174:primary_doc.xml"
        parts = doc_id.split(":")
        accession = parts[0]  # "0001752724-19-203174"
        primary_doc = parts[1] if len(parts) > 1 else "primary_doc.xml"
        source = hit.get("_source", {})
        file_date = source.get("file_date", "")
        period = source.get("period_ending", "")

        filings.append({
            "accession": accession,
            "primary_doc": primary_doc,
            "file_date": file_date,
            "period": period,
        })

    filings.sort(key=lambda f: f.get("period", f.get("file_date", "")))
    return filings


def parse_nport_xml(xml_bytes):
    """Parse an NPORT-P XML filing for ACWI monthly returns.

    Each NPORT-P filing covers 3 months. The monthlyTotReturn element
    has rtn1, rtn2, rtn3 attributes for months 1, 2, 3 of the period.
    """
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return None

    # Get reporting period end date — try both namespaced and non-namespaced
    ns = {"n": "http://www.sec.gov/edgar/nport"}
    rep_date_el = root.find(".//n:repPdDate", ns)
    if rep_date_el is None:
        rep_date_el = root.find(".//{*}repPdDate")
    rep_date = rep_date_el.text.strip() if rep_date_el is not None else None

    # Get net assets
    net_assets_el = root.find(".//n:netAssets", ns)
    if net_assets_el is None:
        net_assets_el = root.find(".//{*}netAssets")
    net_assets = None
    if net_assets_el is not None and net_assets_el.text:
        try:
            net_assets = float(net_assets_el.text.strip())
        except ValueError:
            pass

    # Get monthly total returns for our class
    returns = [None, None, None]
    monthly_els = root.findall(".//n:monthlyTotReturn", ns)
    if not monthly_els:
        monthly_els = root.findall(".//{*}monthlyTotReturn")

    for mel in monthly_els:
        class_id = mel.get("classId", "")
        if CLASS_ID in class_id:
            rtn1 = mel.get("rtn1", "")
            rtn2 = mel.get("rtn2", "")
            rtn3 = mel.get("rtn3", "")
            returns = [
                float(rtn1) if rtn1 else None,
                float(rtn2) if rtn2 else None,
                float(rtn3) if rtn3 else None,
            ]
            break

    return {
        "rep_date": rep_date,
        "net_assets": net_assets,
        "monthly_returns": returns,
    }


def main():
    print("Fetching iShares MSCI ACWI ETF monthly returns from SEC EDGAR")
    print(f"  Series: {SERIES_ID}")
    print(f"  Class: {CLASS_ID}")
    print()

    filings = find_acwi_filings()
    if not filings:
        print("ERROR: no ACWI NPORT-P filings found")
        sys.exit(1)

    # Fetch and parse each filing
    all_periods = []
    for i, filing in enumerate(filings):
        accession_nodashes = filing["accession"].replace("-", "")
        primary_doc = filing["primary_doc"]
        # CIK without leading zeros for the URL path
        url = f"https://www.sec.gov/Archives/edgar/data/1100663/{accession_nodashes}/{primary_doc}"

        print(f"  [{i+1}/{len(filings)}] period={filing['period']}...", end="", flush=True)
        try:
            xml_bytes = edgar_get(url)
            result = parse_nport_xml(xml_bytes)
            if result and any(r is not None for r in result["monthly_returns"]):
                all_periods.append(result)
                rets = [f"{r*100:.2f}%" if r is not None else "N/A" for r in result["monthly_returns"]]
                na = f" NAV=${result['net_assets']/1e9:.1f}B" if result["net_assets"] else ""
                print(f" returns=[{', '.join(rets)}]{na}")
            else:
                print(f" no return data extracted")
        except Exception as e:
            print(f" ERROR: {e}")

    if not all_periods:
        print("\nERROR: no monthly return data extracted")
        sys.exit(1)

    # Build monthly return time series
    monthly_data = []  # [(year-month, return_decimal)]
    for period in all_periods:
        rep_date = period["rep_date"]
        if not rep_date:
            continue
        year = int(rep_date[:4])
        month = int(rep_date[5:7])
        returns = period["monthly_returns"]

        # rtn1 = oldest month in quarter, rtn2 = middle, rtn3 = most recent (= rep_date month)
        # NPORT-P returns are in percentage form (e.g., 2.74 = 2.74%), convert to decimal
        for offset, rtn in [(-2, returns[0]), (-1, returns[1]), (0, returns[2])]:
            if rtn is None:
                continue
            rtn = rtn / 100.0  # Convert from percentage to decimal
            m = month + offset
            y = year
            while m <= 0:
                m += 12
                y -= 1
            ym = f"{y:04d}-{m:02d}"
            monthly_data.append((ym, rtn))

    # Deduplicate (amended filings may overlap) — keep first occurrence
    monthly_data.sort()
    seen = set()
    unique_data = []
    for ym, rtn in monthly_data:
        if ym not in seen:
            seen.add(ym)
            unique_data.append((ym, rtn))

    print(f"\nExtracted {len(unique_data)} unique monthly returns")
    if unique_data:
        print(f"  First: {unique_data[0][0]}")
        print(f"  Last:  {unique_data[-1][0]}")

    # Reconstruct price index from returns (start at 100)
    index_value = 100.0
    index_series = []
    for ym, rtn in unique_data:
        index_value *= (1.0 + rtn)
        index_series.append((ym, rtn, round(index_value, 4)))

    # Write CSV
    os.makedirs(os.path.dirname(os.path.abspath(OUTPUT_CSV)), exist_ok=True)
    with open(OUTPUT_CSV, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["Date", "ACWI_MonthlyReturn", "ACWI_IndexValue"])
        for ym, rtn, idx in index_series:
            writer.writerow([f"{ym}-01", round(rtn, 6), idx])

    csv_size = os.path.getsize(OUTPUT_CSV)
    print(f"\nCSV written: {OUTPUT_CSV}")
    print(f"  {len(index_series)} months")
    print(f"  Size: {csv_size:,} bytes")
    print(f"  Format: Date, ACWI_MonthlyReturn (decimal), ACWI_IndexValue (base=100)")
    print(f"\nNote: NPORT-P filings begin ~2019. This gives ~{len(index_series)//12} years of monthly data.")
    print(f"Source: SEC EDGAR NPORT-P filings by iShares Trust (monthly return figures only).")


if __name__ == "__main__":
    main()
