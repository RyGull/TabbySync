// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// desktop-app.test.js — the extension mentions the Windows Control Panel in
// three places, and this is what keeps those three honest.
//
// Two things go wrong quietly here. One: a Mac or Linux user is shown a .exe
// download, which is noise at best and looks broken at worst — the extension
// runs on Chromium and Firefox on every desktop OS, so "Windows only" has to
// be enforced, not assumed. Two: the copy or the URL is edited in one of the
// three places and not the other two, and the extension starts saying
// different things about the same app depending on which screen you are on.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');

const src = read('shared/desktop-app.js');

/** Runs the real module against a fake navigator and hands back its exports. */
function load(navigator) {
  const self = {};
  new Function('self', 'navigator', src)(self, navigator);
  return self.TabbySyncDesktopApp;
}

const CHROMIUM_WIN = { userAgentData: { platform: 'Windows' }, platform: 'Win32' };
const FIREFOX_WIN = { platform: 'Win32' };
const CHROMIUM_MAC = { userAgentData: { platform: 'macOS' }, platform: 'MacIntel' };
const FIREFOX_MAC = { platform: 'MacIntel' };
const FIREFOX_LINUX = { platform: 'Linux x86_64' };

test('Windows is recognised on both engines, and nothing else is', () => {
  // Firefox does not implement userAgentData, so navigator.platform is the
  // only thing it offers — the extension ships there now, so this matters.
  for (const [name, nav] of [['Chromium/Windows', CHROMIUM_WIN], ['Firefox/Windows', FIREFOX_WIN]]) {
    assert.equal(load(nav).isWindows(), true, `${name} was not recognised as Windows`);
  }
  for (const [name, nav] of [
    ['Chromium/macOS', CHROMIUM_MAC], ['Firefox/macOS', FIREFOX_MAC], ['Firefox/Linux', FIREFOX_LINUX],
  ]) {
    assert.equal(load(nav).isWindows(), false, `${name} would be offered a Windows .exe`);
  }
});

test('userAgentData wins over the frozen platform string', () => {
  // Chromium freezes navigator.platform at legacy values and is entitled to
  // lie in it; userAgentData is the exact answer where it exists. A browser
  // reporting macOS with a stale "Win32" beside it must not see the app.
  assert.equal(load({ userAgentData: { platform: 'macOS' }, platform: 'Win32' }).isWindows(), false);
  assert.equal(load({ userAgentData: { platform: 'Windows' }, platform: 'MacIntel' }).isWindows(), true);
  // An empty platform string is "no answer", not "not Windows" — fall through.
  assert.equal(load({ userAgentData: { platform: '' }, platform: 'Win32' }).isWindows(), true);
});

test('a missing or hostile navigator offers nothing rather than throwing', () => {
  // This module is loaded on every page and, being a plain script, could end
  // up somewhere without a navigator at all. Throwing at load time there would
  // take the whole page's script with it.
  assert.equal(load(undefined).isWindows(), false);
  assert.equal(load({}).isWindows(), false);
  assert.equal(load({ platform: null }).isWindows(), false);
});

test('the download link is not /releases/latest', () => {
  // Same trap the website had: the extension (v*) and the app
  // (control-panel-v*) both cut releases in one repository, so "latest" is
  // whichever came last overall — usually the extension's, which ships store
  // zips and no installer. A published extension cannot be redeployed the way
  // the site can, so this must not be a link that rots.
  const { URL: url } = load(CHROMIUM_WIN);
  assert.ok(!/releases\/latest/.test(url),
    'the extension links /releases/latest, which the next extension release will point at a zip');
  assert.match(url, /^https:\/\/github\.com\/RyGull\/TabbySync\/releases$/,
    'the download URL is not the releases list');
});

test('the host is one the privacy policy already names', () => {
  // privacy-policy.test.js enforces the allow-list; this says out loud why
  // this particular URL was chosen from it, so a future edit to a different
  // host fails here with the reason rather than only there with a regex.
  assert.match(load(CHROMIUM_WIN).URL, /^https:\/\/github\.com\//,
    'the desktop-app link points somewhere the policy does not disclose');
});

test('all three entry points read from this one module', () => {
  for (const page of ['popup.html', 'options.html', 'tabs/tablist.html']) {
    assert.match(read(page), /shared\/desktop-app\.js/,
      `${page} mentions the desktop app without loading the module that defines it`);
  }
  // No page may restate the name, the pitch or the URL. One pitch, three
  // places; anything else drifts.
  const { NAME, URL: url } = load(CHROMIUM_WIN);
  for (const page of ['popup.html', 'options.html', 'tabs/tablist.html', 'popup.js', 'options.js', 'tabs/tablist.js']) {
    const body = read(page).replace(/shared\/desktop-app\.js/g, '');
    assert.ok(!body.includes(url), `${page} hardcodes the download URL instead of reading it`);
    // popup.js and friends build labels as "🖥️ " + app.NAME, never the literal.
    assert.ok(!body.includes(`"${NAME}"`) && !body.includes(`'${NAME}'`),
      `${page} hardcodes the app's name instead of reading it`);
  }
});

test('every entry point is gated on isWindows() before it is shown', () => {
  // The markup ships hidden and the script unhides it, rather than the other
  // way round: a script that fails to run leaves the entry point invisible,
  // which is the safe direction. Shipping it visible and hiding it later would
  // flash a Windows download at every Mac user on every popup open.
  const cases = [
    ['popup.html', /id="deskOpen"[^>]*\bhidden\b/, 'the popup row does not ship hidden'],
    ['tabs/tablist.html', /id="desktop-link"[^>]*\bhidden\b/, 'the tab-list menu item does not ship hidden'],
    ['options.html', /id="desktopCard"[^>]*\bhidden\b/, 'the options card does not ship hidden'],
  ];
  for (const [page, pattern, message] of cases) {
    assert.match(read(page), pattern, message);
  }
  for (const script of ['popup.js', 'options.js', 'tabs/tablist.js']) {
    const body = read(script);
    assert.match(body, /isWindows\(\)/, `${script} shows the desktop app without checking the platform`);
    assert.match(body, /if \(!app \|\| !app\.isWindows\(\)\) return;/,
      `${script} does not bail out early on a non-Windows platform`);
  }
});
