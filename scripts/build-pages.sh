#!/usr/bin/env bash
# build-pages.sh — regenerate docs/, the GitHub Pages source.
#
# The Chrome Web Store needs a privacy policy at a URL that renders as a page.
# GitHub's blob view shows privacy.html as escaped source, so the policy is
# published through Pages (Settings -> Pages, source: main branch, /docs).
#
# privacy.html at the repo root stays the single canonical copy -- the one
# test/privacy-policy.test.js checks against the actual code. This script only
# mirrors it, together with the handful of assets it references, so the
# published page can never say something the tests have not verified. A test
# fails if docs/ drifts out of step, so regenerate and commit after any edit
# to privacy.html.
#
# docs/index.html is hand-written, not generated, and is left alone.
set -euo pipefail

cd "$(dirname "$0")/.."

mkdir -p docs/shared docs/icons

cp privacy.html docs/privacy.html

# Exactly what privacy.html pulls in: the theme toggle, the contact-address
# renderer, and the two logos. Neither script touches a chrome.* API, so both
# run unchanged outside the extension.
cp shared/theme.js shared/contact.js docs/shared/
cp icons/logo-light.png icons/logo-dark.png docs/icons/

# Tell Pages to serve the directory as-is rather than running it through
# Jekyll, which would otherwise skip files it does not recognise.
: > docs/.nojekyll

echo "docs/ regenerated from the canonical sources:"
find docs -type f | sort | sed 's/^/  /'
