#!/usr/bin/env bash
# Watchdog CI: controlla se origin/main è cambiato; se sì, lancia il CI sul VPS.
# Pensato per launchd (ogni 15 min, gira al wake se il Mac era a sonno).
# Lock: un solo istanza alla volta.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCK=/tmp/revra-ci-watch.lock
STATE=/tmp/revra-ci-watch.sha
LOG=/tmp/revra-ci-watch.log

if ! mkdir "$LOCK" 2>/dev/null; then exit 0; fi  # un solo istanza
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

log() { echo "[$(date '+%F %T')] $*" >> "$LOG"; }

REMOTE_SHA=$(git -C "$ROOT" ls-remote origin main 2>/dev/null | awk '{print $1}')
LOCAL_SHA=$(git -C "$ROOT" rev-parse HEAD)
if [ -z "$REMOTE_SHA" ]; then
  log "ERRORE: ls-remote fallito (crediti/rete)"; exit 1
fi
LAST=$(cat "$STATE" 2>/dev/null || echo "")

if [ "$REMOTE_SHA" = "$LOCAL_SHA" ] && [ "$REMOTE_SHA" = "$LAST" ]; then
  exit 0  # nulla di nuovo
fi

# se c'è un push non ancora deployato (anche solo locale), fai girare il CI
if [ "$REMOTE_SHA" != "$LAST" ]; then
  log "nuovo $REMOTE_SHA (ultimo CI: ${LAST:-mai}) → avvio ci-vps.sh"
  bash "$ROOT/scripts/ci-vps.sh" >> "$LOG" 2>&1
  rc=$?
  echo "$REMOTE_SHA" > "$STATE"
  log "ci-vps.sh EXIT=$rc"
  # tieni il log entro ~2MB
  tail -c 2000000 "$LOG" > "$LOG.tmp" && mv "$LOG.tmp" "$LOG"
fi
