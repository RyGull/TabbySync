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
 *  background script, which is newer still. 128 (an ESR) covered both — but
 *  the built-in data-collection consent below only exists from 140, and an
 *  add-on that declares data collection has to show its own consent screen on
 *  anything older. 140 is also an ESR, so this raises the floor without
 *  stranding the people who stay on ESR. */
export const GECKO_MIN_VERSION = '140.0';

/** What leaves the browser, in Mozilla's taxonomy.
 *
 *  AMO rejects a new add-on without this key. Its own definition of data
 *  transmission is "any data collected, used, transferred, shared, or handled
 *  outside the add-on or the local browser" — which is exactly what a sync
 *  tool does, so "none" would be false however little of it TabbySync itself
 *  can see. Bookmarks are `bookmarksInfo`; a saved tab is a URL of a page the
 *  user had open, which is `browsingActivity`.
 *
 *  Both are `required`: sync is the entire product, so there is nothing to opt
 *  out of. Nothing is listed as optional, and `technicalAndInteraction` is
 *  absent, because there is no telemetry of any kind.
 *
 *  Firefox's install prompt renders these as "Share bookmarks information with
 *  extension developer". That wording is Mozilla's and cannot be changed, and
 *  it is wrong about TabbySync specifically: the developer receives nothing,
 *  and the destination is one the user names. privacy.html says so, and so
 *  does the store listing. Declaring less than this would be worse. */
/** Firefox for Android got the consent screen two releases later than the
 *  desktop did. Below this the declaration above would never be shown. */
export const GECKO_ANDROID_MIN_VERSION = '142.0';

export const DATA_COLLECTION = { required: ['bookmarksInfo', 'browsingActivity'] };

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

  // 3. The add-on's identity, the oldest Firefox this is claimed to work on,
  //    and what data leaves the browser. AMO can assign an id itself, but then
  //    the store and a local build disagree about what this add-on is; the
  //    data declaration it will not assign, and refuses the upload without.
  //
  //    gecko_android carries a floor, not a promise: this has never been run
  //    on Firefox for Android and the tab list is a desktop layout. But AMO
  //    considers the add-on for Android either way, and Android only gained
  //    the data-collection consent screen in 142 — without this the linter
  //    warns that the declaration above would go unshown there.
  m.browser_specific_settings = {
    gecko: {
      id: GECKO_ID,
      strict_min_version: GECKO_MIN_VERSION,
      data_collection_permissions: structuredClone(DATA_COLLECTION),
    },
    gecko_android: { strict_min_version: GECKO_ANDROID_MIN_VERSION },
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
