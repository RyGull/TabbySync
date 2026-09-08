// pin-lock.test.js — the PIN gate's storage, verification and throttle.
//
// The throttle tests use the injectable clock rather than real sleeps: a
// suite that actually waited out an exponential backoff would take minutes
// and nobody would run it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createPinStore, pinProblem, ThrottledError, MIN_PIN_LENGTH, MAX_PIN_LENGTH } from '../src/core/pin-lock.js';

const dirs = [];
async function freshDir() {
  const d = await mkdtemp(path.join(tmpdir(), 'tabbysync-pin-'));
  dirs.push(d);
  return d;
}
test.after(async () => { for (const d of dirs) await rm(d, { recursive: true, force: true }); });

/** A store whose clock we drive by hand. */
function clocked(dir, start = 1_700_000_000_000) {
  const clock = { t: start };
  const store = createPinStore(dir, { now: () => clock.t });
  return { store, clock, advance: (ms) => { clock.t += ms; } };
}

test('pinProblem enforces digits and the length range', () => {
  assert.equal(pinProblem('1234'), '');
  assert.equal(pinProblem('123456789012'), '');
  assert.match(pinProblem(''), /Enter a PIN/);
  assert.match(pinProblem('12a4'), /only contain digits/);
  assert.match(pinProblem('1 34'), /only contain digits/);
  assert.match(pinProblem('123'), new RegExp(`${MIN_PIN_LENGTH} digits`));
  assert.match(pinProblem('1'.repeat(MAX_PIN_LENGTH + 1)), new RegExp(`${MAX_PIN_LENGTH} digits`));
  assert.match(pinProblem(1234), /Enter a PIN/); // not a string
});

test('a fresh install has no PIN, so nothing is gated', async () => {
  const store = createPinStore(await freshDir());
  const s = await store.status();
  assert.equal(s.isSet, false);
  assert.equal(s.corrupt, false);
  assert.equal(await store.verify('1234'), false); // nothing to verify against
});

test('a set PIN verifies, a wrong one does not, and neither the PIN nor its hash is readable back', async () => {
  const dir = await freshDir();
  const store = createPinStore(dir);
  await store.set('4821');

  assert.equal(await store.verify('4821'), true);
  assert.equal(await store.verify('4820'), false);
  assert.equal((await store.status()).isSet, true);

  // status() is what the renderer is allowed to see: nothing derived from the PIN.
  const s = await store.status();
  assert.deepEqual(Object.keys(s).sort(), ['corrupt', 'failures', 'filePath', 'isSet', 'throttledForMs', 'unrecoverable']);

  // On disk it is a salted hash, never the digits.
  const raw = JSON.parse(await readFile(path.join(dir, 'security.json'), 'utf8'));
  assert.ok(raw.salt && raw.hash);
  assert.ok(!JSON.stringify(raw).includes('4821'));
});

test('the same PIN in two installs produces different hashes (the salt is random)', async () => {
  const a = createPinStore(await freshDir());
  const b = createPinStore(await freshDir());
  await a.set('999888');
  await b.set('999888');
  const ra = JSON.parse(await readFile(a.filePath, 'utf8'));
  const rb = JSON.parse(await readFile(b.filePath, 'utf8'));
  assert.notEqual(ra.salt, rb.salt);
  assert.notEqual(ra.hash, rb.hash);
});

test('set() refuses to overwrite an existing PIN — that is what change() is for', async () => {
  const store = createPinStore(await freshDir());
  await store.set('1111');
  await assert.rejects(() => store.set('2222'), /already set/);
  assert.equal(await store.verify('1111'), true);
});

test('set() rejects a PIN that does not meet the rules, and leaves no file behind', async () => {
  const dir = await freshDir();
  const store = createPinStore(dir);
  await assert.rejects(() => store.set('12'), /at least 4 digits/);
  await assert.rejects(() => store.set('abcd'), /only contain digits/);
  assert.equal((await store.status()).isSet, false);
});

test('change() needs the current PIN and then switches to the new one', async () => {
  const store = createPinStore(await freshDir());
  await store.set('1234');
  await assert.rejects(() => store.change('9999', '5678'), /not your current PIN/);
  assert.equal(await store.verify('1234'), true);

  await store.change('1234', '567890');
  assert.equal(await store.verify('567890'), true);
  assert.equal(await store.verify('1234'), false);
});

test('change() validates the new PIN before touching the old one', async () => {
  const store = createPinStore(await freshDir());
  await store.set('1234');
  await assert.rejects(() => store.change('1234', '99'), /at least 4 digits/);
  assert.equal(await store.verify('1234'), true, 'the old PIN must still work after a rejected change');
});

test('clear() needs the current PIN and removes the gate entirely', async () => {
  const store = createPinStore(await freshDir());
  await store.set('1234');
  await assert.rejects(() => store.clear('0000'), /not your current PIN/);
  assert.equal((await store.status()).isSet, true);

  await store.clear('1234');
  assert.equal((await store.status()).isSet, false);
});

test('the throttle kicks in after the free attempts and escalates', async () => {
  const { store, advance } = clocked(await freshDir());
  await store.set('1234');

  // Five wrong tries cost nothing — fat fingers shouldn't be punished.
  for (let i = 0; i < 5; i++) assert.equal(await store.verify('0000'), false);
  assert.equal(await store.throttleRemaining(), 0);

  // The sixth starts the penalty.
  assert.equal(await store.verify('0000'), false);
  const first = await store.throttleRemaining();
  assert.ok(first > 0, 'expected a penalty after the sixth wrong PIN');

  // ...and while it is running, nothing is even checked — not even the right PIN.
  await assert.rejects(() => store.verify('1234'), ThrottledError);

  advance(first);
  assert.equal(await store.verify('0000'), false);
  const second = await store.throttleRemaining();
  assert.ok(second > first, `expected the penalty to grow: ${second} should exceed ${first}`);
});

test('the throttle is counted on disk, so relaunching the app does not clear it', async () => {
  const dir = await freshDir();
  const first = clocked(dir);
  await first.store.set('1234');
  // Past the free attempts, verify() throws instead of answering — that IS
  // the throttle working, so swallow it and keep hammering, the way whoever
  // this protects against would.
  for (let i = 0; i < 7; i++) await first.store.verify('0000').catch(() => {});
  assert.ok(await first.store.throttleRemaining() > 0);

  // A brand-new store over the same directory is exactly what a restart is.
  const second = createPinStore(dir, { now: () => 1_700_000_000_000 });
  assert.ok(await second.throttleRemaining() > 0, 'a restart must not reset the penalty');
  await assert.rejects(() => second.verify('1234'), ThrottledError);
});

test('a correct PIN clears the failure count', async () => {
  const { store, advance } = clocked(await freshDir());
  await store.set('1234');
  for (let i = 0; i < 6; i++) await store.verify('0000');
  advance(await store.throttleRemaining());

  assert.equal(await store.verify('1234'), true);
  assert.equal((await store.status()).failures, 0);
  assert.equal(await store.throttleRemaining(), 0);
});

test('a corrupt security.json fails CLOSED — the app stays locked rather than unlocked', async () => {
  const dir = await freshDir();
  const store1 = createPinStore(dir);
  await store1.set('1234');
  await writeFile(store1.filePath, '{not json', 'utf8');

  const store2 = createPinStore(dir);
  const s = await store2.status();
  assert.equal(s.isSet, true, 'a damaged PIN file must not read as "no PIN set"');
  assert.equal(s.corrupt, true);
  assert.equal(s.unrecoverable, true);
  // And no PIN opens it — the error names the file to delete.
  await assert.rejects(() => store2.verify('1234'), /unreadable/);
  await assert.rejects(() => store2.set('5678'), /already set/);
});

test('a structurally valid file missing its hash is corrupt, not "no PIN"', async () => {
  const dir = await freshDir();
  const store1 = createPinStore(dir);
  await store1.set('1234');
  await writeFile(store1.filePath, JSON.stringify({ version: 1, salt: 'abc' }), 'utf8');

  const s = await createPinStore(dir).status();
  assert.equal(s.isSet, true);
  assert.equal(s.corrupt, true);
});

test('an unreadable security.json fails closed too', { skip: process.getuid && process.getuid() === 0 ? 'running as root, which ignores file modes' : false }, async () => {
  const dir = await freshDir();
  const store1 = createPinStore(dir);
  await store1.set('1234');
  await chmod(store1.filePath, 0o000);

  const s = await createPinStore(dir).status();
  assert.equal(s.isSet, true);
  assert.equal(s.corrupt, true);
  await chmod(store1.filePath, 0o600);
});
