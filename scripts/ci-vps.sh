#!/usr/bin/env bash
# CI su VPS OVH (host Coolify, PRD F0.2): gate test + build immagini + push ghcr opzionale.
# Tutte le build sono amd64 NATIVO sul VPS — niente GitHub Actions, niente billing.
#
# Uso:  scripts/ci-vps.sh
# Env:  REVRA_VPS_HOST (default ubuntu@149.56.100.38)
#       REVRA_VPS_DIR (default /home/ubuntu/revra-ci)
#       GHCR_TOKEN/GHCR_USER sul VPS → push opzionale su ghcr.io
set -euo pipefail

VPS_HOST="${REVRA_VPS_HOST:-ubuntu@149.56.100.38}"
VPS_DIR="${REVRA_VPS_DIR:-/home/ubuntu/revra-ci}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIN_FREE_GB=6   # sotto questa soglia libera, le build immagini vengono saltate

echo "[ci-vps] sync repo → $VPS_HOST:$VPS_DIR"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude .git \
  --exclude .agentsroom --exclude .omc --exclude .omp --exclude .freebuff \
  --exclude .claude --exclude .mcp.json --exclude .env \
  --exclude 'benchmarks/decompile_bench_public/data/' \
  --exclude 'benchmarks/decompile_bench_public/reports/' \
  --exclude 'benchmarks/decompile_bench_public/.revra-verify/' \
  --exclude 'benchmarks/decompile_bench_public/examples/' \
  --exclude 'engine/cache/' \
  --exclude '__pycache__' \
  "$ROOT/" "$VPS_HOST:$VPS_DIR/"

disk_free_gb() {
  ssh "$VPS_HOST" "df -BG / | awk 'NR==2{print \$4}' | tr -d 'G'"
}

FREE=$(disk_free_gb)
echo "[ci-vps] spazio libero sul VPS: ${FREE}G"

echo "[ci-vps] gate in container node:22 (install → build → typecheck → test)"
ssh "$VPS_HOST" "cd '$VPS_DIR' && docker run --rm -v \"\$PWD\":/app -w /app node:22-bookworm bash -lc '
  set -euo pipefail
  corepack enable >/dev/null 2>&1
  pnpm install --frozen-lockfile --silent
  pnpm -r build
  pnpm -r typecheck
  pnpm -r test
'"

if [ "${FREE%G}" -lt "$MIN_FREE_GB" ]; then
  echo "[ci-vps] ⚠️  libero ${FREE}G < ${MIN_FREE_GB}G: SKIP build immagini (pulizia)"
  ssh "$VPS_HOST" "docker image prune -f >/dev/null 2>&1; docker builder prune -f >/dev/null 2>&1 || true"
  echo "[ci-vps] ✅ gate test SUPERATO (build immagini saltate per spazio)"
  exit 0
fi

echo "[ci-vps] build immagini engine+judge (amd64 nativo sul VPS)"
ssh "$VPS_HOST" "cd '$VPS_DIR/packages/revra-verify/engine' && bash setup_assets.sh && \
  docker build --platform linux/amd64 -t revra-engine:0.1.0 -f Dockerfile.engine . && \
  docker build --platform linux/amd64 -t revra-judge:0.1.0 -f Dockerfile.judge ."

# rotazione: mantieni solo le ultime 2 versioni di revra-engine
ssh "$VPS_HOST" "docker images revra-engine --format '{{.ID}}' | tail -n +3 | xargs -r docker rmi -f 2>/dev/null || true"

# reclaim: dangling images sempre; build cache oltre soglia solo se poco spazio
ssh "$VPS_HOST" "docker image prune -f >/dev/null 2>&1 || true"
FREE2=$(disk_free_gb)
if [ "${FREE2%G}" -lt 10 ]; then
  ssh "$VPS_HOST" "docker builder prune -f --keep-storage 2000000000 >/dev/null 2>&1 || true"
  echo "[ci-vps] builder prune eseguito (spazio basso)"
fi

# opzionale: pubblicazione ghcr (se GHCR_TOKEN e' configurato sul VPS)
ssh "$VPS_HOST" 'if [ -n "${GHCR_TOKEN:-}" ]; then
  echo "$GHCR_TOKEN" | docker login ghcr.io -u "${GHCR_USER:-JoyciAkira}" --password-stdin && \
  docker push ghcr.io/joyciakira/revra-engine:0.1.0 && docker push ghcr.io/joyciakira/revra-judge:0.1.0
fi' 2>/dev/null || true

echo "[ci-vps] ✅ gate SUPERATO su $VPS_HOST (libero finale: $(disk_free_gb)G)"
