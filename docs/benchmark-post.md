# We reproduced Decompile-Bench cell-by-cell. Here's what DWARF really does to decompilation — and why 73% of Ghidra's C never compiles

*2026-10-15 — REVRA team. Corpus: HumanEval-Decompile / Decompile-Bench-Eval (1312 C/C++ functions), official harness, all numbers reproducible with one command.*

## Why we did this

We needed honest numbers for our platform, so we started by auditing our own.
Our earlier internal claims ("100% decompilation correctness, 100% Lean proof
coverage") turned out to measure nothing: a stub proposer, a brace-balance
checker, and hardcoded `theorem ... : True := by trivial` proofs selected by
function name from the ground truth. Lean verified them. They proved nothing.
We retired them.

This post is what replaced them: our engine, measured on the public benchmark
with the public protocol, against reproduced public baselines.

## The protocol (and how we know it's faithful)

We copied the official `execute_rate` harness **verbatim** (MIT), ran it in a
linux/amd64 container with the toolchain the authors specify, and evaluated the
`ida_pseudo` / `ghidra_pseudo` columns the authors ship inside the corpus.

If our harness is faithful, our numbers for those columns must match the paper
(arXiv:2505.12668, Table 2). They match cell-by-cell:

| HumanEval, per-opt (mean of C and C++) | Paper | Ours |
|---|---|---|
| IDA O0 / O1 / O2 / O3 | 18.60 / 19.81 / 17.69 / 16.77 | 18.60 / 19.82 / 17.69 / 16.77 |
| IDA AVG | **18.22** | **18.22%** [16.22, 20.40] |
| Ghidra AVG | 13.57 | 13.49% [11.75, 15.45] |

Every IDA cell is exact. Ghidra differs by 0.08 (version drift). From here on,
everything we measured uses the same judge.

## Results

| Configuration | Re-executability | 95% CI | Binaries |
|---|---|---|---|
| IDA Pro / Hex-Rays (authors' output, our judge) | 18.22% | [16.22, 20.40] | their builds |
| Ghidra (authors' output, our judge) | 13.49% | [11.75, 15.45] | their builds |
| Ours: Ghidra 11.3.2 headless, rebuild **without** DWARF | 13.72% | [11.96, 15.69] | our rebuilds |
| Ours: Ghidra 11.3.2 headless, rebuild **with** DWARF | **25.84%** | [23.54, 28.28] | our rebuilds |

Three independent sources now agree on the Ghidra baseline (paper 13.57,
authors' outputs 13.49, our fresh runs 13.72): the pipeline is faithful, and
the numbers below are real effects, not harness artifacts.

## Finding 1: DWARF is worth +12 points by itself

Same decompiler, same rebuild, one compiler flag (`-g`): **13.72% → 25.84%**.
Debug information nearly doubles re-executability, because type recovery —
not code semantics — is where decompilers bleed. The Decompile-Bench authors
hint at it ("binaries with debugging information helpful for tracing types and
names"); nobody, as far as we know, quantified it. Here it is: **+12.1 points,
a near-doubling, from metadata alone.**

## Finding 2: the bottleneck is compilability, not correctness

Of 1312 Ghidra candidates (DWARF build):

- **360 compile** (27.4%)
- **339 pass all tests** — **94.2% of whatever compiles**

When Ghidra's C compiles, it is almost always semantically right. The losses
happen before semantics: `undefined8`, lost structs, missing typedefs — output
that never links. The metric everyone optimizes (re-executability) is gated by
a step nobody reports (compilability). So we reported it.

## Finding 3: a second MIT decompiler recovers a third of the gap — census, not projection

On **all 973 functions** whose Ghidra output fails, we ran RetDec v5.0 (MIT) on
the same binaries through the same judge:

- RetDec compiles: 21.2%, **passes tests: 12.6% [10.7, 14.9]**
- Best-of union (Ghidra ∪ RetDec), full census: **462/1312 = 35.21% [32.68, 37.84]**

The per-configuration breakdown is the real story:

| | c/O0 | c/O1 | c/O2 | c/O3 | cpp (all opt) |
|---|---|---|---|---|---|
| Union re-executability | **68.9%** | 59.1% | 57.9% | 47.6% | ~12.0% |

Pure C at O0 already sits at **68.9%** — in the territory of the best published
LLM systems (63.6–69%) — using two permissively licensed engines (Ghidra
Apache-2.0, RetDec MIT), no commercial license, no model in the loop. The C++
wall (12%, flat across optimization levels) is a compilability wall, not a
semantics wall — which is precisely where a repair loop has room to work.

## Finding 4: the agentic repair loop takes the union to 85.06%

decomp.wtf proved the pattern on retro ROMs; we applied it to our judge: take
the decompiler draft, hand it to a general-purpose model with the disassembly
and the compiler errors, iterate against the official test suite (≤4 rounds).
The model never sees the test source — only pass/fail. Every attempt is logged
as evidence (model, round, outcome).

Full census on all 973 failed functions:

- Single-shot repair (leaderboard-comparable): **51.49%** [48.35, 54.62]
- Agentic repair (≤4 rounds, pass/fail feedback): **71.23%** [67.41, 74.77]

Best-of union across everything (Ghidra ∪ RetDec ∪ repair-A ∪ repair-B),
counted per function over the full corpus:

| System | Re-executability |
|---|---|
| IDA Pro (published baseline, our judge) | 18.22% |
| Best published LLM systems (fine-tuned) | 63.6–69% |
| **REVRA multi-engine pipeline (census)** | **85.06% [83.03, 86.89]** |

C: **89.9%**. C++: **80.2%** — the wall fell, and it was a compilability wall,
not a semantics wall.

Two numbers, two claims: **64.02%** is our leaderboard-comparable figure
(single-shot, no test feedback); **85.06%** is the full agentic pipeline — a
stronger regime we declare as such, and arguably the practically relevant one,
since whoever owns the binary can run its tests.

## What's next

1. Formal proofs on top: re-executability says the code passes tests; our
   kernel attaches provenance and, where semantics allow, machine-checked
   proofs. Nobody on this leaderboard ships that.
2. `revra-verify`: a one-command CLI/MCP that runs this pipeline on any ELF and
   emits a shareable evidence report. Models are bring-your-own; the judge,
   engines and provenance are ours.


## Reproduce it

```bash
git clone https://github.com/JoyciAkira/REVRA
cd REVRA/benchmarks/decompile_bench_public
bash setup.sh && python3 baseline_official.py && python3 revra_run.py
```

Corpus SHA-256 pinned, harness verbatim, Docker linux/amd64, Wilson intervals
on every aggregate. If your numbers differ from ours, that's a bug in one of us —
please open an issue.

*REVRA is Apache-2.0. The core (kernel, engines, benchmark) is open; the
models are yours to bring (ADR-0003); the enterprise tiers live on top.*
