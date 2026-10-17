#!/usr/bin/env python3
"""
revra_verify — the REVRA verification engine (self-contained, zero bind mounts).

Multi-engine decompilation (Ghidra 11.3.2 + RetDec 5.0 in the `revra-engine`
image), agentic repair with YOUR model (ADR-0003), judged by the official
Decompile-Bench execute_rate logic in the calibrated `revra-judge` image.

Transfer layer: every container interaction is `docker run --rm -i` with files
piped as tar on stdin and outputs read from stdout. No bind mounts (flaky on
OrbStack/macOS), no long-lived containers — fully portable by construction.

CLI:
  python3 revra_verify.py --binary app.so --symbol func [--test t.c]
                          [--link-lib app.so] [--repair] [--rounds 3]
                          [--out report.md] [--json result.json]
"""
import argparse
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import tarfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ENGINE_IMAGE = os.environ.get("REVRA_ENGINE_IMAGE", "revra-engine:0.1.0")
JUDGE_IMAGE = os.environ.get("REVRA_JUDGE_IMAGE", "revra-judge:0.1.0")
sys.path.insert(0, str(HERE))
from llm_adapter import chat, MODEL  # noqa: E402

SYSTEM = ("You are an expert reverse engineer repairing decompiled C/C++. "
          "The result must compile cleanly and reproduce the original binary's "
          "behavior exactly. Output only code.")


def docker_tar_exec(image: str, files: dict[str, bytes], script: str,
                    timeout: int = 1200) -> subprocess.CompletedProcess:
    """files -> tar -> stdin; script gira nel container con i file in /work;
    stdout/stderr tornano via pipe. Nessun bind mount."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tf:
        for name, data in files.items():
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
    res = subprocess.run(
        ["docker", "run", "--rm", "--platform", "linux/amd64", "-i", image,
         "bash", "-c", f"cd /tmp && tar xf - && ({script})"],
        input=buf.getvalue(), capture_output=True, timeout=timeout)
    return (res.stdout.decode(errors="replace"), res.stderr.decode(errors="replace"))


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def resolve_symbol(elf_name: str, elf_bytes: bytes, symbol: str) -> tuple[str | None, str]:
    script = ("nm --defined-only b.elf | awk '$2==\"T\"{print $1,$3}' | "
              "while read a n; do dn=$(echo $n | c++filt 2>/dev/null); "
              f"case $dn in *'{symbol}'*) echo $a '::' $dn; break;; esac; done")
    out, _ = docker_tar_exec(JUDGE_IMAGE, {"b.elf": elf_bytes}, script, timeout=300)
    for line in out.strip().splitlines():
        parts = line.split(" :: ", 1)
        if len(parts) == 2:
            return (parts[0].lstrip("0") or "0"), parts[1].strip()
    return None, symbol


def ghidra_draft(elf_name: str, elf_bytes: bytes, addr: str) -> str:
    ghidra_scripts = (HERE / "ghidra_scripts" / "decompile_at.py").read_bytes()
    files = {"b.elf": elf_bytes, "decompile_at.py": ghidra_scripts}
    script = ("mkdir -p /tmp/proj /tmp/scripts && cp decompile_at.py /tmp/scripts/ && "
              "JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 "
              "/opt/ghidra/support/analyzeHeadless /tmp/proj eng -import /tmp/b.elf "
              "-overwrite -scriptPath /tmp/scripts -postScript decompile_at.py "
              f"{addr} -deleteProject 2>&1")
    out, _ = docker_tar_exec(ENGINE_IMAGE, files, script, timeout=1200)
    if "REVRA_C_BEGIN" in out:
        body = out.split("REVRA_C_BEGIN", 1)[1]
        body = body.split("\n", 1)[1] if "\n" in body else ""
        return body.split("REVRA_C_END", 1)[0].strip()
    return ""


def retdec_draft(elf_name: str, elf_bytes: bytes) -> str:
    script = ("/opt/retdec/bin/retdec-decompiler -s -k /tmp/b.elf "
              "-o /tmp/retdec.c >/dev/null 2>&1 || true; cat /tmp/retdec.c 2>/dev/null")
    out, _ = docker_tar_exec(ENGINE_IMAGE, {"b.elf": elf_bytes}, script, timeout=1200)
    return strip_main(out.strip())


def strip_main(c_text: str) -> str:
    lines, out, i = c_text.split("\n"), [], 0
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


def compile_check(code: str, language: str, tag: str, test: str | None,
                  link_lib: bytes | None) -> tuple[bool, bool, str]:
    """Giudice nel container calibrated (gcc 11). Con link_lib, i simboli non
    definiti si risolvono dalla libreria originale. Senza test: compilabilita'
    come shared object (undefined refs ammesse) — la metrica del collo noto."""
    ext = "cpp" if language == "cpp" else "c"
    compiler = "g++" if language == "cpp" else "gcc"
    std = "-std=c++17 " if language == "cpp" else ""
    files = {f"attempt_{tag}.{ext}": (code + ("\n" + test if test else "\nint main(){return 0;}\n")).encode()}
    if test is None:
        mode = "-shared -fPIC"
        target = f"attempt_{tag}.so"
    else:
        mode = ""
        target = f"attempt_{tag}.bin"
    link = ""
    if link_lib:
        files["liborig.so"] = link_lib
        link = " -L/tmp -l:liborig.so"
    run_part = (f"LD_LIBRARY_PATH=/tmp ./{target} >/dev/null 2>&1 && ") if test is not None else ""
    script = (f"{compiler} -O0 {std}attempt_{tag}.{ext} -o {target} {mode}{link} "
              f"-lm -lcrypto -ldl -lpthread 2>&1 | tail -c 1200; "
              f"if [ -f {target} ]; then {run_part}echo RUN_RC=$?; "
              "else echo RUN_RC=nobin; fi")
    out, _ = docker_tar_exec(JUDGE_IMAGE, files, script, timeout=600)
    compiles = "RUN_RC=" in out and "error:" not in out and "undefined reference" not in out
    runs = "RUN_RC=0" in out
    return compiles, runs, (out[-1200:] if not compiles or not runs else "")


def extract_code(text: str) -> str:
    m = re.search(r"```[a-zA-Z]*\n(.*?)```", text, re.DOTALL)
    return (m.group(1) if m else text).strip()


def repair_loop(prompt: str, first_code: str, language: str, tag: str,
                test: str | None, link_lib: bytes | None, rounds: int,
                evidence: list) -> str:
    code, feedback = first_code, None
    for rnd in range(1, rounds + 1):
        compiles, runs, err = compile_check(code, language, f"{tag}_r{rnd}", test, link_lib)
        evidence.append({"round": rnd, "attempt": "repair", "model": MODEL,
                         "compiles": compiles, "runs": runs})
        if compiles and (runs or test is None):
            return code
        user = (prompt
                + f"\n\nCurrent attempt (compiles={compiles}, passes={runs}):\n{code}"
                + (f"\n\nCompiler/tool feedback:\n{err}" if err else
                   "\nNo compiler errors reported — check behavioral correctness "
                   "against the disassembly.")
                + "\n\nReturn the FULL corrected code. Code only.")
        try:
            code = extract_code(chat(SYSTEM, user, max_tokens=3500))
        except RuntimeError as e:
            evidence.append({"round": rnd, "error": str(e)[:200]})
            break
    return code


def main() -> None:
    ap = argparse.ArgumentParser(prog="revra-verify-engine")
    ap.add_argument("--binary", required=True, type=Path)
    ap.add_argument("--symbol", required=True)
    ap.add_argument("--language", choices=["c", "cpp", "auto"], default="auto")
    ap.add_argument("--test", type=Path)
    ap.add_argument("--link-lib", type=Path)
    ap.add_argument("--repair", action="store_true")
    ap.add_argument("--rounds", type=int, default=3)
    ap.add_argument("--out", type=Path, default=Path("revra-evidence-report.md"))
    ap.add_argument("--json", type=Path)
    args = ap.parse_args()

    elf_bytes = args.binary.read_bytes()
    digest = sha256_bytes(elf_bytes)
    test_txt = args.test.read_text() if args.test else None
    link_lib = args.link_lib.read_bytes() if args.link_lib else None

    ensure_ok = subprocess.run(["docker", "image", "inspect", ENGINE_IMAGE],
                               capture_output=True)
    if ensure_ok.returncode != 0:
        sys.exit(f"[setup] immagine {ENGINE_IMAGE} non disponibile. Esegui: revra setup")

    print(f"[1/4] symbol: {args.symbol}")
    addr, demangled = resolve_symbol("b.elf", elf_bytes, args.symbol)
    language = "cpp" if ("std::" in demangled or "::" in demangled) else (
        args.language if args.language != "auto" else "c")
    evidence = [{"step": "input", "sha256": digest, "symbol": args.symbol,
                 "demangled": demangled, "language": language,
                 "model": MODEL if args.repair else "none"}]
    if not addr:
        sys.exit(f"simbolo '{args.symbol}' non trovato tra i simboli T di {args.binary.name}")
    print(f"      {demangled} @ 0x{addr} [{language}]")

    print("[2/4] Ghidra 11.3.2 draft...")
    ghidra = ghidra_draft("b.elf", elf_bytes, addr)
    print("[3/4] RetDec 5.0 draft...")
    retdec = retdec_draft("b.elf", elf_bytes)
    evidence.append({"step": "draft", "engine": "ghidra-11.3.2", "chars": len(ghidra)})
    evidence.append({"step": "draft", "engine": "retdec-5.0", "chars": len(retdec)})

    final, rounds_used = None, 0
    comp = exe = None
    if args.repair:
        print(f"[4/4] repair ({MODEL}, ≤{args.rounds} round)...")
        prompt = (f"Function `{args.symbol}`, original signature: {demangled}.\n"
                  f"Draft from Ghidra:\n{ghidra or '(empty)'}\n"
                  f"Draft from RetDec:\n{retdec or '(empty)'}\n"
                  f"TASK: return ONE compilable {'C++' if language == 'cpp' else 'C'} "
                  "translation unit containing exactly:\n"
                  "1. the includes needed by the signature;\n"
                  f"2. the function `{args.symbol}` with the ORIGINAL signature types "
                  "(real types, never undefined8/int64_t-as-pointer);\n"
                  "3. no main(), no tests, no markdown fences, no extra functions.\n"
                  "Implement the exact behavior of the disassembly.")
        first = ghidra or retdec
        tag = f"{ts_tag()}"
        c0, r0, _ = compile_check(first, language, tag + "_draft", test_txt, link_lib)
        evidence.append({"round": 0, "attempt": "draft-best", "compiles": c0, "runs": r0})
        if c0 and (r0 or test_txt is None):
            final = first
        else:
            final = repair_loop(prompt, first, language, tag, test_txt,
                                link_lib, args.rounds, evidence)
            rounds_used = len([e for e in evidence if e.get("round", 0) >= 1
                               and e.get("attempt") == "repair"])
        comp, exe, _ = compile_check(final, language, tag + "_final", test_txt, link_lib)
        evidence.append({"step": "final", "compiles": comp, "runs": exe})

    def trunc(t, n=4000):
        return t if len(t) <= n else t[:n] + f"\n… [+{len(t)-n} chars]"

    report = [
        "# REVRA Evidence Report", "",
        f"- binary: `{args.binary.name}` sha256 `{digest[:16]}…`",
        f"- symbol: `{args.symbol}` — {demangled} @ 0x{addr}",
        "- engines: Ghidra 11.3.2 + RetDec 5.0 (containerized)"
        + (f", repair `{MODEL}`" if args.repair else ""),
        f"- drafts: ghidra {len(ghidra)} chars, retdec {len(retdec)} chars",
    ]
    if args.repair:
        report.append(f"- repair rounds: {rounds_used}")
    if comp is not None:
        report.append(f"- final candidate: compiles={comp}, passes={exe}")
    report += ["", "## Provenance (every attempt)", ""]
    report += [f"- `{json.dumps(e)}`" for e in evidence]
    report += ["", "## Ghidra draft (truncated)", "", "```c", trunc(ghidra) or "(empty)", "```",
               "", "## RetDec draft (truncated)", "", "```c", trunc(retdec) or "(empty)", "```"]
    if final:
        report += ["", "## Final candidate", "", "```c", final, "```"]
    report += ["", "---", "Lawful use required: owned copy, no output redistribution, "
               "no DRM circumvention. See the lawful-use documentation."]
    args.out.write_text("\n".join(report))
    if args.json:
        args.json.write_text(json.dumps({
            "symbol": args.symbol, "final": final or "",
            "compiles": comp, "passes": exe, "evidence": evidence}, indent=1))
    print(f"report: {args.out}")


def ts_tag() -> str:
    return str(int(time.time()))


if __name__ == "__main__":
    main()
