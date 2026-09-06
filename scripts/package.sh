#!/usr/bin/env bash
# package.sh — build a store upload zip.
#
#   bash scripts/package.sh              -> dist/tabbysync-<version>.zip          (Chrome Web Store)
#   bash scripts/package.sh firefox      -> dist/tabbysync-<version>-firefox.zip  (addons.mozilla.org)
#   bash scripts/package.sh firefox --dir-> dist/firefox/                         (unpacked, for about:debugging)
#
# The --dir form exists because Firefox's "Load Temporary Add-on" wants a
# manifest.json on disk, and the one in this repository is Chrome's — it
# declares a service worker, which is the one thing Firefox may not run. Point
# Firefox at dist/firefox/manifest.json instead.
#
# Both are built from the same source files. The only difference is the
# manifest, which scripts/make-manifest.mjs derives from manifest.json — see
# that file for what differs between the two browsers and why.
#
# Contains only what the extension loads. Everything else in the repo (tests,
# website, docs, store copy, git plumbing) stays out of the upload.
set -euo pipefail

cd "$(dirname "$0")/.."

target="${1:-chrome}"
unpacked="${2:-}"
case "$target" in
  chrome|firefox) ;;
  *) echo "usage: bash scripts/package.sh [chrome|firefox] [--dir]" >&2; exit 1 ;;
esac
if [ -n "$unpacked" ] && [ "$unpacked" != "--dir" ]; then
  echo "usage: bash scripts/package.sh [chrome|firefox] [--dir]" >&2; exit 1
fi
if [ "$unpacked" = "--dir" ] && [ "$target" != "firefox" ]; then
  echo "--dir is only for firefox; Chrome can load this repository directly." >&2; exit 1
fi

version=$(grep -m1 '"version"' manifest.json | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')
suffix=""
[ "$target" = "firefox" ] && suffix="-firefox"
out="dist/tabbysync-${version}${suffix}.zip"

rm -f "$out"
mkdir -p dist

# The files the extension actually loads, in both builds.
files=(
  background.js
  popup.html popup.js
  options.html options.js options.css
  privacy.html
  LICENSE
  icons/ shared/ tabs/ bookmarks/
)

if [ "$target" = "chrome" ]; then
  zip -r -X "$out" manifest.json "${files[@]}" -x '*.DS_Store' > /dev/null
else
  # Firefox needs a different manifest.json at the archive root, and the file
  # in the working tree must not be touched — so stage a copy, swap the
  # manifest there, and zip that. A build must never leave the repository in a
  # state where the next one produces something different.
  if [ "$unpacked" = "--dir" ]; then
    stage="dist/firefox"
    rm -rf "$stage"
    mkdir -p "$stage"
  else
    stage="$(mktemp -d)"
    trap 'rm -rf "$stage"' EXIT
  fi
  for f in "${files[@]}"; do
    cp -r "$f" "$stage/"
  done
  node scripts/make-manifest.mjs firefox > "$stage/manifest.json"

  if [ "$unpacked" = "--dir" ]; then
    echo "$stage/"
    echo
    echo "Load it in Firefox:"
    echo "  about:debugging  ->  This Firefox  ->  Load Temporary Add-on…"
    echo "  then pick:  $(pwd)/$stage/manifest.json"
    echo
    echo "It stays until Firefox restarts. Re-run this and click Reload there"
    echo "after changing anything."
    exit 0
  fi

  ( cd "$stage" && zip -r -X "$OLDPWD/$out" . -x '*.DS_Store' > /dev/null )
fi

echo "$out"
unzip -l "$out" | tail -3
