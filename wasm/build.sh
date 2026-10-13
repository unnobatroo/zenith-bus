#!/bin/sh
# Builds the ZenithBus WASM module into web/wasm/.
# Requires Emscripten (brew install emscripten / emsdk).
# -pthread → real Worker threads on SharedArrayBuffer; the site must be
# served with COOP/COEP headers (web/serve.py and vercel.json handle it).
set -e
cd "$(dirname "$0")"
mkdir -p ../web/wasm
em++ -O2 -std=c++20 -pthread -I../include zenith_api.cpp -o ../web/wasm/zenith.js \
    -s MODULARIZE=1 -s EXPORT_ES6=1 -s ENVIRONMENT=web \
    -s PTHREAD_POOL_SIZE=6 -s FILESYSTEM=0
echo "built web/wasm/zenith.{js,wasm,worker.js}"
