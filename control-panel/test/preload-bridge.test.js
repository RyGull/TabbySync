// preload-bridge.test.js — everything the renderer calls has to exist on the
// bridge that preload.cjs exposes.
//
// The bug this file exists to prevent, because it cost a locked-out app:
// adding a `hello:` namespace to preload.cjs closed the `pin:` object one
// member too early, and the two that followed — `activity` and `onChanged` —
// silently became members of `hello` instead. Nothing failed to parse. Nothing
// failed to start. `api.pin.onChanged` was simply undefined, so wireLockScreen()
// threw partway through and the lock:changed listener was never registered.
//
// The result looked like this: launching still worked, because the unlock
// form's submit handler is attached BEFORE the throwing line, so typing a PIN
// still started the app. But "Lock now" then did nothing visible — main locked
// itself and told a renderer that was not listening — leaving an app that
// looked open and refused every action with "TabbySync Control Panel is
// locked". The only way back was to restart.
//
// A renderer talking to a bridge is a contract between two files with nothing
// checking it. This is that check.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const app = await readFile(path.join(CP_ROOT, 'renderer/app.js'), 'utf8');

/**
 * Loads preload.cjs for real, with `electron` stubbed, and hands back the
 * object it exposes. Executing it rather than parsing it means the test sees
 * exactly the shape the renderer would get, including anything built
 * conditionally.
 */
function loadBridge() {
  const Module = require('module');
  const original = Module._load;
  let exposed = null;
  Module._load = function (request, ...rest) {
    if (request === 'electron') {
      return {
        contextBridge: { exposeInMainWorld: (_key, value) => { exposed = value; } },
        ipcRenderer: { on() {}, removeListener() {}, invoke: async () => ({ ok: true }) },
      };
    }
    return original.call(this, request, ...rest);
  };
  try {
    delete require.cache[require.resolve(path.join(CP_ROOT, 'preload.cjs'))];
    require(path.join(CP_ROOT, 'preload.cjs'));
  } finally {
    Module._load = original;
  }
  assert.ok(exposed, 'preload.cjs exposed nothing through contextBridge');
  return exposed;
}

const bridge = loadBridge();

/** Every `api.<namespace>.<member>(` the renderer actually calls. */
function calledMembers() {
  const out = new Set();
  for (const m of app.matchAll(/\bapi\.([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)/g)) {
    out.add(`${m[1]}.${m[2]}`);
  }
  return [...out].sort();
}

test('every api.* the renderer calls exists on the bridge', () => {
  const missing = [];
  for (const ref of calledMembers()) {
    const [ns, member] = ref.split('.');
    const group = bridge[ns];
    if (!group || typeof group[member] !== 'function') missing.push(ref);
  }
  assert.deepEqual(missing, [],
    `the renderer calls these, and preload.cjs does not expose them: ${missing.join(', ')}. ` +
    'A misplaced closing brace moves members between namespaces without breaking anything visibly.');
});

test('the lock screen’s own calls are all present', () => {
  // Named explicitly rather than left to the sweep above, because these are
  // the ones whose absence does not announce itself: the app still launches
  // and still unlocks, and only "Lock now" and the idle timeout quietly stop
  // drawing anything.
  for (const member of ['status', 'setup', 'unlock', 'skipSetup', 'change', 'disable', 'lock', 'activity', 'onChanged']) {
    assert.equal(typeof bridge.pin[member], 'function',
      `api.pin.${member} is missing — check whether it drifted into a neighbouring namespace`);
  }
  for (const member of ['unlock', 'enable', 'disable']) {
    assert.equal(typeof bridge.hello[member], 'function', `api.hello.${member} is missing`);
  }
});

test('the PIN namespace holds no Hello members, and vice versa', () => {
  // The exact shape of the original mistake: a member sitting in the wrong
  // namespace is still a function, still callable, and still wrong.
  for (const member of Object.keys(bridge.pin)) {
    assert.ok(!/^(enable)$/.test(member), `api.pin.${member} looks like a Hello member in the PIN namespace`);
  }
  for (const member of Object.keys(bridge.hello)) {
    assert.ok(!/^(status|setup|skipSetup|change|lock|activity|onChanged)$/.test(member),
      `api.hello.${member} belongs to the PIN namespace`);
  }
});

test('nothing on the bridge is exposed twice under different names', () => {
  // Two namespaces owning the same channel is how one of them ends up being
  // the forgotten copy.
  const seen = new Map();
  for (const [ns, group] of Object.entries(bridge)) {
    if (!group || typeof group !== 'object') continue;
    for (const member of Object.keys(group)) {
      const fn = group[member];
      if (typeof fn !== 'function') continue;
      const key = fn.toString();
      // Only flag genuine duplicates of a channel call, not shapes that
      // happen to be similar (several `() => call('x')` differ by their
      // channel string, which is inside toString()).
      if (!key.includes('call(')) continue;
      if (seen.has(key)) {
        assert.fail(`${ns}.${member} and ${seen.get(key)} both invoke the same channel body`);
      }
      seen.set(key, `${ns}.${member}`);
    }
  }
});
