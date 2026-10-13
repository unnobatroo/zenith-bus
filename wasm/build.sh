#!/bin/sh
# Builds the ZenithBus WASM module into web/src/wasm/.
# Requires Emscripten (brew install emscripten / emsdk).
set -e
cd "$(dirname "$0")"
mkdir -p ../web/src/wasm
em++ -O2 -std=c++20 -I../include zenith_api.cpp -o ../web/src/wasm/zenith.js \
    -s MODULARIZE=1 -s EXPORT_ES6=1 -s ENVIRONMENT=web \
    -s ALLOW_MEMORY_GROWTH=1 -s FILESYSTEM=0
echo "built web/src/wasm/zenith.{js,wasm}"
