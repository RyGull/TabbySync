// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// firefox-build.test.js — the Firefox build is the same code with a different
// manifest, and this is what keeps that true.
//
// The two browsers disagree about exactly three things (see
// scripts/make-manifest.mjs). Everything else — the version, the name, the
// pages, the icons, the commands — must come from the one manifest.json, or
// the second store starts shipping something subtly different from the first.
//
// It also pins the compatibility shim, because the whole port rests on one
// assumption: that `chrome.*` can be made to mean the same thing in both
// browsers. If someone adds a callback-style call back into the codebase, that
// call works in exactly one of them, and this test is the only thing that
// notices before a user does.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { firefoxManifest, GECKO_ID, GECKO_MIN_VERSION, GECKO_ANDROID_MIN_VERSION, DATA_COLLECTION }
  from '../scripts/make-manifest.mjs';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');
const chrome = JSON.parse(read('manifest.json'));
const firefox = firefoxManifest();

// ---------------------------------------------------------------------------
// What differs, and only what differs
// ---------------------------------------------------------------------------

test('Firefox gets an event page; Chrome keeps its service worker', () => {
  assert.ok(chrome.background.service_worker, 'Chrome MV3 requires a service worker');
  assert.equal(firefox.background.service_worker, undefined,
    'Firefox does not implement background.service_worker — the extension would install and do nothing');
  assert.deepEqual(firefox.background.scripts, ['background.js']);
  assert.equal(firefox.background.type, 'module', 'background.js is an ES module in both builds');
});

test('the Firefox build does not ask for tabGroups', () => {
  assert.ok(chrome.permissions.includes('tabGroups'));
  assert.ok(!firefox.permissions.includes('tabGroups'),
    'Firefox has no tabGroups API; asking for it is a warning at review for a permission nothing uses');
  // Everything else must survive: dropping a real permission would break sync
  // rather than one optional nicety.
  for (const p of chrome.permissions.filter((p) => p !== 'tabGroups')) {
    assert.ok(firefox.permissions.includes(p), `the Firefox build lost the ${p} permission`);
  }
});

test('the Firefox build carries a stable add-on identity', () => {
  assert.equal(firefox.browser_specific_settings.gecko.id, GECKO_ID);
  assert.equal(firefox.browser_specific_settings.gecko.strict_min_version, GECKO_MIN_VERSION);
  assert.match(GECKO_ID, /^[^@\s]+@[^@\s]+$/, 'a gecko id is an email-shaped string');
  assert.equal(chrome.browser_specific_settings, undefined, 'Chrome has no use for it');
});

test('the Firefox build declares what leaves the browser', () => {
  // AMO rejects a new add-on without this key outright — 1.3.14 was rejected
  // for exactly that. Mozilla's own definition of data transmission is "any
  // data collected, used, transferred, shared, or handled outside the add-on
  // or the local browser", which a sync tool does by definition, so "none"
  // would be a false declaration however little the developer can see.
  const dc = firefox.browser_specific_settings.gecko.data_collection_permissions;
  assert.deepEqual(dc, DATA_COLLECTION);
  assert.ok(Array.isArray(dc.required) && dc.required.length > 0,
    'the "required" list must exist and cannot be empty');
  assert.ok(!dc.required.includes('none'),
    'TabbySync sends bookmarks and saved tab URLs out of the browser; "none" would be untrue');
  assert.ok(dc.required.includes('bookmarksInfo'), 'bookmarks are synced');
  assert.ok(dc.required.includes('browsingActivity'), 'a saved tab is the URL of a page the user had open');
  assert.ok(!JSON.stringify(dc).includes('technicalAndInteraction'),
    'there is no telemetry, so nothing should claim there is');

  // Only these eleven strings, plus "none", are valid in "required"; anything
  // else is rejected at upload.
  const VALID = ['authenticationInfo', 'bookmarksInfo', 'browsingActivity', 'financialAndPaymentInfo',
    'healthInfo', 'locationInfo', 'personalCommunications', 'personallyIdentifyingInfo',
    'searchTerms', 'websiteActivity', 'websiteContent', 'none'];
  for (const t of dc.required) assert.ok(VALID.includes(t), `${t} is not a data collection permission`);

  assert.equal(chrome.browser_specific_settings, undefined, 'Chrome has no use for any of this');
});

test('the Firefox floor is high enough for the consent screen to exist', () => {
  // Built-in data consent arrived in Firefox 140. An add-on that declares data
  // collection and runs on anything older has to show a consent experience of
  // its own; raising the floor is the documented alternative, and 140 is an
  // ESR so it does not strand the people who stay on those.
  assert.ok(parseInt(GECKO_MIN_VERSION, 10) >= 140,
    `strict_min_version is ${GECKO_MIN_VERSION}, below the 140 that has built-in data consent`);
  // Android got the same screen two releases later, and AMO considers the
  // add-on for Android whether or not it is aimed there.
  assert.equal(firefox.browser_specific_settings.gecko_android.strict_min_version,
    GECKO_ANDROID_MIN_VERSION);
  assert.ok(parseInt(GECKO_ANDROID_MIN_VERSION, 10) >= 142,
    'below 142 the data declaration would never be shown on Android');
});

test('everything the two stores agree on comes from one manifest', () => {
  for (const key of ['manifest_version', 'name', 'version', 'description', 'icons', 'action',
    'options_ui', 'commands', 'optional_host_permissions']) {
    assert.deepEqual(firefox[key], chrome[key],
      `${key} differs between the builds — it should be shared, not forked`);
  }
});

// ---------------------------------------------------------------------------
// The assumption the whole port rests on
// ---------------------------------------------------------------------------

test('every page and the worker load the compatibility shim first', () => {
  for (const page of ['popup.html', 'options.html', 'tabs/tablist.html']) {
    const src = read(page);
    // Compare the script tags themselves. Both files are also named in
    // comments, and a test that reads a comment as if it were markup proves
    // nothing — popup.html mentions theme.js in a CSS note 35 lines earlier.
    const tag = (file) => src.search(new RegExp(`<script src="[^"]*${file}"`));
    const shimAt = tag('browser-compat\\.js');
    const themeAt = tag('theme\\.js');
    assert.ok(shimAt >= 0, `${page} does not load browser-compat.js`);
    assert.ok(themeAt >= 0, `${page} does not load theme.js`);
    assert.ok(shimAt < themeAt,
      `${page} loads browser-compat.js after theme.js — it has to be first, before anything touches chrome.*`);
  }
  const bg = read('background.js');
  assert.match(bg, /import '\.\/shared\/browser-compat\.js';/, 'the worker does not load the shim');
  assert.ok(bg.indexOf('browser-compat') < bg.indexOf('shared/config.js'),
    'the shim must be imported before the engines');
});

test('no extension code calls the API with a completion callback', () => {
  // A callback works on Chrome and is ignored by Firefox's promise-based
  // `browser.*`, which the shim aliases `chrome` to. Promise style works on
  // both. The tab-group calls are the documented exception: that whole path is
  // skipped on any browser without chrome.tabs.group, which is every Firefox.
  const allowed = [/chrome\.tabs\.group\(/, /chrome\.tabGroups\.update\(/];
  const files = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (!['node_modules', '.git', 'test', 'scripts', 'website', 'docs', 'dist', 'store'].includes(name)) walk(full);
      } else if (name.endsWith('.js')) {
        files.push(full);
      }
    }
  })(root);

  // chrome.<ns>.<method>(..., function/arrow) — a trailing callback.
  const callbackCall = /chrome\.[a-zA-Z]+\.[a-zA-Z]+\([^;]*,\s*(function\s*\(|\([^)]*\)\s*=>|resolve\b|sendResponse\b)/;
  for (const file of files) {
    const rel = file.slice(root.length);
    for (const line of read(rel).split('\n')) {
      if (line.includes('addListener') || allowed.some((a) => a.test(line))) continue;
      assert.ok(!callbackCall.test(line),
        `${rel} passes a callback to the extension API, which Firefox ignores:\n    ${line.trim()}`);
    }
  }
});

test('the npm scripts run the packaging script with bash', () => {
  // package.sh uses `set -o pipefail`, which dash does not have — and npm runs
  // scripts with /bin/sh, which on Debian and Ubuntu is dash. `npm run
  // dev:firefox` failed on its first real use for exactly this.
  const scripts = JSON.parse(read('package.json')).scripts;
  for (const [name, cmd] of Object.entries(scripts)) {
    if (!cmd.includes('package.sh')) continue;
    assert.match(cmd, /^bash /, `npm run ${name} calls package.sh with ${cmd.split(' ')[0]}`);
  }
});

test('the packaging script can build both, and never edits the working tree', () => {
  const pkg = read('scripts/package.sh');
  assert.match(pkg, /chrome\|firefox/, 'the script takes no target argument');
  assert.match(pkg, /make-manifest\.mjs firefox > "\$stage\/manifest\.json"/,
    'the Firefox manifest is not generated into a staging copy');
  assert.ok(!/> manifest\.json$/m.test(pkg),
    'the script writes over the repository manifest — a build must leave the tree as it found it');
});
