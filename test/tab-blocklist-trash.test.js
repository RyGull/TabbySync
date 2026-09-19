// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// tab-blocklist-trash.test.js — covers three settings added to the tabs
// engine: the "never save tabs from these sites" blocklist (parseBlocklist /
// isBlockedUrl / filterBlocked) and the configurable "Recently deleted"
// retention (trashDays, threaded into pruneTrash and mergeStates instead of
// the old hardcoded 30-day constant).

import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.self = globalThis;

function fakeStorageLocal() {
  let store = {};
  return {
    async get(keys) {
      if (keys == null) return Object.assign({}, store);
      if (typeof keys === 'string') return { [keys]: store[keys] };
      if (Array.isArray(keys)) {
        const out = {};
        for (const k of keys) if (k in store) out[k] = store[k];
        return out;
      }
      const out = {};
      for (const k of Object.keys(keys)) out[k] = (k in store) ? store[k] : keys[k];
      return out;
    },
    async set(obj) { Object.assign(store, obj); },
  };
}
globalThis.chrome = { storage: { local: fakeStorageLocal() } };
globalThis.self.TabbySyncConfig = {
  getConfig: async () => ({ tabs: {} }),
  setConfig: async () => {},
  sanitizeSyncName: (n) => n || '',
};

await import('../shared/providers.js');
await import('../tabs/storage.js');
const TabbySync = globalThis.self.TabbySync;

// ---------------------------------------------------------------------------
// parseBlocklist
// ---------------------------------------------------------------------------

test('parseBlocklist accepts a bare domain, a full URL, and mixed separators', () => {
  const out = TabbySync.parseBlocklist('example.com, mail.example.com\nhttps://bank.example/login?x=1');
  assert.deepEqual(out, ['example.com', 'mail.example.com', 'bank.example']);
});

test('parseBlocklist strips a leading www. and lowercases', () => {
  assert.deepEqual(TabbySync.parseBlocklist('WWW.Example.COM'), ['example.com']);
});

test('parseBlocklist drops blank lines and unparseable garbage', () => {
  assert.deepEqual(TabbySync.parseBlocklist('example.com\n\n   \n,,,\nnot a url at all???'), ['example.com']);
});

test('parseBlocklist on empty/missing input returns an empty list', () => {
  assert.deepEqual(TabbySync.parseBlocklist(''), []);
  assert.deepEqual(TabbySync.parseBlocklist(undefined), []);
});

// ---------------------------------------------------------------------------
// isBlockedUrl / filterBlocked
// ---------------------------------------------------------------------------

test('isBlockedUrl matches the exact host and any subdomain, never a mere substring', () => {
  const list = TabbySync.parseBlocklist('example.com');
  assert.equal(TabbySync.isBlockedUrl('https://example.com/page', list), true);
  assert.equal(TabbySync.isBlockedUrl('https://mail.example.com/inbox', list), true);
  assert.equal(TabbySync.isBlockedUrl('https://www.example.com/', list), true);
  // "notexample.com" contains "example.com" as a substring but is a
  // different, unrelated domain — must not match.
  assert.equal(TabbySync.isBlockedUrl('https://notexample.com/', list), false);
  assert.equal(TabbySync.isBlockedUrl('https://example.com.evil.com/', list), false);
  assert.equal(TabbySync.isBlockedUrl('https://other.com/', list), false);
});

test('isBlockedUrl is false for an empty blocklist and for an unparseable URL', () => {
  assert.equal(TabbySync.isBlockedUrl('https://example.com/', []), false);
  assert.equal(TabbySync.isBlockedUrl('not a url', ['example.com']), false);
});

test('filterBlocked removes only the blocked tabs, without mutating the input', () => {
  const tabs = [
    { url: 'https://example.com/', title: 'a' },
    { url: 'https://keep-this.com/', title: 'b' },
    { url: 'https://mail.example.com/', title: 'c' },
  ];
  const list = TabbySync.parseBlocklist('example.com');
  const out = TabbySync.filterBlocked(tabs, list);
  assert.deepEqual(out.map((t) => t.url), ['https://keep-this.com/']);
  assert.equal(tabs.length, 3, 'the original array was mutated');
});

test('filterBlocked with no blocklist returns every tab, as a copy', () => {
  const tabs = [{ url: 'https://a.com/' }, { url: 'https://b.com/' }];
  const out = TabbySync.filterBlocked(tabs, []);
  assert.deepEqual(out, tabs);
  assert.notEqual(out, tabs, 'should be a new array, not the same reference');
});

// ---------------------------------------------------------------------------
// configurable trash retention (trashDays)
// ---------------------------------------------------------------------------

function stateWithTrashAt(daysAgoList) {
  const state = TabbySync.emptyState();
  const now = Date.now();
  state.trash = daysAgoList.map((days, i) => ({
    tid: 't' + i, deletedAt: now - days * 24 * 3600 * 1000,
    kind: 'tab', name: 'x', sourceName: '', tabs: [],
  }));
  state.trashDeleted = {};
  return state;
}

test('pruneTrash with no trashDays given falls back to 30 days, matching the old hardcoded behavior', () => {
  const state = stateWithTrashAt([10, 29, 31, 45]);
  const pruned = TabbySync.pruneTrash(state);
  const kept = pruned.trash.map((e) => e.tid);
  assert.deepEqual(kept.sort(), ['t0', 't1'], 'entries older than 30 days should be pruned by default');
});

test('pruneTrash honors a shorter configured trashDays', () => {
  const state = stateWithTrashAt([2, 5, 10]);
  const pruned = TabbySync.pruneTrash(state, 3);
  assert.deepEqual(pruned.trash.map((e) => e.tid), ['t0'], 'only the entry under 3 days should survive');
});

test('pruneTrash honors a longer configured trashDays', () => {
  const state = stateWithTrashAt([10, 45, 100]);
  const pruned = TabbySync.pruneTrash(state, 90);
  assert.deepEqual(pruned.trash.map((e) => e.tid).sort(), ['t0', 't1'], 'the 100-day-old entry should still be pruned, the rest kept');
});

test('trashAdd threads its own trashDays argument into the prune it runs after adding', () => {
  const state = stateWithTrashAt([2, 10]);
  const added = TabbySync.trashAdd(state, [{ kind: 'tab', name: 'new', tabs: [] }], 5);
  const kept = added.trash.map((e) => e.tid);
  assert.ok(kept.includes('t0'), 'the 2-day-old entry should survive a 5-day retention');
  assert.ok(!kept.includes('t1'), 'the 10-day-old entry should be pruned under a 5-day retention');
});

test('mergeStates threads the same configurable retention through the merge path', () => {
  const local = stateWithTrashAt([2, 10]);
  const remote = stateWithTrashAt([2, 10]);
  remote.trash[0].tid = 'r0'; remote.trash[1].tid = 'r1'; // distinct ids so nothing collides
  const shortMerge = TabbySync.mergeStates(local, remote, 5);
  const shortIds = shortMerge.state.trash.map((e) => e.tid).sort();
  assert.deepEqual(shortIds, ['r0', 't0'], 'only entries under 5 days should survive the merge');

  const longMerge = TabbySync.mergeStates(local, remote, 30);
  assert.equal(longMerge.state.trash.length, 4, 'all four should survive a 30-day merge');
});
