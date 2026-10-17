# Demo: verifying a function from a real app (SQLite 3.3 MB)

Real run, 2026-10-16. Target: [`sqlite3_value_int64`](https://sqlite.org/src) from the
official SQLite amalgamation compiled as a 3.3 MB shared library (`gcc -O1 -g -shared`,
270 exported symbols, public domain — zero licensing friction). No test harness provided:
the gate is **compilability and successful link/run**, the bottleneck we measured on
Decompile-Bench-Eval (73% of raw Ghidra output never compiles).

## The command

```bash
python3 revra_verify.py --binary sqlite3.so --symbol sqlite3_value_int64 \
    --repair --rounds 3 --link-lib sqlite3.so --out evidence.md
```

(`--link-lib` resolves internal symbols — here `sqlite3VdbeIntValue` — against the
original library at link and run time.)

## What the pipeline did

| Step | Engine | Result |
|---|---|---|
| Symbol resolution | nm + c++filt (judge container) | `sqlite3_value_int64 @ 0x136b8` |
| Draft 1 | Ghidra 11.3.2 headless | 127 chars — per-function, correct call structure, **non-standard type `sqlite_int64`/`i64`** |
| Draft 2 | RetDec 5.0 | 5.16 MB — whole-library translation unit, compiles alone but its decompiled global state **crashes the stub run** |
| Repair round 1 | claude-sonnet-5 (BYOM) | compiles: false |
| Repair round 2 | claude-sonnet-5 (BYOM) | **compiles: true, runs: true** ✅ |

## The result

Ghidra's draft (correct logic, wrong types):

```c
sqlite_int64 sqlite3_value_int64(sqlite3_value *pVal)
{
  i64 iVar1;
  iVar1 = sqlite3VdbeIntValue(pVal);
  return iVar1;
}
```

Final verified candidate (round 2) — matches the real SQLite source exactly:

```c
#include <stdint.h>

typedef struct sqlite3_value sqlite3_value;

int64_t sqlite3VdbeIntValue(sqlite3_value *pMem);

int64_t sqlite3_value_int64(sqlite3_value *pVal)
{
    return sqlite3VdbeIntValue(pVal);
}
```

The repair agent did three things no decompiler does: recognized `sqlite_int64`/`i64`
as non-standard artifacts, recovered the opaque-type idiom (`typedef struct sqlite3_value
sqlite3_value;`) with a forward declaration of the internal helper, and produced a
translation unit that links against the original library.

## Evidence

Full provenance for every attempt (model, round, compile/run outcome) is in
[`../benchmarks/decompile_bench_public/examples/sqlite3_value_int64.evidence.md`](../benchmarks/decompile_bench_public/examples/sqlite3_value_int64.evidence.md). The judge is the
official Decompile-Bench compile+run logic in a pinned linux/amd64 container.

**Scope, honestly:** this verifies *compilability and successful execution of the
linked result* for one function, with a stub `main` — not behavioral equivalence
(provide `--test` with your own harness for that) and not whole-app reconstruction.

## Lawful use

SQLite is public domain. For other software: owned copy, no output redistribution,
no DRM circumvention — see [`legal/lawful-use.md`](legal/lawful-use.md).
