// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// make-manifest.mjs — prints the manifest for one browser, on stdout.
//
//   node scripts/make-manifest.mjs firefox > manifest.json
//
// manifest.json in the repository is Chrome's, and is the source of truth for
// everything the two browsers agree on: the name, the version, the
// description, the icons, the pages, the commands. Firefox's manifest is
// derived from it here rather than kept as a second file, because a second
// file is a second place for the version number to be wrong.
//
// Only the genuine differences live below, each with the reason it exists.
import { readFileSync } from 'node:fs';

const ROOT = new URL('..', import.meta.url);
const base = JSON.parse(readFileSync(new URL('manifest.json', ROOT), 'utf8'));

/** The add-on's identity on addons.mozilla.org. Never change it once published:
 *  it is how Firefox and AMO recognise an update as the same add-on. */
export const GECKO_ID = 'tabbysync@tabbysync.com';

/** Firefox needed until 121 for MV3 at all, and this uses an ES-module
 *  background script, which is newer still. 128 is the first Extended Support
 *  Release that covers both, so it is the honest floor to advertise. */
export const GECKO_MIN_VERSION = '128.0';

export function firefoxManifest(chromeManifest = base) {
  const m = structuredClone(chromeManifest);

  // 1. Background. Chrome MV3 requires a service worker; Firefox MV3 runs an
  //    event page instead and does not implement background.service_worker.
  //    Same file either way — background.js is a module in both.
  delete m.background.service_worker;
  m.background = { scripts: ['background.js'], type: 'module' };

  // 2. tabGroups is Chrome-only. The feature it powers ("reopen as a browser
  //    tab group") already degrades to plain tabs when the API is missing —
  //    see openTabsGrouped in tabs/tablist.js — so this only removes a
  //    permission Firefox would warn about, not any behaviour.
  m.permissions = m.permissions.filter((p) => p !== 'tabGroups');

  // 3. The add-on's identity, and the oldest Firefox this is claimed to work
  //    on. AMO can assign an id itself, but then the store and a local build
  //    disagree about what this add-on is.
  m.browser_specific_settings = {
    gecko: { id: GECKO_ID, strict_min_version: GECKO_MIN_VERSION },
  };

  return m;
}

// Called as a script: print the requested manifest.
if (import.meta.url === `file://${process.argv[1]}`) {
  const target = (process.argv[2] || 'chrome').toLowerCase();
  if (target !== 'firefox' && target !== 'chrome') {
    console.error(`unknown target "${target}" — expected chrome or firefox`);
    process.exit(1);
  }
  const out = target === 'firefox' ? firefoxManifest() : base;
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
