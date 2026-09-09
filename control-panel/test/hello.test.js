// hello.test.js — the Windows Hello gate's policy, which is the half of this
// feature that can be tested anywhere.
//
// The native addon is Windows-only and may not even be built. That is
// deliberate and it is what these tests exercise: every path through
// src/core/hello.js has to end somewhere safe when Hello is missing, broken,
// busy, disabled by policy, or simply says no — and "somewhere safe" always
// means the PIN, never an unlocked app.
//
// The two rules, both of which are load-bearing:
//
//   1. Only the literal result "Verified" unlocks. Anything else — including
//      a state nobody has thought of yet — is a refusal.
//   2. Hello cannot be turned on unless a PIN already exists. A fingerprint
//      reader that dies must not be able to lock someone out of every profile
//      they have.

import test from 'node:test';
import assert from 'node:assert/strict';

import { createHelloGate, describe as describeState } from '../src/core/hello.js';

/** A fake addon, so the policy can be driven through every state. */
function fakeAddon({ supported = true, availability = 'Available', result = 'Verified' } = {}) {
  return {
    supported,
    checkAvailability: async () => {
      if (availability instanceof Error) throw availability;
      return availability;
    },
    requestVerification: async () => {
      if (result instanceof Error) throw result;
      return result;
    },
  };
}

const gateWith = (addon) => createHelloGate({ load: () => addon });

// ---------------------------------------------------------------------------
// Rule 1: only "Verified" opens the gate
// ---------------------------------------------------------------------------

test('only the literal "Verified" unlocks — every other answer refuses', async () => {
  const refusals = [
    'Canceled', 'RetriesExhausted', 'DeviceNotPresent', 'NotConfiguredForUser',
    'DisabledByPolicy', 'DeviceBusy', 'Unknown',
  ];
  for (const result of refusals) {
    const { verified, state } = await gateWith(fakeAddon({ result })).verify(Buffer.alloc(8), 'msg');
    assert.equal(verified, false, `"${result}" was treated as a successful unlock`);
    assert.equal(state, result);
  }
  const ok = await gateWith(fakeAddon({ result: 'Verified' })).verify(Buffer.alloc(8), 'msg');
  assert.equal(ok.verified, true, 'a real verification did not unlock');
});

test('a state nobody has thought of yet is a refusal, not an unlock', async () => {
  // The failure this prevents: a future Windows adds an enum value, the addon
  // passes the name through, and an unrecognised string falls into a truthy
  // branch somewhere.
  for (const result of ['SomethingNew', '', 'verified', 'VERIFIED', 'true']) {
    const { verified } = await gateWith(fakeAddon({ result })).verify(Buffer.alloc(8), 'msg');
    assert.equal(verified, false, `an unrecognised result "${result}" unlocked the app`);
  }
});

test('a native call that throws refuses rather than propagating', async () => {
  // A lock screen that shows an exception instead of the PIN box is a lock
  // screen nobody gets past.
  const gate = gateWith(fakeAddon({ result: new Error('COM went sideways') }));
  const out = await gate.verify(Buffer.alloc(8), 'msg');
  assert.equal(out.verified, false);
  assert.equal(out.state, 'Unknown');
  assert.equal(out.retryable, true, 'a transient native failure should still allow another attempt');
});

test('a missing window handle refuses instead of calling into the addon', async () => {
  let called = false;
  const addon = fakeAddon({ result: 'Verified' });
  addon.requestVerification = async () => { called = true; return 'Verified'; };
  const out = await createHelloGate({ load: () => addon }).verify(null, 'msg');
  assert.equal(out.verified, false, 'verification without a window handle unlocked the app');
  assert.equal(called, false, 'the addon was called with no window to parent the dialog to');
});

// ---------------------------------------------------------------------------
// Rule 2: the PIN is the floor
// ---------------------------------------------------------------------------

test('Hello cannot be enabled without a PIN behind it', async () => {
  const gate = gateWith(fakeAddon({ availability: 'Available' }));
  const no = await gate.canEnable({ pinIsSet: false });
  assert.equal(no.ok, false, 'Hello could be turned on with no PIN to fall back to');
  assert.match(no.reason, /Set a PIN first/);

  const yes = await gate.canEnable({ pinIsSet: true });
  assert.equal(yes.ok, true, 'Hello could not be enabled on a machine that supports it');
});

test('Hello cannot be enabled where the machine will not do it', async () => {
  for (const availability of ['DeviceNotPresent', 'NotConfiguredForUser', 'DisabledByPolicy']) {
    const out = await gateWith(fakeAddon({ availability })).canEnable({ pinIsSet: true });
    assert.equal(out.ok, false, `Hello was offered on a machine reporting ${availability}`);
    assert.ok(out.reason.length > 0, `${availability} was refused without saying why`);
  }
});

// ---------------------------------------------------------------------------
// Not built, not Windows — the ordinary case for most of this repository
// ---------------------------------------------------------------------------

test('an addon that was never built reports unavailable, not broken', async () => {
  // `npm install` on Linux builds the stub target, and a fresh checkout may
  // have nothing at all. Both must behave like a PC without a fingerprint
  // reader rather than like a bug.
  for (const load of [() => null, () => fakeAddon({ supported: false })]) {
    const s = await createHelloGate({ load }).status();
    assert.equal(s.usable, false);
    assert.equal(s.state, 'NotBuilt');
    assert.equal(s.retryable, false, 'a missing addon should not invite a retry');

    const v = await createHelloGate({ load }).verify(Buffer.alloc(8), 'msg');
    assert.equal(v.verified, false);

    const e = await createHelloGate({ load }).canEnable({ pinIsSet: true });
    assert.equal(e.ok, false, 'Hello was offered on a build that has no Hello in it');
  }
});

test('an availability check that throws degrades instead of failing', async () => {
  const s = await gateWith(fakeAddon({ availability: new Error('no WinRT here') })).status();
  assert.equal(s.state, 'Unknown');
  assert.equal(s.usable, false);
});

test('an unrecognised availability string is not treated as usable', async () => {
  const s = await gateWith(fakeAddon({ availability: 'SomethingNew' })).status();
  assert.equal(s.state, 'Unknown');
  assert.equal(s.usable, false);
});

// ---------------------------------------------------------------------------
// What the lock screen is told
// ---------------------------------------------------------------------------

test('every state a person can hit explains itself', async () => {
  // A lock screen quietly falling back to the PIN with no reason is how a
  // broken fingerprint reader turns into a support question.
  for (const state of ['DeviceNotPresent', 'NotConfiguredForUser', 'DisabledByPolicy', 'DeviceBusy', 'RetriesExhausted', 'NotBuilt']) {
    assert.ok(describeState(state).message.length > 0, `${state} has no explanation for the user`);
  }
  // Cancelling is the one case that must stay silent: the person just pressed
  // Escape, and telling them what they did is noise.
  assert.equal(describeState('Canceled').message, '');
  assert.equal(describeState('Available').message, '');
});

test('retryable separates "try again" from "this PC will not do this"', async () => {
  for (const state of ['DeviceNotPresent', 'NotConfiguredForUser', 'DisabledByPolicy', 'NotBuilt']) {
    assert.equal(describeState(state).retryable, false,
      `${state} invites a retry that cannot possibly succeed`);
  }
  for (const state of ['DeviceBusy', 'RetriesExhausted', 'Canceled', 'Unknown']) {
    assert.equal(describeState(state).retryable, true, `${state} should allow another attempt`);
  }
});
