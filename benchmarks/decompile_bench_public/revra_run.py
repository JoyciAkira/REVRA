#!/usr/bin/env python3
"""
Pipeline REVRA sul benchmark pubblico (protocollo ufficiale LLM4Binary):

 1. Ricostruisce i binari dal corpus (stessa toolchain del protocollo, container
    linux/amd64: gcc/g++ -O{opt} — i binari NON sono strip: come nel corpus
    originale il simbolo della funzione target resta risolvibile).
 2. Risolve l'indirizzo del simbolo target (nm + c++filt).
 3. Decompila con Ghidra headless (il motore REALE disponibile a REVRA,
    ~/.local/ghidra) -> candidato C.
 4. Valuta i candidati con l'harness ufficiale (eval_candidates.py).

Nota onesta: REVRA oggi non ha un decompilatore proprietario funzionante (il
CalibratedNeuralProposer produce stub e lo StructuralRuleVerifier controlla
solo le parentesi bilanciate). Il numero REVRA su questo benchmark e' quindi
il numero del suo motore di decompilazione reale: Ghidra headless.

Uso: python3 revra_run.py [--limit N] [--stride N] [--skip-ghidra]
Output: reports/ {TAG}_candidates.jsonl, reports/revra_results.jsonl,
        reports/ {TAG}_summary.json
"""
import argparse
import json
import os
import subprocess
from collections import defaultdict
from pathlib import Path

from baseline_official import wilson, eval_in_docker

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
REPORTS = HERE / "reports"
# Variabili d'ambiente per esperimenti A/B (es. -g/DWARF) senza toccare la run principale:
#   REVRA_BUILD_SUFFIX  suffisso dir build (es. "_g" -> data/build_g)
#   REVRA_EXTRA_FLAGS   flag extra di compilazione (es. "-g")
#   REVRA_TAG           prefisso file output in reports/ (default "revra")
BUILD = DATA / f"build{os.environ.get('REVRA_BUILD_SUFFIX', '')}"
EXTRA_FLAGS = os.environ.get("REVRA_EXTRA_FLAGS", "")
TAG = os.environ.get("REVRA_TAG", "revra")
GHIDRA = Path.home() / ".local" / "ghidra_11.3.2_PUBLIC" / "support" / "analyzeHeadless"
JAVA_HOME = Path("/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home")


def step_build_and_symbols(corpus: list[dict]) -> list[dict | None]:
    """Compila tutte le funzioni nel container e ritorna gli indirizzi simbolo."""
    BUILD.mkdir(parents=True, exist_ok=True)
    for i, s in enumerate(corpus):
        # stub main: le funzioni del corpus sono standalone; il simbolo target
        # resta globale e viene emesso, quindi risolvibile con nm e decompilabile.
        src = s["func_dep"] + "\n" + s["func"] + "\nint main(){return 0;}\n"
        (BUILD / f"{i}.src.{s['language']}").write_text(src)

    # Compilazione (batch singolo, parallelo nel container, idempotente su .elf)
    cmds = []
    for i, s in enumerate(corpus):
        c = (
            f"g++ {EXTRA_FLAGS} -{s['opt']} -std=c++17 {i}.src.cpp -o {i}.elf -lm -lcrypto"
            if s["language"] == "cpp"
            else f"gcc {EXTRA_FLAGS} -{s['opt']} {i}.src.c -o {i}.elf -lm"
        )
        cmds.append(f"( [ -f {i}.elf ] || {c} || echo {i} >> /work/build/failures.txt )")
    (BUILD / "cmds.txt").write_text("\n".join(cmds) + "\n")
    cworkers = os.environ.get("DBENCH_WORKERS", "8")
    script = (
        f"cd /work/build && rm -f failures.txt && "
        f"xargs -P {cworkers} -I {{}} bash -c {{}} < cmds.txt"
    )
    subprocess.run(
        ["docker", "run", "--rm", "--platform", "linux/amd64",
         "-v", f"{BUILD}:/work/build", "revra-dbench-eval", "bash", "-c", script],
        check=True, capture_output=True, text=True,
    )
    failed = set()
    ffile = BUILD / "failures.txt"
    if ffile.exists():
        failed = {l.strip() for l in ffile.read_text().splitlines() if l.strip()}

    # Risoluzione indirizzi: script su file (una riga-comando come argomento di
    # bash -c supererebbe MAX_ARG_STRLEN con 1312 righe)
    resolve_lines = [
        f"echo RES_{i}; nm --defined-only {i}.elf 2>/dev/null | awk '$2==\"T\"{{print $1,$3}}' | "
        f"while read a n; do dn=$(echo $n | c++filt 2>/dev/null); "
        f"case $dn in *'{s['func_name']}'*) echo ADDR_$a; break;; esac; done"
        for i, s in enumerate(corpus)
        if str(i) not in failed
    ]
    (BUILD / "resolve.sh").write_text(
        "#!/bin/bash\ncd /work/build\n" + "\n".join(resolve_lines) + "\n"
    )
    proc = subprocess.run(
        ["docker", "run", "--rm", "--platform", "linux/amd64",
         "-v", f"{BUILD}:/work/build:ro", "revra-dbench-eval", "bash", "/work/build/resolve.sh"],
        check=True, capture_output=True, text=True,
    )
    addrs: dict[int, str] = {}
    current = None
    for line in proc.stdout.splitlines():
        if line.startswith("RES_"):
            current = int(line[4:])
        elif line.startswith("ADDR_") and current is not None:
            addrs[current] = line[5:].lstrip("0") or "0"
    return [addrs.get(i) for i in range(len(corpus))]


def _ghidra_one(task: tuple[int, dict, object, object]) -> tuple[int, str]:
    i, s, elf, addr = task
    if not addr or not elf.exists():
        return i, ""
    proc = subprocess.run(
        [
            str(GHIDRA), str(BUILD / "ghidra_proj"), f"dbench_{i}",
            "-import", str(elf), "-overwrite",
            "-scriptPath", str(HERE / "ghidra_scripts"),
            "-postScript", "decompile_at.py", addr,
            "-deleteProject",
        ],
        capture_output=True, text=True, timeout=600,
        env={**os.environ, "JAVA_HOME": str(JAVA_HOME)},
    )
    out = proc.stdout + proc.stderr
    candidate = ""
    if "REVRA_C_BEGIN" in out:
        body = out.split("REVRA_C_BEGIN", 1)[1]
        body = body.split("\n", 1)[1] if "\n" in body else ""
        candidate = body.split("REVRA_C_END", 1)[0].strip()
    return i, candidate


def step_ghidra(corpus: list[dict], addrs: list) -> list[str]:
    """Ghidra headless (parallelo) per ogni binario; ritorna i candidati C."""
    (BUILD / "ghidra_proj").mkdir(parents=True, exist_ok=True)
    tasks = [(i, s, BUILD / f"{i}.elf", a) for i, (s, a) in enumerate(zip(corpus, addrs))]
    candidates = [""] * len(corpus)
    workers = int(os.environ.get("GHIDRA_WORKERS", "4"))
    done = 0
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for i, cand in pool.map(_ghidra_one, tasks):
            candidates[i] = cand
            done += 1
            if done % 50 == 0:
                print(f"[ghidra {done}/{len(corpus)}]", flush=True)
    return candidates


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--stride", type=int, default=1)
    ap.add_argument("--skip-ghidra", action="store_true",
                    help=" riusa reports/{TAG}_candidates.jsonl esistente")
    args = ap.parse_args()

    REPORTS.mkdir(exist_ok=True)
    corpus = json.loads((DATA / os.environ.get("DBENCH_CORPUS", "humaneval-decompile.json")).read_text())
    if args.stride > 1:
        corpus = corpus[:: args.stride]
    if args.limit:
        corpus = corpus[: args.limit]
    print(f"righe: {len(corpus)}")

    cand_file = REPORTS / f"{TAG}_candidates.jsonl"
    if args.skip_ghidra and cand_file.exists():
        candidates = [json.loads(l)["candidate"] for l in cand_file.read_text().splitlines() if l.strip()]
    else:
        addrs = step_build_and_symbols(corpus)
        resolved = sum(1 for a in addrs if a)
        print(f"simboli risolti: {resolved}/{len(corpus)}")
        candidates = step_ghidra(corpus, addrs)
        cand_file.write_text(
            "".join(json.dumps({"id": str(i), "candidate": c}, ensure_ascii=False) + "\n"
                    for i, c in enumerate(candidates))
        )

    rows = [
        {
            "id": str(i),
            "func_dep": s["func_dep"],
            "candidate": candidates[i],
            "test": s["test"],
            "language": s["language"],
            "opt": s["opt"],
        }
        for i, s in enumerate(corpus)
    ]
    (REPORTS / f"{TAG}_input.jsonl").write_text(
        "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
    )
    results = {r["id"]: r for r in eval_in_docker(rows, TAG)}

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
                      "wilson95": [round(lo, 4), round(hi, 4)]}
    (REPORTS / f"{TAG}_summary.json").write_text(json.dumps(table, indent=2))
    print("\n== REVRA (ghidra headless) ==")
    for key in ("c/O0", "c/O1", "c/O2", "c/O3", "cpp/O0", "cpp/O1", "cpp/O2", "cpp/O3", "TOTAL"):
        if key in table:
            t = table[key]
            print(f"  {key:8s} {t['exe']}/{t['n']} = {t['exe_rate']*100:.2f}%  CI95 {t['wilson95']}")


if __name__ == "__main__":
    main()
