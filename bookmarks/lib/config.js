// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// config.js — the bookmarks engine's view of TabbySync's shared config.
//
// Server URL / token / sync name / passphrase are SHARED with the tabs engine
// (see shared/config.js). Everything here maps that shared config onto the
// field names the rest of the bookmarks engine already uses, and owns the
// bookmark-only sync state under its own namespaced keys.

// self.TabbySyncConfig is provided by shared/config.js, imported by the
// service worker before this engine runs.
function shared() { return self.TabbySyncConfig; }

export const DEFAULTS = {
  baseUrl: '',
  token: '',
  syncName: '',
  passphrase: '',
  provider: 'custom',
  gistId: '',
  jsonbinTabsId: '',
  jsonbinBookmarksId: '',
  intervalMin: 5,
  autoSync: true,
  deleteWins: false,
  enabled: true,
};

// Returns the bookmarks engine config, flattened from the shared config.
export async function getConfig() {
  const c = await shared().getConfig();
  return {
    baseUrl: c.serverUrl,
    token: c.token,
    syncName: c.syncName,
    passphrase: c.passphrase,
    // which sync backend the fields above apply to (see shared/providers.js)
    provider: c.provider,
    gistId: c.gistId,
    jsonbinTabsId: c.jsonbinTabsId,
    jsonbinBookmarksId: c.jsonbinBookmarksId,
    intervalMin: c.bookmarks.intervalMin,
    autoSync: c.bookmarks.autoSync,
    deleteWins: c.bookmarks.deleteWins,
    enabled: c.bookmarks.enabled,
  };
}

export async function setConfig(patch) {
  const server = {};
  if ('baseUrl' in patch) server.serverUrl = patch.baseUrl;
  if ('token' in patch) server.token = patch.token;
  if ('syncName' in patch) server.syncName = patch.syncName;
  if ('passphrase' in patch) server.passphrase = patch.passphrase;
  if ('provider' in patch) server.provider = patch.provider;
  if ('gistId' in patch) server.gistId = patch.gistId;
  if ('jsonbinTabsId' in patch) server.jsonbinTabsId = patch.jsonbinTabsId;
  if ('jsonbinBookmarksId' in patch) server.jsonbinBookmarksId = patch.jsonbinBookmarksId;
  const bookmarks = {};
  if ('intervalMin' in patch) bookmarks.intervalMin = patch.intervalMin;
  if ('autoSync' in patch) bookmarks.autoSync = patch.autoSync;
  if ('deleteWins' in patch) bookmarks.deleteWins = patch.deleteWins;
  if ('enabled' in patch) bookmarks.enabled = patch.enabled;
  await shared().setConfig({ ...server, bookmarks });
}

// Configured AND enabled — the engine only runs when both hold.
export function isConfigured(cfg) {
  return !!(cfg.enabled) && self.TabbySyncProviders.isConfigured(cfg);
}

// --- sync state (not user-editable), under bookmark-only keys ---
const S = {
  cacheTree: 'sl.bm.cacheTree',
  stableToLocal: 'sl.bm.stableToLocal',
  lastSync: 'sl.bm.lastSync',
  lastError: 'sl.bm.lastError',
  lastStatus: 'sl.bm.lastStatus',
};
const STATE_KEYS = Object.keys(S).map((k) => S[k]);

export async function getState() {
  const s = await chrome.storage.local.get(STATE_KEYS);
  return {
    cacheTree: s[S.cacheTree] || null,
    stableToLocal: s[S.stableToLocal] || {},
    lastSync: s[S.lastSync] || 0,
    lastError: s[S.lastError] || '',
    lastStatus: s[S.lastStatus] || 'never synced',
  };
}

export async function setState(patch) {
  const out = {};
  for (const k of Object.keys(patch)) {
    if (k in S) out[S[k]] = patch[k];
  }
  await chrome.storage.local.set(out);
}
