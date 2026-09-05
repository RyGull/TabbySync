// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// bulk-open.test.js — reopening saved tabs must not be able to take the
// machine down.
//
// Reported: "Reopen everything" against a few hundred saved tabs tried to open
// over 800 at once and nearly crashed the computer. It asked nothing first,
// had no ceiling, and created every tab in one synchronous burst.
//
// The behaviour itself needs a browser, and scripts/e2e-bulk-open.mjs drives
// it there. What is checked here is that the guard stays wired into every path
// that can open tabs in bulk — the cheap check that fails the moment someone
// adds a fourth path, or "simplifies" one of the three back to a raw loop.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('../tabs/tablist.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../tabs/tablist.html', import.meta.url), 'utf8');

test('the thresholds are set where a person would expect them', () => {
  const warn = Number(js.match(/var BULK_WARN_AT = (\d+)/)[1]);
  const first = Number(js.match(/var BULK_FIRST_N = (\d+)/)[1]);
  const size = Number(js.match(/var BATCH_SIZE = (\d+)/)[1]);
  const pause = Number(js.match(/var BATCH_PAUSE = (\d+)/)[1]);

  assert.ok(warn >= 5 && warn <= 30, 'asking below 5 would nag; above 30 is already a lot of tabs');
  assert.ok(first > 0 && first <= 50, '"just some of them" has to be a number of tabs a browser shrugs at');
  assert.ok(size > 0 && size <= 20, 'a big batch is a burst again, which is the thing being fixed');
  assert.ok(pause >= 50, 'without a real pause between batches the browser never gets a turn');
});

test('every path that can open many tabs asks first', () => {
  for (const fn of ['function restoreAll', 'function restoreGroup']) {
    const start = js.indexOf(fn);
    assert.ok(start > 0, `${fn} is gone — this test needs re-pointing`);
    const body = js.slice(start, start + 2000);
    assert.match(body, /askHowMany\(/, `${fn} opens tabs without asking how many`);
  }
});

test('tabs are created in batches, never in one burst', () => {
  assert.match(js, /function createInBatches\(/, 'the batching helper is gone');
  assert.match(js, /setTimeout\(tick, BATCH_PAUSE\)/, 'batches no longer yield between ticks');
  assert.match(js, /if \(bulkStop \|\| i >= urls\.length\)/, 'a run in progress can no longer be stopped');
  // The grouped opener must go through the same helper rather than mapping
  // every URL to a create() call the way it used to.
  const grouped = js.slice(js.indexOf('function openTabsGrouped'), js.indexOf('function groupLabel'));
  assert.match(grouped, /createInBatches\(/, 'the tab-group path still opens everything at once');
});

test('a stopped or partial restore never clears the list', () => {
  // The dangerous combination: "remove links after I reopen them" is on, the
  // restore is stopped a third of the way through, and the rest of the list
  // is deleted anyway. Both restore paths gate removal on completion.
  const matches = js.match(/var complete = res && !res\.stopped && res\.opened === /g) || [];
  assert.equal(matches.length, 2, 'both restoreGroup and restoreAll must gate removal on a complete run');
});

test('the question offers a way out, and the page can be left alone', () => {
  for (const id of ['bulk-title', 'bulk-msg', 'bulk-some', 'bulk-all', 'bulk-cancel', 'bulk-progress', 'bulk-stop']) {
    assert.ok(html.includes(`id="${id}"`), `the dialog is missing #${id}`);
  }
  assert.match(js, /bulkOverlay\.addEventListener\("click"/, 'clicking the backdrop does not dismiss it');
  assert.match(js, /bulkStop = true;/, 'Escape and the backdrop do not stop a run');
});
