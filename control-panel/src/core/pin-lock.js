// pin-lock.js — the app's PIN gate: storage, verification and the throttle
// that stops a four-digit secret from being brute-forced in a second.
//
// What this is, and what it is NOT. This is a walk-up lock: it stops the
// person who sits down at your unlocked desktop from reading your sync
// destinations and moving your bookmarks around. It is NOT encryption of
// your data. Per-profile secrets are already encrypted at rest by Electron's
// safeStorage (DPAPI on Windows), and that key is bound to your WINDOWS
// ACCOUNT, not to this PIN — so anyone already logged in as you can read
// profiles.json with the app closed, PIN or no PIN. Deriving the profile
// encryption key from the PIN instead would make this a real boundary, at
// the cost of losing OS-backed protection and turning a forgotten PIN into
// permanently destroyed credentials. The UI says this in as many words; a
// lock that quietly implies more than it delivers is worse than none.
//
// Stored in its own file rather than in settings.json, for one reason:
// app-settings.js deliberately falls back to defaults when its file won't
// parse, because losing a theme preference is nothing. Doing that here would
// mean a corrupt file silently DISABLES the lock. This store fails closed
// instead — an unreadable record leaves the app locked and says how to
// recover, which is the only safe direction for this particular file.
//
// The hash is scrypt with a random 16-byte salt. Against a 4-digit PIN
// (10,000 possibilities) no KDF is a real defence on its own, so the
// throttle below matters more than the cost parameters: failures are
// counted ON DISK and the delay escalates, so quitting the app or killing
// the process doesn't reset the count.
'use strict';

import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);

const FILE_NAME = 'security.json';
const KEY_LEN = 32;
// N=16384 keeps a verify at roughly a few tens of milliseconds — high enough
// to matter across thousands of guesses, low enough that a correct PIN feels
// instant. The record stores these, so raising them later doesn't invalidate
// PINs already set.
const SCRYPT_PARAMS = Object.freeze({ N: 16384, r: 8, p: 1 });

export const MIN_PIN_LENGTH = 4;
export const MAX_PIN_LENGTH = 12;

// After this many consecutive wrong PINs, every further attempt waits.
const FREE_ATTEMPTS = 5;
// Delay = BASE * 2^(failures beyond the free ones), capped. Five wrong tries
// costs nothing; the tenth costs half a minute; it tops out somewhere a
// person will tolerate but a script will not.
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;

/** Rejects anything that isn't a plausible PIN, with the reason the UI should show. */
export function pinProblem(pin) {
  if (typeof pin !== 'string' || !pin) return 'Enter a PIN.';
  if (!/^\d+$/.test(pin)) return 'A PIN can only contain digits.';
  if (pin.length < MIN_PIN_LENGTH) return `A PIN needs at least ${MIN_PIN_LENGTH} digits.`;
  if (pin.length > MAX_PIN_LENGTH) return `A PIN can be at most ${MAX_PIN_LENGTH} digits.`;
  return '';
}

function lockoutMs(failures) {
  if (failures <= FREE_ATTEMPTS) return 0;
  const steps = failures - FREE_ATTEMPTS - 1;
  return Math.min(BACKOFF_BASE_MS * (2 ** steps), BACKOFF_MAX_MS);
}

/** Thrown when the PIN is right or wrong is not even the question yet — the caller is still serving a penalty. */
export class ThrottledError extends Error {
  constructor(waitMs) {
    super(`Too many wrong PINs. Try again in ${Math.ceil(waitMs / 1000)} second${Math.ceil(waitMs / 1000) === 1 ? '' : 's'}.`);
    this.code = 'PIN_THROTTLED';
    this.waitMs = waitMs;
  }
}

/**
 * @param {string} dir - directory to hold security.json (created if missing)
 * @param {object} [opts]
 * @param {() => number} [opts.now] - injectable clock, so tests can walk past a lockout without sleeping
 */
export function createPinStore(dir, opts = {}) {
  const filePath = path.join(dir, FILE_NAME);
  const now = opts.now || (() => Date.now());

  let cache = null;      // parsed record, or null for "no PIN set"
  let corrupt = false;   // the file exists but can't be trusted — fail closed
  let loaded = false;
  let writeQueue = Promise.resolve();

  function enqueue(fn) {
    const result = writeQueue.then(fn);
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function load() {
    if (loaded) return cache;
    loaded = true;
    let raw;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') { cache = null; return cache; }
      // Present but unreadable (permissions, a bad disk) is not "no PIN".
      corrupt = true;
      cache = null;
      return cache;
    }
    let rec;
    try {
      rec = JSON.parse(raw);
    } catch {
      corrupt = true; cache = null; return cache;
    }
    if (!rec || typeof rec.hash !== 'string' || typeof rec.salt !== 'string' || !rec.hash || !rec.salt) {
      corrupt = true; cache = null; return cache;
    }
    cache = {
      version: rec.version || 1,
      salt: rec.salt,
      hash: rec.hash,
      params: { ...SCRYPT_PARAMS, ...(rec.params || {}) },
      failures: Number.isInteger(rec.failures) && rec.failures > 0 ? rec.failures : 0,
      lastFailureAt: Number.isFinite(rec.lastFailureAt) ? rec.lastFailureAt : 0,
      createdAt: rec.createdAt || 0,
      updatedAt: rec.updatedAt || 0,
    };
    return cache;
  }

  async function writeToDisk(rec) {
    await mkdir(dir, { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify(rec, null, 2), { mode: 0o600 });
    await rename(tmp, filePath);
  }

  async function derive(pin, salt, params) {
    return scrypt(pin, Buffer.from(salt, 'base64'), KEY_LEN, { ...params });
  }

  /** How long the caller must wait before another attempt is even considered. */
  async function throttleRemaining() {
    const rec = await load();
    if (!rec) return 0;
    const wait = lockoutMs(rec.failures);
    if (!wait) return 0;
    const elapsed = now() - rec.lastFailureAt;
    return Math.max(0, wait - elapsed);
  }

  /**
   * Whether the app should be gated at all. A corrupt record counts as "set"
   * on purpose — see the file header. Also reports the throttle so the lock
   * screen can show a countdown rather than a bare rejection.
   */
  async function status() {
    const rec = await load();
    return {
      isSet: !!rec || corrupt,
      corrupt,
      failures: rec ? rec.failures : 0,
      // A corrupt record can never be satisfied by any PIN, so say so rather
      // than letting someone type at it forever.
      unrecoverable: corrupt,
      throttledForMs: await throttleRemaining(),
      filePath,
    };
  }

  /** Sets the very first PIN. Refuses if one already exists — changing it goes through change(). */
  async function set(pin) {
    const problem = pinProblem(pin);
    if (problem) throw new Error(problem);
    return enqueue(async () => {
      const rec = await load();
      if (rec || corrupt) throw new Error('A PIN is already set. Use "Change PIN" instead.');
      const salt = randomBytes(16).toString('base64');
      const hash = (await derive(pin, salt, SCRYPT_PARAMS)).toString('base64');
      const stamp = now();
      const next = {
        version: 1, salt, hash, params: { ...SCRYPT_PARAMS },
        failures: 0, lastFailureAt: 0, createdAt: stamp, updatedAt: stamp,
      };
      await writeToDisk(next);
      cache = next; corrupt = false; loaded = true;
      return true;
    });
  }

  /**
   * True/false for "is this the PIN". Throws ThrottledError while a penalty
   * is running, so a caller can't spend the wait guessing.
   */
  async function verify(pin) {
    const rec = await load();
    if (corrupt) throw new Error(`${filePath} is unreadable, so the app stays locked. Delete that file to clear the PIN and start over — nothing else is lost.`);
    if (!rec) return false;

    const waiting = await throttleRemaining();
    if (waiting > 0) throw new ThrottledError(waiting);

    if (pinProblem(pin)) { await recordFailure(); return false; }

    const got = await derive(pin, rec.salt, rec.params);
    const want = Buffer.from(rec.hash, 'base64');
    const ok = got.length === want.length && timingSafeEqual(got, want);
    if (ok) await recordSuccess(); else await recordFailure();
    return ok;
  }

  function recordSuccess() {
    return enqueue(async () => {
      const rec = await load();
      if (!rec || (!rec.failures && !rec.lastFailureAt)) return;
      const next = { ...rec, failures: 0, lastFailureAt: 0 };
      await writeToDisk(next);
      cache = next;
    });
  }

  // Counted on disk, not in memory: a throttle a restart clears is no
  // throttle at all against anyone willing to relaunch the app.
  function recordFailure() {
    return enqueue(async () => {
      const rec = await load();
      if (!rec) return;
      const next = { ...rec, failures: rec.failures + 1, lastFailureAt: now() };
      await writeToDisk(next);
      cache = next;
    });
  }

  /** Replaces the PIN, proving the current one first. */
  async function change(currentPin, newPin) {
    const problem = pinProblem(newPin);
    if (problem) throw new Error(problem);
    const ok = await verify(currentPin);
    if (!ok) throw new Error('That is not your current PIN.');
    return enqueue(async () => {
      const rec = await load();
      const salt = randomBytes(16).toString('base64');
      const hash = (await derive(newPin, salt, SCRYPT_PARAMS)).toString('base64');
      const next = {
        ...rec, salt, hash, params: { ...SCRYPT_PARAMS },
        failures: 0, lastFailureAt: 0, updatedAt: now(),
      };
      await writeToDisk(next);
      cache = next;
      return true;
    });
  }

  /** Turns the lock off entirely, proving the current PIN first. */
  async function clear(currentPin) {
    const ok = await verify(currentPin);
    if (!ok) throw new Error('That is not your current PIN.');
    return enqueue(async () => {
      await unlink(filePath).catch(() => {});
      cache = null; corrupt = false; loaded = true;
      return true;
    });
  }

  return { filePath, status, set, verify, change, clear, throttleRemaining };
}
