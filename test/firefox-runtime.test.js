// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// firefox-runtime.test.js — the two things that compiled fine, shipped, and
// then only misbehaved once the extension was running in Firefox.
//
// firefox-build.test.js covers the manifest and the shim. This covers the
// behaviour underneath them: which folders "bookmarks bar" and "other
// bookmarks" mean, and when a host-permission request is allowed to be made.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { pickRoots } from '../bookmarks/lib/tree.js';
import { getRoots, readLiveModel } from '../bookmarks/lib/import-merge.js';
import { readBrowserTree } from '../bookmarks/lib/browser.js';

const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// Which live folders get synced
// ---------------------------------------------------------------------------

// Firefox's roots, in the order and with the ids Firefox uses. Note that the
// first child is the *menu*, not the toolbar — the whole reason this file
// exists.
const firefoxRoots = () => [
  { id: 'menu________', title: 'Bookmarks Menu', children: [{ id: 'm1', title: 'in the menu', url: 'https://menu.example/' }] },
  { id: 'toolbar_____', title: 'Bookmarks Toolbar', children: [{ id: 't1', title: 'on the toolbar', url: 'https://toolbar.example/' }] },
  { id: 'unfiled_____', title: 'Other Bookmarks', children: [{ id: 'u1', title: 'unfiled', url: 'https://other.example/' }] },
  { id: 'mobile______', title: 'Mobile Bookmarks', children: [] },
];

// Chromium's, likewise.
const chromeRoots = () => [
  { id: '1', title: 'Bookmarks bar', children: [{ id: 'c1', title: 'on the bar', url: 'https://bar.example/' }] },
  { id: '2', title: 'Other bookmarks', children: [{ id: 'c2', title: 'other', url: 'https://other.example/' }] },
  { id: '3', title: 'Mobile bookmarks', children: [] },
];

function installRoots(children) {
  const index = new Map();
  (function walk(n) { index.set(n.id, n); (n.children || []).forEach(walk); })({ id: 'root', children });
  globalThis.chrome = {
    bookmarks: {
      async getTree() { return [{ id: 'root', title: '', children }]; },
      async getSubTree(id) { return [index.get(id)]; },
    },
  };
}

test('on Firefox the toolbar is the bookmarks bar, not the menu', () => {
  const { barLocalId, otherLocalId } = pickRoots(firefoxRoots());
  // Positionally the menu comes first. Taking children[0] would sync every
  // bookmark into a folder Firefox hides by default, which reads to the user
  // as "my bookmarks never arrived".
  assert.equal(barLocalId, 'toolbar_____');
  assert.equal(otherLocalId, 'unfiled_____');
});

test('on Chromium the ids still resolve the same way they always did', () => {
  assert.deepEqual(pickRoots(chromeRoots()), { barLocalId: '1', otherLocalId: '2' });
});

test('an unrecognised browser falls back to position, as before', () => {
  const kids = [{ id: 'n1' }, { id: 'n2' }, { id: 'n3' }];
  assert.deepEqual(pickRoots(kids), { barLocalId: 'n1', otherLocalId: 'n2' });
  assert.deepEqual(pickRoots([{ id: 'only' }]), { barLocalId: 'only', otherLocalId: 'only' });
});

test('both bookmark readers agree with each other about the Firefox roots', async () => {
  installRoots(firefoxRoots());

  assert.deepEqual(await getRoots(), { barLocalId: 'toolbar_____', otherLocalId: 'unfiled_____' });

  const live = await readLiveModel();
  assert.deepEqual(live.children[0].children.map((n) => n.url), ['https://toolbar.example/']);
  assert.deepEqual(live.children[1].children.map((n) => n.url), ['https://other.example/']);

  const { tree } = await readBrowserTree({}, null);
  const urls = (folder) => folder.children.map((n) => n.url);
  assert.deepEqual(urls(tree.children[0]), ['https://toolbar.example/'], 'the sync engine reads the toolbar as the bar');
  assert.deepEqual(urls(tree.children[1]), ['https://other.example/']);
  // And the menu stays out of it entirely: syncing a third root would move
  // bookmarks nobody asked to have moved.
  assert.ok(!JSON.stringify(tree).includes('menu.example'), "Firefox's Bookmarks Menu is not synced");

  delete globalThis.chrome;
});

// ---------------------------------------------------------------------------
// When host access may be asked for
// ---------------------------------------------------------------------------

// Firefox rejects permissions.request() outright — no prompt — unless the
// click that led to it is still on the stack. A single `await` beforehand is
// enough to lose that, which is how "Save and connect" came to report that
// access wasn't granted while never asking for it.
function handlerBody(src, id) {
  const start = src.indexOf(`$('${id}').addEventListener('click'`);
  assert.ok(start >= 0, `no click handler for #${id}`);
  const end = src.indexOf('\n});', start);
  assert.ok(end > start, `could not find the end of the #${id} handler`);
  return src.slice(start, end);
}

for (const id of ['srv-save', 'srv-test']) {
  test(`#${id} asks for host access before it awaits anything`, () => {
    const body = handlerBody(read('options.js'), id);
    const asked = body.indexOf('requestAccess(');
    const firstAwait = body.indexOf('await ');
    assert.ok(asked >= 0, `#${id} no longer requests host access`);
    assert.ok(firstAwait < 0 || asked < firstAwait,
      `#${id} awaits before requesting host access — Firefox will refuse the request without prompting`);
  });
}

test('the request itself is made synchronously, not from an async function', () => {
  const src = read('options.js');
  assert.match(src, /function requestAccess\(origins\) \{/,
    'requestAccess must stay a plain function: an async one resumes after the caller returns, ' +
    'by which time Firefox has already discarded the user gesture');
  assert.doesNotMatch(src, /async function requestAccess/);
});

test('a refused request reports why', () => {
  const src = read('options.js');
  // `.catch(() => false)` was the original bug's accomplice: the browser said
  // exactly what was wrong and the page threw it away.
  assert.doesNotMatch(src, /permissions\.request[^\n]*catch\(\(\) => false\)/,
    'the reason the browser gave is being swallowed');
  assert.match(src, /function accessProblem\(res\)/);
});

// ---------------------------------------------------------------------------
// What AMO's linter objects to
// ---------------------------------------------------------------------------

test('no extension code builds markup out of variables', () => {
  // addons-linter warns on every innerHTML assignment whose value is not a
  // constant, and on two of them it was right: the server URL the user types
  // was interpolated into a template string and assigned to innerHTML, so a
  // script tag typed into that box ran in the options page. Build nodes.
  const files = ['options.js', 'shared/theme.js', 'tabs/tablist.js', 'popup.js', 'background.js'];
  for (const file of files) {
    const src = read(file);
    const re = /\.innerHTML\s*=/g;
    let m;
    while ((m = re.exec(src))) {
      // The statement, up to the semicolon that ends it.
      const stmt = src.slice(m.index, src.indexOf(';', m.index));
      const line = src.slice(0, m.index).split('\n').length;
      assert.ok(!stmt.includes('${'),
        `${file}:${line} interpolates a value into innerHTML`);
      assert.ok(!/\+\s*[A-Za-z_$]/.test(stmt.slice(stmt.indexOf('='))),
        `${file}:${line} concatenates a value into innerHTML`);
    }
  }
});
