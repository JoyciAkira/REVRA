#!/usr/bin/env bash
# Setup per il benchmark pubblico (HumanEval-Decompile / Decompile-Bench-Eval, LLM4Binary).
#
# - Scarica il corpus ufficiale dal repo LLM4Decompile (MIT) e ne verifica lo SHA-256.
# - Costruisce l'immagine Docker linux/amd64 con la toolchain del protocollo ufficiale
#   (g++/gcc, libboost-dev, libssl-dev — richieste dalla readme di Decompile-Bench).
#
# Uso: bash setup.sh
set -euo pipefail
cd "$(dirname "$0")"

CORPUS_URL="https://raw.githubusercontent.com/albertan017/LLM4Decompile/main/decompile-bench/data/humaneval-decompile.json"
CORPUS_SHA256="95bc5ebc6ea64905386b29ca416a0730582c7f00d720c5b977aaf0d3a6058dd7"
MBPP_URL="https://raw.githubusercontent.com/albertan017/LLM4Decompile/main/decompile-bench/data/mbpp-decompile.json"
MBPP_SHA256="2b12f60492a307ff944d31fc89d1832c616fb7c35a379cf89d52bb4acc7ccfa5"

mkdir -p data reports

download_verify() {
  local url="$1" sha="$2" out="$3"
  if [ ! -f "data/$out" ]; then
    echo "== download $out =="
    curl -sSL "$url" -o "data/$out"
  fi
  local actual
  actual=$(shasum -a 256 "data/$out" | awk '{print $1}')
  if [ "$actual" != "$sha" ]; then
    echo "ERRORE: SHA-256 $out non corrisponde: $actual (atteso $sha)"
    exit 1
  fi
  echo "$out sha256: $actual"
}

download_verify "$CORPUS_URL" "$CORPUS_SHA256" "humaneval-decompile.json"
download_verify "$MBPP_URL" "$MBPP_SHA256" "mbpp-decompile.json"

echo "== build immagine docker linux/amd64 (toolchain protocollo ufficiale) =="
docker build --platform linux/amd64 -t revra-dbench-eval -f - . <<'DOCKERFILE'
FROM --platform=linux/amd64 ubuntu:22.04
RUN apt-get update && apt-get install -y --no-install-recommends \
      g++ gcc libc6-dev libboost-dev libssl-dev python3 python3-pip \
    && rm -rf /var/lib/apt/lists/* \
    && pip3 install tqdm numpy
WORKDIR /work
DOCKERFILE

echo "== smoke toolchain =="
docker run --rm --platform linux/amd64 -v "$(pwd)/data:/work/data:ro" revra-dbench-eval \
  bash -c 'printf "#include <cstdio>\nint main(){return 0;}\n" > /tmp/t.cpp && g++ -O0 -std=c++17 /tmp/t.cpp -o /tmp/t -lm -lcrypto && /tmp/t && echo SMOKE_OK'
echo "setup completato."
