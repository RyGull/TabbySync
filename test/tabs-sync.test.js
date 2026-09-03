// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// tabs-sync.test.js — the tabs engine's conflict-retry orchestration
// (tabs/storage.js's doSync). A 412 means another device (or another sync
// on this device) wrote to the file between our pull and our push; doSync
// is supposed to re-pull, re-merge and retry rather than surfacing the
// conflict straight to the user, since two devices that both sync at
// browser startup routinely race on the very first attempt.

import test from 'node:test';
import assert from 'node:assert/strict';

import { reply, installFetch } from './fake-fetch.js';

// storage.js and providers.js are classic IIFEs that assign to `self`, so
// both globals — and a minimal chrome.storage.local — have to exist before
// either module body runs.
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

/** Run `fn` against a scripted fetch, then restore the real one. */
async function withFetch(replies, fn) {
  const f = installFetch(replies);
  try { return await fn(f.calls); } finally { f.restore(); }
}

// Every attempt below sees a 404 (no remote file yet), which forces a push
// on every retry regardless of local content — isolating the thing this
// test actually cares about: how many times a 412 gets retried.
const NO_REMOTE = reply({ status: 404 });

test('a 412 that clears on a later attempt is retried until it succeeds, not surfaced', async () => {
  await withFetch([
    NO_REMOTE, reply({ status: 412 }),
    NO_REMOTE, reply({ status: 412 }),
    NO_REMOTE, reply({ status: 412 }),
    NO_REMOTE, reply({ status: 200, etag: '"final"' }),
  ], async (calls) => {
    await TabbySync.syncNow(true);
    const puts = calls.filter((c) => c.method === 'PUT');
    assert.equal(puts.length, 4, 'kept retrying past the first conflict instead of giving up after one');
    assert.equal((await TabbySync.getSyncStatus()).status, 'ok');
  });
});

test('a 412 that never clears is eventually reported, not retried forever', async () => {
  await withFetch([
    NO_REMOTE, reply({ status: 412 }),
    NO_REMOTE, reply({ status: 412 }),
    NO_REMOTE, reply({ status: 412 }),
    NO_REMOTE, reply({ status: 412 }),
  ], async (calls) => {
    await assert.rejects(
      TabbySync.syncNow(true),
      (e) => e.conflict === true && /conflict/i.test(e.message),
    );
    const puts = calls.filter((c) => c.method === 'PUT');
    assert.equal(puts.length, 4, 'stopped after a bounded number of attempts rather than looping forever');
  });
});
