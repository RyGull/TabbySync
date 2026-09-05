// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// e2e-bulk-open.mjs — loads the extension and tries to reopen a lot of saved
// tabs, which is the action that nearly crashed a user's machine: "Reopen
// everything" against a few hundred saved tabs opened them all at once.
//
//   node scripts/e2e-bulk-open.mjs
//
// It checks the three things that make that safe now: small lists still open
// without being asked about, a big one asks first and opens nothing until
// answered, and a run in progress can be stopped — leaving the list intact
// even when "remove links after I reopen them" is on.
//
// Opens real tabs in a throwaway profile, so it is heavier than `npm test`;
// test/bulk-open.test.js is the fast guard that keeps the wiring in place.

import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tbs-bulk-'));
const ctx = await chromium.launchPersistentContext(dir, {
  headless: false, viewport: { width: 1100, height: 900 },
  args: [`--disable-extensions-except=${ROOT}`, `--load-extension=${ROOT}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars'],
});
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 30000 });
const id = new URL(sw.url()).host;
const now = Date.now();
const p = await ctx.newPage();
p.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
await p.goto(`chrome-extension://${id}/tabs/tablist.html`);

const openTabs = async () => (await ctx.pages()).length;
const seed = (n, removeOnRestore = false) => p.evaluate(async ({ now, n, removeOnRestore }) => {
  const tabs = [];
  for (let i = 0; i < n; i++) {
    tabs.push({ url: 'data:text/html,' + encodeURIComponent('<title>t' + i + '</title>'), title: 'Tab ' + i });
  }
  await chrome.storage.local.set({
    'sl.tab.enabled': true, 'sl.tab.removeOnRestore': removeOnRestore,
    'sl.tab.state': { version: 1, updatedAt: now, deleted: {}, trash: [], trashDeleted: {},
      groups: [{ id: 'g', createdAt: now, updatedAt: now, name: 'Saved', locked: false, pinned: false, tabs }] },
  });
}, { now, n, removeOnRestore });
const clearOpened = async () => {
  await p.evaluate(async () => {
    const ts = await chrome.tabs.query({});
    for (const t of ts) if (t.url.startsWith('data:')) await chrome.tabs.remove(t.id);
  });
  await p.waitForTimeout(800);
};

// 1. a handful just opens
await seed(8); await p.reload(); await p.waitForTimeout(1000);
let base = await openTabs();
await p.click('#restore-all'); await p.waitForTimeout(2200);
console.log(`8 saved   : asked=${await p.isVisible('#bulk-overlay .modal')} opened=${await openTabs() - base}  (expected asked=false opened=8)`);
await clearOpened();

// 2. a lot asks, and opens nothing until answered
await seed(300, true); await p.reload(); await p.waitForTimeout(1200);
base = await openTabs();
await p.click('#restore-all'); await p.waitForTimeout(700);
console.log(`300 saved : asked=${await p.isVisible('#bulk-overlay .modal')} opened=${await openTabs() - base}  (expected asked=true opened=0)`);
console.log(`            "${(await p.textContent('#bulk-title')).trim()}"`);

// 3. Stop halts it, and the list survives even with remove-after-reopen on
await p.evaluate(() => document.getElementById('bulk-all').click());
await p.waitForTimeout(1000);
const mid = await openTabs() - base;
await p.evaluate(() => document.getElementById('bulk-stop').click());
await p.waitForTimeout(600);
const atStop = await openTabs() - base;
await p.waitForTimeout(2500);
const settled = await openTabs() - base;
console.log(`stopping  : ${mid} open when Stop pressed, ${atStop} at Stop, ${settled} after waiting  (of 300)`);
console.log(`            stop held: ${settled === atStop}`);
console.log(`            list kept: ${(await p.textContent('.band-count')).trim()}  (must still be 300)`);

await ctx.close();
fs.rmSync(dir, { recursive: true, force: true });
process.exit(0);
