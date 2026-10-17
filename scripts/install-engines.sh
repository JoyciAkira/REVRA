#!/usr/bin/env bash
# Installazione motori RE per la copertura universale (PRD §3.1, visione founder).
# Idempotente: rilanciabile. macOS + Homebrew.
set -euo pipefail

echo "== tool brew =="
brew list radare2 >/dev/null 2>&1 || brew install radare2
brew list jadx >/dev/null 2>&1 || brew install jadx
brew list binwalk >/dev/null 2>&1 || brew install binwalk
brew list wabt >/dev/null 2>&1 || brew install wabt

echo "== asar-cli (Electron) =="
command -v asar >/dev/null || npm install -g @electron/asar

echo "== pycdc (Python .pyc, build cmake) =="
if ! command -v pycdc >/dev/null; then
  rm -rf /tmp/pycdc-build
  git clone --depth 1 https://github.com/zrax/pycdc.git /tmp/pycdc-build
  cd /tmp/pycdc-build
  cmake . -DCMAKE_BUILD_TYPE=Release >/dev/null
  make -j >/dev/null
  mkdir -p "$HOME/.local/bin"
  cp pycdc pycdas "$HOME/.local/bin/"
fi

echo "== ilspycmd (.NET CIL) — richiede dotnet-sdk (brew install dotnet-sdk) =="
if command -v dotnet >/dev/null; then
  command -v ilspycmd >/dev/null || dotnet tool install -g ilspycmd
  echo "  NOTA: esporta DOTNET_ROOT=$(cd "$(dirname "$(command -v dotnet)")/../libexec" && pwd) prima di avviare revra-api"
else
  echo "  dotnet-sdk mancante: brew install dotnet-sdk, poi dotnet tool install -g ilspycmd"
fi

echo "== ghidra headless (ELF/PE/Mach-O deep analysis) — ~400MB + JDK 21 =="
if ! command -v java >/dev/null; then
  echo "  java mancante: brew install --cask temurin"
fi
if ! command -v analyzeHeadless >/dev/null && [ ! -e "$HOME/.local/ghidra" ]; then
  echo "  installazione manuale: scarica https://github.com/NationalSecurityAgency/ghidra/releases"
  echo "  (zip PUBLIC) → estrai in ~/.local/ghidra e symlink: support/analyzeHeadless → ~/.local/bin"
fi

echo "== Lean4 (formal proofs L3) via elan =="
if ! command -v lean >/dev/null; then
  curl https://elan.lean-lang.org/elan-init.sh -sSf | sh -s -- -y
  export PATH="$HOME/.elan/bin:$PATH"
fi
echo "  lean: $(lean --version 2>/dev/null || echo 'installazione in corso')"

echo "== riepilogo =="
for t in r2 jadx binwalk wasm2wat asar pycdc ilspycmd analyzeHeadless; do
  if command -v "$t" >/dev/null; then echo "  ✅ $t"; else echo "  ❌ $t (DEGRADED dichiarato nella matrice)"; fi
done
