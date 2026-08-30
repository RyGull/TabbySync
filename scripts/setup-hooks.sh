#!/bin/sh
# One-time setup: point git at the repo's version-controlled hooks so the
# manifest.json patch version auto-increments on every commit.
#
# Run once per clone, from anywhere in the repo:
#     sh scripts/setup-hooks.sh
root=$(git rev-parse --show-toplevel) || { echo "not a git repo"; exit 1; }
git -C "$root" config core.hooksPath .githooks
chmod +x "$root/.githooks/pre-commit" 2>/dev/null || true
echo "Hooks enabled: manifest.json patch version will auto-bump on each commit."
echo "Skip a bump with:  git commit --no-verify   (or SKIP_VERSION_BUMP=1 git commit …)"
