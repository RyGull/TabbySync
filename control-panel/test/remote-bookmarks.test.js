// remote-bookmarks.test.js — load()/save() against a scripted fetch, the same
// technique the extension's own test/providers.test.js uses.

import test from 'node:test';
import assert from 'node:assert/strict';

import { reply, installFetch } from '../../test/fake-fetch.js';
import { bm, folder, tree, urls, BAR_ID, OTHER_ID } from '../../test/helpers.js';
import { encryptJSON } from '../vendor/bookmarks-lib/crypto.js';
import { loadVendored } from '../src/core/provider-shim.js';
import * as remoteBookmarks from '../src/core/remote-bookmarks.js';

await loadVendored(); // sets up self.TabbySyncConfig/TabbySyncProviders that vendor/bookmarks-lib/sync.js needs

const PROFILE = { id: 'p1', provider: 'custom', serverUrl: 'https://example.com/tabbysync.php', token: 'tok', syncName: 'work', passphrase: '' };

async function withFetch(replies, fn) {
  const f = installFetch(replies);
  try { return await fn(f.calls); } finally { f.restore(); }
}

test('load() with nothing on the server returns an empty tree, not null/undefined', async () => {
  await withFetch([reply({ status: 404 })], async () => {
    const { tree: t, empty } = await remoteBookmarks.load(PROFILE);
    assert.equal(empty, true);
    assert.deepEqual(urls(t), []);
  });
});

test('load() decrypts an encrypted remote file when the profile has the right passphrase', async () => {
  const plainTree = tree([bm('a', 'A', 'https://a.example/')]);
  const envelope = await encryptJSON(plainTree, 'correct-horse');
  await withFetch([reply({ body: JSON.stringify(envelope) })], async () => {
    const { tree: t } = await remoteBookmarks.load({ ...PROFILE, passphrase: 'correct-horse' });
    assert.deepEqual(urls(t), ['https://a.example/']);
  });
});

test('save() on a brand-new destination (404) just writes the working tree', async () => {
  const working = tree([bm('a', 'A', 'https://a.example/')]);
  await withFetch([reply({ status: 404 }), reply({ status: 200 })], async (calls) => {
    const { tree: saved } = await remoteBookmarks.save(PROFILE, working, null);
    assert.deepEqual(urls(saved), ['https://a.example/']);
    assert.equal(calls.length, 2);
    assert.equal(calls[0].method, 'GET');
    assert.equal(calls[1].method, 'PUT');
    const sentBody = JSON.parse(calls[1].body);
    assert.deepEqual(urls(sentBody), ['https://a.example/']);
  });
});

test('save() merges a concurrent remote change instead of clobbering it', async () => {
  // What we loaded a moment ago, before any local edits:
  const base = tree([bm('shared', 'Shared', 'https://shared.example/')]);
  // Our local edit since then: added a new bookmark.
  const working = tree([bm('shared', 'Shared', 'https://shared.example/'), bm('mine', 'Mine', 'https://mine.example/')]);
  // What's ACTUALLY on the server now: someone else added a different one.
  const freshRemote = tree([bm('shared', 'Shared', 'https://shared.example/'), bm('theirs', 'Theirs', 'https://theirs.example/')]);

  await withFetch([reply({ body: JSON.stringify(freshRemote) }), reply({ status: 200 })], async (calls) => {
    const { tree: merged } = await remoteBookmarks.save(PROFILE, working, base);
    assert.deepEqual(urls(merged), ['https://mine.example/', 'https://shared.example/', 'https://theirs.example/']);
    const sentBody = JSON.parse(calls[1].body);
    assert.deepEqual(urls(sentBody), ['https://mine.example/', 'https://shared.example/', 'https://theirs.example/']);
  });
});

test('save() refuses a merge that would delete most of a substantial tree, unless overridden', async () => {
  // The working copy (25 bookmarks) is unchanged from base — but the
  // destination now has only 2 of them, as if something else (another
  // device, a reset file) deleted the rest. A plain merge would honor that
  // deletion and collapse the working copy down to 2 as well: an 92% loss
  // on a tree well above the brake's 20-bookmark floor.
  const many = Array.from({ length: 25 }, (_, i) => bm(`id${i}`, `T${i}`, `https://x${i}.example/`));
  const base = tree(many);
  const working = tree(many);
  const shrunkRemote = tree(many.slice(0, 2));

  await withFetch([reply({ body: JSON.stringify(shrunkRemote) })], async (calls) => {
    await assert.rejects(
      () => remoteBookmarks.save(PROFILE, working, base),
      (err) => { assert.equal(err.code, 'LARGE_DELETION'); return true; }
    );
    assert.equal(calls.length, 1, 'must not have written anything');
  });

  await withFetch([reply({ body: JSON.stringify(shrunkRemote) }), reply({ status: 200 })], async () => {
    const { tree: saved } = await remoteBookmarks.save(PROFILE, working, base, { allowLargeDeletion: true });
    assert.equal(urls(saved).length, 2);
  });
});

test('save() does not treat a since-vanished remote as "everything was deleted"', async () => {
  // We loaded a substantial tree a while ago (base), but the destination
  // now answers 404 (e.g. the file/bin was reset). A real base compared
  // against nothing would read as a 100% deletion and wipe the result.
  const many = Array.from({ length: 25 }, (_, i) => bm(`id${i}`, `T${i}`, `https://x${i}.example/`));
  const base = tree(many);

  await withFetch([reply({ status: 404 }), reply({ status: 200 })], async () => {
    const { tree: saved } = await remoteBookmarks.save(PROFILE, base, base);
    assert.equal(urls(saved).length, 25, 'the working tree must survive intact');
  });
});
