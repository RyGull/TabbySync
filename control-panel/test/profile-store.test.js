import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createProfileStore } from '../src/core/profile-store.js';

async function freshDir() {
  return mkdtemp(path.join(tmpdir(), 'tabbysync-cp-test-'));
}

/** A fake "OS-backed" secret transform, reversible but visibly not plaintext, so tests can tell the two apart. */
function fakeSecretCodec() {
  return {
    secretsAvailable: true,
    encrypt: async (s) => ({ fake: true, rot13: s.replace(/[a-zA-Z]/g, (c) => {
      const base = c <= 'Z' ? 65 : 97;
      return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    }) }),
    decrypt: async (v) => v.rot13.replace(/[a-zA-Z]/g, (c) => {
      const base = c <= 'Z' ? 65 : 97;
      return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    }),
  };
}

test('add/list/get/update/remove basics', async () => {
  const store = createProfileStore(await freshDir());
  const p = await store.add({ label: 'Work', provider: 'custom', serverUrl: 'https://x/tabbysync.php', token: 't', syncName: 'work' });
  assert.ok(p.id);
  assert.equal(p.label, 'Work');
  assert.equal(p.syncName, 'work');

  const listed = await store.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].hasToken, true);
  assert.equal('token' in listed[0], false); // redacted by default

  const got = await store.get(p.id);
  assert.equal(got.token, 't'); // full record includes secrets by default

  const updated = await store.update(p.id, { label: 'Work laptop' });
  assert.equal(updated.label, 'Work laptop');

  await store.remove(p.id);
  assert.equal(await store.get(p.id), null);
  await assert.rejects(() => store.remove(p.id), /No such profile/);
});

test('profiles persist across a fresh store instance pointed at the same directory', async () => {
  const dir = await freshDir();
  const store1 = createProfileStore(dir);
  const p = await store1.add({ label: 'Home', provider: 'gist', token: 'ghp_x', syncName: 'home' });

  const store2 = createProfileStore(dir); // simulates the app restarting
  const got = await store2.get(p.id);
  assert.equal(got.label, 'Home');
  assert.equal(got.token, 'ghp_x');
});

test('secrets go through the encrypt/decrypt hooks and are not stored as plaintext on disk', async () => {
  const dir = await freshDir();
  const codec = fakeSecretCodec();
  const store = createProfileStore(dir, codec);
  assert.equal(store.secretsAvailable, true);

  await store.add({ label: 'Work', provider: 'custom', serverUrl: 'https://x/', token: 'super-secret-token', syncName: 'work', passphrase: 'hunter2' });

  const raw = JSON.parse(await readFile(store.filePath, 'utf8'));
  const onDisk = JSON.stringify(raw);
  assert.ok(!onDisk.includes('super-secret-token'), 'plaintext token must not appear on disk');
  assert.ok(!onDisk.includes('hunter2'), 'plaintext passphrase must not appear on disk');
  assert.equal(raw.profiles[0].token.fake, true);

  // a fresh store with the SAME codec reads the real secret back
  const store2 = createProfileStore(dir, fakeSecretCodec());
  const list = await store2.list({ includeSecrets: true });
  assert.equal(list[0].token, 'super-secret-token');
  assert.equal(list[0].passphrase, 'hunter2');
});

test('without an encrypt/decrypt hook, secrets round-trip as plain strings (no crash, no false security claim)', async () => {
  const store = createProfileStore(await freshDir());
  assert.equal(store.secretsAvailable, false);
  const p = await store.add({ label: 'X', provider: 'jsonbin', token: 'plain-token' });
  const raw = JSON.parse(await readFile(store.filePath, 'utf8'));
  assert.equal(raw.profiles[0].token, 'plain-token');
  const got = await store.get(p.id);
  assert.equal(got.token, 'plain-token');
});

test('duplicate() clones connection settings but starts remote-destination ids blank', async () => {
  const store = createProfileStore(await freshDir());
  const p = await store.add({ label: 'Orig', provider: 'gist', token: 't', syncName: 'n', gistId: 'existing-gist-id' });
  const copy = await store.duplicate(p.id);
  assert.notEqual(copy.id, p.id);
  assert.equal(copy.label, 'Orig (copy)');
  assert.equal(copy.token, 't');
  assert.equal(copy.gistId, '', 'must not silently point at the same remote gist as the original');
});

test('reorder() requires every existing id exactly once and applies the new order', async () => {
  const store = createProfileStore(await freshDir());
  const a = await store.add({ label: 'A', provider: 'jsonbin', token: 't' });
  const b = await store.add({ label: 'B', provider: 'jsonbin', token: 't' });
  const c = await store.add({ label: 'C', provider: 'jsonbin', token: 't' });
  await assert.rejects(() => store.reorder([a.id, b.id]), /exactly once/);
  const result = await store.reorder([c.id, a.id, b.id]);
  assert.deepEqual(result.map((p) => p.id), [c.id, a.id, b.id]);
});

test('validate() rejects an unknown provider, a serverless self-hosted profile, or a blank label', async () => {
  const store = createProfileStore(await freshDir());
  await assert.rejects(() => store.add({ label: 'X', provider: 'carrier-pigeon' }), /Unknown provider/);
  await assert.rejects(() => store.add({ label: 'X', provider: 'custom', token: 't', syncName: 'n' }), /server address/);
  await assert.rejects(() => store.add({ label: '   ', provider: 'jsonbin', token: 't' }), /needs a name/);
});

test('validate() requires https:// for a self-hosted server, except localhost/127.0.0.1', async () => {
  const store = createProfileStore(await freshDir());
  await assert.rejects(
    () => store.add({ label: 'X', provider: 'custom', serverUrl: 'http://example.com/tabbysync.php', token: 't' }),
    /must use https/,
  );
  await assert.rejects(
    () => store.add({ label: 'X', provider: 'custom', serverUrl: 'not a url', token: 't' }),
    /full address/,
  );
  // loopback is exempt — never leaves the machine
  const local = await store.add({ label: 'Local', provider: 'custom', serverUrl: 'http://localhost:8080/tabbysync.php', token: 't' });
  assert.equal(local.serverUrl, 'http://localhost:8080/tabbysync.php');
  const loop = await store.add({ label: 'Loop', provider: 'custom', serverUrl: 'http://127.0.0.1/tabbysync.php', token: 't' });
  assert.equal(loop.serverUrl, 'http://127.0.0.1/tabbysync.php');
  // update() runs the same validation, not just add()
  await assert.rejects(
    () => store.update(local.id, { serverUrl: 'http://not-localhost.example/' }),
    /must use https/,
  );
});

test('a corrupt profiles.json is reported clearly rather than silently overwritten', async () => {
  const dir = await freshDir();
  const store = createProfileStore(dir);
  await store.add({ label: 'X', provider: 'jsonbin', token: 't' }); // creates the file
  await writeFile(store.filePath, '{not json', 'utf8');
  const store2 = createProfileStore(dir);
  await assert.rejects(() => store2.list(), /not valid JSON/);
});

test('syncName is sanitized the same way the extension sanitizes it', async () => {
  const store = createProfileStore(await freshDir());
  const p = await store.add({ label: 'X', provider: 'custom', serverUrl: 'https://x/', token: 't', syncName: 'my sync name!!' });
  assert.equal(p.syncName, 'my-sync-name');
});

test('replaceAll wipes what is there and restores the supplied profiles, ids intact', async () => {
  const store = createProfileStore(await freshDir());
  const mine = await store.add({ label: 'Mine', provider: 'jsonbin', token: 'keep-me' });

  const restored = await store.replaceAll([
    { id: 'profile_from_backup', label: 'Home', provider: 'custom', serverUrl: 'https://home.example/y.php', token: 'tok', createdAt: 5, updatedAt: 6 },
    { id: 'profile_other', label: 'Work', provider: 'gist', token: 'tok2', gistId: 'g1' },
  ]);

  assert.equal(restored.length, 2);
  // Ids come from the backup, not freshly minted — the restored settings
  // (lastActiveProfileId, expandedTabGroups) are keyed by them.
  assert.deepEqual(restored.map((p) => p.id), ['profile_from_backup', 'profile_other']);
  assert.equal(await store.get(mine.id), null, 'the pre-existing profile should be gone');

  // Secrets came through, and list() still redacts them by default.
  assert.equal((await store.get('profile_from_backup')).token, 'tok');
  assert.deepEqual((await store.list()).map((p) => p.hasToken), [true, true]);
});

test('replaceAll validates everything before deleting anything', async () => {
  const store = createProfileStore(await freshDir());
  const mine = await store.add({ label: 'Mine', provider: 'jsonbin', token: 'keep-me' });

  // The second entry is invalid (http:// to a non-loopback host). A restore
  // that deleted first and validated as it went would leave the user with
  // neither their old profiles nor the new ones.
  await assert.rejects(() => store.replaceAll([
    { id: 'ok', label: 'Fine', provider: 'jsonbin', token: 't' },
    { id: 'bad', label: 'Broken', provider: 'custom', serverUrl: 'http://example.com/y.php' },
  ]), /must use https/);

  const still = await store.list();
  assert.equal(still.length, 1);
  assert.equal(still[0].id, mine.id, 'a rejected restore must leave the existing profiles untouched');
});

test('replaceAll refuses a backup that names the same profile id twice', async () => {
  const store = createProfileStore(await freshDir());
  await assert.rejects(() => store.replaceAll([
    { id: 'dupe', label: 'A', provider: 'jsonbin', token: 't' },
    { id: 'dupe', label: 'B', provider: 'jsonbin', token: 't' },
  ]), /same profile id twice/);
});
