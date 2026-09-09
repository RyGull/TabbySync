// lock-gate.test.js — the one property the whole PIN feature rests on.
//
// The lock is enforced in main.cjs's handle(): every IPC channel refuses
// while locked unless it opts out with `allowWhileLocked`. That opt-out is a
// single word, easy to copy onto a new channel without thinking, and a
// channel that leaks while locked is not something the UI would ever show —
// the lock screen would look exactly as convincing as before. So the
// allow-list is pinned here, in source, and adding to it has to be
// deliberate enough to also edit this file.
//
// Read as text rather than by importing: main.cjs is CommonJS that calls
// Electron at load time, and there is no Electron in this test runner.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const main = await readFile(path.join(CP_ROOT, 'main.cjs'), 'utf8');

/**
 * The only channels allowed to answer while the app is locked. Between them
 * they can reveal exactly one thing: whether a PIN is set. None of them
 * touches a profile, a token, a bookmark or a saved tab.
 *
 * hello:unlock is the one addition, and it belongs here for the same reason
 * pin:unlock does: it IS an unlock path, so refusing it while locked would
 * mean it could never be used. It reveals no more than the PIN channels do —
 * it answers "did Windows say this is you", and the decision to actually
 * unlock is made in main.cjs from that answer, not by the renderer. The other
 * two Hello channels (enable, disable) are deliberately NOT here: both need
 * an app that is already open.
 */
const ALLOWED_WHILE_LOCKED = new Set([
  'pin:status',
  'pin:setup',
  'pin:unlock',
  'pin:skipSetup',
  'hello:unlock',
]);

/** Every handle('channel', ...) in main.cjs, with the source of that call. */
function handlerCalls(src) {
  const out = [];
  const re = /\bhandle\(\s*'([^']+)'/g;
  let m;
  while ((m = re.exec(src))) {
    // The call's own text runs to the start of the next handle( — enough to
    // see whether its options object carries the opt-out.
    const next = src.indexOf("handle('", m.index + 8);
    out.push({ channel: m[1], body: src.slice(m.index, next === -1 ? src.length : next) });
  }
  return out;
}

test('Windows Hello can never be the only thing standing between you and the app', () => {
  // The rule from src/core/hello.js, enforced where it actually matters. If
  // hello:unlock stopped checking that a PIN exists, a machine where Hello
  // was enabled and the PIN later cleared would unlock on a fingerprint with
  // no fallback — and a dead sensor would then be a locked-out user.
  const call = handlerCalls(main).find((c) => c.channel === 'hello:unlock');
  assert.ok(call, 'hello:unlock is gone; the lock screen button has nothing to call');
  assert.match(call.body, /if \(!helloEnabled \|\| !status\.isSet\)/,
    'hello:unlock no longer refuses when no PIN is set behind it');
  assert.match(call.body, /if \(result\.verified\) markUnlocked\(\)/,
    'hello:unlock unlocks on something other than a positive verification');

  // And clearing the PIN has to clear Hello with it.
  const disable = handlerCalls(main).find((c) => c.channel === 'pin:disable');
  assert.ok(disable, 'pin:disable is gone');
  assert.match(disable.body, /helloEnabled: false/,
    'turning the PIN off leaves Windows Hello on, with no PIN behind it');
});

test('main.cjs registers handlers we can actually see', () => {
  const calls = handlerCalls(main);
  assert.ok(calls.length > 30, `expected to find the app's IPC channels, found ${calls.length} — did handle() get renamed?`);
});

test('only the PIN channels answer while the app is locked', () => {
  const leaking = handlerCalls(main)
    .filter((c) => /allowWhileLocked:\s*true/.test(c.body))
    .map((c) => c.channel)
    .filter((channel) => !ALLOWED_WHILE_LOCKED.has(channel));

  assert.deepEqual(leaking, [],
    `these channels answer while the app is locked but are not on the allow-list: ${leaking.join(', ')}. ` +
    'If that is genuinely intended, add them to ALLOWED_WHILE_LOCKED here — and be sure they reveal nothing about the ' +
    "user's profiles, credentials, bookmarks or saved tabs.");
});

test('every channel on the allow-list is actually registered', () => {
  const registered = new Set(handlerCalls(main).map((c) => c.channel));
  for (const channel of ALLOWED_WHILE_LOCKED) {
    assert.ok(registered.has(channel), `${channel} is on the allow-list but no longer exists — remove it from the list`);
  }
});

test('the data channels carry no opt-out at all', () => {
  // Spot-check the ones that would matter most if they ever did.
  const mustBeGated = [
    'profiles:list', 'profiles:get', 'settings:get', 'settings:update',
    'bookmarks:load', 'tabs:load', 'backup:export', 'backup:read', 'backup:apply',
    'pin:change', 'pin:disable',
  ];
  const calls = new Map(handlerCalls(main).map((c) => [c.channel, c.body]));
  for (const channel of mustBeGated) {
    const body = calls.get(channel);
    assert.ok(body, `${channel} is no longer registered — if it was renamed, update this list`);
    assert.ok(!/allowWhileLocked/.test(body), `${channel} must never answer while the app is locked`);
  }
});

test('handle() defaults to gated, and gates before running the handler', () => {
  // The default in the signature is what makes "forgot to think about it"
  // safe rather than open.
  assert.match(main, /function handle\(channel, fn, \{\s*allowWhileLocked = false\s*\} = \{\}\)/,
    'handle() must default allowWhileLocked to false');
  // And the check has to come before fn() is called, not after.
  const body = main.slice(main.indexOf('function handle(channel, fn'));
  const guard = body.indexOf('lockState.locked');
  const call = body.indexOf('await fn(...args)');
  assert.ok(guard > -1 && call > -1 && guard < call, 'the lock check must run before the handler does');
});

test('a reload relocks: the main process, not the page, holds the unlocked flag', () => {
  // Rule 2 of the gate. Without this, Ctrl+R would reload a page that simply
  // decides for itself that it is unlocked.
  assert.match(main, /did-start-navigation/, 'main.cjs must relock on a main-frame navigation');
  const nav = main.slice(main.indexOf("'did-start-navigation'"));
  assert.match(nav.slice(0, 400), /lockState\.locked = true/);
});

test('the app starts locked', () => {
  const decl = main.slice(main.indexOf('const lockState = {'), main.indexOf('let pinStore'));
  assert.match(decl, /locked:\s*true/, 'lockState must start locked — an app that starts unlocked and locks later has a window');
});
