# REVRA — Verified Reverse Engineering

**Evidence-first reverse engineering: multi-engine decompilation, an agentic repair loop, and an evidence kernel that records every attempt.**

Every number on this page is a measured result on an official public benchmark, with a pinned corpus, a verbatim official judge, and full reproducibility. No projections, no cherry-picking, no unverifiable claims.

---

## Benchmark results

**Corpus:** [Decompile-Bench-Eval / HumanEval-Decompile](https://arxiv.org/abs/2505.12668) — 1,312 C/C++ functions (164 tasks × 4 optimization levels × {C, C++}), linux x86-64.
**Judge:** the official `execute_rate` harness, copied verbatim (MIT), running in a linux/amd64 container. A candidate *passes* when it compiles and its binary runs the function's full test suite (exit 0).
**Calibration:** our judge reproduces the paper's published table **cell-by-cell** — IDA Pro 18.22% (paper: 18.22), per-optimization cells exact; Ghidra 13.49% (paper: 13.57).

| Pipeline | Re-executability | 95% CI |
|---|---|---|
| IDA Pro / Hex-Rays (published baseline, our judge) | 18.22% | [16.22, 20.40] |
| Ghidra (published baseline, our judge) | 13.49% | [11.75, 15.45] |
| REVRA: Ghidra headless, rebuild without DWARF | 13.72% | [11.96, 15.69] |
| REVRA: Ghidra headless, rebuild with DWARF | 25.84% | [23.54, 28.28] |
| ∪ RetDec (MIT, second engine) | 35.21% | [32.68, 37.84] |
| ∪ Repair, single-shot (**protocol A** — leaderboard-comparable) | **64.02%** | [61.39, 66.58] |
| ∪ Repair, agentic (**protocol B** — see below) | **85.06%** | **[83.03, 86.89]** |

Per language (full union): **C 89.9%**, **C++ 80.2%**.

For context, best published fine-tuned systems on this benchmark: LLM4Decompile-Ref-22B 63.6%, SK2Decompile 69% (C-only split). REVRA protocol A reaches **69.66% on the C-only split** with a general-purpose, bring-your-own model — no fine-tuning.

### Two protocols, declared separately — never mixed

- **Protocol A (single-shot, leaderboard-comparable):** one model call per function. Input: disassembly, build dependencies, decompiler drafts, compiler errors. **Never** the tests or their outcomes.
- **Protocol B (agentic):** up to 4 rounds; the model receives compiler stderr and pass/fail outcomes (never the test source). A stronger regime — we declare it as such. It is also the practically relevant one: whoever owns the binary can run its tests.

### What 85.06% means — and what it does not mean

It means: for **1,116 of 1,312 benchmark functions**, the pipeline's decompiled C compiled and passed that function's full test suite. It does **not** mean 85% of a whole application is reconstructed — this is a per-function benchmark, not whole-app reconstruction, not byte-exact recompilation, and not guaranteed semantic equivalence (tests bound what is proven; formal proofs are on the roadmap where semantics allow).

### Why it works: the bottleneck was compilability, not semantics

Of all Ghidra drafts, only 27.4% compiled — but **94.2% of those that compiled passed their tests**. The losses were `undefined8`-style output that never links, not wrong logic. The repair loop attacks exactly that, and the per-language split confirms it: C++ went from 12.0% (drafts) to 80.2% (pipeline) with no change in the semantics budget. Debug information alone was worth +12.1 points (13.72% → 25.84%) — a lever we have not seen quantified anywhere else.

## Install

```bash
npm install -g revra-verify     # or: npx revra-verify
revra setup                     # pinned artifacts + docker images (~5 min, once)
revra connect claude            # or codex/cursor/windsurf/opencode
revra verify --binary app.so --symbol func_name --repair
```

Models are bring-your-own ([ADR-0003](docs/adr/0003-llm-provider-byom.md)): configure via `~/.revra/config.json` or `REVRA_LLM_*` env.

## Reproduce it

```bash
git clone https://github.com/JoyciAkira/REVRA
cd REVRA/benchmarks/decompile_bench_public
bash setup.sh                                # pinned corpora (SHA-256) + linux/amd64 judge image
python3 baseline_official.py                 # reproduce IDA/Ghidra baselines from shipped outputs
python3 revra_run.py                         # Ghidra+DWARF census (multi-hour)
python3 retdec_spike.py --scope exec0        # RetDec union census
python3 repair_loop.py --protocol A          # repair census (bring your own model, ADR-0003)
python3 repair_loop.py --protocol B
```

**Engine container** (Ghidra 11.3.2 + RetDec 5.0 + JDK21, artifacts SHA-256-pinned):

```bash
docker build --platform linux/amd64 -t revra-engine:0.1.0 -f engine/Dockerfile.engine .
```

`revra-verify.py` uses this container automatically; without it, it falls back to
local Ghidra/RetDec installations. A prebuilt image is published to
`ghcr.io/<owner>/revra-engine` via CI (requires Actions minutes; local build
works everywhere).

Corpora SHA-256 pinned. Baselines evaluated from the author-released `ida_pseudo`/`ghidra_pseudo` outputs. Wilson 95% intervals on every aggregate. Full methodology and limitations: [`benchmarks/decompile_bench_public/STEP4_PUBLIC_BENCHMARK_REPORT.md`](benchmarks/decompile_bench_public/STEP4_PUBLIC_BENCHMARK_REPORT.md).

## Integrity statement

Our first internal benchmark (a synthetic obfuscated corpus) measured nothing: a stub proposer, a brace-balance verifier, and hardcoded tautological Lean proofs. We audited it, **retired every number it produced**, and rebuilt all claims on the official public protocol above. The audit is public: [STEP4 report, §4](benchmarks/decompile_bench_public/STEP4_PUBLIC_BENCHMARK_REPORT.md). We consider this the most important section of the project.

## How it works

```
binary → [Ghidra headless] → [RetDec]      two independent MIT/Apache engines
              ↓                              (best-of selection per function)
        draft C candidates
              ↓
        [agentic repair]                   BYOM (ADR-0003): the model is yours
              ↓                            judge: official compile+run harness
        verified C + evidence              every attempt logged (model, round, outcome)
              ↓
        [evidence kernel]                  provenance, no-silent-promotion,
                                           formal proofs where semantics allow (roadmap)
```

Design rules (PRD §0): **no silent promotion** — a claim without evidence stays unverified; every gate is a measured threshold; engines are out-of-process adapters with declared capabilities; the evidence trail is the product.

## Lawful use

Reverse engineering has well-established lawful applications — interoperability (explicit EU right, dir. 2009/24/EC art. 6), security research, supply-chain audits, malware analysis, forensics, compliance, source recovery for your own products. It also has hard red lines: no DRM circumvention, no redistribution of decompiled code, no cracking, no unauthorized systems. See [`docs/legal/lawful-use.md`](docs/legal/lawful-use.md) for the full matrix with legal bases (not legal advice).

**Live example** — verifying `sqlite3_value_int64` from a real 3.3 MB SQLite library: [`docs/demo-sqlite.md`](docs/demo-sqlite.md).

## Repository layout

```
benchmarks/decompile_bench_public/   official-benchmark harness, corpora (SHA-256 pinned), full report
packages/kernel/                     evidence & verification kernel (L0–L3, Lean 4 verifier)
packages/engine/                     decompilation engines, repair loop, consensus, behavioral verification
packages/api, packages/web           REST API + evidence dashboard
docs/adr/                            architecture decisions (licensing, BYOM, toolchain)
docs/legal/                          lawful-use matrix
docs/benchmark-post.md           publishable benchmark write-up
```

## Roadmap

Measured milestones with exit gates: [`docs/ROADMAP.md`](docs/ROADMAP.md).

1. **`revra-verify` CLI/MCP** — one command on any ELF: multi-engine draft → repair → evidence report (markdown). Bring your own model.
2. **Formal proofs on top of re-executability** — tests bound what is proven; the kernel already runs Lean 4 where semantics allow.
3. **DecompileBench (ACL 2025)** — 23,400 real-world functions, the second official benchmark.
4. **MBPP split results** — second official test-bearing split (census in progress).

## License & contributing

Apache-2.0. Open core: the kernel, engines, benchmarks and this evidence are open; enterprise tiers (sovereign deployment, compliance artifacts, support) live on top. Contributions under DCO/CLA — see [`CONTRIBUTING.md`](CONTRIBUTING.md). Dependencies restricted to MIT/Apache-2.0 ([ADR-0002](docs/adr/0002-licenze-tool-mit-apache.md)); models are bring-your-own ([ADR-0003](docs/adr/0003-llm-provider-byom.md)).
