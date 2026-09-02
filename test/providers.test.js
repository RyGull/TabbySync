// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// providers.test.js — the pluggable sync backends.
//
// This layer decides what request goes to your server, and how an unexpected
// answer is interpreted. Two things matter most: a missing file must read as
// "nothing stored yet" rather than as an error, and a concurrent write on
// another device must be caught (412 -> conflict) rather than overwritten.

import test from 'node:test';
import assert from 'node:assert/strict';

import { reply, installFetch } from './fake-fetch.js';

// providers.js is a classic IIFE that assigns to `self`, so both globals have
// to exist before the module body runs.
globalThis.self = globalThis;
globalThis.self.TabbySyncConfig = { setConfig: async () => {} };
await import('../shared/providers.js');
const P = globalThis.self.TabbySyncProviders;

const CUSTOM = { provider: 'custom', baseUrl: 'https://example.com/tabbysync/tabbysync.php', token: 'tok', syncName: 'work' };
const FILE = 'bookmarks-work.json';

/** Run `fn` against a scripted fetch, then restore the real one. */
async function withFetch(replies, fn) {
  const f = installFetch(replies);
  try { return await fn(f.calls); } finally { f.restore(); }
}

// ---------------------------------------------------------------------------
// Request shape
// ---------------------------------------------------------------------------

test('a .php base URL is routed via ?name=, needing no server rewrites', async () => {
  await withFetch([reply({ body: '{}' })], async (calls) => {
    await P.get(CUSTOM, FILE);
    assert.equal(calls[0].url, 'https://example.com/tabbysync/tabbysync.php?name=bookmarks-work.json');
  });
});

test('a non-.php base URL is treated as a directory', async () => {
  await withFetch([reply({ body: '{}' })], async (calls) => {
    await P.get({ ...CUSTOM, baseUrl: 'https://example.com/sync' }, FILE);
    assert.equal(calls[0].url, 'https://example.com/sync/bookmarks-work.json');
  });
});

test('trailing slashes on the base URL are stripped', async () => {
  await withFetch([reply({ body: '{}' })], async (calls) => {
    await P.get({ ...CUSTOM, baseUrl: 'https://example.com/sync///' }, FILE);
    assert.equal(calls[0].url, 'https://example.com/sync/bookmarks-work.json');
  });
});

test('the file name is URL-encoded', async () => {
  await withFetch([reply({ body: '{}' })], async (calls) => {
    await P.get(CUSTOM, 'bookmarks-my sync&name.json');
    assert.ok(calls[0].url.endsWith('?name=bookmarks-my%20sync%26name.json'), calls[0].url);
  });
});

test('the bearer token is sent, and omitted when there is none', async () => {
  await withFetch([reply({ body: '{}' })], async (calls) => {
    await P.get(CUSTOM, FILE);
    assert.equal(calls[0].headers.Authorization, 'Bearer tok');
  });

  await withFetch([reply({ body: '{}' })], async (calls) => {
    await P.get({ ...CUSTOM, token: '' }, FILE);
    assert.equal('Authorization' in calls[0].headers, false);
  });
});

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

test('404 reads as "nothing stored yet", not as a failure', async () => {
  // This is the first-ever sync. Treating it as an error would block setup;
  // the README even tells people to expect a 404 from Test connection.
  await withFetch([reply({ status: 404 })], async () => {
    assert.deepEqual(await P.get(CUSTOM, FILE), { text: null, etag: '' });
  });
});

test('a stored file comes back with its ETag', async () => {
  await withFetch([reply({ body: '{"v":1}', etag: 'W/"abc"' })], async () => {
    assert.deepEqual(await P.get(CUSTOM, FILE), { text: '{"v":1}', etag: 'W/"abc"' });
  });
});

test('a missing ETag header degrades to an empty string, not undefined', async () => {
  await withFetch([reply({ body: '{}' })], async () => {
    assert.equal((await P.get(CUSTOM, FILE)).etag, '');
  });
});

test('401 and 403 are reported as an auth failure, not as empty data', async () => {
  for (const status of [401, 403]) {
    await withFetch([reply({ status })], async () => {
      await assert.rejects(() => P.get(CUSTOM, FILE), /token/i);
    });
  }
});

test('a server error is surfaced with its status code', async () => {
  await withFetch([reply({ status: 500 })], async () => {
    await assert.rejects(() => P.get(CUSTOM, FILE), /HTTP 500/);
  });
});

test('an unconfigured base URL reads as empty instead of throwing', async () => {
  await withFetch([], async (calls) => {
    assert.deepEqual(await P.get({ ...CUSTOM, baseUrl: '' }, FILE), { text: null, etag: '' });
    assert.equal(calls.length, 0, 'no request attempted');
  });
});

// ---------------------------------------------------------------------------
// Writing, and the conflict that protects a concurrent edit
// ---------------------------------------------------------------------------

test('a write carries If-Match when an ETag is known', async () => {
  await withFetch([reply({ etag: 'new' })], async (calls) => {
    await P.put(CUSTOM, FILE, '{"a":1}', 'W/"abc"');

    assert.equal(calls[0].method, 'PUT');
    assert.equal(calls[0].headers['If-Match'], 'W/"abc"');
    assert.equal(calls[0].headers['Content-Type'], 'application/json');
    assert.equal(calls[0].body, '{"a":1}');
  });
});

test('a first write sends no If-Match', async () => {
  await withFetch([reply({ etag: 'new' })], async (calls) => {
    await P.put(CUSTOM, FILE, '{}', '');
    assert.equal('If-Match' in calls[0].headers, false);
  });
});

test('412 is flagged as a conflict so the caller can re-merge instead of clobbering', async () => {
  // Another device wrote between our read and our write. The error must be
  // distinguishable from a generic failure, or the retry would overwrite it.
  await withFetch([reply({ status: 412 })], async () => {
    await assert.rejects(
      () => P.put(CUSTOM, FILE, '{}', 'W/"stale"'),
      (e) => e.conflict === true && /conflict/i.test(e.message),
    );
  });
});

test('a write returns the new ETag for the next conditional write', async () => {
  await withFetch([reply({ etag: 'W/"v2"' })], async () => {
    assert.deepEqual(await P.put(CUSTOM, FILE, '{}', ''), { etag: 'W/"v2"' });
  });
});

test('write failures are reported rather than silently swallowed', async () => {
  await withFetch([reply({ status: 403 })], async () => {
    await assert.rejects(() => P.put(CUSTOM, FILE, '{}', ''), /token/i);
  });
  await withFetch([reply({ status: 507 })], async () => {
    await assert.rejects(() => P.put(CUSTOM, FILE, '{}', ''), /HTTP 507/);
  });
});

test('writing with no server URL fails instead of pretending to succeed', async () => {
  // Note: customPut raises this one synchronously, while every other error in
  // the module arrives as a rejected promise. Both current call sites are safe
  // (sync.js awaits inside try/catch; storage.js calls it inside a .then, which
  // turns a sync throw into a rejection), but a future caller doing
  // `put(...).catch(...)` would miss it. This test accepts either form, so it
  // keeps passing if that is ever made consistent.
  await withFetch([], async (calls) => {
    let raised = null;
    try {
      await P.put({ ...CUSTOM, baseUrl: '' }, FILE, '{}', '');
    } catch (e) {
      raised = e;
    }
    assert.ok(raised, 'a missing server URL must not look like a successful write');
    assert.match(raised.message, /No server URL/);
    assert.equal(calls.length, 0, 'no request attempted');
  });
});

// ---------------------------------------------------------------------------
// GitHub Gist
// ---------------------------------------------------------------------------

test('no gist yet reads as empty rather than as an error', async () => {
  await withFetch([], async (calls) => {
    assert.deepEqual(await P.get({ provider: 'gist', token: 't' }, FILE), { text: null, etag: '' });
    assert.equal(calls.length, 0);
  });
});

test('a gist that exists but lacks this engine’s file reads as empty', async () => {
  // Bookmarks enabled after tabs: the gist is there, this file is not.
  await withFetch([reply({ body: { files: { 'tabs-work.json': { content: '{}' } } } })], async () => {
    assert.deepEqual(await P.get({ provider: 'gist', token: 't', gistId: 'g1' }, FILE), { text: null, etag: '' });
  });
});

test('a truncated gist file is re-fetched in full from its raw URL', async () => {
  // GitHub truncates large files in the API response. Using the truncated
  // body would silently sync a partial bookmark tree.
  await withFetch([
    reply({ body: { files: { [FILE]: { content: 'TRUNCATED', truncated: true, raw_url: 'https://raw.example/full' } } } }),
    reply({ body: 'THE WHOLE FILE' }),
  ], async (calls) => {
    assert.deepEqual(await P.get({ provider: 'gist', token: 't', gistId: 'g1' }, FILE),
      { text: 'THE WHOLE FILE', etag: '' });
    assert.equal(calls[1].url, 'https://raw.example/full');
  });
});

test('a deleted gist is reported clearly, not read as empty', async () => {
  await withFetch([reply({ status: 404 })], async () => {
    await assert.rejects(() => P.get({ provider: 'gist', token: 't', gistId: 'gone' }, FILE), /not found/i);
  });
});

test('a rejected GitHub token names the Gists scope', async () => {
  await withFetch([reply({ status: 401 })], async () => {
    await assert.rejects(() => P.get({ provider: 'gist', token: 'bad', gistId: 'g1' }, FILE), /Gists/);
  });
});

// ---------------------------------------------------------------------------
// JSONBin
// ---------------------------------------------------------------------------

test('no bin yet reads as empty rather than as an error', async () => {
  await withFetch([], async (calls) => {
    assert.deepEqual(await P.get({ provider: 'jsonbin', token: 't' }, FILE), { text: null, etag: '' });
    assert.equal(calls.length, 0);
  });
});

test('a bin that 404s reads as empty rather than throwing', async () => {
  await withFetch([reply({ status: 404 })], async () => {
    assert.deepEqual(
      await P.get({ provider: 'jsonbin', token: 't', jsonbinBookmarksId: 'b1' }, FILE),
      { text: null, etag: '' },
    );
  });
});

test('a bin’s record comes back as text for the engine to parse', async () => {
  await withFetch([reply({ body: { record: { v: 1, items: [] } } })], async () => {
    assert.deepEqual(
      await P.get({ provider: 'jsonbin', token: 't', jsonbinBookmarksId: 'b1' }, FILE),
      { text: '{"v":1,"items":[]}', etag: '' },
    );
  });
});

test('a rejected JSONBin key is reported', async () => {
  await withFetch([reply({ status: 401 })], async () => {
    await assert.rejects(
      () => P.get({ provider: 'jsonbin', token: 'bad', jsonbinBookmarksId: 'b1' }, FILE),
      /JSONBin rejected/,
    );
  });
});

// ---------------------------------------------------------------------------
// Dispatch and configuration
// ---------------------------------------------------------------------------

test('isConfigured requires everything the chosen provider actually needs', () => {
  assert.equal(P.isConfigured(CUSTOM), true);
  assert.equal(P.isConfigured({ ...CUSTOM, token: '' }), false);
  assert.equal(P.isConfigured({ ...CUSTOM, baseUrl: '' }), false);
  assert.equal(P.isConfigured({ ...CUSTOM, syncName: '' }), false);

  assert.equal(P.isConfigured({ provider: 'gist', token: 't' }), true);
  assert.equal(P.isConfigured({ provider: 'gist' }), false);
  assert.equal(P.isConfigured({ provider: 'jsonbin', token: 't' }), true);
  assert.equal(P.isConfigured({ provider: 'jsonbin' }), false);
});

test('an unknown provider falls back to self-hosted rather than failing', async () => {
  await withFetch([reply({ body: '{}' })], async (calls) => {
    await P.get({ ...CUSTOM, provider: 'not-a-provider' }, FILE);
    assert.ok(calls[0].url.startsWith('https://example.com/tabbysync/tabbysync.php'));
  });
});

test('every provider is described for the Options UI, and third parties carry a disclaimer', () => {
  assert.deepEqual(Object.keys(P.PROVIDERS).sort(), ['custom', 'gist', 'jsonbin']);

  for (const id of ['gist', 'jsonbin']) {
    assert.ok(P.PROVIDERS[id].disclaimer, `${id} must warn that it is a third-party service`);
  }
  assert.equal(P.PROVIDERS.custom.disclaimer, '', 'self-hosting needs no third-party warning');
  assert.equal(P.providerMeta('nonsense').id, 'custom', 'unknown ids fall back to self-hosted');
});

test('deleting data through an unknown provider is refused', async () => {
  await assert.rejects(() => P.deleteProviderData({}, 'not-a-provider'), /Unknown provider/);
});
