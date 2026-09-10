// hello-lock-screen.test.js — when Windows Hello is allowed to ask by itself.
//
// Turning Hello on is a decision that it should just happen, so the lock
// screen fires it without waiting for a click. The failure modes of getting
// that wrong are worse than the click was:
//
//   * a prompt that reappears the moment you dismiss it is a trap — you can
//     never reach the PIN box underneath;
//   * a prompt fired at the instant you press "Lock now" asks you to undo
//     what you just deliberately did;
//   * a prompt fired while the window is minimised to the tray, or while you
//     are in another program, puts a Windows credential dialog over somebody
//     else's work with no context for why.
//
// So the rule is: fire when someone is plausibly trying to get IN, which is
// not the same moment as the app locking. Launch, or returning to a locked
// window. Once per lock, and only with focus.
//
// Read as source rather than executed, for the reason lock-gate.test.js gives:
// renderer/app.js is a classic script that touches document at load time and
// there is no DOM in this runner.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = await readFile(path.join(CP_ROOT, 'renderer/app.js'), 'utf8');
const html = await readFile(path.join(CP_ROOT, 'renderer/index.html'), 'utf8');

/** The source of one top-level `function name(...) {...}`, brace-matched. */
function functionSource(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name}() not found in renderer/app.js`);
  let parens = 0;
  let i = app.indexOf('(', start);
  for (; i < app.length; i += 1) {
    if (app[i] === '(') parens += 1;
    else if (app[i] === ')' && (parens -= 1) === 0) break;
  }
  let depth = 0;
  for (let j = app.indexOf('{', i); j < app.length; j += 1) {
    if (app[j] === '{') depth += 1;
    else if (app[j] === '}' && (depth -= 1) === 0) return app.slice(start, j + 1);
  }
  throw new Error(`${name}() is not brace-balanced`);
}

const auto = functionSource('maybeAutoUnlockWithHello');

test('Hello never asks by itself more than once per lock', () => {
  // The trap: dismiss the prompt, it comes straight back, and the PIN box is
  // unreachable forever.
  assert.match(auto, /lockUi\.helloAutoTried/, 'nothing tracks whether Hello has already asked');
  assert.match(auto, /if \(lockUi\.helloAutoTried \|\| lockUi\.helloBusy\) return;/,
    'the once-per-lock guard is gone, so a dismissed prompt can be re-fired');
  // Set before firing, not after — an await in between would let a second
  // caller through.
  const flagAt = auto.indexOf('lockUi.helloAutoTried = true');
  const fireAt = auto.indexOf('unlockWithHello()');
  assert.ok(flagAt > 0 && fireAt > flagAt,
    'the guard is set after the prompt fires, which leaves a window for a second one');

  // And a fresh lock has to clear it, or Hello asks once per app run rather
  // than once per lock.
  assert.match(functionSource('showLockScreen'), /lockUi\.helloAutoTried = false/,
    'showing the lock screen does not reset the once-per-lock guard');
});

test('Hello never asks while the window is out of sight', () => {
  assert.match(auto, /if \(!document\.hasFocus\(\)\) return;/,
    'Hello can fire with the window unfocused — a credential dialog over another program');
});

test('Hello never asks when there is nothing to ask for', () => {
  assert.match(auto, /if \(lockUi\.screen\.hidden \|\| !lockUi\.helloOffered\) return;/,
    'Hello can fire when the lock screen is down, or when this PC cannot do Hello');
});

test('locking on purpose does not immediately ask you to unlock', () => {
  // No special case needed, and that is the point: locking deliberately
  // involves no change of focus, so the focus handler stays quiet. This test
  // exists to stop someone "helpfully" adding the call to the relock path.
  const wire = functionSource('wireLockScreen');
  const onChanged = wire.slice(wire.indexOf('api.pin.onChanged'));
  assert.ok(!onChanged.includes('maybeAutoUnlockWithHello'),
    'the relock path fires Hello, so pressing "Lock now" asks you to unlock a moment later');
});

test('arriving at a locked app does ask — at launch, and on return', () => {
  // The two moments someone is actually trying to get in.
  const init = functionSource('init');
  assert.match(init, /showLockScreen\('unlock'\);[\s\S]{0,200}maybeAutoUnlockWithHello\(\);/,
    'launching into a locked app does not offer Hello without a click');

  const wire = functionSource('wireLockScreen');
  assert.match(wire, /addEventListener\('focus', \(\) => \{ maybeAutoUnlockWithHello\(\); \}\)/,
    'returning to a locked window does not offer Hello');
});

test('two prompts can never be on screen at once', () => {
  const unlock = functionSource('unlockWithHello');
  assert.match(unlock, /if \(lockUi\.helloBusy\) return;\s*lockUi\.helloBusy = true;/,
    'a click during an in-flight prompt opens a second one');
  assert.match(unlock, /finally \{\s*lockUi\.helloBusy = false;/,
    'the busy flag is not cleared in a finally, so one failure disables Hello for good');
});

test('the PIN box is always there, whatever Hello does', () => {
  // The rule from src/core/hello.js, at the one place a person meets it. The
  // button is added ABOVE the PIN field and never replaces it.
  const form = html.slice(html.indexOf('id="lock-unlock"'), html.indexOf('id="lock-setup"'));
  assert.ok(form.includes('id="lock-hello"'), 'the Hello button is gone from the unlock form');
  assert.ok(form.includes('id="lock-pin"'), 'the PIN field is gone from the unlock form');
  assert.ok(form.indexOf('id="lock-hello"') < form.indexOf('id="lock-pin"'),
    'the Hello button should sit above the PIN field, as the faster path offered first');
  assert.match(form, /id="lock-hello"[^>]*\bhidden\b/,
    'the Hello button ships visible; it must be revealed only once main confirms Hello is usable');

  // And a failed prompt has to hand the keyboard back.
  assert.match(functionSource('unlockWithHello'), /\$\('#lock-pin'\)\.focus\(\)/,
    'a dismissed or failed Hello leaves the caret nowhere, so typing the PIN needs a click first');
});
