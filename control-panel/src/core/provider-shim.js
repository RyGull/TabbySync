// provider-shim.js — loads the vendored shared/providers.js and tabs/storage.js
// (see ../../vendor/MANIFEST.json) and gives them the one thing they expect
// from their host page/service-worker: a `self.TabbySyncConfig` object.
//
// The real extension's shared/config.js is NOT vendored here on purpose — it
// is built around ONE active provider with "remembered slots" for the other
// two (see its own file comment), which is the extension's model, not the
// Control Panel's (many independent named profiles). Re-using it would mean
// fighting its assumptions. Instead this shim implements only the two things
// shared/providers.js actually calls on `shared()`:
//
//   - sanitizeSyncName(name): copied verbatim from shared/config.js so the
//     Control Panel derives the exact same "bookmarks-<name>.json" /
//     "tabs-<name>.json" filenames the extension would for the same input.
//     test/vendor-parity.test.js cross-checks this copy against the real
//     file so an upstream change can't silently drift out from under it.
//   - setConfig(patch): called exactly once, right after shared/providers.js
//     auto-creates a Gist or a JSONBin bin on a profile's first save, to
//     remember the new id. We don't have a global "current config" to write
//     into (this app juggles many profiles at once) — withCapture() below
//     records whatever setConfig() was given during one call and hands it
//     back to the caller, which then saves it onto the right profile.
'use strict';

const SYNC_NAME_MAX = 40;

/** Verbatim copy of shared/config.js's sanitizeSyncName — see the parity test. */
export function sanitizeSyncName(name) {
  return (name || '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .slice(0, SYNC_NAME_MAX)
    .replace(/^[-.]+|[-.]+$/g, '');
}

let capture = null;

function shimSetConfig(patch) {
  if (capture) Object.assign(capture, patch);
  return Promise.resolve();
}

/**
 * Runs `fn` (an async function making provider calls) while recording any
 * setConfig() patch issued during it. Resolves to { result, patch }, where
 * `patch` is `{}` unless a Gist/JSONBin id was just created.
 *
 * Calls do not nest safely (capture is a single module-level slot) — this
 * app only ever talks to one profile's provider at a time (see
 * src/core/sessions.js's per-profile queueing), so that's fine in practice;
 * withCapture asserts against accidental re-entrancy rather than silently
 * losing a patch.
 */
export async function withCapture(fn) {
  if (capture !== null) {
    throw new Error('provider-shim: withCapture() called re-entrantly — provider calls must be serialized per profile.');
  }
  capture = {};
  try {
    const result = await fn();
    return { result, patch: capture };
  } finally {
    capture = null;
  }
}

let loaded = null;

/**
 * Loads the vendored shared/providers.js and tabs/storage.js exactly once
 * (both are classic scripts that attach to `self` on load) and returns
 * { TabbySyncProviders, TabbySync }. Safe to call repeatedly.
 */
export async function loadVendored() {
  if (loaded) return loaded;

  if (typeof globalThis.self === 'undefined') globalThis.self = globalThis;
  globalThis.self.TabbySyncConfig = {
    sanitizeSyncName,
    setConfig: shimSetConfig,
  };

  await import('../../vendor/shared/providers.js');
  await import('../../vendor/tabs/storage.js');

  const TabbySyncProviders = globalThis.self.TabbySyncProviders;
  const TabbySync = globalThis.self.TabbySync;
  if (!TabbySyncProviders) throw new Error('provider-shim: vendor/shared/providers.js did not set self.TabbySyncProviders.');
  if (!TabbySync) throw new Error('provider-shim: vendor/tabs/storage.js did not set self.TabbySync.');

  loaded = { TabbySyncProviders, TabbySync };
  return loaded;
}

/**
 * Synchronous access to what loadVendored() already fetched. Throws if it
 * hasn't been awaited yet — call loadVendored() once during app startup
 * (main.cjs does this before creating any window) so every other module can
 * assume it's already there instead of threading an await through every op.
 */
export function getVendored() {
  if (!loaded) throw new Error('provider-shim: loadVendored() must be awaited once (at app startup) before getVendored() is used.');
  return loaded;
}
