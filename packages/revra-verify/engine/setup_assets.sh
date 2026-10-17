#!/usr/bin/env bash
# Scarica gli artifact engine con SHA-256 pinnati in ./assets/ e li verifica.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p assets

GHIDRA_URL="https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_11.3.2_build/ghidra_11.3.2_PUBLIC_20250415.zip"
GHIDRA_SHA="99d45035bdcc3d6627e7b1232b7b379905a9fad76c772c920602e2b5d8b2dac2"
RETDEC_URL="https://github.com/avast/retdec/releases/download/v5.0/RetDec-v5.0-Linux-Release.tar.xz"
RETDEC_SHA="e5a7dd82987ff52b8c714892277d0b1d0190ab778c03036d01eb69c7658ab1a5"

fetch() {
  local url="$1" sha="$2" out="$3"
  if [ ! -f "assets/$out" ]; then
    echo "[setup] download $out"
    curl -sSL "$url" -o "assets/$out"
  fi
  local actual
  actual=$(sha256sum "assets/$out" | awk '{print $1}')
  if [ "$actual" != "$sha" ]; then
    echo "ERRORE: SHA-256 $out: $actual (atteso $sha)" >&2
    exit 1
  fi
  echo "[setup] $out ok ($actual)"
}

fetch "$GHIDRA_URL" "$GHIDRA_SHA" "ghidra_11.3.2_linux.zip"
fetch "$RETDEC_URL" "$RETDEC_SHA" "retdec-linux.tar.xz"
echo "[setup] artifact verificati."
