// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// tabs-sync-queue.test.js — syncNow() must serialize overlapping calls.
//
// Without this, two triggers close together on the SAME device (a manual
// click racing schedulePush's own debounced auto-push, or two automatic
// triggers) can each open their own doSync at once. Since even an
// encrypted no-op write changes the file's bytes (fresh salt/IV every
// time), any such overlap 412s — this extension racing against its own
// writes, with no second device involved at all. That reproduced even
// with the OTHER device's extension fully disabled.
//
// The fix queues calls rather than sharing them: an earlier version of
// this code made an overlapping call just return the already-running
// call's promise, which broke manual "Sync now" — a click would inherit
// whatever automatic attempt happened to already be in flight instead of
// getting its own. These tests pin down both halves: no two doSync runs
// ever overlap, AND every call still gets its own independent outcome.

import test from 'node:test';
import assert from 'node:assert/strict';

import { reply, installFetch } from './fake-fetch.js';

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

const SETTINGS_CFG = {
  serverUrl: 'https://example.com/tabbysync.php',
  token: 'tok',
  syncName: 'work',
  provider: 'custom',
  passphrase: '',
  profileLabel: '',
  gistId: '', jsonbinTabsId: '', jsonbinBookmarksId: '',
  tabs: {
    enabled: true, intervalMin: 5, dedupe: '', restoreAsGroup: false,
    removeOnRestore: false, pinList: false, backupPass: '',
  },
};
globalThis.self.TabbySyncConfig = {
  getConfig: async () => SETTINGS_CFG,
  setConfig: async () => {},
  sanitizeSyncName: (n) => n || '',
};

await import('../shared/providers.js');
await import('../tabs/storage.js');
const TabbySync = globalThis.self.TabbySync;

async function withFetch(replies, fn) {
  const f = installFetch(replies);
  try { return await fn(f.calls); } finally { f.restore(); }
}

const NO_REMOTE = reply({ status: 404 });

test('two calls fired before the first settles run strictly one after the other, never overlapping', async () => {
  await withFetch([
    NO_REMOTE, reply({ status: 200, etag: '"a"' }), // call 1: GET, PUT
    NO_REMOTE, reply({ status: 200, etag: '"b"' }), // call 2: GET, PUT
  ], async (calls) => {
    const p1 = TabbySync.syncNow(true);
    const p2 = TabbySync.syncNow(true); // fired while p1 is still pending
    await Promise.all([p1, p2]);
    assert.equal(calls.length, 4, 'both calls ran to completion');
    // If they'd overlapped, call 2's GET could land before call 1's PUT.
    // Queued, the order must be exactly: GET, PUT, GET, PUT.
    assert.deepEqual(calls.map((c) => c.method), ['GET', 'PUT', 'GET', 'PUT']);
  });
});

test('a queued call still gets its own outcome, not the one ahead of it in line', async () => {
  await withFetch([
    NO_REMOTE, reply({ status: 500 }),               // call 1: fails
    NO_REMOTE, reply({ status: 200, etag: '"ok"' }),  // call 2: succeeds
  ], async () => {
    const p1 = TabbySync.syncNow(true);
    const p2 = TabbySync.syncNow(true);
    await assert.rejects(p1, /HTTP 500/);
    await assert.doesNotReject(p2);
  });
});

test('a failed call does not jam the queue for calls after it', async () => {
  await withFetch([
    NO_REMOTE, reply({ status: 500 }),
    NO_REMOTE, reply({ status: 200, etag: '"still works"' }),
    NO_REMOTE, reply({ status: 200, etag: '"and again"' }),
  ], async (calls) => {
    await assert.rejects(TabbySync.syncNow(true));
    await assert.doesNotReject(TabbySync.syncNow(true));
    await assert.doesNotReject(TabbySync.syncNow(true));
    assert.equal(calls.filter((c) => c.method === 'PUT').length, 3);
  });
});
