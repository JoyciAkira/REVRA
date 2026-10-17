#!/usr/bin/env python3
"""
revra-verify — one command: multi-engine decompilation drafts → compile check →
optional agentic repair (BYOM) → evidence report.

USAGE:
  python3 revra-verify.py --binary game.elf --symbol func_name [--test harness.c]
                          [--out report.md] [--repair] [--rounds 3]

REQUIRES (see README): docker (linux/amd64 image `revra-dbench-eval`, built by
benchmarks/decompile_bench_public/setup.sh), Ghidra 11.3.2 at ~/.local/retdec/../
ghidra_11.3.2_PUBLIC (GHIDRA_HOME env overrides), RetDec v5.0 Linux release at
benchmarks/decompile_bench_public/data/retdec. Model via env (ADR-0003).

Every attempt is recorded in the evidence report (model/tool, round, outcome).
"""
import argparse
import hashlib
import json
import os
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
BENCH = HERE / "benchmarks" / "decompile_bench_public"
GHIDRA_SCRIPTS = BENCH / "ghidra_scripts"
RETDEC_DATA = BENCH / "data" / "retdec"
GHIDRA = Path(os.environ.get(
    "GHIDRA_HOME",
    Path.home() / ".local" / "ghidra_11.3.2_PUBLIC")) / "support" / "analyzeHeadless"
JAVA_HOME = Path("/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home")
WORK = HERE / ".revra-verify"

sys.path.insert(0, str(BENCH))
from llm_adapter import chat, MODEL  # noqa: E402


def sh(cmd: list[str], timeout: int = 600, **kw) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, **kw)


def sha256_file(p: Path) -> str:
    h = hashlib.sha256()
    h.update(p.read_bytes())
    return h.hexdigest()


def resolve_symbol(elf: Path, symbol: str) -> tuple[str | None, str]:
    """(indirizzo hex, nome demangled) via nm+c++filt nel container."""
    script = (
        f"nm --defined-only {elf.name} | awk '$2==\"T\"{{print $1,$3}}' | "
        "while read a n; do dn=$(echo $n | c++filt 2>/dev/null); "
        f"case $dn in *'{symbol}'*) echo $a '::' $dn; break;; esac; done"
    )
    proc = sh(["docker", "run", "--rm", "--platform", "linux/amd64",
               "-v", f"{elf.parent}:/work:ro", "revra-dbench-eval",
               "bash", "-c", f"cd /work && {script}"])
    for line in proc.stdout.strip().splitlines():
        if "::" in line or " " in line:
            parts = line.split(" :: ", 1)
            if len(parts) == 2:
                return (parts[0].lstrip("0") or "0"), parts[1].strip()
    return None, symbol


ENGINE_IMAGE = os.environ.get("REVRA_ENGINE_IMAGE", "revra-engine:0.1.0")
ENGINE_CONTAINER = "revra_engine_cli"


def ensure_engine(workdir: Path) -> bool:
    """Container engine long-lived; ritorna False se l'immagine non c'e' (fallback locale)."""
    subprocess.run(["docker", "rm", "-f", ENGINE_CONTAINER], capture_output=True)
    proc = subprocess.run(["docker", "run", "-d", "--platform", "linux/amd64",
                           "--name", ENGINE_CONTAINER, "-v", f"{workdir}:/work",
                           ENGINE_IMAGE, "sleep", "infinity"], capture_output=True, text=True)
    if proc.returncode != 0:
        print(f"[engine] immagine {ENGINE_IMAGE} non disponibile: uso installazioni locali")
        return False
    return True


def ghidra_draft(elf: Path, addr: str, workdir: Path, ts: int, engine: bool) -> str:
    out_c = workdir / f"ghidra_draft_{ts}.c"
    if engine:
        script = ("mkdir -p /work/ghproj && JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 "
                  "/opt/ghidra/support/analyzeHeadless /work/ghproj eng -import "
                  f"/work/{elf.name} -overwrite -scriptPath /opt/revra-scripts "
                  f"-postScript decompile_at.py {addr} -deleteProject 2>&1")
        out = subprocess.run(["docker", "exec", ENGINE_CONTAINER, "bash", "-c", script],
                             capture_output=True, text=True, timeout=900).stdout + \
             subprocess.run(["docker", "exec", ENGINE_CONTAINER, "bash", "-c",
                             f"cat /work/{out_c.name} 2>/dev/null || true"],
                            capture_output=True, text=True).stdout
        if out_c.exists():
            return out_c.read_text(errors="replace").strip()
        if "REVRA_C_BEGIN" in out:
            body = out.split("REVRA_C_BEGIN", 1)[1]
            body = body.split("\n", 1)[1] if "\n" in body else ""
            return body.split("REVRA_C_END", 1)[0].strip()
        return ""
    proj = workdir / "ghidra_proj"
    proj.mkdir(exist_ok=True)
    proc = sh([
        str(GHIDRA), str(project_dir(proj)), f"rv_{int(time.time())}",
        "-import", str(elf), "-overwrite",
        "-scriptPath", str(GHIDRA_SCRIPTS),
        "-postScript", "decompile_at.py", addr,
        "-deleteProject",
    ], env={**os.environ, "JAVA_HOME": str(JAVA_HOME)})
    out = proc.stdout + proc.stderr
    if out_c.exists():
        return out_c.read_text(errors="replace").strip()
    if "REVRA_C_BEGIN" in out:
        body = out.split("REVRA_C_BEGIN", 1)[1]
        body = body.split("\n", 1)[1] if "\n" in body else ""
        return body.split("REVRA_C_END", 1)[0].strip()
    return ""


def project_dir(proj: Path) -> Path:
    return proj


def strip_main(c_text: str) -> str:
    """Rimuove la definizione di main() dall'output RetDec (brace matching)."""
    lines = c_text.split("\n")
    out, i = [], 0
    while i < len(lines):
        if lines[i].lstrip().startswith(("int main(", "void main(", "signed main(")):
            depth, started = 0, False
            while i < len(lines):
                depth += lines[i].count("{") - lines[i].count("}")
                if "{" in lines[i]:
                    started = True
                i += 1
                if started and depth <= 0:
                    break
            continue
        out.append(lines[i])
        i += 1
    return "\n".join(out)


def retdec_draft(elf: Path, symbol: str, workdir: Path, ts: int, engine: bool) -> str:
    out_c = workdir / f"retdec_draft_{ts}.c"
    if engine:
        subprocess.run(["docker", "exec", ENGINE_CONTAINER, "bash", "-c",
                        f"/opt/retdec/bin/retdec-decompiler -s -k /work/{elf.name} "
                        f"-o /work/{out_c.name} >/dev/null 2>&1 || true"],
                       capture_output=True, timeout=600)
        if out_c.exists():
            return strip_main(out_c.read_text(errors="replace"))
        return ""
    sh(["docker", "run", "--rm", "--platform", "linux/amd64",
        "-v", f"{RETDEC_DATA}:/retdec:ro", "-v", f"{workdir}:/work",
        "revra-dbench-eval", "bash", "-c",
        f"/retdec/bin/retdec-decompiler -s -k /work/{elf.name} "
        f"-o /work/{out_c.name} >/dev/null 2>&1 || true"])
    if out_c.exists():
        return strip_main(out_c.read_text(errors="replace"))
    return ""


def compile_check(code: str, language: str, workdir: Path, ts: int, test: str | None = None, rnd: int = 0) -> tuple[bool, bool, str]:
    """Compila nel container (link completo, main stub se niente test).
    Dir calda (long-lived): le dir appena create lato host
    arrivano vuote nei container OrbStack.
    Ritorna (compiles, runs, stderr_tail)."""
    ext = "cpp" if language == "cpp" else "c"
    compiler = "g++" if language == "cpp" else "gcc"
    std = "-std=c++17 " if language == "cpp" else ""
    src = workdir / f"attempt_{ts}_{rnd}.{ext}"
    src.write_text(code + ("\n" + test if test else "\nint main(){return 0;}\n"))
    binp = src.with_suffix(".bin")
    binp.unlink(missing_ok=True)
    run_stmt = f"./{binp.name} >/dev/null 2>&1 && " if test is not None else ""
    proc = sh(["docker", "run", "--rm", "--platform", "linux/amd64",
               "-v", f"{workdir}:/work", "revra-dbench-eval", "bash", "-c",
               f"cd /work && {compiler} -O0 {std}{src.name} -o {binp.name} "
               f"-lm -lcrypto 2>&1 | tail -c 1200; "
               f"if [ -f {binp.name} ]; then {run_stmt}echo RUN_RC=$?; "
               "else echo RUN_RC=nobin; fi"])
    out = proc.stdout
    compiles = "RUN_RC=" in out and "error:" not in out
    runs = "RUN_RC=0" in out
    return compiles, runs, (out[-1200:] if not compiles or not runs else "")


SYSTEM = ("You are an expert reverse engineer repairing decompiled C/C++. "
          "The result must compile cleanly and reproduce the original binary's "
          "behavior exactly. Output only code.")


def repair_loop(prompt_base: str, first_code: str, language: str,
                workdir: Path, ts: int, test: str | None, rounds: int, evidence: list) -> str:
    code, feedback = first_code, None
    for rnd in range(1, rounds + 1):
        compiles, runs, err = compile_check(code, language, workdir, ts, test, rnd)
        evidence.append({"round": rnd, "attempt": "repair", "model": MODEL,
                         "compiles": compiles, "runs": runs})
        if compiles and (runs or test is None):
            return code
        user = (prompt_base
                + f"\n\nCurrent attempt (compiles={compiles}, passes={runs}):\n{code}"
                + (f"\n\nCompiler/tool feedback:\n{err}" if err else "\nNo compiler errors reported — "
                   "check behavioral correctness against the disassembly.")
                + "\n\nReturn the FULL corrected function/file. Code only.")
        try:
            code = extract_code(chat(SYSTEM, user, max_tokens=3500))
        except RuntimeError as e:
            evidence.append({"round": rnd, "error": str(e)[:200]})
            break
    return code


def extract_code(text: str) -> str:
    import re
    m = re.search(r"```[a-zA-Z]*\n(.*?)```", text, re.DOTALL)
    return (m.group(1) if m else text).strip()


def main() -> None:
    ap = argparse.ArgumentParser(prog="revra-verify")
    ap.add_argument("--binary", required=True, type=Path)
    ap.add_argument("--symbol", required=True)
    ap.add_argument("--language", choices=["c", "cpp", "auto"], default="auto")
    ap.add_argument("--test", type=Path, help="optional test harness (defines main)")
    ap.add_argument("--repair", action="store_true", help="enable agentic repair (BYOM)")
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--out", type=Path, default=Path("revra-evidence-report.md"))
    args = ap.parse_args()

    if not args.binary.exists():
        sys.exit(f"binary non trovato: {args.binary}")
    WORK = BENCH / "reports" / "repair_tmp"  # dir calda: unica con visibilita' bidirezionale garantita
    WORK.mkdir(exist_ok=True)
    ts = int(time.time())
    elf = WORK / f"verify_{ts}.elf"
    elf.write_bytes(args.binary.read_bytes())

    digest = sha256_file(elf)
    evidence: list = [{"step": "input", "binary_sha256": digest,
                       "symbol": args.symbol, "model": MODEL if args.repair else "none"}]

    print(f"[1/4] symbol resolution: {args.symbol}")
    addr, demangled = resolve_symbol(elf, args.symbol)
    evidence.append({"step": "symbol", "resolved": bool(addr), "address": addr,
                     "demangled": demangled})
    if not addr:
        sys.exit(f"simbolo '{args.symbol}' non trovato (exported T) in {elf.name}")
    language = ("cpp" if ("std::" in demangled or "::" in demangled)
                else (args.language if args.language != "auto" else "c"))
    evidence.append({"step": "language", "detected": language})
    engine = ensure_engine(WORK)

    print("[2/4] Ghidra headless draft...")
    t0 = time.time()
    ghidra = ghidra_draft(elf, addr, WORK, ts, engine)
    evidence.append({"step": "draft", "engine": "ghidra-11.3.2",
                     "chars": len(ghidra), "seconds": round(time.time() - t0, 1)})

    print("[3/4] RetDec draft...")
    t0 = time.time()
    retdec = retdec_draft(elf, args.symbol, WORK, ts, engine)
    evidence.append({"step": "draft", "engine": "retdec-5.0",
                     "chars": len(retdec), "seconds": round(time.time() - t0, 1)})

    final, repair_meta = None, {"enabled": args.repair, "rounds": 0}
    if args.repair:
        print("[4/4] agentic repair (BYOM)...")
        prompt = (f"Function `{args.symbol}`, original signature: {demangled}.\n"
                  f"Draft from Ghidra:\n{ghidra or '(empty)'}\n"
                  f"Draft from RetDec:\n{retdec or '(empty)'}\n"
                  f"TASK: return ONE compilable {'C++' if language == 'cpp' else 'C'} "
                  "translation unit containing exactly:\n"
                  "1. the includes needed by the signature (e.g. <vector>, <string>, <cstdint>);\n"
                  f"2. the function `{args.symbol}` with the ORIGINAL signature types "
                  "(use real C++ types from the signature, never undefined8/int64_t-as-pointer);\n"
                  "3. no main(), no tests, no markdown fences, no extra functions.\n"
                  "Implement the exact behavior of the disassembly.")
        test_txt = args.test.read_text() if args.test else None
        final = repair_loop(prompt, ghidra or retdec, language,
                            WORK, ts, test_txt, args.rounds, evidence)
        repair_meta["rounds"] = len([e for e in evidence if e.get("attempt") == "repair"])

    # ---- evidence report (markdown) ----
    lines = [
        "# REVRA Evidence Report",
        "",
        f"- binary: `{args.binary.name}` sha256 `{digest[:16]}…`",
        f"- symbol: `{args.symbol}` @ 0x{addr}" if addr else f"- symbol: `{args.symbol}`",
        f"- engines: Ghidra 11.3.2, RetDec 5.0 (container: {engine})" + (f", repair model `{MODEL}`" if args.repair else ""),
        f"- drafts: ghidra {len(ghidra)} chars, retdec {len(retdec)} chars",
    ]
    if args.repair:
        lines.append(f"- repair rounds: {repair_meta['rounds']}")
    lines += ["", "## Provenance (every attempt)", ""]
    lines += [f"- `{json.dumps(e)}`" for e in evidence]
    lines += ["", "## Ghidra draft", "", "```c", ghidra or "(empty)", "```",
              "", "## RetDec draft", "", "```c", retdec or "(empty)", "```"]
    if final:
        lines += ["", "## Final (repaired) code", "", "```c", final, "```"]
    lines += ["", "---", "Lawful use required: analyzed copy owned, no redistribution "
              "of output, no DRM circumvention. See docs/legal/lawful-use.md."]
    args.out.write_text("\n".join(lines))
    print(f"report: {args.out}")


if __name__ == "__main__":
    main()
