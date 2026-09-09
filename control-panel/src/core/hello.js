// hello.js — Windows Hello as an alternative way through the PIN gate.
//
// WHAT HELLO IS HERE FOR, stated plainly because the UI copy depends on it:
// convenience, not a stronger boundary. UserConsentVerifier returns an
// attestation that Windows recognised the account owner. It derives no key and
// encrypts nothing. Per-profile secrets are protected at rest by Electron's
// safeStorage (DPAPI on Windows), keyed to the WINDOWS ACCOUNT — so anyone
// already logged in as you can read profiles.json with the app closed, whether
// the app is gated by a PIN, by Hello, or by both. See pin-lock.js's header;
// this changes none of it. What Hello buys is not typing four digits.
//
// THE RULE THIS MODULE EXISTS TO ENFORCE: Hello is never the only way in.
//
// A fingerprint reader dies. A driver update breaks enrolment. Group policy
// turns Hello off overnight. The user connects over RDP, where there is no
// Hello at all. If Hello were the whole gate, any of those would mean losing
// access to every sync profile in the app, with no recovery — a PIN can at
// least be remembered. So a PIN must exist BEFORE Hello can be turned on
// (canEnable below), and the lock screen always offers it. Hello is the fast
// path; the PIN is the floor.
//
// The native side is native/hello/. It is Windows-only and may simply not be
// built — a checkout on macOS, a dev run before `npm run build:native`. That
// is not an error condition: it is "Hello is unavailable", which is exactly
// what a machine without a fingerprint reader reports too, and the app behaves
// the same way in both cases.
'use strict';

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * Where node-gyp leaves the addon, and where it ends up once packaged.
 *
 * A native module cannot be loaded from inside an asar archive, which is why
 * package.json lists it under build.asarUnpack: electron-builder then writes
 * it to app.asar.unpacked/ instead. Electron patches process.dlopen to follow
 * that redirect on its own, so the first path usually just works — the
 * rewritten one is here because "usually" is not a thing to rely on for the
 * lock screen, and an extra failed require() costs nothing.
 */
const CANDIDATES = [
  path.join(HERE, '../../native/hello/build/Release/tabbysync_hello.node'),
  path.join(HERE, '../../native/hello/build/Release/tabbysync_hello.node').replace('app.asar', 'app.asar.unpacked'),
  path.join(HERE, '../../native/hello/build/Debug/tabbysync_hello.node'),
];

/**
 * Every state the gate can be in, and what the lock screen should say. Kept
 * here rather than in the renderer so the reason a person is being asked for
 * a PIN instead of a fingerprint is written once.
 *
 * `retryable` separates "this might work next time" (the sensor was busy,
 * the finger was not recognised) from "this machine will not do Hello"
 * (no hardware, no enrolment, policy) — the first is worth offering again,
 * the second should stop being offered at all.
 */
const STATES = Object.freeze({
  Available:            { usable: true,  retryable: true,  message: '' },
  DeviceNotPresent:     { usable: false, retryable: false, message: 'This PC has no Windows Hello hardware set up.' },
  NotConfiguredForUser: { usable: false, retryable: false, message: 'Windows Hello is not set up for your Windows account. Add a fingerprint, face or Hello PIN in Windows Settings first.' },
  DisabledByPolicy:     { usable: false, retryable: false, message: 'Windows Hello has been turned off by a policy on this PC.' },
  DeviceBusy:           { usable: false, retryable: true,  message: 'The Windows Hello sensor is busy. Try again in a moment.' },
  RetriesExhausted:     { usable: false, retryable: true,  message: 'Windows Hello did not recognise you. Enter your PIN instead.' },
  Canceled:             { usable: false, retryable: true,  message: '' },
  Verified:             { usable: true,  retryable: true,  message: '' },
  NotBuilt:             { usable: false, retryable: false, message: 'This build does not include Windows Hello support.' },
  Unknown:              { usable: false, retryable: true,  message: 'Windows Hello could not be reached.' },
});

export function describe(state) {
  return STATES[state] || STATES.Unknown;
}

/** Loads the compiled addon, or null when it was never built for this platform. */
function loadAddon() {
  for (const candidate of CANDIDATES) {
    try { return require(candidate); } catch { /* try the next one */ }
  }
  return null;
}

/**
 * @param {object} [opts]
 * @param {() => object|null} [opts.load] - injectable addon loader, so the
 *   policy below can be tested on a machine that cannot build or run it.
 */
export function createHelloGate(opts = {}) {
  const load = opts.load || loadAddon;
  let addon;              // undefined until first use, then the addon or null
  let cachedState = null; // last availability answer, for canEnable()

  function addonOrNull() {
    if (addon === undefined) addon = load();
    return addon;
  }

  /**
   * Whether Hello can be used on this machine right now.
   *
   * Never throws. Every failure — no addon, no hardware, a native call that
   * blew up — resolves to a state with usable:false, because a lock screen
   * that errors instead of falling back to the PIN is a lock screen nobody
   * can get past.
   */
  async function status() {
    const native = addonOrNull();
    if (!native || !native.supported) {
      cachedState = 'NotBuilt';
      return { state: 'NotBuilt', ...describe('NotBuilt'), platform: process.platform };
    }
    let state;
    try {
      state = await native.checkAvailability();
    } catch {
      state = 'Unknown';
    }
    if (!(state in STATES)) state = 'Unknown';
    cachedState = state;
    return { state, ...describe(state), platform: process.platform };
  }

  /**
   * Whether the user may TURN ON Hello unlocking.
   *
   * `pinIsSet` is not a courtesy check — it is the rule at the top of this
   * file. Without a PIN behind it, a Hello failure is a locked-out user with
   * nothing left to try.
   */
  async function canEnable({ pinIsSet }) {
    if (!pinIsSet) {
      return { ok: false, reason: 'Set a PIN first. Windows Hello unlocks the app, but the PIN is what you fall back to if Hello ever stops working.' };
    }
    const s = await status();
    if (!s.usable) return { ok: false, reason: s.message || 'Windows Hello is not available on this PC.' };
    return { ok: true, reason: '' };
  }

  /**
   * Ask Windows to verify the person at the keyboard.
   *
   * Resolves { verified, state, message, retryable } — it never rejects, for
   * the same reason status() never throws. A caller that has to try/catch to
   * decide whether to show the PIN box will one day forget to.
   *
   * IMPORTANT: a false here means "not verified", and the ONLY correct
   * response is to fall back to the PIN. It must never unlock anything.
   */
  async function verify(windowHandle, message) {
    const native = addonOrNull();
    if (!native || !native.supported) {
      return { verified: false, state: 'NotBuilt', ...describe('NotBuilt') };
    }
    if (!windowHandle) {
      return { verified: false, state: 'Unknown', ...describe('Unknown') };
    }
    let state;
    try {
      state = await native.requestVerification(windowHandle, message || 'Unlock TabbySync Control Panel');
    } catch {
      state = 'Unknown';
    }
    if (!(state in STATES)) state = 'Unknown';
    // Belt and braces: only the one literal opens the gate. Any future state
    // added to the enum defaults to locked rather than to open.
    const verified = state === 'Verified';
    return { verified, state, ...describe(state) };
  }

  return { status, canEnable, verify, lastState: () => cachedState };
}
