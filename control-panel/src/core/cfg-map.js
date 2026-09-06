// cfg-map.js — maps a Control Panel Profile record onto the small, differently
// -shaped "cfg"/"settings" objects each vendored module expects.
//
// A Profile always describes exactly ONE provider with its own credentials
// (see profile-store.js) — unlike the extension, which keeps one active
// provider plus "remembered" credentials for the other two. That makes these
// mappings simple: every field a vendored function reads either comes
// straight off the profile, or is blank because this profile uses a
// different provider.
'use strict';

/** cfg shape expected by vendor/bookmarks-lib/sync.js (getRemote/putRemote). */
export function bookmarksCfg(profile) {
  return {
    provider: profile.provider,
    baseUrl: profile.serverUrl || '',
    token: profile.token || '',
    syncName: profile.syncName || '',
    passphrase: profile.passphrase || '',
    gistId: profile.gistId || '',
    jsonbinTabsId: profile.jsonbinTabsId || '',
    jsonbinBookmarksId: profile.jsonbinBookmarksId || '',
  };
}

/** settings shape expected by vendor/tabs/storage.js (pullRemote/pushRemote). */
export function tabsCfg(profile) {
  return {
    provider: profile.provider,
    baseUrl: profile.serverUrl || '',
    token: profile.token || '',
    syncKey: profile.syncName || '',
    syncName: profile.syncName || '',
    passphrase: profile.passphrase || '',
    gistId: profile.gistId || '',
    jsonbinTabsId: profile.jsonbinTabsId || '',
    jsonbinBookmarksId: profile.jsonbinBookmarksId || '',
  };
}

/**
 * fullCfg shape expected by vendor/shared/providers.js's deleteProviderData —
 * it was written for the extension's "remembered slot per provider" model, so
 * it wants each provider's credentials under its OWN field name regardless of
 * which one is active. A Profile only ever has one provider active, so only
 * that provider's slot is filled in; the others are deliberately left blank,
 * which reads to deleteProviderData as "that provider was never configured".
 */
export function fullCfgForDelete(profile) {
  const isCustom = profile.provider === 'custom';
  const isGist = profile.provider === 'gist';
  const isJsonbin = profile.provider === 'jsonbin';
  return {
    serverUrl: isCustom ? (profile.serverUrl || '') : '',
    customToken: isCustom ? (profile.token || '') : '',
    customSyncName: isCustom ? (profile.syncName || '') : '',
    gistToken: isGist ? (profile.token || '') : '',
    gistId: isGist ? (profile.gistId || '') : '',
    jsonbinToken: isJsonbin ? (profile.token || '') : '',
    jsonbinTabsId: isJsonbin ? (profile.jsonbinTabsId || '') : '',
    jsonbinBookmarksId: isJsonbin ? (profile.jsonbinBookmarksId || '') : '',
  };
}
