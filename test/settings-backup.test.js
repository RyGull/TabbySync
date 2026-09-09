// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// settings-backup.test.js — export/import of the extension's own settings.
//
// The rule this file exists to hold down, and it is the same one
// control-panel/test/backup.test.js holds down for the desktop app: a backup
// either has no credentials in it, or it is encrypted. There is no third
// state, and no path through serializeSettingsBackup() that writes a live
// bearer token to a file in the clear.

import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// crypto.js reaches for the global WebCrypto, which Node exposes but does not
// install as `crypto` in every version this suite runs on.
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const {
  buildSettingsBackup, serializeSettingsBackup, parseSettingsBackup,
  backupIsEncrypted, summarizeSettingsBackup, settingsToApply,
  SECRET_KEYS, BACKUP_KIND, BACKUP_VERSION, MIN_PASSPHRASE_LENGTH,
} = await import('../shared/settings-backup.js');

const root = new URL('..', import.meta.url).pathname;

/** A realistic storage snapshot: configuration, plus every kind of secret. */
const stored = () => ({
  'sl.serverUrl': 'https://home.example.com/tabbysync/tabbysync.php',
  'sl.token': 'tok-live-secret',
  'sl.syncName': 'home',
  'sl.provider': 'custom',
  'sl.passphrase': 'the-password-lock',
  'sl.genToken': 'generated-server-code',
  'sl.gist.token': 'ghp-gist-secret',
  'sl.gist.syncName': 'work',
  'sl.jsonbin.token': 'jsonbin-secret',
  'sl.tab.backupPass': 'backup-file-password',
  'sl.bm.enabled': true,
  'sl.bm.intervalMin': 15,
  'sl.tab.dedupe': 'url',
  'sl.tab.pinList': true,
  // Must never leave, whatever is asked for:
  'sl.tab.state': { groups: [{ id: 'g1', name: 'Reading' }] },
  'sl.tab.etag': 'W/"abc123"',
});

const SECRET_VALUES = [
  'tok-live-secret', 'the-password-lock', 'generated-server-code',
  'ghp-gist-secret', 'jsonbin-secret', 'backup-file-password',
];

// ---------------------------------------------------------------------------
// The one rule
// ---------------------------------------------------------------------------

test('a credential-free export contains no secret anywhere in the file', async () => {
  const payload = buildSettingsBackup({ stored: stored(), includeSecrets: false });
  const text = await serializeSettingsBackup(payload, '');
  for (const secret of SECRET_VALUES) {
    assert.ok(!text.includes(secret), `the file contains the live secret ${secret}`);
  }
  for (const key of SECRET_KEYS) {
    assert.ok(!(key in payload.settings), `${key} was exported without credentials being asked for`);
  }
  // It is still worth having: the configuration came through.
  assert.equal(payload.settings['sl.serverUrl'], 'https://home.example.com/tabbysync/tabbysync.php');
  assert.equal(payload.settings['sl.syncName'], 'home');
  assert.equal(payload.settings['sl.bm.intervalMin'], 15);
});

test('an export with credentials cannot be written without a passphrase', async () => {
  const payload = buildSettingsBackup({ stored: stored(), includeSecrets: true });
  await assert.rejects(() => serializeSettingsBackup(payload, ''), /must be protected with a passphrase/);
  // Short ones are refused too — this file holds a live bearer token.
  await assert.rejects(() => serializeSettingsBackup(payload, 'short'), /at least 8 characters/);
});

test('an export with credentials is sealed, and the plaintext is nowhere in it', async () => {
  const payload = buildSettingsBackup({ stored: stored(), includeSecrets: true });
  const text = await serializeSettingsBackup(payload, 'correct horse battery');
  assert.equal(backupIsEncrypted(text), true, 'a credential-carrying backup was written unencrypted');
  for (const secret of SECRET_VALUES) {
    assert.ok(!text.includes(secret), `the ciphertext leaks ${secret}`);
  }
  assert.ok(!text.includes('sl.token'), 'even the key names are visible, so the envelope is not sealing the payload');
});

// ---------------------------------------------------------------------------
// Round trips
// ---------------------------------------------------------------------------

test('a sealed backup opens with its passphrase and refuses any other', async () => {
  const payload = buildSettingsBackup({ stored: stored(), includeSecrets: true, appVersion: '1.3.16' });
  const text = await serializeSettingsBackup(payload, 'correct horse battery');

  const opened = await parseSettingsBackup(text, 'correct horse battery');
  assert.equal(opened.kind, BACKUP_KIND);
  assert.equal(opened.version, BACKUP_VERSION);
  assert.equal(opened.settings['sl.token'], 'tok-live-secret');
  assert.equal(opened.settings['sl.passphrase'], 'the-password-lock');

  await assert.rejects(() => parseSettingsBackup(text, 'wrong passphrase'),
    (e) => e.code === 'BAD_PASSPHRASE');
  await assert.rejects(() => parseSettingsBackup(text, ''),
    (e) => e.code === 'PASSPHRASE_REQUIRED');
});

test('a credential-free backup opens with no passphrase at all', async () => {
  const payload = buildSettingsBackup({ stored: stored(), includeSecrets: false });
  const text = await serializeSettingsBackup(payload, '');
  assert.equal(backupIsEncrypted(text), false);
  const opened = await parseSettingsBackup(text, '');
  assert.equal(opened.settings['sl.syncName'], 'home');
});

// ---------------------------------------------------------------------------
// What must never travel
// ---------------------------------------------------------------------------

test('saved tab lists never enter a settings backup', async () => {
  // They are large, they have their own backup on the saved-tabs page, and
  // they are the one thing here that is genuinely synced — restoring a stale
  // copy can resurrect lists deleted on another machine.
  for (const includeSecrets of [false, true]) {
    const payload = buildSettingsBackup({ stored: stored(), includeSecrets });
    assert.ok(!('sl.tab.state' in payload.settings), 'tab lists were exported as settings');
    assert.ok(!('sl.tab.etag' in payload.settings), 'this install’s sync bookkeeping was exported');
  }
});

test('a hand-edited file cannot smuggle tab lists back in through import', async () => {
  const hostile = {
    kind: BACKUP_KIND, version: 1, createdAt: 0, includesSecrets: false,
    settings: {
      'sl.serverUrl': 'https://ok.example.com/tabbysync.php',
      'sl.tab.state': { groups: [] },      // would wipe live lists
      'sl.tab.etag': 'W/"stale"',
      'evil.key': 'nope',                   // outside this extension's namespace
    },
  };
  const apply = settingsToApply(hostile);
  assert.ok(!('sl.tab.state' in apply), 'importing settings overwrote live tab lists');
  assert.ok(!('sl.tab.etag' in apply), 'importing settings rewrote sync bookkeeping');
  assert.ok(!('evil.key' in apply), 'importing wrote a key outside the sl. namespace');
  assert.equal(apply['sl.serverUrl'], 'https://ok.example.com/tabbysync.php');
});

test('a restore leaves alone anything the file does not mention', () => {
  // The failure this prevents: restoring a credential-free backup onto a
  // working install, and having it blank the token that install already had.
  // "Says nothing about credentials" is not "set them to empty".
  const payload = buildSettingsBackup({ stored: stored(), includeSecrets: false });
  const apply = settingsToApply(payload);
  for (const key of SECRET_KEYS) {
    assert.ok(!(key in apply),
      `${key} is in the write, so a credential-free restore would clear a working credential`);
  }
});

test('a setting that was never set is not exported as an empty one', () => {
  // Writing "" for an unset key restores an explicit empty over a default,
  // which is a different thing — the interval defaults would be lost.
  const payload = buildSettingsBackup({ stored: { 'sl.serverUrl': 'https://a.example/x.php' } });
  assert.deepEqual(Object.keys(payload.settings), ['sl.serverUrl']);
  assert.equal('sl.bm.intervalMin' in payload.settings, false);
});

// ---------------------------------------------------------------------------
// Rejections a person can act on
// ---------------------------------------------------------------------------

test('the wrong kind of file is named, not just refused', async () => {
  const tabListBackup = JSON.stringify({ groups: [{ id: 'g1' }] });
  await assert.rejects(() => parseSettingsBackup(tabListBackup, ''), /saved-tabs page/);
  await assert.rejects(() => parseSettingsBackup('not json at all', ''), /not valid JSON/);
  const future = JSON.stringify({ kind: BACKUP_KIND, version: BACKUP_VERSION + 1, settings: {} });
  await assert.rejects(() => parseSettingsBackup(future, ''), /newer version/);
});

test('the summary says what a restore will not give back', async () => {
  const payload = buildSettingsBackup({ stored: stored(), includeSecrets: false });
  const s = summarizeSettingsBackup(payload);
  assert.equal(s.includesSecrets, false);
  assert.equal(s.provider, 'custom');
  assert.equal(s.syncName, 'home');
  // Only the credentials this install actually had — the fixture sets no
  // Gist or JSONBin passphrase, and telling someone to re-enter one they
  // never had is noise, not help.
  assert.deepEqual(s.omittedSecrets.sort(), [
    'sl.gist.token', 'sl.genToken', 'sl.jsonbin.token',
    'sl.passphrase', 'sl.tab.backupPass', 'sl.token',
  ].sort(), 'the summary does not name exactly the credentials this file leaves out');

  const full = summarizeSettingsBackup(await parseSettingsBackup(
    await serializeSettingsBackup(buildSettingsBackup({ stored: stored(), includeSecrets: true }), 'correct horse battery'),
    'correct horse battery',
  ));
  assert.equal(full.includesSecrets, true);
  assert.deepEqual(full.omittedSecrets, [], 'a backup carrying credentials leaves none out');

  // An install with no credentials set omits nothing, rather than reporting
  // every empty slot as something the restore will be missing.
  const bare = summarizeSettingsBackup(buildSettingsBackup({
    stored: { 'sl.serverUrl': 'https://a.example/x.php', 'sl.token': '' },
  }));
  assert.deepEqual(bare.omittedSecrets, [], 'an unset credential was reported as omitted');
});

// ---------------------------------------------------------------------------
// Agreement with the rest of the project
// ---------------------------------------------------------------------------

test('every credential key this extension stores is on the secret list', () => {
  // The trap: a new credential slot is added to shared/config.js and nobody
  // thinks about this file, so the next credential-free export quietly ships
  // it in the clear. Anything key-shaped like a secret has to be listed.
  const config = readFileSync(join(root, 'shared/config.js'), 'utf8');
  const declared = [...config.matchAll(/^\s*\w+:\s*"(sl\.[\w.]+)"/gm)].map((m) => m[1]);
  assert.ok(declared.length > 20, 'the key map could not be read out of shared/config.js');

  const looksSecret = declared.filter((k) => /token|passphrase|pass$|Pass$|secret/i.test(k));
  for (const key of looksSecret) {
    assert.ok(SECRET_KEYS.includes(key),
      `${key} looks like a credential but is not in SECRET_KEYS — a credential-free export would leak it`);
  }
  // And nothing on the list may be a key this extension does not store.
  for (const key of SECRET_KEYS) {
    assert.ok(declared.includes(key), `SECRET_KEYS lists ${key}, which shared/config.js does not define`);
  }
});

test('the extension and the Control Panel agree on the rule', () => {
  // Two products, the same secrets, one rule. If the desktop app ever drops
  // its "secrets require a passphrase" refusal, this fails here too — the
  // weaker of two disagreeing implementations becomes the answer.
  const cp = readFileSync(join(root, 'control-panel/src/core/backup.js'), 'utf8');
  assert.match(cp, /if \(payload\.includesSecrets && !passphrase\)/,
    'the Control Panel no longer refuses to serialize secrets without a passphrase');
  assert.equal(MIN_PASSPHRASE_LENGTH, 8, 'the minimum passphrase length changed without the UI copy being revisited');
});
