#!/usr/bin/env bash
# Catena MBPP: baselines → REVRA (ghidra+DWARF census) → repair A → repair B.
# Ogni step logga su file e prosegue anche se il precedente fallisce (EXIT registrato).
# Resume: revra_run e repair_loop sono incrementali; rilanciare il chain è safe.
set -uo pipefail
cd "$(dirname "$0")/../benchmarks/decompile_bench_public"
LOG=reports/mbpp_chain.log
export DBENCH_CORPUS=mbpp-decompile.json
export REVRA_BUILD_SUFFIX=mbpp REVRA_EXTRA_FLAGS=-g REVRA_TAG=mbpp_revra

run_step() {
  local name="$1"; shift
  echo "[$(date +%H:%M)] START $name" >> "$LOG"
  "$@" >> "$LOG" 2>&1
  echo "[$(date +%H:%M)] EXIT $name = $?" >> "$LOG"
}

run_step baselines python3 baseline_official.py
run_step revra_census python3 revra_run.py
run_step repair_A python3 repair_loop.py --protocol A --limit 2000 --workers 4
run_step repair_B python3 repair_loop.py --protocol B --limit 2000 --workers 4
echo "[$(date +%H:%M)] CHAIN COMPLETE" >> "$LOG"
