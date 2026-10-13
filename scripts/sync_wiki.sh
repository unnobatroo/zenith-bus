#!/usr/bin/env bash
set -euo pipefail
WIKI_DIR="build/wiki_repo"
rm -rf "$WIKI_DIR"
mkdir -p "$(dirname "$WIKI_DIR")"
git clone "https://github.com/unnobatroo/zenith-bus.wiki.git" "$WIKI_DIR"
cp wiki/*.md "$WIKI_DIR/"
cd "$WIKI_DIR"
git add .
git commit -m "docs: sync wiki documentation" || echo "No changes to commit"
git push origin master
