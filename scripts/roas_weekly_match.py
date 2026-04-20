import csv
import json
import os
import sys
import urllib.request
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timedelta, date
from pathlib import Path


ROOT = Path(r"c:\Users\Dell\Desktop\creative-portal")
WORKBOOK = Path(r"c:\Users\Dell\Downloads\kabir_analysis_2026-04-09T05_57_51.376350329Z.xlsx")
PORTAL_INTERNAL_BASE_URL = os.environ.get("PORTAL_INTERNAL_BASE_URL", "http://[::1]:3000").rstrip("/")
LOCAL_META_URL = f"{PORTAL_INTERNAL_BASE_URL}/api/meta/ad-insights-daily"
ANALYSIS_START = date(2025, 11, 21)
ANALYSIS_END = date(2026, 4, 9)
META_CHUNK_CACHE = ROOT / "tmp_meta_insights_chunk_cache.json"
TARGETS = {
    "FB_MOF_Baby-AI_V0_211125",
    "FB_MOF_Election-Day_V1_261125",
    "FB_MOF_Selfie-Girl-BlackF_0_261125",
    "FB_MOF_Static_Performance-20th-Nov_V0_261125",
    "FB_MOF_Video_Monkey-AI_V2_181125",
    "FB_MOF_Video_Monkey-AI_V1_181125",
    "FB_MOF_Black-Friday-AI_V1_201125",
    "FB_MOF_Black-Friday-Fire_0_201125",
    "FB_MOF_Video_AS-Sebi_V0_171125",
    "FB_MOF_Video_AS-Anchor_V0_161125",
    "FB_MOF_Video_Buddhu-Ladki-Test_V0_131125",
}


def norm_campaign(v):
    return str(v or "").strip().lower().replace("\u00a0", " ")


def norm_adset(v):
    return str(v or "").strip().lower().replace("\u00a0", " ")


def norm_tracker(v):
    s = str(v or "")
    s = s.split(":", 1)[0]
    return s.strip().lower().replace("\u00a0", " ")


def join_key(d, campaign, adset, tracker):
    return "|||".join([str(d)[:10], norm_campaign(campaign), norm_adset(adset), norm_tracker(tracker)])


def week_start(d):
    return d - timedelta(days=d.weekday())


def parse_date(v):
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, (int, float)):
        # Excel serial date (Windows epoch)
        return (datetime(1899, 12, 30) + timedelta(days=float(v))).date()
    s = str(v).strip()
    if not s:
        return None
    if s.replace(".", "", 1).isdigit():
        return (datetime(1899, 12, 30) + timedelta(days=float(s))).date()
    if "T" in s:
        s = s[:10]
    return datetime.strptime(s, "%Y-%m-%d").date()


def parse_num(v):
    if v is None or v == "":
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).replace("₹", "").replace("%", "").replace(",", "").strip()
    try:
        return float(s)
    except Exception:
        return 0.0


def fetch_meta(date_from, date_to):
    body = json.dumps({"dateFrom": date_from, "dateTo": date_to}).encode("utf-8")
    req = urllib.request.Request(
        LOCAL_META_URL,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    last_err = None
    for attempt in range(1, 4):
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                payload = json.loads(resp.read().decode("utf-8"))
                if not payload.get("success"):
                    raise RuntimeError(payload.get("error") or "meta api failed")
                return payload["data"]
        except Exception as e:
            last_err = e
            if attempt < 3:
                continue
    raise last_err


def load_chunk_cache():
    if META_CHUNK_CACHE.exists():
        try:
            return json.loads(META_CHUNK_CACHE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_chunk_cache(cache):
    META_CHUNK_CACHE.write_text(json.dumps(cache), encoding="utf-8")


def chunk_dates(start_d, end_d, chunk_days=21):
    cur = start_d
    while cur <= end_d:
        nxt = min(cur + timedelta(days=chunk_days - 1), end_d)
        yield cur, nxt
        cur = nxt + timedelta(days=1)


def load_workbook_rows():
    ns = {
        "main": "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
        "rel": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    }
    with zipfile.ZipFile(WORKBOOK, "r") as zf:
        shared = []
        if "xl/sharedStrings.xml" in zf.namelist():
            root = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            for si in root.findall("main:si", ns):
                text_parts = []
                for t in si.iterfind(".//main:t", ns):
                    text_parts.append(t.text or "")
                shared.append("".join(text_parts))
        wb_root = ET.fromstring(zf.read("xl/workbook.xml"))
        sheets = wb_root.find("main:sheets", ns)
        first_sheet_name = None
        first_sheet_rid = None
        for sh in sheets.findall("main:sheet", ns):
            first_sheet_name = sh.attrib.get("name")
            first_sheet_rid = sh.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
            break
        if not first_sheet_name:
            raise RuntimeError("No sheets in workbook")
        rels_root = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        target = None
        for rel in rels_root:
            if rel.attrib.get("Id") == first_sheet_rid:
                target = rel.attrib.get("Target")
                break
        if not target:
            raise RuntimeError("Could not resolve sheet target")
        sheet_path = target.lstrip("/")
        if not sheet_path.startswith("xl/"):
            sheet_path = "xl/" + sheet_path
        sheet_root = ET.fromstring(zf.read(sheet_path))
        rows = []
        for row in sheet_root.findall(".//main:sheetData/main:row", ns):
            vals = []
            for c in row.findall("main:c", ns):
                t = c.attrib.get("t")
                v = c.findtext("main:v", default="", namespaces=ns)
                if t == "s":
                    idx = int(v) if v else 0
                    vals.append(shared[idx] if idx < len(shared) else "")
                elif t == "inlineStr":
                    vals.append("".join(x.text or "" for x in c.iterfind(".//main:t", ns)))
                else:
                    vals.append(v)
            rows.append(vals)
        headers = [str(h).strip() for h in rows[0]]
        out = []
        for row in rows[1:]:
            obj = {headers[i]: row[i] if i < len(row) else None for i in range(len(headers))}
            if not obj.get("date"):
                continue
            obj["date"] = parse_date(obj["date"])
            out.append(obj)
        return out


def main():
    rows = load_workbook_rows()
    target_rows = [r for r in rows if ANALYSIS_START <= r["date"] <= ANALYSIS_END and str(r.get("tracker_name") or "") in TARGETS]
    if not target_rows:
        print("No target workbook rows found", file=sys.stderr)
        sys.exit(1)

    min_date = min(r["date"] for r in target_rows)
    max_date = min(max(r["date"] for r in target_rows), ANALYSIS_END)
    print(f"Target workbook rows: {len(target_rows)}")
    print(f"Workbook date range: {min_date} -> {max_date}")

    chunk_cache = load_chunk_cache()
    meta_rows = []
    for d1, d2 in chunk_dates(min_date, max_date, chunk_days=7):
        ck = f"{d1.isoformat()}__{d2.isoformat()}"
        if ck in chunk_cache:
            meta_rows.extend(chunk_cache[ck])
            print(f"Using cached Meta {d1} -> {d2} ({len(chunk_cache[ck])} rows)")
            continue
        print(f"Fetching Meta {d1} -> {d2} ...")
        rows_chunk = fetch_meta(d1.isoformat(), d2.isoformat())
        chunk_cache[ck] = rows_chunk
        save_chunk_cache(chunk_cache)
        meta_rows.extend(rows_chunk)
    print(f"Meta rows fetched: {len(meta_rows)}")

    meta_lookup = defaultdict(list)
    for r in meta_rows:
        key = join_key(r.get("date_start"), r.get("campaign_name"), r.get("adset_name"), r.get("ad_name"))
        meta_lookup[key].append(r)

    matched = []
    unmatched = []
    for r in target_rows:
        key = join_key(r["date"], r.get("campaign_name"), r.get("ad_set_name"), r.get("tracker_name"))
        spend = sum(parse_num(x.get("spend")) * 1.18 for x in meta_lookup.get(key, []))
        if spend > 0:
            matched.append((r, spend))
        else:
            unmatched.append(r)

    print(f"Matched workbook rows with spend: {len(matched)} / {len(target_rows)}")
    if unmatched:
        print("Unmatched sample:")
        for r in unmatched[:10]:
            print("  ", r["date"], r.get("campaign_name"), r.get("ad_set_name"), r.get("tracker_name"))

    horizons = [
        ("d6_overall_revenue", "D6"),
        ("d15_overall_revenue", "D15"),
        ("d30_overall_revenue", "D30"),
        ("d60_overall_revenue", "D60"),
        ("d180_overall_revenue", "D180"),
    ]

    buckets = defaultdict(lambda: defaultdict(lambda: {"spend": 0.0, **{label: 0.0 for _, label in horizons}, "rows": 0}))
    creative_daily = defaultdict(list)
    for r, spend in matched:
        wk = week_start(r["date"])
        creative = str(r.get("tracker_name") or "").strip()
        b = buckets[creative][wk]
        b["spend"] += spend
        for field, label in horizons:
            b[label] += parse_num(r.get(field))
        b["rows"] += 1
        creative_daily[creative].append((r["date"], spend, {label: parse_num(r.get(field)) for field, label in horizons}))

    out_path = ROOT / "tmp_roas_weekly_match.csv"
    with out_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["creative", "week_start", "rows", "spend", "d6_rev", "d6_roas", "d15_rev", "d15_roas", "d30_rev", "d30_roas", "d60_rev", "d60_roas", "d180_rev", "d180_roas"])
        for creative in sorted(buckets.keys()):
            for wk in sorted(buckets[creative].keys()):
                b = buckets[creative][wk]
                spend = b["spend"]
                def roas(v):
                    return round(v / spend * 100, 2) if spend > 0 else None
                writer.writerow([
                    creative,
                    wk.isoformat(),
                    b["rows"],
                    round(spend, 2),
                    round(b["D6"], 2), roas(b["D6"]),
                    round(b["D15"], 2), roas(b["D15"]),
                    round(b["D30"], 2), roas(b["D30"]),
                    round(b["D60"], 2), roas(b["D60"]),
                    round(b["D180"], 2), roas(b["D180"]),
                ])
    print(f"Wrote {out_path}")

    print("\nWeekly ROAS summary:")
    for creative in sorted(buckets.keys()):
        weeks = sorted(buckets[creative].keys())
        first = buckets[creative][weeks[0]]
        last = buckets[creative][weeks[-1]]
        spend_first = first["spend"] or 0.0
        spend_last = last["spend"] or 0.0
        def r(v, sp):
            return round(v / sp * 100, 2) if sp > 0 else None
        print(f"- {creative}")
        print(f"  weeks={len(weeks)} rows={sum(buckets[creative][w]['rows'] for w in weeks)}")
        print(f"  D6 {r(first['D6'], spend_first)} -> {r(last['D6'], spend_last)}")
        print(f"  D15 {r(first['D15'], spend_first)} -> {r(last['D15'], spend_last)}")
        print(f"  D30 {r(first['D30'], spend_first)} -> {r(last['D30'], spend_last)}")
        print(f"  D60 {r(first['D60'], spend_first)} -> {r(last['D60'], spend_last)}")
        print(f"  D180 {r(first['D180'], spend_first)} -> {r(last['D180'], spend_last)}")


if __name__ == "__main__":
    main()
