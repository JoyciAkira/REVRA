#!/usr/bin/env python3
"""
Spike RetDec (MIT, ADR-0002): misura quanto recupera sulle funzioni dove il
candidato Ghidra del run primario (-g) NON compila.

Protocollo:
 1. Da reports/revra_results.jsonl (run -g) prende gli id con comp=0.
 2. Campione deterministico di N=100 (stratificato language/opt).
 3. RetDec headless (v5.0 Linux prebuild in container ubuntu 22.04, ADR-0002)
    sullo stesso ELF del run primario, -k (il target non è raggiungibile dal main stub).
 4. Candidato = segmento tipi/includes + funzione target; per cpp: rename del
    simbolo mangled -> func_name e firma parametri dal commento "Demangled:".
 5. Stesso harness ufficiale (eval_in_docker, fd3).

Uso: python3 retdec_spike.py [--limit 100] [--workers 4]
Output: reports/retdec_spike.json, reports/retdec_results.jsonl, reports/retdec_input.jsonl
"""
import argparse
import json
import os
import re
import subprocess
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from baseline_official import wilson, eval_in_docker

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
REPORTS = HERE / "reports"
BUILD = DATA / "build_g"
RETDEC_DATA = DATA / "retdec"


def retdec_batch(ids: list[int], workers: int) -> str:
    """RetDec su tutti gli ELF selezionati, batch unico nel container.
    Gli output finiscono in /work/build (root, dir 'calda' per il bind mount
    di OrbStack — le subdir create lato host arrivano vuote nel container)."""
    prefix = f"retdec_{int(time.time())}"
    script = (
        f"printf '%s\\n' {' '.join(map(str, ids))} | "
        f"xargs -P {workers} -n1 bash -c "
        f"'i=$0; [ -s /work/build/{prefix}_$i.c ] || "
        f"/retdec/bin/retdec-decompiler -s -k /work/build/$i.elf "
        f"-o /work/build/{prefix}_$i.c >/dev/null 2>&1 || true'"
    )
    subprocess.run(
        ["docker", "run", "--rm", "--platform", "linux/amd64",
         "-v", f"{RETDEC_DATA}:/retdec:ro", "-v", f"{BUILD}:/work/build",
         "revra-dbench-eval", "bash", "-c", "cd /work/build && " + script],
        check=True, capture_output=True, text=True,
    )
    return prefix


def brace_block(lines: list[str], start: int) -> tuple[int, int]:
    """Ritorna (inizio, fine) del blocco {…} che inizia non prima di lines[start]."""
    depth, started = 0, False
    i = start
    while i < len(lines):
        if "{" in lines[i]:
            started = True
        depth += lines[i].count("{") - lines[i].count("}")
        if started and depth <= 0:
            return start, i
        i += 1
    return start, len(lines) - 1


def extract_candidate(c_text: str, func_name: str, language: str) -> str:
    lines = c_text.split("\n")

    # segmento tipi/includes: dall'inizio fino alla sezione prototipi (esclusa)
    proto = next((k for k, l in enumerate(lines) if "Function Prototypes" in l), 0)
    types_seg = "\n".join(lines[:proto])

    # definizione target: commento "Demangled: name(...)" (cpp) oppure match nome (c)
    def_start = None
    mangled = None
    demangled_sig = None
    for k, l in enumerate(lines):
        m = re.search(r"//\s*Demangled:\s*(\S+)\(", l)
        if m and m.group(1) == func_name:
            demangled_sig = l.split("Demangled:", 1)[1].strip()
            for j in range(k + 1, min(k + 6, len(lines))):
                s = lines[j].strip()
                if s and not s.startswith("//"):
                    if "{" in s or ");" not in s:
                        def_start = j
                        mm = re.match(rf"\S+\s+(\S+)\(", s)
                        if mm:
                            mangled = mm.group(1)
                    break
            if def_start is not None:
                break
    if def_start is None:
        for k, l in enumerate(lines):
            if re.match(rf"^\s*\w[\w\s\*]*\b{re.escape(func_name)}\s*\(", l) and ");" not in l:
                def_start = k
                mangled = func_name
                break
    if def_start is None:
        return ""

    s, e = brace_block(lines, def_start)
    func_text = "\n".join(lines[s:e + 1])

    if language == "cpp" and mangled and mangled != func_name:
        func_text = func_text.replace(mangled, func_name)
        if demangled_sig:
            params = demangled_sig[demangled_sig.find("(") + 1:demangled_sig.rfind(")")]
            func_text = re.sub(
                rf"({re.escape(func_name)}\s*)\([^)]*\)",
                lambda m: m.group(1) + "(" + params + ")",
                func_text, count=1,
            )

    return types_seg + "\n" + func_text


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=100)
    ap.add_argument("--workers", type=int, default=4)
    ap.add_argument("--scope", choices=["comp0", "exec0"], default="comp0",
                    help="comp0: dove Ghidra non compila | exec0: dove Ghidra non passa (union census)")
    args = ap.parse_args()

    REPORTS.mkdir(exist_ok=True)
    corpus = json.loads((DATA / "humaneval-decompile.json").read_text())
    ghidra = {json.loads(l)["id"]: json.loads(l) for l in
              (REPORTS / "revra_results.jsonl").read_text().splitlines() if l.strip()}

    if args.scope == "exec0":
        failed_ids = sorted((int(k) for k, v in ghidra.items() if v["exe"] == 0),
                            key=lambda i: (corpus[i]["language"], corpus[i]["opt"], i))
    else:
        failed_ids = sorted((int(k) for k, v in ghidra.items() if v["comp"] == 0),
                            key=lambda i: (corpus[i]["language"], corpus[i]["opt"], i))
    step = max(1, len(failed_ids) // args.limit)
    sample = failed_ids[::step][: args.limit]
    print(f"funzioni Ghidra comp=0: {len(failed_ids)} | campione: {len(sample)}")

    prefix = retdec_batch(sample, args.workers)

    rows = []
    for i in sample:
        out_file = BUILD / f"{prefix}_{i}.c"
        raw = out_file.read_text(errors="replace") if out_file.exists() else ""
        cand = extract_candidate(raw, corpus[i]["func_name"], corpus[i]["language"]) if raw else ""
        rows.append({
            "id": str(i),
            "func_dep": corpus[i]["func_dep"],
            "candidate": cand,
            "test": corpus[i]["test"],
            "language": corpus[i]["language"],
            "opt": corpus[i]["opt"],
        })

    (REPORTS / "retdec_input.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
    )
    results = {r["id"]: r for r in eval_in_docker(rows, "retdec")}

    agg = defaultdict(lambda: {"n": 0, "exe": 0, "comp": 0, "empty": 0})
    for r in rows:
        res = results[r["id"]]
        for key in (f"{r['language']}/{r['opt']}", "TOTAL"):
            agg[key]["n"] += 1
            agg[key]["comp"] += res["comp"]
            agg[key]["exe"] += res["exe"]
        if not r["candidate"].strip():
            agg["TOTAL"]["empty"] += 1

    table = {}
    for key, v in sorted(agg.items()):
        lo, hi = wilson(v["exe"], v["n"])
        table[key] = {**v, "exe_rate": round(v["exe"] / v["n"], 4),
                      "comp_rate": round(v["comp"] / v["n"], 4),
                      "wilson95": [round(lo, 4), round(hi, 4)]}

    (REPORTS / "retdec_results.jsonl").write_text(
        "".join(json.dumps(results[r["id"]]) + "\n" for r in rows)
    )
    summary = {
        "scope": "funzioni dove il candidato Ghidra (run -g) NON compila",
        "sample": len(sample), "population": len(failed_ids),
        "retdec_results": table,
    }
    (REPORTS / "retdec_spike.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(table["TOTAL"], indent=1))
    print(f"report: {REPORTS / 'retdec_spike.json'}")


if __name__ == "__main__":
    main()
