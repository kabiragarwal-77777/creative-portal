import csv
import json
import math
from collections import defaultdict
from pathlib import Path

ROOT = Path(r"c:\Users\Dell\Desktop\creative-portal")
CSV_PATH = ROOT / "tmp_roas_weekly_match.csv"
OUT_JSON = ROOT / "tmp_roas_weekly_backtest_proxy.json"

STAGE_LABELS = ["P0", "P2", "P8", "P14"]
HORIZONS = ["D6", "D15", "D30", "D60", "D180"]


def cosine(a, b):
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def read_csv():
    with CSV_PATH.open("r", encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    by = defaultdict(list)
    for r in rows:
        by[r["creative"]].append({
            "week_start": r["week_start"],
            "spend": float(r["spend"] or 0),
            "vector": [
                float(r["d6_roas"] or 0),
                float(r["d15_roas"] or 0),
                float(r["d30_roas"] or 0),
                float(r["d60_roas"] or 0),
                float(r["d180_roas"] or 0),
            ],
        })
    for c in by:
        by[c].sort(key=lambda x: x["week_start"])
    return by


def main():
    data = read_csv()
    creatives = sorted(data.keys())
    final = {c: data[c][-1]["vector"] for c in creatives if data[c]}

    report = []
    summary = defaultdict(lambda: {"n": 0, "mape": 0.0, "smape": 0.0})

    for target in creatives:
        series = [r for r in data[target] if r["spend"] > 0]
        if not series:
            continue
        for stage_idx, stage in enumerate(STAGE_LABELS):
            if stage_idx >= len(series):
                continue
            cur = series[stage_idx]
            cur_vec = cur["vector"]
            actual_final = final[target]

            similars = []
            for other in creatives:
                if other == target:
                    continue
                oseries = [r for r in data[other] if r["spend"] > 0]
                if stage_idx >= len(oseries):
                    continue
                ocur = oseries[stage_idx]
                sim = cosine(cur_vec, ocur["vector"])
                if sim <= 0:
                    continue
                base = ocur["vector"]
                fin = final[other]
                mults = []
                for i in range(5):
                    mults.append(fin[i] / base[i] if base[i] else 1.0)
                similars.append((sim, mults))

            similars.sort(reverse=True, key=lambda x: x[0])
            top = similars[:3]
            if top:
                weights = [x[0] for x in top]
                total_w = sum(weights)
                mults = []
                for i in range(5):
                    mults.append(sum(w * x[1][i] for w, x in zip(weights, top)) / total_w)
            else:
                mults = [1.0] * 5

            pred = [cur_vec[i] * mults[i] for i in range(5)]
            for i in range(1, 5):
                if pred[i] < pred[i - 1]:
                    pred[i] = pred[i - 1]

            for i, h in enumerate(HORIZONS):
                act = actual_final[i]
                p = pred[i]
                ape = abs(p - act) / act * 100 if act else None
                smape = abs(p - act) / ((abs(p) + abs(act)) / 2) * 100 if (abs(p) + abs(act)) else None
                report.append({
                    "creative": target,
                    "stage": stage,
                    "stage_index": stage_idx,
                    "horizon": h,
                    "actual_final": round(act, 2),
                    "predicted_final": round(p, 2),
                    "ape": round(ape, 2) if ape is not None else None,
                    "smape": round(smape, 2) if smape is not None else None,
                    "checkpoint_week": cur["week_start"],
                })
                if ape is not None:
                    summary[(stage, h)]["n"] += 1
                    summary[(stage, h)]["mape"] += ape
                    summary[(stage, h)]["smape"] += smape or 0

    out = {}
    for (stage, h), v in summary.items():
        out.setdefault(stage, {})[h] = {
            "n": v["n"],
            "mape": round(v["mape"] / v["n"], 2) if v["n"] else None,
            "smape": round(v["smape"] / v["n"], 2) if v["n"] else None,
        }

    OUT_JSON.write_text(json.dumps({"summary": out, "rows": report}, indent=2), encoding="utf-8")
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
