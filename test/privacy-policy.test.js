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
  // 'website' is the marketing site (website/README.md), a separate PHP
  // deployable with its own threat model -- external links (GitHub, PayPal,
  // the license) are normal there and none of it ships inside the extension
  // bundle.
  //
  // 'docs' is the GitHub Pages source: a mirror of privacy.html and the assets
  // it pulls in, published so the store has a policy URL that renders as a
  // page. Nothing original lives there and none of it ships in the extension
  // bundle either -- scanning it would just double-count the same file. The
  // mirror is held to the canonical copy by its own test at the end of this
  // file instead. None of its files currently match the .js/.html extensions this
  // scanner walks anyway (it's .php/.css), but excluded explicitly so that
  // stays true by design rather than by accident if that ever changes.
  const skip = new Set(['.git', 'node_modules', 'test', '.github', 'icons', 'scripts', '.githooks', 'website', 'docs']);
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

test('no plain-http host access is requestable except loopback', () => {
  // The policy: "The address must be https://; TabbySync refuses to save a
  // plain http:// server URL". An http://*/* pattern here would make that
  // refusal cosmetic -- the grant would still be available to any code path
  // that skipped the check.
  const patterns = manifest.optional_host_permissions || [];
  assert.ok(patterns.length > 0, 'no optional host permissions -- has the flow moved?');
  for (const pattern of patterns) {
    assert.notEqual(pattern, '<all_urls>');
    if (!pattern.startsWith('http://')) continue;
    const host = pattern.slice('http://'.length).replace(/\/\*$/, '');
    assert.ok(
      host === 'localhost' || host === '127.0.0.1',
      `plain http is grantable for a non-loopback host: ${pattern}`,
    );
  }
});

test('the options page refuses an insecure server URL before saving it', () => {
  // The token travels in an Authorization header on every request, outside
  // the encrypted body, so an http:// destination leaks a long-lived
  // credential. Both buttons that can reach the server must be gated -- a
  // "Test" that happily talks to a plain-http host would leak it just as
  // thoroughly as a "Save" that stored one.
  const optionsJs = read('options.js');
  assert.match(optionsJs, /function serverUrlProblem\(/);
  assert.match(optionsJs, /u\.protocol === 'https:'/);
  assert.equal(
    (optionsJs.match(/serverUrlProblem\(serverUrl\)/g) || []).length, 2,
    'both the save and the test handler must run the check',
  );
});

test("the options page's loopback exception matches what the manifest can grant", () => {
  // Two lists, one rule. If the validator allowed a host the manifest does
  // not cover, the user would save a config that can never be granted and so
  // never syncs; if the manifest covered a host the validator rejects, the
  // permission would be dead weight in the review.
  const optionsJs = read('options.js');
  const declared = (optionsJs.match(/const LOOPBACK_HOSTS = \[([^\]]*)\]/) || [])[1];
  assert.ok(declared !== undefined, 'LOOPBACK_HOSTS not found in options.js');
  const allowedByOptions = declared.split(',')
    .map((h) => h.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
    .sort();
  const allowedByManifest = (manifest.optional_host_permissions || [])
    .filter((pattern) => pattern.startsWith('http://'))
    .map((pattern) => pattern.slice('http://'.length).replace(/\/\*$/, ''))
    .sort();
  assert.deepEqual(allowedByOptions, allowedByManifest);
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

test('every version number in the repo agrees with the manifest', () => {
  // package.json, the marketing site footer and the changelog all restate the
  // extension's version. "Keep this in step with manifest.json" was a comment,
  // and a comment had already let website/config.php ship a release behind.
  const version = manifest.version;

  assert.equal(JSON.parse(read('package.json')).version, version, 'package.json is out of step');

  const site = read('website/config.php').match(/const CURRENT_VERSION\s*=\s*'([^']+)'/);
  assert.ok(site, 'CURRENT_VERSION not found in website/config.php');
  assert.equal(site[1], version, 'website/config.php is out of step');

  const latest = read('CHANGELOG.md').match(/^## (\S+)/m);
  assert.ok(latest, 'no version heading found in CHANGELOG.md');
  assert.equal(latest[1], version, 'the changelog has no entry for this version');
});

// ---------------------------------------------------------------------------
// The published copy must be the copy these tests check
// ---------------------------------------------------------------------------

test('docs/ publishes the same privacy policy this file verifies', () => {
  // GitHub's blob view renders privacy.html as escaped source, so the policy
  // is served through Pages from docs/ instead. That makes a second copy on
  // disk, and a second copy is a second thing that can drift: every test above
  // checks the root privacy.html, so a stale docs/privacy.html would publish
  // claims about the code that nothing has verified. Byte-identical or bust --
  // run scripts/build-pages.sh after editing the policy.
  assert.equal(
    read('docs/privacy.html'), policy,
    'docs/privacy.html is out of step with privacy.html -- run scripts/build-pages.sh',
  );
});

test('every asset the published policy references exists in docs/', () => {
  // The mirror is only useful if it renders. privacy.html pulls in two scripts
  // and two logos by relative path; deriving the list from the file means
  // adding a new one to the policy fails here until build-pages.sh copies it,
  // rather than silently 404ing on the live site.
  const refs = [...policy.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)].map((m) => m[1]);
  const local = refs.filter((r) => !/^(?:https?:)?\/\//.test(r) && !r.startsWith('#'));
  assert.ok(local.length > 0, 'no local asset references found -- has the policy changed shape?');
  for (const ref of local) {
    assert.ok(
      statSync(join(root, 'docs', ref), { throwIfNoEntry: false }),
      `privacy.html references "${ref}" but docs/${ref} does not exist -- run scripts/build-pages.sh`,
    );
  }
});

test('the Pages site has a landing page and opts out of Jekyll', () => {
  // The store also requires a reachable homepage URL, and Jekyll would
  // otherwise reprocess the directory rather than serving it as-is.
  assert.ok(statSync(join(root, 'docs/index.html'), { throwIfNoEntry: false }));
  assert.ok(statSync(join(root, 'docs/.nojekyll'), { throwIfNoEntry: false }));
});
