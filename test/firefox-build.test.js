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

import { firefoxManifest, GECKO_ID, GECKO_MIN_VERSION } from '../scripts/make-manifest.mjs';

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

test('the packaging script can build both, and never edits the working tree', () => {
  const pkg = read('scripts/package.sh');
  assert.match(pkg, /chrome\|firefox/, 'the script takes no target argument');
  assert.match(pkg, /make-manifest\.mjs firefox > "\$stage\/manifest\.json"/,
    'the Firefox manifest is not generated into a staging copy');
  assert.ok(!/> manifest\.json$/m.test(pkg),
    'the script writes over the repository manifest — a build must leave the tree as it found it');
});
