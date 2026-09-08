import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createSettingsStore, DEFAULTS } from '../src/core/app-settings.js';

async function freshDir() {
  return mkdtemp(path.join(tmpdir(), 'tabbysync-cp-settings-'));
}

test('get() returns the defaults when no file exists yet', async () => {
  const store = createSettingsStore(await freshDir());
  const s = await store.get();
  assert.deepEqual(s, DEFAULTS);
});

test('update() merges a partial patch and persists it', async () => {
  const store = createSettingsStore(await freshDir());
  const s1 = await store.update({ theme: 'dark' });
  assert.equal(s1.theme, 'dark');
  assert.equal(s1.startWithWindows, false); // untouched fields keep their default
  const s2 = await store.update({ startWithWindows: true });
  assert.equal(s2.theme, 'dark'); // earlier change survives an unrelated later one
  assert.equal(s2.startWithWindows, true);
});

test('settings persist across a fresh store instance pointed at the same directory', async () => {
  const dir = await freshDir();
  const store1 = createSettingsStore(dir);
  await store1.update({ theme: 'light', closeBehavior: 'minimize', reopenLastProfile: true, lastActiveProfileId: 'p1' });

  const store2 = createSettingsStore(dir);
  const s = await store2.get();
  assert.equal(s.theme, 'light');
  assert.equal(s.closeBehavior, 'minimize');
  assert.equal(s.reopenLastProfile, true);
  assert.equal(s.lastActiveProfileId, 'p1');
});

test('invalid enum values are dropped rather than corrupting the stored settings', async () => {
  const store = createSettingsStore(await freshDir());
  const s = await store.update({ theme: 'purple', closeBehavior: 'nonsense', startMinimized: true });
  assert.equal(s.theme, DEFAULTS.theme); // rejected, falls back to default
  assert.equal(s.closeBehavior, DEFAULTS.closeBehavior);
  assert.equal(s.startMinimized, true); // the one valid field in the same patch still applies
});

test('booleans are coerced rather than stored as whatever truthy/falsy value was passed', async () => {
  const store = createSettingsStore(await freshDir());
  const s = await store.update({ startWithWindows: 'yes', startMinimized: 0 });
  assert.equal(s.startWithWindows, true);
  assert.equal(s.startMinimized, false);
});

test('a corrupt settings.json falls back to defaults instead of refusing to start', async () => {
  const dir = await freshDir();
  const store1 = createSettingsStore(dir);
  await store1.update({ theme: 'dark' }); // creates the file
  await writeFile(store1.filePath, '{not json', 'utf8');

  const store2 = createSettingsStore(dir);
  const s = await store2.get();
  assert.deepEqual(s, DEFAULTS);
});

test('lastActiveProfileId can be cleared back to null', async () => {
  const store = createSettingsStore(await freshDir());
  await store.update({ lastActiveProfileId: 'p1' });
  const s = await store.update({ lastActiveProfileId: null });
  assert.equal(s.lastActiveProfileId, null);
});

test('updateCheckFrequency accepts the known values and rejects anything else', async () => {
  const store = createSettingsStore(await freshDir());
  for (const freq of ['startup', 'daily', 'weekly', 'monthly', 'never']) {
    const s = await store.update({ updateCheckFrequency: freq });
    assert.equal(s.updateCheckFrequency, freq);
  }
  const rejected = await store.update({ updateCheckFrequency: 'hourly' });
  assert.equal(rejected.updateCheckFrequency, 'never'); // unchanged from the last valid update above ('never' was last in the loop)
});

test('lastUpdateCheckAt only accepts a positive number, else null', async () => {
  const store = createSettingsStore(await freshDir());
  const s1 = await store.update({ lastUpdateCheckAt: 1234567890 });
  assert.equal(s1.lastUpdateCheckAt, 1234567890);
  const s2 = await store.update({ lastUpdateCheckAt: -1 });
  assert.equal(s2.lastUpdateCheckAt, null);
  const s3 = await store.update({ lastUpdateCheckAt: 'yesterday' });
  assert.equal(s3.lastUpdateCheckAt, null);
});

test('expandedTabGroups round-trips per profile and survives a reload', async () => {
  const dir = await freshDir();
  const store1 = createSettingsStore(dir);
  const s = await store1.update({ expandedTabGroups: { p1: ['g1', 'g2'], p2: ['g9'] } });
  assert.deepEqual(s.expandedTabGroups, { p1: ['g1', 'g2'], p2: ['g9'] });

  const store2 = createSettingsStore(dir);
  assert.deepEqual((await store2.get()).expandedTabGroups, { p1: ['g1', 'g2'], p2: ['g9'] });
});

test('expandedTabGroups drops junk rather than storing it', async () => {
  const store = createSettingsStore(await freshDir());
  const s = await store.update({
    expandedTabGroups: {
      p1: ['g1', 'g1', '', null, 42, 'g2'], // dupes, blanks and non-strings
      p2: 'not-an-array',
      p3: [],                                // nothing open — no reason to keep the key
    },
  });
  assert.deepEqual(s.expandedTabGroups, { p1: ['g1', 'g2'] });

  // A whole value of the wrong shape resets to empty instead of poisoning the file.
  assert.deepEqual((await store.update({ expandedTabGroups: ['g1'] })).expandedTabGroups, {});
  assert.deepEqual((await store.update({ expandedTabGroups: null })).expandedTabGroups, {});
});

test('the default expandedTabGroups is never shared between reads', async () => {
  const store = createSettingsStore(await freshDir());
  const a = await store.get();
  a.expandedTabGroups.p1 = ['leaked'];
  assert.deepEqual((await store.get()).expandedTabGroups, {});
  assert.deepEqual(DEFAULTS.expandedTabGroups, {});
});
