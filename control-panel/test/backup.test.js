// backup.test.js — export/import of every profile and setting.
//
// The rule this file exists to hold down: a backup either has no credentials
// in it, or it is encrypted. There is no third state, and no path through
// serializeBackup() that produces a plaintext file with a live token in it.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBackup, serializeBackup, parseBackup, backupIsEncrypted,
  summarizeBackup, profilesForImport, settingsForImport,
  BACKUP_KIND, BACKUP_VERSION,
} from '../src/core/backup.js';

const profiles = () => ([
  {
    id: 'profile_a', label: 'Home', color: '#5b8def', provider: 'custom',
    serverUrl: 'https://home.example.com/tabbysync.php', syncName: 'home',
    token: 'tok-home-secret', passphrase: 'pass-home-secret',
    gistId: '', jsonbinTabsId: '', jsonbinBookmarksId: '',
    createdAt: 10, updatedAt: 20,
  },
  {
    id: 'profile_b', label: 'Work', color: '#3ec28f', provider: 'gist',
    serverUrl: '', syncName: 'work', token: 'tok-work-secret', passphrase: '',
    gistId: 'gist123', jsonbinTabsId: '', jsonbinBookmarksId: '',
    createdAt: 30, updatedAt: 40,
  },
]);

const settings = () => ({
  theme: 'dark', startWithWindows: true, startMinimized: false, closeBehavior: 'quit',
  reopenLastProfile: true, lastActiveProfileId: 'profile_a',
  updateCheckFrequency: 'weekly', lastUpdateCheckAt: 1234,
  expandedTabGroups: { profile_a: ['g1'], profile_gone: ['g9'] },
  pinIdleMinutes: 20, pinSetupSeen: true,
});

test('a credential-free export contains no token or passphrase anywhere in the file', async () => {
  const payload = buildBackup({ profiles: profiles(), settings: settings(), includeSecrets: false });
  const text = await serializeBackup(payload);

  assert.equal(payload.kind, BACKUP_KIND);
  assert.equal(payload.version, BACKUP_VERSION);
  assert.equal(payload.includesSecrets, false);
  assert.equal(payload.profiles.length, 2);
  // Not just "the field is absent" — the value must not appear in the bytes at all.
  assert.ok(!text.includes('tok-home-secret'), 'a token leaked into a credential-free export');
  assert.ok(!text.includes('pass-home-secret'), 'a passphrase leaked into a credential-free export');
  assert.ok(!('token' in payload.profiles[0]));
  assert.ok(!('passphrase' in payload.profiles[0]));
  // Everything non-secret survives, so the file is still worth having.
  assert.equal(payload.profiles[0].serverUrl, 'https://home.example.com/tabbysync.php');
  assert.equal(payload.profiles[1].gistId, 'gist123');
});

test('an export carrying secrets is REFUSED without a passphrase', async () => {
  const payload = buildBackup({ profiles: profiles(), settings: settings(), includeSecrets: true });
  assert.equal(payload.includesSecrets, true);
  await assert.rejects(() => serializeBackup(payload), /must be protected with a passphrase/);
  await assert.rejects(() => serializeBackup(payload, ''), /must be protected with a passphrase/);
});

test('an encrypted export hides everything, and round-trips with the right passphrase', async () => {
  const payload = buildBackup({ profiles: profiles(), settings: settings(), includeSecrets: true, appVersion: '1.6.0' });
  const text = await serializeBackup(payload, 'correct horse battery staple');

  assert.ok(backupIsEncrypted(text));
  // The envelope leaks nothing — not the tokens, not even the profile names.
  assert.ok(!text.includes('tok-home-secret'));
  assert.ok(!text.includes('Home'));
  assert.ok(!text.includes('home.example.com'));

  const back = await parseBackup(text, 'correct horse battery staple');
  assert.equal(back.profiles[0].token, 'tok-home-secret');
  assert.equal(back.profiles[0].passphrase, 'pass-home-secret');
  assert.equal(back.appVersion, '1.6.0');
});

test('a wrong or missing passphrase is reported as such, not as a corrupt file', async () => {
  const payload = buildBackup({ profiles: profiles(), includeSecrets: true });
  const text = await serializeBackup(payload, 'the right one');

  await assert.rejects(() => parseBackup(text), (e) => e.code === 'PASSPHRASE_REQUIRED');
  await assert.rejects(() => parseBackup(text, 'the wrong one'), (e) => e.code === 'BAD_PASSPHRASE');
});

test('buildBackup refuses redacted profiles when asked to include secrets', () => {
  // profileStore.list() without includeSecrets hands back hasToken booleans.
  // Exporting those as though they were the credentials would produce a file
  // that "restores" an account you cannot sync with.
  const redacted = [{ id: 'p1', label: 'Home', provider: 'custom', serverUrl: 'https://x.example/y.php', hasToken: true, hasPassphrase: false }];
  assert.throws(() => buildBackup({ profiles: redacted, includeSecrets: true }), /redacted profiles/);
  // Without secrets it is exactly the right input, so that must still work.
  assert.doesNotThrow(() => buildBackup({ profiles: redacted, includeSecrets: false }));
});

test('machine-local settings are left out of the file', async () => {
  const payload = buildBackup({ profiles: [], settings: settings() });
  assert.ok(!('lastUpdateCheckAt' in payload.settings), 'when THIS install last checked GitHub is not portable');
  assert.equal(payload.settings.theme, 'dark');
  assert.equal(payload.settings.pinIdleMinutes, 20);
});

test('parseBackup rejects files that are not this app’s backups', async () => {
  await assert.rejects(() => parseBackup('not json at all'), /not valid JSON/);
  await assert.rejects(() => parseBackup(JSON.stringify({ hello: 'world' })), /not a TabbySync backup|not a Control Panel backup/);
  await assert.rejects(
    () => parseBackup(JSON.stringify({ kind: BACKUP_KIND, version: BACKUP_VERSION + 5, profiles: [] })),
    /newer version/,
  );
  await assert.rejects(
    () => parseBackup(JSON.stringify({ kind: BACKUP_KIND, version: 1 })),
    /no profiles/,
  );
});

test('summarizeBackup says what is in the file without opening the profiles', () => {
  const payload = buildBackup({ profiles: profiles(), settings: settings(), includeSecrets: true });
  const s = summarizeBackup(payload);
  assert.equal(s.profileCount, 2);
  assert.deepEqual(s.labels, ['Home', 'Work']);
  assert.equal(s.includesSecrets, true);
  assert.equal(s.hasSettings, true);
});

test('merge drops the ids so an import can never overwrite a profile you already have', () => {
  const payload = buildBackup({ profiles: profiles(), includeSecrets: true });
  const incoming = profilesForImport(payload, 'merge');
  assert.equal(incoming.length, 2);
  for (const p of incoming) assert.ok(!('id' in p), 'a merged profile must get a fresh id from the store');
  assert.equal(incoming[0].token, 'tok-home-secret');
});

test('replace keeps the ids, because the restored settings are keyed by them', () => {
  const payload = buildBackup({ profiles: profiles(), settings: settings(), includeSecrets: true });
  const incoming = profilesForImport(payload, 'replace');
  assert.deepEqual(incoming.map((p) => p.id), ['profile_a', 'profile_b']);

  const s = settingsForImport(payload, 'replace');
  assert.equal(s.lastActiveProfileId, 'profile_a');
  // View state for a profile the backup doesn't contain is dropped rather
  // than restored as an orphan.
  assert.deepEqual(s.expandedTabGroups, { profile_a: ['g1'] });
});

test('replace clears lastActiveProfileId when the backup does not contain that profile', () => {
  const payload = buildBackup({
    profiles: [profiles()[1]],
    settings: { ...settings(), lastActiveProfileId: 'profile_a' },
  });
  assert.equal(settingsForImport(payload, 'replace').lastActiveProfileId, null);
});

test('merge changes no settings at all', () => {
  const payload = buildBackup({ profiles: profiles(), settings: settings() });
  assert.equal(settingsForImport(payload, 'merge'), null,
    'pulling a profile out of someone else’s export must not change your theme');
});

test('an unknown import mode is refused rather than guessed at', () => {
  const payload = buildBackup({ profiles: profiles() });
  assert.throws(() => profilesForImport(payload, 'overwrite'), /Unknown import mode/);
});

test('imported profile fields are sanitized, not trusted', () => {
  const payload = {
    kind: BACKUP_KIND, version: 1, profiles: [
      { id: 'p', label: '   ', provider: 'custom', serverUrl: 'https://x.example/y.php', syncName: 'a b/c!!' },
    ],
  };
  const [p] = profilesForImport(payload, 'merge');
  assert.equal(p.label, 'Imported profile', 'a blank label must not produce a nameless profile');
  // Same rule the extension applies, via the shared sanitizeSyncName.
  assert.equal(p.syncName, 'a-b-c');
});
