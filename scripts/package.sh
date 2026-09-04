#!/usr/bin/env bash
# package.sh — build the Chrome Web Store upload zip.
#
# Produces dist/tabbysync-<version>.zip with manifest.json at the archive root,
# containing only the files the extension actually loads. Everything else in the
# repo (tests, website, docs, git plumbing) stays out of the upload.
set -euo pipefail

cd "$(dirname "$0")/.."

version=$(grep -m1 '"version"' manifest.json | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
out="dist/tabbysync-${version}.zip"

rm -f "$out"
mkdir -p dist

zip -r -X "$out" \
  manifest.json \
  background.js \
  popup.html popup.js \
  options.html options.js options.css \
  privacy.html \
  LICENSE \
  icons/ shared/ tabs/ bookmarks/ \
  -x '*.DS_Store' > /dev/null

echo "$out"
unzip -l "$out"
