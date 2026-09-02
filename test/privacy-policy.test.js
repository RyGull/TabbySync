// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// privacy-policy.test.js — holds privacy.html to what the code actually does.
//
// A privacy policy is a promise about behaviour, and promises drift. These
// tests fail if the extension starts doing something the policy does not
// disclose: requesting a permission that is not in the table, reaching a host
// that is not listed, adding a content script, or touching an API the policy
// explicitly says it never touches.
//
// They check the code against the policy. They cannot check the policy against
// reality beyond that -- what happens to an email you send is outside any test.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const policy = read('privacy.html');

/** Every extension source file, excluding tests and tooling. */
function sourceFiles(exts) {
  const skip = new Set(['.git', 'node_modules', 'test', '.github', 'icons', 'scripts', '.githooks']);
  const out = [];
  (function walk(dir, rel) {
    for (const name of readdirSync(dir)) {
      if (skip.has(name)) continue;
      const abs = join(dir, name);
      const r = rel ? `${rel}/${name}` : name;
      if (statSync(abs).isDirectory()) walk(abs, r);
      else if (exts.includes(extname(name))) out.push(r);
    }
  })(root, '');
  return out;
}

const jsFiles = sourceFiles(['.js']);
const htmlFiles = sourceFiles(['.html']);
const allSource = jsFiles.map(read).join('\n');

// ---------------------------------------------------------------------------
// The permission table must match the manifest, in both directions
// ---------------------------------------------------------------------------

test('every permission the manifest requests is disclosed in the policy', () => {
  for (const perm of manifest.permissions) {
    assert.ok(
      policy.includes(`<code>${perm}</code>`) || policy.includes(perm),
      `manifest requests "${perm}" but privacy.html never mentions it`,
    );
  }
});

test('the policy does not claim a permission the manifest no longer requests', () => {
  // Guards the other direction: a permission dropped from the manifest but
  // left in the table makes the policy overstate what the extension can do.
  const known = new Set([...manifest.permissions, 'permissions']);
  for (const claimed of ['bookmarks', 'tabs', 'tabGroups', 'storage', 'unlimitedStorage', 'contextMenus', 'alarms']) {
    if (policy.includes(`<code>${claimed}</code>`)) {
      assert.ok(known.has(claimed), `privacy.html lists "${claimed}" but the manifest does not request it`);
    }
  }
});

test('every requested permission is actually used by the code', () => {
  // An unused permission is one the policy has to justify for no reason, and
  // is a Chrome Web Store review finding in its own right.
  const usedBy = {
    bookmarks: /chrome\.bookmarks\./,
    tabs: /chrome\.tabs\./,
    tabGroups: /chrome\.tabGroups\./,
    storage: /chrome\.storage\./,
    contextMenus: /chrome\.contextMenus\./,
    alarms: /chrome\.alarms\./,
    unlimitedStorage: null, // no API surface; it only raises the storage quota
  };
  for (const perm of manifest.permissions) {
    const re = usedBy[perm];
    assert.ok(re !== undefined, `unrecognised permission "${perm}" -- add it to this test and to privacy.html`);
    if (re) assert.match(allSource, re, `"${perm}" is requested but never used`);
  }
});

// ---------------------------------------------------------------------------
// "does not read your browsing history ... never listens for page navigation"
// ---------------------------------------------------------------------------

test('no API that could read browsing history or page content is used', () => {
  const forbidden = [
    'history', 'webNavigation', 'webRequest', 'declarativeNetRequest',
    'cookies', 'scripting', 'downloads', 'management', 'debugger',
    'privacy', 'proxy', 'topSites', 'browsingData', 'identity',
  ];
  for (const api of forbidden) {
    assert.doesNotMatch(allSource, new RegExp(`chrome\\.${api}\\b`), `chrome.${api} is used but the policy says it is not`);
    assert.equal(manifest.permissions.includes(api), false, `manifest requests "${api}"`);
  }
});

test('nothing listens for tab navigation', () => {
  // The policy: "TabbySync never listens for page navigation; it only reads
  // your currently open tabs at the moment you act."
  for (const ev of ['onUpdated', 'onCreated', 'onReplaced', 'onActivated']) {
    assert.doesNotMatch(allSource, new RegExp(`chrome\\.tabs\\.${ev}`), `chrome.tabs.${ev} listener found`);
  }
  assert.doesNotMatch(allSource, /chrome\.webNavigation/);
});

// ---------------------------------------------------------------------------
// "no host_permissions, no content scripts, never a wildcard"
// ---------------------------------------------------------------------------

test('the manifest asks for no host access and injects nothing up front', () => {
  assert.equal('host_permissions' in manifest, false, 'up-front host access would contradict the policy');
  assert.equal('content_scripts' in manifest, false, 'the policy states there are no content scripts');
  assert.equal('externally_connectable' in manifest, false);
});

test('host access is requested one origin at a time, never as a wildcard', () => {
  // The policy: "it only ever requests the one host you just configured ...
  // never a wildcard covering other sites."
  const optionsJs = read('options.js');
  const requests = optionsJs.match(/permissions\.request\(\{\s*origins:\s*\[[^\]]*\]/g) || [];
  assert.ok(requests.length > 0, 'no permission requests found -- has the flow moved?');

  for (const r of requests) {
    assert.doesNotMatch(r, /["']https?:\/\/\*\/\*["']/, `a wildcard origin is requested: ${r}`);
    assert.doesNotMatch(r, /["']<all_urls>["']/, `<all_urls> is requested: ${r}`);
  }
  // The dynamic one derives a single origin from the URL the user typed.
  assert.match(optionsJs, /new URL\(u\)\.origin \+ ['"]\/\*['"]/);
});

// ---------------------------------------------------------------------------
// "no analytics, telemetry or usage tracking of any kind"
// ---------------------------------------------------------------------------

test('the only hosts the extension can reach are the ones the policy names', () => {
  const allowed = [
    'https://api.github.com',      // GitHub Gist backend, disclosed
    'https://api.jsonbin.io',      // JSONBin backend, disclosed
    'https://www.paypal.com',      // donate link, disclosed, click-gated
    'https://github.com',          // token-setup help link in Options
    'https://jsonbin.io',          // account help link in Options
    'https://docs.github.com',     // link to GitHub's privacy statement
    'http://www.w3.org',           // SVG xmlns, not a network fetch
  ];
  const placeholders = /YOURDOMAIN|YOUR-DOMAIN|your-server\.example|example\.com|a\.example|b\.example|raw\.example/;

  for (const file of [...jsFiles, ...htmlFiles]) {
    if (file === 'shared/server-files.js') continue; // generates a server script, not a client call
    for (const url of read(file).match(/https?:\/\/[^\s"'`)<>\\]+/g) || []) {
      if (placeholders.test(url)) continue;
      assert.ok(
        allowed.some((a) => url.startsWith(a)),
        `${file} references an undisclosed host: ${url}`,
      );
    }
  }
});

test('no extension page loads a remote script, style, image or frame', () => {
  // A remote asset is how tracking usually arrives, and would also be a
  // Chrome Web Store remote-code violation.
  for (const file of htmlFiles) {
    const tags = read(file).match(/<(script|link|img|iframe|source)\b[^>]*>/g) || [];
    for (const tag of tags) {
      const src = (tag.match(/(?:src|href)\s*=\s*"([^"]*)"/) || [])[1];
      if (!src) continue; // e.g. the feedback iframe, which has no src until clicked
      assert.doesNotMatch(src, /^https?:\/\//, `${file} loads a remote asset: ${tag}`);
    }
  }
});

test('the extension reaches no server operated by its developer', () => {
  // The strongest claim in the policy, and the reason the embedded feedback
  // form was removed: TabbySync contacts only the sync destination the user
  // configures, plus GitHub/JSONBin if they pick one of those. Any http(s)
  // reference to the developer's own domain would break that.
  for (const file of [...jsFiles, ...htmlFiles]) {
    assert.doesNotMatch(read(file), /https?:\/\/[^\s"'`]*tabbysync\.com/,
      `${file} reaches the developer's own domain`);
  }
});

test('no page embeds a frame at all', () => {
  // An iframe is how the old feedback form contacted two servers before the
  // user had typed anything. There should now be none.
  for (const file of htmlFiles) {
    assert.doesNotMatch(read(file), /<iframe\b/i, `${file} contains an iframe`);
  }
});

test('feedback hands off to the user\'s mail client with no data attached', () => {
  const popupJs = read('popup.js');
  const handler = popupJs.slice(popupJs.indexOf('$("feedbackOpen")'));
  const fn = handler.slice(0, handler.indexOf('\n});'));

  assert.match(fn, /TabbySyncContact\.mailto/, 'feedback should build a mail link');
  // A subject naming the version is all it may carry: no body, and nothing
  // drawn from the user's settings or synced state.
  assert.equal(/body=/.test(fn), false, 'the mail link prefills a body');
  for (const leak of ['settings', 'token', 'passphrase', 'baseUrl', 'syncName', 'getState', 'bookmarks']) {
    assert.equal(fn.includes(leak), false, `the mail link includes "${leak}"`);
  }
});

test('the contact address is never written out in the source', () => {
  // It ships in readable JS and, once the repo is public, sits on GitHub. This
  // will not stop anyone who reads the code -- it stops the regex harvesters
  // that make up almost all address scraping. Anything stronger is not
  // available to a client-side extension; the durable defence is a rotatable
  // alias plus mail filtering.
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
  for (const file of [...jsFiles, ...htmlFiles, 'manifest.json']) {
    const hit = read(file).match(EMAIL);
    assert.equal(hit, null, `${file} contains a harvestable address: ${hit && hit[0]}`);
  }
});

test('the assembled address is a real, complete mail address', () => {
  // Obfuscation is worthless if it silently produces a broken address, which
  // would send every bug report and security report into the void.
  const src = read('shared/contact.js');
  const sandbox = { self: {}, String };
  new Function('self', 'String', src)(sandbox.self, String);
  const C = sandbox.self.TabbySyncContact;

  assert.match(C.address(), /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/);
  assert.equal(C.address(), 'contact' + String.fromCharCode(64) + 'tabbysync.com');
  assert.match(C.mailto('Hi there'), /^mailto:.+\?subject=Hi%20there$/);
  assert.equal(C.mailto(''), 'mailto:' + C.address(), 'no empty subject parameter');
});

test('the policy shows a readable fallback if scripting is off', () => {
  // The address must never become unreachable just because it is obfuscated.
  const spans = policy.match(/<span data-contact[^>]*>([^<]*)<\/span>/g) || [];
  assert.ok(spans.length >= 2, 'expected the policy to carry contact placeholders');
  for (const span of spans) {
    assert.match(span, /tabbysync/i, `placeholder is not human-readable: ${span}`);
  }
  assert.match(policy, /shared\/contact\.js/, 'the policy must load the script that renders them');
});

test('no analytics or beacon primitive appears anywhere', () => {
  for (const bad of [/sendBeacon/, /navigator\.sendBeacon/, /new Image\(\)/, /gtag\(/, /googletagmanager/, /google-analytics/, /XMLHttpRequest/]) {
    assert.doesNotMatch(allSource, bad, `analytics-shaped code found: ${bad}`);
  }
});

// ---------------------------------------------------------------------------
// "stored locally" and "the passphrase never leaves your device"
// ---------------------------------------------------------------------------

test('local data uses chrome.storage.local, never the browser cloud sync', () => {
  assert.match(allSource, /chrome\.storage\.local/);
  assert.doesNotMatch(allSource, /chrome\.storage\.sync/, 'chrome.storage.sync would upload settings to the browser vendor');
});

test('no secret is written into the uploaded tab payload', () => {
  // serialize() builds the body that gets uploaded. It must name its fields
  // explicitly rather than spreading the settings object, which holds the
  // bearer token and the encryption passphrase.
  const storage = read('tabs/storage.js');
  const body = storage.slice(storage.indexOf('function serialize('));
  const fn = body.slice(0, body.indexOf('\n  }'));

  for (const secret of ['token', 'passphrase', 'baseUrl', 'apiKey', 'gistId']) {
    assert.equal(fn.includes(secret), false, `serialize() puts "${secret}" in the uploaded payload`);
  }
  assert.equal(/\.\.\.settings|Object\.assign\(\{\}, settings/.test(fn), false,
    'serialize() spreads the whole settings object into the payload');
});

test('the bookmark payload is the tree itself, encrypted or not -- never the config', () => {
  const sync = read('bookmarks/lib/sync.js');
  assert.match(sync, /const body = cfg\.passphrase \? await encryptJSON\(tree, cfg\.passphrase\) : tree;/);
});

// ---------------------------------------------------------------------------
// Features the policy has to describe
// ---------------------------------------------------------------------------

test('the policy documents the Delete data feature that Options actually has', () => {
  const hasFeature = read('options.html').includes('Delete data') || read('options.js').includes('Delete data');
  if (hasFeature) {
    assert.match(policy, /Deleting your data/, 'Options has a Delete data section that the policy never mentions');
  }
});

test('the policy names each sync provider the code can actually reach', () => {
  const providers = read('shared/providers.js');
  // Declared twice: once as UI metadata, once as the get/put dispatch table.
  const ids = [...new Set([...providers.matchAll(/^\s{4}([a-z]+):\s*\{/gm)].map((m) => m[1]))];
  assert.deepEqual(ids.sort(), ['custom', 'gist', 'jsonbin'], 'provider list changed -- update privacy.html');

  assert.match(policy, /Self-hosted/);
  assert.match(policy, /GitHub Gist/);
  assert.match(policy, /JSONBin\.io/);
});

test('the policy states who is responsible and how to reach them', () => {
  assert.match(policy, /Ryan Gulliver/, 'no identifiable controller named');
  assert.match(policy, /Contact/);
});
