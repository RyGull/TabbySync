import http from 'node:http';
import crypto from 'node:crypto';
// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// e2e-switch-destination.mjs — loads the extension for real and tries the two
// things that have emptied someone's bookmarks, to answer one question end to
// end: do the bookmarks in the browser survive it?
//
//   1. switching sync destination underneath a synced profile
//   2. a destination whose file has been emptied, which is what the safety
//      brake exists to stop — and then lifting the brake on purpose
//
//   node scripts/e2e-switch-destination.mjs                 (this working tree)
//   node scripts/e2e-switch-destination.mjs /path/to/copy   (any other build)
//
// It exists because switching sync method used to delete every bookmark on
// the machine, and a unit test on the merge could not have caught it: the
// merge was behaving correctly, on inputs the engine should never have
// assembled. Only running the real thing showed it. test/switch-destination.test.js
// is the fast guard that runs in `npm test`; this is the one that would have
// found it in the first place.
//
// A throwaway mock of tabbysync.php stands in for a server, and the extension
// is copied to a temp directory with the loopback origin pre-granted, because
// chrome.permissions.request opens a dialog no script can click. Nothing in
// the extension itself is modified.

// bearer-token auth, ETag. In memory, so each run starts clean.
const TOKEN = 'test-token-123';
const stored = new Map();
const etag = (s) => '"' + crypto.createHash('md5').update(s).digest('hex') + '"';
function startServer(port) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const name = url.searchParams.get('name') || '';
    const auth = req.headers.authorization || '';
    if (auth !== 'Bearer ' + TOKEN) { res.writeHead(401).end('no'); return; }
    if (req.method === 'GET') {
      if (!stored.has(name)) { res.writeHead(404).end('missing'); return; }
      const body = stored.get(name);
      res.writeHead(200, { 'Content-Type': 'application/json', ETag: etag(body) }).end(body);
    } else if (req.method === 'PUT') {
      let b = ''; req.on('data', c => b += c);
      req.on('end', () => { stored.set(name, b); res.writeHead(200, { ETag: etag(b) }).end('ok'); });
    } else if (req.method === 'DELETE') {
      stored.delete(name); res.writeHead(200).end('ok');
    } else { res.writeHead(405).end(); }
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({ server, files: stored })));
}

import { chromium } from 'playwright';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

const SRC = process.argv[2] || '/home/user/TabbySync';
const PORT = 8791;
const { files } = await startServer(PORT);

// A copy of the extension with the loopback origin pre-granted, so
// chrome.permissions.request resolves without a dialog no test can click.
const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'tbs-ext-'));
fs.cpSync(SRC, ext, { recursive: true, filter: (s) => !/\/(\.git|node_modules|docs|website|dist)$/.test(s) });
const mf = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
mf.host_permissions = ['http://127.0.0.1/*'];
fs.writeFileSync(path.join(ext, 'manifest.json'), JSON.stringify(mf, null, 2));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbs-prof-'));
const ctx = await chromium.launchPersistentContext(dir, { headless: false, viewport: { width: 1000, height: 900 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, '--no-first-run', '--no-default-browser-check'] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 30000 });
const id = new URL(sw.url()).host;
const p = await ctx.newPage();
await p.goto(`chrome-extension://${id}/options.html`);

const bookmarks = () => p.evaluate(async () => {
  const t = await chrome.bookmarks.getTree();
  const out = [];
  (function walk(n) { if (n.url) out.push(n.url); (n.children || []).forEach(walk); })(t[0]);
  return out;
});
const configure = (syncName) => p.evaluate(async (n) => {
  await self.TabbySyncConfig.setConfig({
    provider: 'custom', serverUrl: 'http://127.0.0.1:8791/tabbysync.php',
    token: 'test-token-123', syncName: n, bookmarks: { enabled: true, autoSync: false },
  });
}, syncName);
const syncNow = () => p.evaluate(() => new Promise(r => chrome.runtime.sendMessage({ type: 'syncNow' }, r)));

// 1. real bookmarks in the browser
await p.evaluate(async () => {
  const bar = (await chrome.bookmarks.getTree())[0].children[0];
  const f = await chrome.bookmarks.create({ parentId: bar.id, title: 'Work' });
  await chrome.bookmarks.create({ parentId: f.id, title: 'MDN', url: 'https://developer.mozilla.org/' });
  await chrome.bookmarks.create({ parentId: f.id, title: 'GitHub', url: 'https://github.com/' });
  await chrome.bookmarks.create({ parentId: bar.id, title: 'News', url: 'https://news.example/' });
});
const started = (await bookmarks()).length;
console.log('start           :', started, 'bookmarks in the browser');

// 2. sync to destination A
await configure('aaa'); await p.waitForTimeout(400);
console.log('sync to A       :', JSON.stringify(await syncNow()).slice(0, 90));
console.log('  browser now   :', (await bookmarks()).length, '| file on server A:', files.has('bookmarks-aaa.json'));

// 3. switch to destination B (a different sync name = a different destination)
await configure('bbb'); await p.waitForTimeout(400);
console.log('sync to B       :', JSON.stringify(await syncNow()).slice(0, 90));
const after = await bookmarks();
console.log('  browser now   :', after.length, 'bookmarks');

// 4. and back to A
await configure('aaa'); await p.waitForTimeout(400);
await syncNow();
console.log('back to A       :', (await bookmarks()).length, 'bookmarks');

console.log(after.length === started
  ? `\nRESULT 1: all ${started} bookmarks SURVIVED the switch`
  : `\nRESULT 1: DATA LOSS — ${started - after.length} of ${started} bookmarks deleted by the switch`);

// ---------------------------------------------------------------------------
// 2. the safety brake: a destination whose file has been emptied
// ---------------------------------------------------------------------------
// The brake only guards collections of 20 or more, so this needs a realistic
// number of bookmarks rather than the three above.
console.log('\n--- safety brake ---');
await p.evaluate(async () => {
  const bar = (await chrome.bookmarks.getTree())[0].children[0];
  for (let i = 0; i < 25; i++) {
    await chrome.bookmarks.create({ parentId: bar.id, title: 'Link ' + i, url: 'https://example.com/' + i });
  }
});
await configure('brake'); await p.waitForTimeout(400);
await syncNow();
const before = (await bookmarks()).length;
console.log('synced          :', before, 'bookmarks, file on server:', files.has('bookmarks-brake.json'));

// Someone else's machine deletes the lot, or the file is damaged: the
// destination still exists and still answers, it is just empty now.
const emptied = JSON.parse(files.get('bookmarks-brake.json'));
emptied.children.forEach((root) => { root.children = []; });
files.set('bookmarks-brake.json', JSON.stringify(emptied));
console.log('server file emptied by "another machine"');

const blocked = await syncNow();
console.log('sync result     :', blocked && blocked.status, '—', (blocked && blocked.message || '').slice(0, 78));
const held = (await bookmarks()).length;
console.log('browser now     :', held, 'bookmarks');
console.log(held === before
  ? `RESULT 2: the brake HELD — all ${held} bookmarks still here, nothing pushed`
  : `RESULT 2: the brake FAILED — ${before - held} bookmarks deleted`);

// And the release: the same sync, accepted on purpose.
const allowed = await p.evaluate(() => new Promise(r =>
  chrome.runtime.sendMessage({ type: 'syncNow', allowLargeDeletion: true }, r)));
const afterAllow = (await bookmarks()).length;
console.log('\nafter accepting :', afterAllow, 'bookmarks —',
  allowed && allowed.ok ? 'the deletion went through as asked' : 'FAILED: ' + JSON.stringify(allowed));
console.log(afterAllow === 0
  ? 'RESULT 3: the brake can be lifted when the deletion is real'
  : 'RESULT 3: lifting the brake did not apply the deletion');
await ctx.close();
fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(ext, { recursive: true, force: true });
process.exit(0);
