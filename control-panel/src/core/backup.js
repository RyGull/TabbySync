// backup.js — export and import of everything this app knows: every sync
// profile and the app's own settings, as one file.
//
// Two shapes, and the difference matters. A profile's `token` and
// `passphrase` are live credentials — a token is a bearer credential for
// your server, and the passphrase is what your synced data is encrypted
// with. So an export either:
//
//   * leaves them out entirely (`includesSecrets: false`) — a file you can
//     email yourself or drop in Dropbox, at the cost of having to re-enter
//     each credential after restoring; or
//   * carries them, in which case a passphrase is REQUIRED and the whole
//     payload is sealed in the same AES-256-GCM / PBKDF2 envelope the
//     browser extension uses for its own backups (vendor/bookmarks-lib/
//     crypto.js — the real one, not a re-implementation, so the format can't
//     quietly drift apart from the extension's).
//
// There is deliberately no third option. A plaintext file full of live
// tokens is not a backup, it is a leak with a .json extension.
//
// Everything here is pure: it builds, seals, opens and validates payloads.
// Actually writing to the profile store is main.cjs's job, so this module
// stays testable in plain Node with no Electron around it.
'use strict';

import { encryptJSON, decryptJSON, isEncrypted } from '../../vendor/bookmarks-lib/crypto.js';
import { sanitizeSyncName } from './provider-shim.js';

export const BACKUP_KIND = 'tabbysync-control-panel-backup';
export const BACKUP_VERSION = 1;

const SECRET_FIELDS = ['token', 'passphrase'];

// Copied verbatim into the file; anything not listed is either machine-local
// noise or would be actively wrong on another machine.
const PORTABLE_PROFILE_FIELDS = [
  'id', 'label', 'color', 'provider', 'serverUrl', 'syncName',
  'gistId', 'jsonbinTabsId', 'jsonbinBookmarksId', 'createdAt', 'updatedAt',
];

// lastUpdateCheckAt says when THIS install last phoned GitHub — restoring
// another machine's value would suppress or force a check for no reason.
const NON_PORTABLE_SETTINGS = new Set(['lastUpdateCheckAt']);

function pickProfile(p, includeSecrets) {
  const out = {};
  for (const f of PORTABLE_PROFILE_FIELDS) if (p[f] !== undefined) out[f] = p[f];
  if (includeSecrets) {
    for (const f of SECRET_FIELDS) out[f] = p[f] || '';
  }
  return out;
}

/**
 * Assembles the payload. `profiles` must come from profileStore.list({
 * includeSecrets: true }) when includeSecrets is on — a redacted profile has
 * hasToken/hasPassphrase booleans rather than the values, and silently
 * exporting those as though they were the credentials would produce a file
 * that restores an account you can't sync with.
 */
export function buildBackup({ profiles = [], settings = {}, includeSecrets = false, appVersion = '' } = {}) {
  if (includeSecrets) {
    for (const p of profiles) {
      if ('hasToken' in p || 'hasPassphrase' in p) {
        throw new Error('buildBackup: got redacted profiles but was asked to include secrets.');
      }
    }
  }
  const portableSettings = {};
  for (const [k, v] of Object.entries(settings)) {
    if (!NON_PORTABLE_SETTINGS.has(k)) portableSettings[k] = v;
  }
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    createdAt: Date.now(),
    appVersion,
    includesSecrets: !!includeSecrets,
    settings: portableSettings,
    profiles: profiles.map((p) => pickProfile(p, includeSecrets)),
  };
}

/**
 * Payload -> the text that goes in the file. A payload carrying secrets
 * without a passphrase is refused here rather than at the UI layer, so no
 * future caller can route around the rule by accident.
 */
export async function serializeBackup(payload, passphrase = '') {
  if (payload.includesSecrets && !passphrase) {
    throw new Error('A backup containing your tokens and passphrases must be protected with a passphrase.');
  }
  const body = passphrase ? await encryptJSON(payload, passphrase) : payload;
  return JSON.stringify(body, null, 2);
}

/** True if the file needs a passphrase before anything can be read out of it. */
export function backupIsEncrypted(text) {
  try { return isEncrypted(JSON.parse(text)); } catch { return false; }
}

function validate(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('That file is not a TabbySync backup.');
  if (payload.kind !== BACKUP_KIND) {
    throw new Error('That file is not a Control Panel backup. (Bookmark HTML exports and the extension’s own tab backups are imported from their own buttons, not this one.)');
  }
  if (payload.version > BACKUP_VERSION) {
    throw new Error(`That backup was written by a newer version of the Control Panel (format ${payload.version}, this app reads ${BACKUP_VERSION}). Update the app and try again.`);
  }
  if (!Array.isArray(payload.profiles)) throw new Error('That backup has no profiles in it.');
  return payload;
}

/** Text -> payload, decrypting first when the file is sealed. */
export async function parseBackup(text, passphrase = '') {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON, so it is not a backup this app wrote.');
  }
  if (isEncrypted(body)) {
    if (!passphrase) {
      const e = new Error('This backup is passphrase-protected. Enter its passphrase to open it.');
      e.code = 'PASSPHRASE_REQUIRED';
      throw e;
    }
    // decryptJSON throws on a wrong passphrase (AES-GCM fails its tag check),
    // which is exactly the signal we want — say so in words a person can act on.
    let plain;
    try {
      plain = await decryptJSON(body, passphrase);
    } catch {
      const e = new Error('That passphrase does not open this backup.');
      e.code = 'BAD_PASSPHRASE';
      throw e;
    }
    return validate(plain);
  }
  return validate(body);
}

/** What the confirm dialog shows before anything is written. */
export function summarizeBackup(payload) {
  return {
    createdAt: payload.createdAt || 0,
    appVersion: payload.appVersion || '',
    includesSecrets: !!payload.includesSecrets,
    profileCount: payload.profiles.length,
    labels: payload.profiles.map((p) => p.label || 'Untitled profile'),
    hasSettings: !!payload.settings && Object.keys(payload.settings).length > 0,
  };
}

/**
 * The profile records to hand the store, in the shape add()/replaceAll()
 * want.
 *
 * mode 'replace' keeps the original ids, because the settings restored
 * alongside them (lastActiveProfileId, expandedTabGroups) are keyed by id
 * and would otherwise point at nothing. mode 'merge' drops the ids so the
 * store mints fresh ones — importing a colleague's export, or your own twice,
 * must never collide with or overwrite a profile you already have.
 */
export function profilesForImport(payload, mode) {
  if (mode !== 'merge' && mode !== 'replace') throw new Error(`Unknown import mode: ${mode}`);
  return payload.profiles.map((p) => {
    const out = {
      label: (p.label || 'Imported profile').trim() || 'Imported profile',
      color: p.color || '',
      provider: p.provider || 'custom',
      serverUrl: p.serverUrl || '',
      syncName: sanitizeSyncName(p.syncName || ''),
      gistId: p.gistId || '',
      jsonbinTabsId: p.jsonbinTabsId || '',
      jsonbinBookmarksId: p.jsonbinBookmarksId || '',
      token: p.token || '',
      passphrase: p.passphrase || '',
    };
    if (mode === 'replace') {
      out.id = p.id;
      out.createdAt = p.createdAt || Date.now();
      out.updatedAt = p.updatedAt || Date.now();
    }
    return out;
  });
}

/**
 * The settings to apply on a restore. Merge deliberately returns nothing:
 * pulling one profile out of someone else's export should not also change
 * your theme, your close behaviour or which lists you had open. On replace,
 * per-profile view state is kept only for ids the restore actually brought
 * back.
 */
export function settingsForImport(payload, mode) {
  if (mode === 'merge') return null;
  const settings = { ...(payload.settings || {}) };
  const ids = new Set(payload.profiles.map((p) => p.id).filter(Boolean));
  if (settings.expandedTabGroups && typeof settings.expandedTabGroups === 'object') {
    const kept = {};
    for (const [pid, groupIds] of Object.entries(settings.expandedTabGroups)) {
      if (ids.has(pid)) kept[pid] = groupIds;
    }
    settings.expandedTabGroups = kept;
  }
  if (settings.lastActiveProfileId && !ids.has(settings.lastActiveProfileId)) {
    settings.lastActiveProfileId = null;
  }
  return settings;
}
