#!/usr/bin/env bash
# Crea il repository pubblico di REVRA dall'albero corrente (senza history).
#
# Perché: la history di questo repo working contiene documenti di strategia e
# corpus pesanti oggi rimossi dall'albero. Il repo pubblico nasce da un export
# dell'albero corrente (git archive) → history pulita, nulla di legacy.
#
# Uso: bash scripts/make-public-repo.sh [destinazione] [url-remote]
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DST="${1:-$SRC/../REVRA-public}"
REMOTE_URL="${2:-}"

# l'albero corrente deve essere pulito
if [ -n "$(git -C "$SRC" status --porcelain)" ]; then
  echo "ERRORE: albero non pulito — committa o stash prima del rilascio." >&2
  exit 1
fi

rm -rf "$DST"
mkdir -p "$DST"
git -C "$SRC" init -b main "$DST" >/dev/null
git -C "$SRC" archive HEAD | tar -x -C "$DST"
git -C "$DST" add -A
git -C "$DST" commit -q -m "REVRA public release — verified reverse engineering platform

Multi-engine decompilation (Ghidra, RetDec) + agentic repair loop + evidence
kernel. 85.06% re-executability (census, 1116/1312 functions) on
Decompile-Bench-Eval with the official judge; IDA/Ghidra baselines reproduced
cell-by-cell. Every attempt logged as evidence. Apache-2.0, BYOM."

if [ -n "$REMOTE_URL" ]; then
  git -C "$DST" remote add origin "$REMOTE_URL"
  git -C "$DST" push -u origin main
  echo "Pubblicato su $REMOTE_URL"
fi

echo "Repo pubblico pronto in: $DST (history pulita, $(git -C "$DST" rev-list --count HEAD) commit)"
