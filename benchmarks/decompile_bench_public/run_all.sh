#!/usr/bin/env bash
# Orchestrazione completa del benchmark pubblico.
# Uso: bash run_all.sh [--limit N] (smoke)
set -euo pipefail
cd "$(dirname "$0")"
LIMIT=${1:+$1}

bash setup.sh
python3 baseline_official.py $LIMIT
python3 revra_run.py $LIMIT
echo "Completo. Report in reports/."
