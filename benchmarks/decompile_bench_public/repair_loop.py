#!/usr/bin/env python3
"""
P2 — Repair loop (pattern decomp.wtf, giudice re-executability nostro).

Protocollo A (single-shot, comparabile leaderboard): UNA chiamata LLM con
asm + dependencies + draft (Ghidra/RetDec) + errori di compilazione del draft.
MAI il contenuto/risultato dei test.

Protocollo B (agentic): fino a 4 round; feedback = stderr del compilatore e
esito dei test (pass/fail, non il sorgente dei test).

Giudice: execute_rate ufficiale (verbatim) in container persistente.
Ogni tentativo è registrato in evidence.jsonl (ADR-0003: model/protocol nei metadata).

Uso: python3 repair_loop.py --protocol A|B --limit 100 [--workers 4]
Output: reports/repair_{P}/candidates.jsonl, results.jsonl, evidence.jsonl, summary.json
"""
import argparse
import json
import os
import re
import subprocess
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from baseline_official import wilson, eval_in_docker
import llm_adapter as llm

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
REPORTS = HERE / "reports"
BUILD = DATA / "build_g"
CONTAINER = "revra_repair"
MAX_ROUNDS_B = 4
TAG = os.environ.get("REVRA_TAG", "revra")


def ensure_container() -> None:
    subprocess.run(["docker", "rm", "-f", CONTAINER], capture_output=True)
    subprocess.run(
        ["docker", "run", "-d", "--platform", "linux/amd64", "--name", CONTAINER,
         "-v", f"{HERE}:/bench", "-w", "/bench", "revra-dbench-eval", "sleep", "infinity"],
        check=True, capture_output=True,
    )
    # cal_execute_rate importabile
    subprocess.run(["docker", "exec", CONTAINER, "mkdir", "-p", "/bench/reports/repair_tmp"],
                   check=True, capture_output=True)


def judge(func_dep: str, cand: str, test: str, language: str) -> tuple[int, int, str]:
    """Giudizio ufficiale in container. Ritorna (comp, exe, stderr_tail)."""
    tag = f"j_{time.time_ns()}"
    args_file = REPORTS / "repair_tmp" / f"{tag}.json"
    args_file.write_text(json.dumps(
        {"func_dep": func_dep, "candidate": cand, "test": test, "language": language}))
    script = (
        "import json,sys\n"
        "sys.path.insert(0,'/bench')\n"
        "from cal_execute_rate import execute_rate\n"
        f"a=json.load(open('/bench/reports/repair_tmp/{tag}.json'))\n"
        "c,e=execute_rate(a['func_dep'],a['candidate'],a['test'],timeout=10,"
        "language=a['language'],opt='-O0')\n"
        "print(json.dumps({'comp':c,'exe':e}))\n"
    )
    proc = subprocess.run(["docker", "exec", CONTAINER, "python3", "-c", script],
                          capture_output=True, text=True, timeout=120)
    args_file.unlink(missing_ok=True)
    try:
        out = json.loads(proc.stdout.strip().splitlines()[-1])
        return out["comp"], out["exe"], proc.stderr[-800:]
    except (json.JSONDecodeError, IndexError, KeyError):
        return 0, 0, proc.stderr[-800:]


def extract_code(text: str) -> str:
    """Rimuove fence markdown se presenti; ritorna il corpo."""
    text = text.strip()
    m = re.search(r"```[a-zA-Z]*\n(.*?)```", text, re.DOTALL)
    if m:
        return m.group(1).strip()
    return text


def build_prompt(row: dict, drafts: dict, feedback: str | None) -> str:
    lang = "C++" if row["language"] == "cpp" else "C"
    parts = [
        f"Target function: `{row['func_name']}` (g++, linux x86-64, optimization {row['opt']})",
        f"Original disassembly:\n{row['asm']}",
        f"Available includes/dependencies (already provided in the build):\n{row['func_dep']}",
        f"Draft from Ghidra headless:\n{drafts.get('ghidra') or '(empty)'}",
        f"Draft from RetDec:\n{drafts.get('retdec') or '(empty)'}",
    ]
    if feedback:
        parts.append(f"Feedback on the previous attempt:\n{feedback}")
    parts.append(
        f"Task: output ONE function named `{row['func_name']}` in {lang} that compiles "
        "with the given dependencies and implements exactly the behavior of the "
        "disassembly. Requirements:\n"
        "- Output ONLY code (no markdown fences, no main(), no test code).\n"
        "- Match the exact signature implied by the symbol in the disassembly.\n"
        "- Replace decompiler artifacts (undefined8, int64_t used as pointer, "
        "DAT_/LAB_ labels) with real types from the dependencies."
    )
    return "\n\n".join(parts)


SYSTEM = ("You are an expert reverse engineer repairing decompiled C/C++. "
          "The result must compile cleanly and reproduce the original binary's "
          "behavior exactly. Be precise; do not invent library functions.")


def repair_one(task: tuple) -> dict:
    pid, row, drafts, protocol = task
    evidence = []
    cand = drafts.get("ghidra") or drafts.get("retdec") or ""
    comp, exe, err = judge(row["func_dep"], cand, row["test"], row["language"])
    evidence.append({"round": 0, "source": "draft", "comp": comp, "exe": exe})
    if exe:
        return {"id": pid, "final": cand, "rounds": 0, "solved_by": "draft", "evidence": evidence}

    feedback = None
    if comp == 0 and drafts.get("ghidra") and drafts.get("retdec") is not None:
        feedback = f"Ghidra draft does not compile. Compiler output (tail):\n{err}"

    rounds = 0
    best = cand
    while (protocol == "A" and rounds < 1) or (protocol == "B" and rounds < MAX_ROUNDS_B):
        rounds += 1
        try:
            text = llm.chat(SYSTEM, build_prompt(row, drafts, feedback), max_tokens=3500)
        except RuntimeError as e:
            evidence.append({"round": rounds, "error": str(e)[:200]})
            break
        cand = extract_code(text)
        if not cand.strip():
            feedback = "Empty output. Produce the function code only."
            continue
        comp, exe, err = judge(row["func_dep"], cand, row["test"], row["language"])
        evidence.append({"round": rounds, "comp": comp, "exe": exe})
        best = cand
        if exe:
            break
        feedback = (
            f"Compiler output (tail):\n{err}" if comp == 0
            else "The code compiles but FAILS the behavior tests: the produced binary "
                 "exits nonzero or an assertion fires. The logic differs from the "
                 "disassembly. Re-check control flow, return values, and edge cases."
        )

    return {"id": pid, "final": best, "rounds": rounds,
            "solved_by": "repair" if evidence[-1].get("exe") else "unsolved",
            "evidence": evidence}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--protocol", choices=["A", "B"], required=True)
    ap.add_argument("--limit", type=int, default=100)
    ap.add_argument("--workers", type=int, default=4)
    args = ap.parse_args()

    REPORTS.mkdir(exist_ok=True)
    (REPORTS / "repair_tmp").mkdir(exist_ok=True)
    corpus = json.loads((DATA / os.environ.get("DBENCH_CORPUS", "humaneval-decompile.json")).read_text())
    ghidra_res = {json.loads(l)["id"]: json.loads(l) for l in
                  (REPORTS / f"{TAG}_results.jsonl").read_text().splitlines() if l.strip()}
    ghidra_cand = {json.loads(l)["id"]: json.loads(l)["candidate"] for l in
                   (REPORTS / f"{TAG}_input.jsonl").read_text().splitlines() if l.strip()}
    retdec_file = REPORTS / "retdec_input.jsonl"
    retdec_cand = ({json.loads(l)["id"]: json.loads(l)["candidate"]
                    for l in retdec_file.read_text().splitlines() if l.strip()}
                   if retdec_file.exists() else {})

    failed = sorted((int(k) for k, v in ghidra_res.items() if v["exe"] == 0),
                    key=lambda i: (corpus[i]["language"], corpus[i]["opt"], i))
    step = max(1, len(failed) // args.limit)
    sample = failed[::step][: args.limit]
    print(f"popolazione Ghidra exe=0: {len(failed)} | campione: {len(sample)}")

    ensure_container()
    out_dir = REPORTS / f"repair_{args.protocol}"
    out_dir.mkdir(exist_ok=True)

    tasks = []
    for i in sample:
        s = corpus[i]
        row = {"func_name": s["func_name"], "asm": s["asm"], "func_dep": s["func_dep"],
               "test": s["test"], "language": s["language"], "opt": s["opt"]}
        drafts = {"ghidra": ghidra_cand.get(str(i), ""), "retdec": retdec_cand.get(str(i), "")}
        tasks.append((str(i), row, drafts, args.protocol))

    t0 = time.time()
    out_dir = REPORTS / f"repair_{args.protocol}"
    out_dir.mkdir(exist_ok=True)
    cand_file = out_dir / "candidates.jsonl"
    ev_file = out_dir / "evidence.jsonl"
    results_file = out_dir / "results.jsonl"

    # resume: gli id già completati non si rifanno
    done: dict[str, dict] = {}
    if cand_file.exists():
        for l in cand_file.read_text().splitlines():
            if l.strip():
                r = json.loads(l)
                done[r["id"]] = r
    todo_tasks = [t for t in tasks if t[0] not in done]
    print(f"resume: {len(done)} già completati, {len(todo_tasks)} da eseguire")

    write_lock = threading.Lock()
    completed: dict[str, dict] = {}

    def run_one(task: tuple) -> None:
        r = repair_one(task)
        with write_lock:
            completed[r["id"]] = r
            with open(cand_file, "a") as f:
                f.write(json.dumps({"id": r["id"], "candidate": r["final"]},
                                   ensure_ascii=False) + "\n")
            with open(ev_file, "a") as f:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        if len(completed) % 25 == 0:
            print(f"[{args.protocol} {len(done) + len(completed)}/{len(sample)}]", flush=True)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(run_one, todo_tasks))
    elapsed = time.time() - t0

    all_results = {**{k: v for k, v in done.items()}, **completed}
    results = [all_results[str(i)] for i in sample if str(i) in all_results]

    rows = [{
        "id": r["id"],
        "func_dep": corpus[int(r["id"])]["func_dep"],
        "candidate": r["final"],
        "test": corpus[int(r["id"])]["test"],
        "language": corpus[int(r["id"])]["language"],
        "opt": corpus[int(r["id"])]["opt"],
    } for r in results]
    results_j = {x["id"]: x for x in eval_in_docker(rows, f"repair_{args.protocol}")}

    agg = defaultdict(lambda: {"n": 0, "exe": 0, "comp": 0})
    for r in rows:
        res = results_j[r["id"]]
        for key in (f"{r['language']}", "TOTAL"):
            agg[key]["n"] += 1
            agg[key]["comp"] += res["comp"]
            agg[key]["exe"] += res["exe"]
    table = {}
    for key, v in sorted(agg.items()):
        lo, hi = wilson(v["exe"], v["n"])
        table[key] = {**v, "exe_rate": round(v["exe"] / v["n"], 4),
                      "wilson95": [round(lo, 4), round(hi, 4)]}

    # confronto diretto: stesso campione, baseline
    base_exe = sum(1 for r in rows if ghidra_res[r["id"]]["exe"])
    summary = {
        "protocol": args.protocol, "model": llm.MODEL,
        "sample": len(rows),
        "ghidra_exe_on_sample": base_exe,
        "repair_exe": table["TOTAL"]["exe"],
        "repair_exe_rate": table["TOTAL"]["exe_rate"],
        "repair_wilson95": table["TOTAL"]["wilson95"],
        "by_language": {k: v for k, v in table.items() if k != "TOTAL"},
        "elapsed_s": round(elapsed), "max_rounds": MAX_ROUNDS_B if args.protocol == "B" else 1,
    }
    (out_dir / "results.jsonl").write_text(
        "".join(json.dumps(results_j[r["id"]]) + "\n" for r in rows))
    (out_dir / "summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps(summary, indent=1))

    subprocess.run(["docker", "rm", "-f", CONTAINER], capture_output=True)


if __name__ == "__main__":
    main()
