// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// settings-backup.js — export and import of the extension's own settings:
// where it syncs, how it is configured, and (optionally) the credentials to
// get back in.
//
// WHY THIS EXISTS. The saved-tabs page has had a backup button for a long
// time, but it writes tab LISTS. Every setting — the server URL, the access
// code, the sync name, the password lock — lived only in chrome.storage.local
// and nowhere else. Storage does survive a store update, but it does not
// survive the extension's IDENTITY changing: a browser treats an unpacked or
// temporarily-loaded copy and the store copy as different extensions with
// separate storage, so replacing one with the other reads as a fresh install
// and every credential has to be retyped. Nothing was ever lost from the sync
// destination in that case — a first sync with no merge base unions rather
// than deletes (see bookmarks/lib/engine.js) — but re-entering a bearer token
// by hand is nobody's idea of a recovery plan.
//
// THE RULE, which is the Control Panel's rule (control-panel/src/core/
// backup.js) deliberately restated rather than loosened, because the same
// secrets are at stake and two products disagreeing about how to protect them
// is how the weaker one becomes the answer:
//
//   * without credentials — every setting, no token and no passphrase. A file
//     you can email yourself. You re-enter two secrets after restoring.
//   * with credentials — a passphrase is REQUIRED and the whole payload is
//     sealed with AES-256-GCM by bookmarks/lib/crypto.js: the extension's own
//     encryption, the same code that protects synced data, not a second
//     implementation that could drift from it.
//
// There is no third option. A plaintext file holding a live bearer token is
// not a backup, it is a leak with a .json extension.
//
// An ES module rather than the classic IIFE the rest of shared/ uses: it needs
// crypto.js's exports, and its only consumer is options.js, which is already
// loaded as a module. Everything here is pure — it builds, seals, opens and
// validates payloads, and hands back a plain object for the caller to write.
// Nothing in this file touches chrome.storage.

import { encryptJSON, decryptJSON, isEncrypted } from '../bookmarks/lib/crypto.js';

export const BACKUP_KIND = 'tabbysync-extension-settings';
export const BACKUP_VERSION = 1;

/** Shortest passphrase that may seal a file containing live credentials. */
export const MIN_PASSPHRASE_LENGTH = 8;

/**
 * The storage keys that are credentials, by the only test that matters: would
 * handing this string to a stranger let them read or write your synced data,
 * or open a file you encrypted?
 *
 *   token / gist.token / jsonbin.token   bearer credentials for a destination
 *   genToken                             the access code baked into the PHP
 *                                        file this extension generates — the
 *                                        server's own bearer token
 *   passphrase / gist / jsonbin          the password lock; holds the key to
 *                                        everything already uploaded
 *   tab.backupPass                       opens tab-list backup files
 *
 * Everything else — server URL, sync name, profile label, gist/bin ids, every
 * toggle and interval — is configuration. It says where your data is, not how
 * to get at it, and it is what makes a credential-free restore worth having.
 */
export const SECRET_KEYS = Object.freeze([
  'sl.token',
  'sl.gist.token',
  'sl.jsonbin.token',
  'sl.genToken',
  'sl.passphrase',
  'sl.gist.passphrase',
  'sl.jsonbin.passphrase',
  'sl.tab.backupPass',
]);

/**
 * Keys this file will never carry, whatever else is asked for.
 *
 * sl.tab.state is the saved tab LISTS. They are large, they already have their
 * own backup on the saved-tabs page, and they are the one thing here that is
 * genuinely synced — restoring a stale copy of them over a live sync is a way
 * to resurrect lists you deleted on another machine. sl.tab.etag and the
 * status/ui keys are this install's own bookkeeping about a conversation with
 * a server; carrying them to another machine says "we already agreed on this"
 * about an agreement that machine was never part of.
 */
const NEVER_EXPORTED = Object.freeze([
  'sl.tab.state',
  'sl.tab.etag',
  'sl.tab.status',
  'sl.tab.ui',
]);

const isSecret = (key) => SECRET_KEYS.includes(key);

/**
 * Assembles the payload from a raw chrome.storage.local snapshot.
 *
 * `stored` is what storage.local.get(keys) returned. Only keys that are
 * actually present are carried: writing `""` for a setting that was never set
 * would restore an explicit empty over a default, which is not the same thing.
 */
export function buildSettingsBackup({ stored = {}, includeSecrets = false, appVersion = '' } = {}) {
  const settings = {};
  // Which credentials this install actually HAD and this file is leaving out.
  // Recorded by key name only — never a value, never a length — so a restore
  // can say "this file has no access code for your self-hosted server" instead
  // of listing every credential slot the extension has and letting you work
  // out which ones you were using. A slot that was never set is not omitted,
  // it simply does not exist, and telling someone to re-enter a Gist
  // passphrase they never had is noise dressed up as help.
  const omittedSecrets = [];
  for (const [key, value] of Object.entries(stored)) {
    if (NEVER_EXPORTED.includes(key)) continue;
    if (value === undefined) continue;
    if (!includeSecrets && isSecret(key)) {
      if (value !== '' && value !== null) omittedSecrets.push(key);
      continue;
    }
    settings[key] = value;
  }
  return {
    kind: BACKUP_KIND,
    version: BACKUP_VERSION,
    createdAt: Date.now(),
    appVersion,
    includesSecrets: !!includeSecrets,
    omittedSecrets,
    settings,
  };
}

/**
 * Payload -> the text that goes in the file. A payload carrying secrets
 * without a passphrase is refused HERE rather than in the options page, so no
 * future caller can route around the rule by accident.
 */
export async function serializeSettingsBackup(payload, passphrase = '') {
  if (payload.includesSecrets && !passphrase) {
    throw new Error('A backup containing your access code and password lock must be protected with a passphrase.');
  }
  if (payload.includesSecrets && passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters — this file holds live credentials.`);
  }
  const body = passphrase ? await encryptJSON(payload, passphrase) : payload;
  return JSON.stringify(body, null, 2);
}

/** True if the file needs a passphrase before anything can be read out of it. */
export function backupIsEncrypted(text) {
  try { return !!isEncrypted(JSON.parse(text)); } catch { return false; }
}

function validate(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('That file is not a TabbySync backup.');
  if (payload.kind !== BACKUP_KIND) {
    throw new Error('That file is not a TabbySync settings backup. (Saved tab lists are restored from the saved-tabs page, not here.)');
  }
  if (payload.version > BACKUP_VERSION) {
    throw new Error(`That backup was written by a newer version of TabbySync (format ${payload.version}, this one reads ${BACKUP_VERSION}). Update the extension and try again.`);
  }
  if (!payload.settings || typeof payload.settings !== 'object') {
    throw new Error('That backup has no settings in it.');
  }
  return payload;
}

/** Text -> payload, decrypting first when the file is sealed. */
export async function parseSettingsBackup(text, passphrase = '') {
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error('That file is not valid JSON, so it is not a backup this extension wrote.');
  }
  if (isEncrypted(body)) {
    if (!passphrase) {
      const e = new Error('This backup is passphrase-protected. Enter its passphrase to open it.');
      e.code = 'PASSPHRASE_REQUIRED';
      throw e;
    }
    let plain;
    try {
      plain = await decryptJSON(body, passphrase);
    } catch {
      // decryptJSON throws when AES-GCM fails its tag check, which is exactly
      // the signal wanted — say so in words someone can act on.
      const e = new Error('That passphrase does not open this backup.');
      e.code = 'BAD_PASSPHRASE';
      throw e;
    }
    return validate(plain);
  }
  return validate(body);
}

/** What to show before anything is written. */
export function summarizeSettingsBackup(payload) {
  const keys = Object.keys(payload.settings);
  return {
    createdAt: payload.createdAt || 0,
    appVersion: payload.appVersion || '',
    includesSecrets: !!payload.includesSecrets,
    settingCount: keys.length,
    provider: payload.settings['sl.provider'] || 'custom',
    serverUrl: payload.settings['sl.serverUrl'] || '',
    syncName: payload.settings['sl.syncName'] || '',
    // Credentials the exporting install had and this file leaves out, so the
    // confirm step can name them rather than letting them be discovered at
    // the next failed sync. Empty for a backup carrying credentials, and
    // empty for an install that had none to begin with.
    omittedSecrets: Array.isArray(payload.omittedSecrets) ? payload.omittedSecrets : [],
  };
}

/**
 * The object to hand chrome.storage.local.set().
 *
 * Deliberately a partial write, not a replace: anything the file does not
 * carry is LEFT ALONE. A credential-free backup restored onto a working
 * install must not blank the token that install already has — the file says
 * nothing about credentials, and "says nothing" is not "set them to empty".
 *
 * NEVER_EXPORTED is filtered again on the way in. A hand-edited file could
 * carry sl.tab.state, and importing settings is not a route to overwriting
 * live synced tab lists.
 */
export function settingsToApply(payload) {
  const out = {};
  for (const [key, value] of Object.entries(payload.settings || {})) {
    if (NEVER_EXPORTED.includes(key)) continue;
    if (!key.startsWith('sl.')) continue; // nothing outside this extension's namespace
    out[key] = value;
  }
  return out;
}
