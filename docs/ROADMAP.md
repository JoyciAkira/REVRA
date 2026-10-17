# REVRA Roadmap

Every milestone has a measurable exit gate. No milestone is "done" without a
number produced by the official judge. Status: ✅ shipped · 🚧 in progress · 📋 planned.

## Shipped

- ✅ **Official benchmark harness, calibrated** — Decompile-Bench-Eval judge
  reproduced cell-by-cell against the paper's published table (IDA 18.22% exact,
  per-optimization cells exact; Ghidra within version drift).
- ✅ **Multi-engine census** — Ghidra headless + RetDec (MIT) best-of union:
  35.21% [32.68, 37.84] over 1,312 functions (full census, no sampling).
- ✅ **Agentic repair loop** — protocol A (single-shot) and protocol B (≤4 rounds,
  pass/fail feedback), both declared separately, full census:
  - A: 501/973 failed functions repaired (51.49%)
  - B: 411/973 repaired (71.23%)
  - **Full union: 1116/1312 = 85.06% [83.03, 86.89]** — C 89.9%, C++ 80.2%.
- ✅ **DWARF quantification** — debug information alone: 13.72% → 25.84% (+12.1).
- ✅ **Integrity audit** — first internal benchmark retired (measured nothing);
  audit public in the STEP4 report §4.
- ✅ **Policy ADRs** — MIT/Apache-only dependencies; bring-your-own-model.

## Milestones

### M1 — `revra-verify` CLI 🚧
One command on any ELF: multi-engine drafts → compile check → optional agentic
repair (BYOM) → markdown evidence report with per-attempt provenance.
**Gate:** end-to-end on ≥5 distinct real ELFs; evidence report includes every
attempt; zero unverifiable claims in the output.

### M2 — Determinism hardening ✅ (measured, with a finding)
`temperature=0` in adapter; pinned model in reports; run-to-run variance MEASURED
on 98 functions (protocol A, two independent runs):
- **Aggregate: stable** — 53 vs 54 passes (Δ+1, ~1pt): le percentuali pubblicate
  sono riproducibili.
- **Per-function: NOT deterministic** — 31% flip rate tra run (anche a temp=0:
  il provider non garantisce bit-exact). Conseguenza dichiarata: i claim
  aggregati sono validi; i claim per-funzione valgono per-run con evidence,
  mai come proprietà permanenti.
**Gate:** aggregate stability ±2pt su 98 funzioni ✅; per-function determinism
dichiarato impossibile per repair LLM (misurato, non assunto).

### M3 — MBPP split publication 🚧 (census running)
Second official test-bearing split: 7,792 functions. Baselines already reproduced
within paper CI (IDA 23.75% vs 25.62; Ghidra 11.88% vs 14.27).
**Gate:** REVRA census numbers on all 7,792 + baselines table published.

### M4 — DecompileBench (ACL 2025) 📋 ⛔blocked-tooling
23,400 functions from 130 real-world programs — the heaviest official benchmark
(recompilability + re-executability; LLM-judged Elo excluded by policy).
**Blocked:** no prebuilt dataset released; the framework builds its corpus from
oss-fuzz (multi-day compute; authors' artifact server availability unverified).
**Plan:** batch oss-fuzz build on the CI VPS (amd64), Ghidra+RetDec runners only.
**Gate:** judge infrastructure reproduced; REVRA numbers on the full corpus.

### M5 — Formal proofs over re-executability 📋
Re-executability bounds what is proven; the kernel already runs Lean 4.
Attach machine-checked equivalence properties to repaired functions.
**Gate:** ≥100 functions with non-trivial verified properties; fuzzing shows
zero false `VERIFIED`.

### M6 — MCP integration ✅
`revra mcp` server (stdio, zero-dep) **verified from a real Claude Code session**:
`revra_doctor` executed end-to-end (all environment checks green).
Long-running tools (`revra_verify`, ~10-18 min on multi-MB libraries) exceed
Claude Code's default MCP tool timeout — supported paths today:
`MCP_TOOL_TIMEOUT=1800000` env, or the CLI (`revra verify`, no timeout).
**Gate PASSED:** async job pattern shipped (`revra_verify` → job id immediato,
`revra_status` polling) e **full-verify session eseguita da Claude Code reale su
SQLite**: job → poll → compiles=true, passes=true, evidence report con provenance.
Bonus: durante la validazione, il modello ha diagnosticato da solo un bug dello
schema MCP del server (doppio wrap), corretto in `mcp/server.mjs`.

### Backlog (unordered)
- Multi-arch: arm64 ELF, Mach-O; PE behavioral verification (Speakeasy, MIT).
- Third engine (angr decompiler, BSD) for union coverage.
- Signed evidence reports (PQC, ML-DSA-65 — already in kernel).
- Whole-project scaffolding (decomp.wtf-style linking) after per-function proof layer.
