// sessions.test.js — integration-level coverage of cross-profile copy/move,
// the actual "everything under one roof" feature: two independently-synced
// profiles, exercised through a small fake self-hosted server (URL-keyed, so
// it behaves like a real one under concurrent GET/PUT/If-Match) rather than
// a flat scripted reply queue — the ordering of which profile gets talked to
// when is exactly the thing being tested here.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { reply } from '../../test/fake-fetch.js';
import { urls, BAR_ID, OTHER_ID } from '../../test/helpers.js';
import { flatten } from '../vendor/bookmarks-lib/tree.js';
import { createProfileStore } from '../src/core/profile-store.js';
import { createSessionManager } from '../src/core/sessions.js';
import { addBookmark } from '../src/core/bookmarks-ops.js';
import { addList } from '../src/core/tabs-ops.js';
import { loadVendored } from '../src/core/provider-shim.js';

await loadVendored(); // tabs-ops.js's addList needs this loaded before first use

function fakeServer() {
  const files = new Map();
  let n = 0;
  async function fetchImpl(url, opts = {}) {
    const method = opts.method || 'GET';
    const headers = opts.headers || {};
    const existing = files.get(url);
    if (method === 'GET') {
      if (!existing) return reply({ status: 404 });
      return reply({ status: 200, body: existing.text, etag: existing.etag });
    }
    if (method === 'PUT') {
      const ifMatch = headers['If-Match'];
      if (ifMatch && (!existing || existing.etag !== ifMatch)) return reply({ status: 412 });
      n += 1;
      const etag = `"etag${n}"`;
      files.set(url, { text: opts.body, etag });
      return reply({ status: 200, etag });
    }
    return reply({ status: 405 });
  }
  return {
    install() { const prev = globalThis.fetch; globalThis.fetch = fetchImpl; return () => { globalThis.fetch = prev; }; },
    fileFor(profile, kind) {
      const name = `${kind}-${profile.syncName}.json`;
      return files.get(`${profile.serverUrl}?name=${encodeURIComponent(name)}`);
    },
    breakNextPutTo(url) {
      const real = fetchImpl;
      globalThis.fetch = async (u, opts) => {
        if (u === url && (opts.method || 'GET') === 'PUT') {
          globalThis.fetch = real; // one-shot
          return reply({ status: 500 });
        }
        return real(u, opts);
      };
    },
    urlFor(profile, kind) {
      const name = `${kind}-${profile.syncName}.json`;
      return `${profile.serverUrl}?name=${encodeURIComponent(name)}`;
    },
  };
}

async function withHarness(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'tabbysync-cp-sessions-'));
  const store = createProfileStore(dir);
  const sessions = createSessionManager(store);
  const server = fakeServer();
  const uninstall = server.install();
  try {
    const A = await store.add({ label: 'A', provider: 'custom', serverUrl: 'https://s.example/t.php', token: 'tok', syncName: 'alpha' });
    const B = await store.add({ label: 'B', provider: 'custom', serverUrl: 'https://s.example/t.php', token: 'tok', syncName: 'beta' });
    return await fn({ store, sessions, server, A, B });
  } finally {
    uninstall();
  }
}

test('copyBookmarkToProfile adds to the target and leaves the source untouched', async () => {
  await withHarness(async ({ sessions, server, A, B }) => {
    await sessions.loadBookmarks(A.id);
    await sessions.loadBookmarks(B.id);
    const add = await sessions.applyBookmarkOp(A.id, (tree) => addBookmark(tree, BAR_ID, { url: 'https://shared/', title: 'Shared' }));
    const nodeId = add.extra.id;
    await sessions.saveBookmarks(A.id);

    await sessions.copyBookmarkToProfile(A.id, nodeId, B.id, OTHER_ID);

    const bFile = server.fileFor(B, 'bookmarks');
    assert.ok(bFile, 'target file should now exist');
    assert.deepEqual(urls(JSON.parse(bFile.text)), ['https://shared/']);

    const aFile = server.fileFor(A, 'bookmarks');
    assert.deepEqual(urls(JSON.parse(aFile.text)), ['https://shared/'], 'source keeps its own copy — this was a copy, not a move');
  });
});

test('moveBookmarkToProfile adds to the target AND removes from the source', async () => {
  await withHarness(async ({ sessions, A, B, server }) => {
    await sessions.loadBookmarks(A.id);
    await sessions.loadBookmarks(B.id);
    const add = await sessions.applyBookmarkOp(A.id, (tree) => addBookmark(tree, BAR_ID, { url: 'https://move-me/' }));
    const nodeId = add.extra.id;
    await sessions.saveBookmarks(A.id);

    const result = await sessions.moveBookmarkToProfile(A.id, nodeId, B.id, OTHER_ID);
    assert.equal(result.sourceRemoved, true);

    assert.deepEqual(urls(JSON.parse(server.fileFor(B, 'bookmarks').text)), ['https://move-me/']);
    assert.deepEqual(urls(JSON.parse(server.fileFor(A, 'bookmarks').text)), []);
  });
});

test('a move that fails to remove from the source reports MOVE_PARTIAL rather than silently duplicating', async () => {
  await withHarness(async ({ sessions, A, B, server }) => {
    await sessions.loadBookmarks(A.id);
    await sessions.loadBookmarks(B.id);
    const add = await sessions.applyBookmarkOp(A.id, (tree) => addBookmark(tree, BAR_ID, { url: 'https://x/' }));
    const nodeId = add.extra.id;
    await sessions.saveBookmarks(A.id);

    // Let the copy-to-B succeed, but make the FOLLOW-UP save on A (the
    // removal step) fail once.
    server.breakNextPutTo(server.urlFor(A, 'bookmarks'));

    await assert.rejects(
      () => sessions.moveBookmarkToProfile(A.id, nodeId, B.id, OTHER_ID),
      (err) => { assert.equal(err.code, 'MOVE_PARTIAL'); assert.match(err.message, /both/i); return true; }
    );
    // The copy to B did go through — that's the whole point of surfacing this loudly.
    assert.deepEqual(urls(JSON.parse(server.fileFor(B, 'bookmarks').text)), ['https://x/']);
  });
});

test('copyListToProfile and moveListToProfile move a whole saved-tabs list between profiles', async () => {
  await withHarness(async ({ sessions, A, B, server }) => {
    await sessions.loadTabs(A.id);
    await sessions.loadTabs(B.id);
    const added = await sessions.applyTabsOp(A.id, (state) => addList(state, { name: 'Reading', tabs: [{ url: 'https://r1/', title: 'r1' }] }));
    const listId = added.extra.id;
    await sessions.saveTabs(A.id);

    await sessions.copyListToProfile(A.id, listId, B.id);
    let bTabs = JSON.parse(server.fileFor(B, 'tabs').text);
    assert.equal(bTabs.groups.length, 1);
    assert.equal(bTabs.groups[0].name, 'Reading');
    let aTabs = JSON.parse(server.fileFor(A, 'tabs').text);
    assert.equal(aTabs.groups.length, 1, 'copy leaves the source list in place');

    const moveResult = await sessions.moveListToProfile(A.id, listId, B.id);
    assert.equal(moveResult.sourceRemoved, true);
    aTabs = JSON.parse(server.fileFor(A, 'tabs').text);
    assert.equal(aTabs.groups.length, 0, 'move removes the source list');
  });
});

test('moveTabToProfile moves a single tab into an existing list on the target, by value not stale index', async () => {
  await withHarness(async ({ sessions, A, B }) => {
    await sessions.loadTabs(A.id);
    await sessions.loadTabs(B.id);
    const srcAdded = await sessions.applyTabsOp(A.id, (state) =>
      addList(state, { name: 'Src', tabs: [{ url: 'https://one/', title: 'one' }, { url: 'https://two/', title: 'two' }] }));
    const srcListId = srcAdded.extra.id;
    const dstAdded = await sessions.applyTabsOp(B.id, (state) => addList(state, { name: 'Dst' }));
    const dstListId = dstAdded.extra.id;
    await sessions.saveTabs(A.id);
    await sessions.saveTabs(B.id);

    await sessions.moveTabToProfile(A.id, srcListId, 1, B.id, dstListId);

    const aStatus = await sessions.loadTabs(A.id, { force: true });
    const srcGroup = aStatus.state.groups.find((g) => g.id === srcListId);
    assert.deepEqual(srcGroup.tabs.map((t) => t.url), ['https://one/']);

    const bStatus = await sessions.loadTabs(B.id, { force: true });
    const dstGroup = bStatus.state.groups.find((g) => g.id === dstListId);
    assert.deepEqual(dstGroup.tabs.map((t) => t.url), ['https://two/']);
  });
});
