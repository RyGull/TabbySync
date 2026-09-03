// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// tabs-parse.test.js — parsing a synced tabs file must be deterministic.
//
// mergeStates matches "the same group" across a local copy and a freshly
// pulled remote copy purely by id (see tabs/storage.js). If parsing the
// exact same file twice ever produced two different ids for the same
// group — e.g. a fallback like uid() for a group that's missing its id —
// that group would look brand new on every single sync, the merged state
// would never stop looking "changed," and a sync would never stop needing
// to push: a conflict on every attempt, forever, even with only one device
// ever writing to the file. A group written by this extension always
// carries its own id (makeGroup() sets one at creation), so this only
// matters for a malformed or pre-id-scheme legacy entry — but for exactly
// that entry, correctness here is what stands between "converges" and
// "never converges."

import test from 'node:test';
import assert from 'node:assert/strict';

import { reply, installFetch } from './fake-fetch.js';

globalThis.self = globalThis;
globalThis.chrome = {
  storage: {
    local: {
      async get() { return {}; },
      async set() {},
    },
  },
};
globalThis.self.TabbySyncConfig = {
  getConfig: async () => ({}),
  setConfig: async () => {},
  sanitizeSyncName: (n) => n || '',
};

await import('../shared/providers.js');
await import('../tabs/storage.js');
const TabbySync = globalThis.self.TabbySync;

const SETTINGS = {
  provider: 'custom',
  baseUrl: 'https://example.com/tabbysync.php',
  token: 'tok',
  syncKey: 'work',
  syncName: 'work',
  passphrase: '',
};

async function withFetch(replies, fn) {
  const f = installFetch(replies);
  try { return await fn(f.calls); } finally { f.restore(); }
}

test('a group missing its id gets the same id on every parse of the same file', async () => {
  const fileWithNoId = JSON.stringify({
    app: 'TabbySync', version: 1, updatedAt: 1000, deleted: {}, trash: [], trashDeleted: {},
    groups: [{ name: 'legacy group', tabs: [{ url: 'https://example.com/a' }] }],
  });
  await withFetch([
    reply({ body: fileWithNoId }),
    reply({ body: fileWithNoId }),
  ], async () => {
    const first = await TabbySync.pullRemote(SETTINGS);
    const second = await TabbySync.pullRemote(SETTINGS);
    assert.equal(first.state.groups.length, 1);
    assert.equal(second.state.groups.length, 1);
    assert.equal(
      first.state.groups[0].id, second.state.groups[0].id,
      'parsing the identical file twice produced two different ids for the same group',
    );
  });
});

test('mergeStates converges (stops reporting "changed") once ids are stable across parses', async () => {
  const fileWithNoId = JSON.stringify({
    app: 'TabbySync', version: 1, updatedAt: 1000, deleted: {}, trash: [], trashDeleted: {},
    groups: [{ name: 'legacy group', tabs: [{ url: 'https://example.com/a' }] }],
  });
  await withFetch([
    reply({ body: fileWithNoId }),
    reply({ body: fileWithNoId }),
  ], async () => {
    const pulled1 = await TabbySync.pullRemote(SETTINGS);
    const pulled2 = await TabbySync.pullRemote(SETTINGS);
    // Simulate a solo device merging its own just-pulled copy against
    // itself on the next sync — this is the exact no-op case that should
    // never need another push.
    const merged = TabbySync.mergeStates(pulled1.state, pulled2.state);
    assert.equal(merged.changed, false, 'identical content across two parses was still reported as changed');
  });
});
