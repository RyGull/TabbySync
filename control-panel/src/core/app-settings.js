// app-settings.js — persistence for the app's OWN preferences (theme,
// launch behavior, close behavior). Separate from profile-store.js's
// profiles.json on purpose: these aren't sync destinations, they don't hold
// secrets, and they apply to the whole app rather than to any one profile.
//
// Same atomic-write pattern as profile-store.js (temp file + rename) for the
// same reason: a crash mid-write must never leave a half-written,
// unparseable settings.json behind.
'use strict';

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

const FILE_NAME = 'settings.json';

const THEMES = new Set(['system', 'light', 'dark']);
const CLOSE_BEHAVIORS = new Set(['ask', 'minimize', 'quit']);

export const DEFAULTS = Object.freeze({
  theme: 'system',
  startWithWindows: false,
  startMinimized: false,
  closeBehavior: 'ask',
  // Whether to jump straight back into the last profile you had open,
  // rather than the empty-state screen, on the next launch.
  reopenLastProfile: false,
  // Written automatically on every successful profile selection regardless
  // of reopenLastProfile, so turning that setting on later has something to
  // act on immediately instead of waiting for the next selection.
  lastActiveProfileId: null,
});

function sanitize(patch) {
  const out = {};
  if ('theme' in patch && THEMES.has(patch.theme)) out.theme = patch.theme;
  if ('startWithWindows' in patch) out.startWithWindows = !!patch.startWithWindows;
  if ('startMinimized' in patch) out.startMinimized = !!patch.startMinimized;
  if ('closeBehavior' in patch && CLOSE_BEHAVIORS.has(patch.closeBehavior)) out.closeBehavior = patch.closeBehavior;
  if ('reopenLastProfile' in patch) out.reopenLastProfile = !!patch.reopenLastProfile;
  if ('lastActiveProfileId' in patch) out.lastActiveProfileId = patch.lastActiveProfileId || null;
  return out;
}

export function createSettingsStore(dir) {
  const filePath = path.join(dir, FILE_NAME);
  let cache = null;
  let writeQueue = Promise.resolve();

  function enqueue(fn) {
    const result = writeQueue.then(fn);
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function load() {
    if (cache) return cache;
    let raw;
    try {
      raw = await readFile(filePath, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') { cache = { ...DEFAULTS }; return cache; }
      throw e;
    }
    let onDisk;
    try {
      onDisk = JSON.parse(raw);
    } catch {
      // Unlike profiles.json, losing this file loses nothing irreplaceable
      // (no credentials, no sync destinations) — falling back to defaults
      // is safer here than refusing to start the app over a corrupt
      // preferences file.
      cache = { ...DEFAULTS };
      return cache;
    }
    cache = { ...DEFAULTS, ...sanitize(onDisk) };
    return cache;
  }

  async function writeToDisk(settings) {
    await mkdir(dir, { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify(settings, null, 2));
    await rename(tmp, filePath);
  }

  async function get() {
    return { ...(await load()) };
  }

  function update(patch) {
    return enqueue(async () => {
      const current = await load();
      const next = { ...current, ...sanitize(patch) };
      cache = next;
      await writeToDisk(next);
      return { ...next };
    });
  }

  return { filePath, get, update };
}
