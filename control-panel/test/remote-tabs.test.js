// remote-tabs.test.js — load()/save() against a scripted fetch.

import test from 'node:test';
import assert from 'node:assert/strict';

import { reply, installFetch } from '../../test/fake-fetch.js';
import { loadVendored, getVendored } from '../src/core/provider-shim.js';
import * as remoteTabs from '../src/core/remote-tabs.js';

await loadVendored();
const T = getVendored().TabbySync;

const PROFILE = { id: 'p1', provider: 'custom', serverUrl: 'https://example.com/tabbysync.php', token: 'tok', syncName: 'work', passphrase: '' };

async function withFetch(replies, fn) {
  const f = installFetch(replies);
  try { return await fn(f.calls); } finally { f.restore(); }
}

function group(id, name, tabs, updatedAt = 1) {
  return { id, createdAt: updatedAt, updatedAt, name, locked: false, pinned: false, tabs: tabs.map((url) => ({ url, title: url, favIconUrl: '' })) };
}
function rawState(groups, updatedAt = 1) {
  return { app: 'TabbySync', version: 1, key: 'work', updatedAt, deleted: {}, trash: [], trashDeleted: {}, groups };
}
function groupIds(state) { return state.groups.map((g) => g.id).sort(); }

test('load() with nothing on the server returns an empty state, not null', async () => {
  await withFetch([reply({ status: 404 })], async () => {
    const { state, empty } = await remoteTabs.load(PROFILE);
    assert.equal(empty, true);
    assert.deepEqual(state.groups, []);
  });
});

test('load() decrypts an encrypted remote file when the profile has the right passphrase', async () => {
  const plaintext = JSON.stringify(rawState([group('g1', 'Reading', ['https://a/'])]));
  const envelope = await T.encryptString('correct-horse', plaintext);
  await withFetch([reply({ body: JSON.stringify(envelope) })], async () => {
    const { state } = await remoteTabs.load({ ...PROFILE, passphrase: 'correct-horse' });
    assert.deepEqual(groupIds(state), ['g1']);
  });
});

test('save() on a brand-new destination (404) just writes the working state', async () => {
  const working = rawState([group('g1', 'Mine', ['https://a/'])]);
  await withFetch([reply({ status: 404 }), reply({ status: 200 })], async (calls) => {
    const { state: saved } = await remoteTabs.save(PROFILE, working);
    assert.deepEqual(groupIds(saved), ['g1']);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[1].method, 'PUT');
  });
});

test('save() merges a concurrently-added remote list instead of clobbering it', async () => {
  const working = rawState([group('mine', 'Mine', ['https://mine/'])]);
  const freshRemote = rawState([group('theirs', 'Theirs', ['https://theirs/'])]);
  await withFetch([reply({ body: JSON.stringify(freshRemote) }), reply({ status: 200 })], async (calls) => {
    const { state: merged } = await remoteTabs.save(PROFILE, working);
    assert.deepEqual(groupIds(merged), ['mine', 'theirs']);
    const sentBody = JSON.parse(calls[1].body);
    assert.deepEqual(groupIds(sentBody), ['mine', 'theirs']);
  });
});

test('save() retries once on a 412 conflict and succeeds on the second attempt', async () => {
  const working = rawState([group('g1', 'Mine', ['https://a/'])]);
  await withFetch([
    reply({ body: JSON.stringify(rawState([])), etag: '"abc"' }), // pull #1
    reply({ status: 412 }),                                       // push #1 conflicts
    reply({ body: JSON.stringify(rawState([])), etag: '"def"' }), // pull #2 (retry)
    reply({ status: 200 }),                                       // push #2 succeeds
  ], async (calls) => {
    const { state } = await remoteTabs.save(PROFILE, working);
    assert.deepEqual(groupIds(state), ['g1']);
    assert.equal(calls.length, 4);
  });
});

test('save() gives up after exhausting its one retry', async () => {
  const working = rawState([group('g1', 'Mine', ['https://a/'])]);
  await withFetch([
    reply({ body: JSON.stringify(rawState([])) }),
    reply({ status: 412 }),
    reply({ body: JSON.stringify(rawState([])) }),
    reply({ status: 412 }),
  ], async () => {
    await assert.rejects(() => remoteTabs.save(PROFILE, working), /conflict/);
  });
});

test('save() honours a deleted list even though the destination never saw the tombstone before', async () => {
  // Simulates: this profile deleted list "gone" locally (tombstoned); the
  // destination still has it from before. The tombstone must win.
  const deletedAt = 100;
  const working = { ...rawState([]), deleted: { gone: deletedAt } };
  const freshRemote = rawState([group('gone', 'Gone', ['https://a/'], 1)]); // updatedAt=1, well before the tombstone
  await withFetch([reply({ body: JSON.stringify(freshRemote) }), reply({ status: 200 })], async () => {
    const { state } = await remoteTabs.save(PROFILE, working);
    assert.deepEqual(groupIds(state), []);
  });
});
