import csv
import json
import math
import statistics
import zipfile
import xml.etree.ElementTree as ET
from collections import defaultdict
from datetime import datetime, timedelta, date
from pathlib import Path

ROOT = Path(r"c:\Users\Dell\Desktop\creative-portal")
WORKBOOK = Path(r"c:\Users\Dell\Downloads\kabir_analysis_2026-04-09T05_57_51.376350329Z.xlsx")
META_CACHE = ROOT / "tmp_meta_insights_chunk_cache.json"
OUT_CSV = ROOT / "tmp_roas_backtest_curves.csv"
OUT_JSON = ROOT / "tmp_roas_backtest_curves.json"

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

CHECKPOINTS = [0, 2, 8, 14]
HORIZONS = ["D6", "D15", "D30", "D60", "D180"]


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


def parse_date(v):
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    if isinstance(v, (int, float)):
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
                text_parts = [t.text or "" for t in si.iterfind(".//main:t", ns)]
                shared.append("".join(text_parts))

        wb_root = ET.fromstring(zf.read("xl/workbook.xml"))
        sheets = wb_root.find("main:sheets", ns)
        first_sheet_rid = None
        for sh in sheets.findall("main:sheet", ns):
            first_sheet_rid = sh.attrib.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
            break
        rels_root = ET.fromstring(zf.read("xl/_rels/workbook.xml.rels"))
        target = None
        for rel in rels_root:
            if rel.attrib.get("Id") == first_sheet_rid:
                target = rel.attrib.get("Target")
                break
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


def load_meta_rows():
    cache = json.loads(META_CACHE.read_text(encoding="utf-8"))
    out = []
    for chunk_rows in cache.values():
        out.extend(chunk_rows)
    return out


def horizon_vector(row):
    return [parse_num(row.get("d6_overall_revenue")), parse_num(row.get("d15_overall_revenue")), parse_num(row.get("d30_overall_revenue")), parse_num(row.get("d60_overall_revenue")), parse_num(row.get("d180_overall_revenue"))]


def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def safe_div(a, b):
    return a / b if b else None


def main():
    workbook = load_workbook_rows()
    workbook = [r for r in workbook if str(r.get("tracker_name") or "") in TARGETS]
    meta_rows = load_meta_rows()

    meta_lookup = defaultdict(list)
    first_spend = {}
    for r in meta_rows:
        key = join_key(r.get("date_start"), r.get("campaign_name"), r.get("adset_name"), r.get("ad_name"))
        meta_lookup[key].append(r)

    daily = defaultdict(list)
    for r in workbook:
        key = join_key(r["date"], r.get("campaign_name"), r.get("ad_set_name"), r.get("tracker_name"))
        spend = sum(parse_num(x.get("spend")) * 1.18 for x in meta_lookup.get(key, []))
        if spend <= 0:
            continue
        creative = str(r.get("tracker_name") or "").strip()
        first_spend.setdefault(creative, r["date"])
        daily[creative].append({
            "date": r["date"],
            "age": (r["date"] - first_spend[creative]).days,
            "spend": spend,
            "vector": [safe_div(parse_num(r.get("d6_overall_revenue")), spend) * 100 if spend else 0,
                       safe_div(parse_num(r.get("d15_overall_revenue")), spend) * 100 if spend else 0,
                       safe_div(parse_num(r.get("d30_overall_revenue")), spend) * 100 if spend else 0,
                       safe_div(parse_num(r.get("d60_overall_revenue")), spend) * 100 if spend else 0,
                       safe_div(parse_num(r.get("d180_overall_revenue")), spend) * 100 if spend else 0],
        })

    for creative in daily:
        daily[creative].sort(key=lambda x: (x["age"], x["date"]))

    final_vec = {c: rows[-1]["vector"] for c, rows in daily.items() if rows}
    report_rows = []
    summary = defaultdict(lambda: {"n": 0, "mape": 0.0, "smape": 0.0, "r2_like": 0.0})

    for target in sorted(daily.keys()):
        target_rows = daily[target]
        for cp in CHECKPOINTS:
            candidates = [r for r in target_rows if r["age"] >= cp]
            if not candidates:
                continue
            cur = min(candidates, key=lambda r: (r["age"] - cp, r["date"]))
            cur_vec = cur["vector"]
            actual_final = final_vec[target]

            others = []
            for other, series in daily.items():
                if other == target:
                    continue
                cand = [r for r in series if r["age"] >= cp]
                if not cand:
                    continue
                ocur = min(cand, key=lambda r: (r["age"] - cp, r["date"]))
                ovec = ocur["vector"]
                sim = cosine(cur_vec, ovec)
                if sim <= 0:
                    continue
                mults = []
                for i in range(5):
                    base = ovec[i]
                    fin = final_vec.get(other, [0, 0, 0, 0, 0])[i]
                    if base and fin:
                        mults.append(fin / base)
                    else:
                        mults.append(1.0)
                others.append((sim, mults))

            others.sort(reverse=True, key=lambda x: x[0])
            top = others[:3] if others else []
            if top:
                weights = [x[0] for x in top]
                total_w = sum(weights)
                avg_mults = []
                for i in range(5):
                    avg_mults.append(sum(w * x[1][i] for w, x in zip(weights, top)) / total_w)
            else:
                avg_mults = [1.0] * 5

            pred = [cur_vec[i] * avg_mults[i] for i in range(5)]
            # enforce nondecreasing horizon prediction
            for i in range(1, 5):
                if pred[i] < pred[i - 1]:
                    pred[i] = pred[i - 1]

            errs = []
            for i, h in enumerate(HORIZONS):
                a = actual_final[i]
                p = pred[i]
                if a:
                    errs.append(abs(p - a) / a * 100)
                    summary[(cp, h)]["n"] += 1
                    summary[(cp, h)]["mape"] += abs(p - a) / a * 100
                    denom = (abs(p) + abs(a)) / 2
                    summary[(cp, h)]["smape"] += abs(p - a) / denom * 100 if denom else 0
                report_rows.append({
                    "creative": target,
                    "checkpoint": f"P{cp}",
                    "age_days": cur["age"],
                    "horizon": h,
                    "actual_final": round(actual_final[i], 2),
                    "predicted_final": round(p, 2),
                    "ape": round(abs(p - a) / a * 100, 2) if a else None,
                    "week_date": cur["date"].isoformat(),
                })

    with OUT_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(report_rows[0].keys()))
        writer.writeheader()
        writer.writerows(report_rows)

    out_summary = {}
    for (cp, h), v in summary.items():
        if v["n"]:
            out_summary.setdefault(cp, {})[h] = {
                "n": v["n"],
                "mape": round(v["mape"] / v["n"], 2),
                "smape": round(v["smape"] / v["n"], 2),
            }
    OUT_JSON.write_text(json.dumps(out_summary, indent=2), encoding="utf-8")

    print(json.dumps(out_summary, indent=2))


if __name__ == "__main__":
    main()
