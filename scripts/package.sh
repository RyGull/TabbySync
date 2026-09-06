#!/usr/bin/env bash
# package.sh — build a store upload zip.
#
#   bash scripts/package.sh              -> dist/tabbysync-<version>.zip          (Chrome Web Store)
#   bash scripts/package.sh firefox      -> dist/tabbysync-<version>-firefox.zip  (addons.mozilla.org)
#   bash scripts/package.sh firefox --dir-> dist/firefox/                         (unpacked, for about:debugging)
#   bash scripts/package.sh source     -> dist/tabbysync-<version>-source.zip   (AMO's source upload)
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
  chrome|firefox|source) ;;
  *) echo "usage: bash scripts/package.sh [chrome|firefox|source] [--dir]" >&2; exit 1 ;;
esac
if [ -n "$unpacked" ] && [ "$unpacked" != "--dir" ]; then
  echo "usage: bash scripts/package.sh [chrome|firefox] [--dir]" >&2; exit 1
fi
if [ "$unpacked" = "--dir" ] && [ "$target" != "firefox" ]; then
  echo "--dir is only for firefox; Chrome can load this repository directly." >&2; exit 1
fi

version=$(grep -m1 '"version"' manifest.json | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/')

# AMO asks for the source when anything in the upload is generated, which for
# this add-on is the one manifest.json that make-manifest.mjs derives. The
# honest answer to "do you use a tool that generates files in the extension" is
# yes, so this produces what that question then asks for: the repository at the
# commit the upload was built from, which is the only thing needed to
# reproduce it. git archive rather than a hand-picked file list, so nothing can
# be left out by accident — and untracked files (config.local.php among them)
# cannot get in by accident either.
if [ "$target" = "source" ]; then
  out="dist/tabbysync-${version}-source.zip"
  mkdir -p dist
  rm -f "$out"
  git archive --format=zip -o "$out" HEAD
  echo "$out"
  echo "built from commit $(git rev-parse --short HEAD)"
  if [ -n "$(git status --porcelain)" ]; then
    echo "WARNING: the working tree has changes that are NOT in this archive" >&2
  fi
  unzip -l "$out" | tail -3
  exit 0
fi
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
