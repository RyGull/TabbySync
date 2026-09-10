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
const UPDATE_CHECK_FREQUENCIES = new Set(['startup', 'daily', 'weekly', 'monthly', 'never']);

/** Which GitHub releases this install is willing to be updated to. */
export const UPDATE_CHANNELS = new Set(['stable', 'beta']);

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
  // How often setupAutoUpdate() checks GitHub Releases on startup —
  // 'startup' means every launch (the original, still-default behavior);
  // 'never' means only the manual "Check for updates" button does anything.
  updateCheckFrequency: 'startup',
  // Which releases count as an update for this install.
  //
  // 'stable' is every normal GitHub Release. 'beta' additionally accepts ones
  // marked pre-release, which is how a build can be handed out for testing
  // without it becoming the version the website and the update prompt push at
  // everybody. electron-updater calls this allowPrerelease and only supports
  // it on the GitHub provider, which is the provider this app uses.
  //
  // Deliberately NOT a way to install workflow artifacts. Those need an
  // authenticated GitHub token even on a public repository, arrive as a zip
  // rather than the latest.yml + installer the updater reads, and expire — a
  // token shipped inside a desktop app is a published token, so there is no
  // version of that idea worth having.
  updateChannel: 'stable',
  // When a check last actually ran (startup or manual) — main.cjs compares
  // this against updateCheckFrequency to decide whether today's launch
  // should check again. Not meant to be hand-edited; null means "never".
  lastUpdateCheckAt: null,
  // Which saved-tab lists are opened up in the Saved tabs panel, as
  // { profileId: [groupId, ...] }. Kept here rather than in the synced tab
  // state on purpose: whether a list is folded is about this window on this
  // machine, not about the tabs, and writing it into the state would push a
  // remote change every time you clicked a twisty. Per profile because a
  // list id only means anything within its own profile.
  expandedTabGroups: {},
  // How long the app stays unlocked with no interaction before the PIN
  // screen comes back. Idle, not absolute: the point is "you walked away",
  // and a timer that relocks mid-edit teaches people to pick a shorter PIN.
  // The PIN itself lives in security.json (see src/core/pin-lock.js), never
  // here — this file falls back to defaults when it can't be parsed, which
  // is the right call for a theme and completely the wrong one for a lock.
  pinIdleMinutes: 15,
  // Whether the first-run "set a PIN" prompt has been answered, either way.
  // Without this, declining it would mean being asked again on every single
  // launch — a prompt you cannot get rid of is one people learn to dismiss
  // without reading.
  pinSetupSeen: false,
  // Whether the lock screen offers Windows Hello before the PIN box.
  //
  // Only ever an ALTERNATIVE to the PIN, never a replacement: see
  // src/core/hello.js. It cannot be turned on without a PIN already set, and
  // clearing the PIN turns it back off — a fingerprint reader that dies must
  // not be able to lock someone out of every profile they have. Storing it
  // here (which falls back to defaults on a corrupt file) is safe precisely
  // because the safe default is false: losing this setting means being asked
  // for a PIN, which is the floor anyway.
  helloEnabled: false,
});

const MIN_PIN_IDLE_MINUTES = 1;
const MAX_PIN_IDLE_MINUTES = 480;

// Ids are strings and there are never many; the caps exist so a corrupt or
// hand-edited file can't grow this key without bound, not because any real
// use approaches them.
const MAX_PROFILES_TRACKED = 200;
const MAX_GROUPS_PER_PROFILE = 2000;

function sanitizeExpandedTabGroups(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [profileId, ids] of Object.entries(value).slice(0, MAX_PROFILES_TRACKED)) {
    if (!Array.isArray(ids)) continue;
    const clean = [...new Set(ids.filter((id) => typeof id === 'string' && id))].slice(0, MAX_GROUPS_PER_PROFILE);
    if (clean.length) out[profileId] = clean;
  }
  return out;
}

// A fresh copy, not the frozen DEFAULTS themselves: expandedTabGroups is an
// object, and spreading DEFAULTS would hand every caller the same nested one
// to mutate.
function freshDefaults() {
  return { ...DEFAULTS, expandedTabGroups: {} };
}

function sanitize(patch) {
  const out = {};
  if ('theme' in patch && THEMES.has(patch.theme)) out.theme = patch.theme;
  if ('startWithWindows' in patch) out.startWithWindows = !!patch.startWithWindows;
  if ('startMinimized' in patch) out.startMinimized = !!patch.startMinimized;
  if ('closeBehavior' in patch && CLOSE_BEHAVIORS.has(patch.closeBehavior)) out.closeBehavior = patch.closeBehavior;
  if ('reopenLastProfile' in patch) out.reopenLastProfile = !!patch.reopenLastProfile;
  if ('lastActiveProfileId' in patch) out.lastActiveProfileId = patch.lastActiveProfileId || null;
  if ('updateCheckFrequency' in patch && UPDATE_CHECK_FREQUENCIES.has(patch.updateCheckFrequency)) out.updateCheckFrequency = patch.updateCheckFrequency;
  // An unrecognised channel falls back to stable rather than being ignored:
  // the safe direction for "which builds may install themselves here" is the
  // conservative one, and a silently-dropped patch would leave Options showing
  // a channel the app is not actually on.
  if ('updateChannel' in patch) {
    out.updateChannel = UPDATE_CHANNELS.has(patch.updateChannel) ? patch.updateChannel : DEFAULTS.updateChannel;
  }
  if ('lastUpdateCheckAt' in patch) out.lastUpdateCheckAt = (typeof patch.lastUpdateCheckAt === 'number' && patch.lastUpdateCheckAt > 0) ? patch.lastUpdateCheckAt : null;
  if ('expandedTabGroups' in patch) out.expandedTabGroups = sanitizeExpandedTabGroups(patch.expandedTabGroups);
  if ('pinIdleMinutes' in patch) {
    const n = Math.round(Number(patch.pinIdleMinutes));
    // Out-of-range or non-numeric falls back to the default rather than being
    // ignored: a silently-dropped patch would leave the Options field showing
    // a value the app isn't actually using.
    out.pinIdleMinutes = Number.isFinite(n) && n >= MIN_PIN_IDLE_MINUTES && n <= MAX_PIN_IDLE_MINUTES
      ? n : DEFAULTS.pinIdleMinutes;
  }
  if ('pinSetupSeen' in patch) out.pinSetupSeen = !!patch.pinSetupSeen;
  if ('helloEnabled' in patch) out.helloEnabled = !!patch.helloEnabled;
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
      if (e.code === 'ENOENT') { cache = freshDefaults(); return cache; }
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
      cache = freshDefaults();
      return cache;
    }
    cache = { ...freshDefaults(), ...sanitize(onDisk) };
    return cache;
  }

  async function writeToDisk(settings) {
    await mkdir(dir, { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify(settings, null, 2));
    await rename(tmp, filePath);
  }

  async function get() {
    const cur = await load();
    // Deep enough to cover the one nested value: a shallow spread would hand
    // every caller the cache's own expandedTabGroups object to mutate.
    return { ...cur, expandedTabGroups: { ...cur.expandedTabGroups } };
  }

  function update(patch) {
    return enqueue(async () => {
      const current = await load();
      const next = { ...current, ...sanitize(patch) };
      cache = next;
      await writeToDisk(next);
      return { ...next, expandedTabGroups: { ...next.expandedTabGroups } };
    });
  }

  return { filePath, get, update };
}
