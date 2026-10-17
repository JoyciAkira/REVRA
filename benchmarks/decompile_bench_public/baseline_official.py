#!/usr/bin/env python3
"""
Valutazione dei candidati UFFICIALI presenti nel corpus (ida_pseudo, ghidra_pseudo)
attraverso l'harness ufficiale in container linux/amd64.

Scopo:
 1. Riprodurre localmente le baseline pubblicate (IDA Pro / Hex-Rays e Ghidra)
    sul corpus humaneval-decompile.json -> calibrazione di fedeltà del protocollo.
 2. Produzione del numero confrontabile con la letteratura.

Uso: python3 baseline_official.py [--limit N] [--sets ida,ghidra]
Output: reports/official_baselines.json + jsonl per-candidato in reports/.
"""
import argparse
import json
import os
import subprocess
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = HERE / "data" / os.environ.get("DBENCH_CORPUS", "humaneval-decompile.json")
REPORTS = HERE / "reports"


def wilson(k: int, n: int, z: float = 1.96) -> tuple[float, float]:
    if n == 0:
        return (0.0, 0.0)
    p = k / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = z * ((p * (1 - p) / n + z * z / (4 * n * n)) ** 0.5) / denom
    return (max(0.0, center - half), min(1.0, center + half))


def eval_in_docker(rows: list[dict], tag: str) -> list[dict]:
    """Esegue l'harness ufficiale nel container; ritorna i risultati per id.
    Input via stdin e output via stdout catturato: niente file intermedi su
    bind mount (lag di sync su macOS può lasciare il file vuoto nel container).
    """
    payload = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
    out = subprocess.run(
        [
            "docker", "run", "--rm", "--platform", "linux/amd64", "-i",
            "-v", f"{HERE}:/bench:ro",
            "revra-dbench-eval",
            "bash", "-c",
            "cd /bench && python3 eval_candidates.py 3>&1 1>/dev/null",
        ],
        input=payload, text=True, capture_output=True,
    )
    if out.returncode != 0:
        raise RuntimeError(f"docker eval fallito: {out.stderr[-2000:]}")
    results = [json.loads(l) for l in out.stdout.splitlines() if l.strip()]
    if len(results) != len(rows):
        raise RuntimeError(
            f"risultati {len(results)} != righe {len(rows)} (stderr tail: {out.stderr[-500:]})"
        )
    (REPORTS / f"{tag}_results.jsonl").write_text(
        "".join(json.dumps(r) + "\n" for r in results)
    )
    return results


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="prime N righe (smoke)")
    ap.add_argument("--sets", type=str, default="ida,ghidra")
    ap.add_argument("--stride", type=int, default=1)
    args = ap.parse_args()

    REPORTS.mkdir(exist_ok=True)
    corpus = json.loads(DATA.read_text())
    if args.stride > 1:
        corpus = corpus[:: args.stride]
    if args.limit:
        corpus = corpus[: args.limit]
    print(f"righe: {len(corpus)}")

    summary = {}
    field_map = {"ida": "ida_pseudo", "ghidra": "ghidra_pseudo"}
    for field in (field_map.get(s, s) for s in args.sets.split(",")):
        tag = f"official_{field}"
        rows = [
            {
                "id": f"{i}",
                "func_dep": s["func_dep"],
                "candidate": s[field],
                "test": s["test"],
                "language": s["language"],
                "opt": s["opt"],
            }
            for i, s in enumerate(corpus)
        ]
        (REPORTS / f"{tag}_input.jsonl").write_text(
            "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
        )
        results = {r["id"]: r for r in eval_in_docker(rows, tag)}

        agg = defaultdict(lambda: {"n": 0, "exe": 0, "comp": 0})
        for r in rows:
            res = results[r["id"]]
            for key in (f"{r['language']}/{r['opt']}", "TOTAL"):
                agg[key]["n"] += 1
                agg[key]["comp"] += res["comp"]
                agg[key]["exe"] += res["exe"]

        table = {}
        for key, v in sorted(agg.items()):
            lo, hi = wilson(v["exe"], v["n"])
            table[key] = {**v, "exe_rate": round(v["exe"] / v["n"], 4),
                          "wilson95": [round(lo, 4), round(hi, 4)]}
        summary[field] = table
        print(f"\n== {field} ==")
        for key in ("c/O0", "c/O1", "c/O2", "c/O3", "cpp/O0", "cpp/O1", "cpp/O2", "cpp/O3", "TOTAL"):
            if key in table:
                t = table[key]
                print(f"  {key:8s} {t['exe']}/{t['n']} = {t['exe_rate']*100:.2f}%  CI95 {t['wilson95']}")

    out_file = REPORTS / "official_baselines.json"
    out_file.write_text(json.dumps(
        {"dataset": "humaneval-decompile.json",
         "sha256": "95bc5ebc6ea64905386b29ca416a0730582c7f00d720c5b977aaf0d3a6058dd7",
         "rows": len(corpus), "harness": "official execute_rate verbatim, opt=-O0, timeout=10",
         "results": summary}, indent=2))
    print(f"\nreport: {out_file}")


if __name__ == "__main__":
    main()
