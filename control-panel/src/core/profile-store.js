// profile-store.js — persistence for the Control Panel's own concept of a
// "sync profile": a fully self-contained {label, provider, credentials}
// bundle. This has no equivalent in the extension, which only ever has ONE
// active provider per browser install — the whole point of this app is to
// hold several side by side (work/personal/home-server/...) and move or copy
// things between them.
//
// Stored as a single JSON file, `profiles.json`, under the directory the
// caller supplies (Electron's app.getPath('userData') in the real app; a
// temp dir in tests). Secrets (token, passphrase) are run through the
// caller's encrypt/decrypt hooks before touching disk — main.cjs wires those
// to Electron's safeStorage (OS-backed: DPAPI on Windows). Without that hook
// (e.g. plain Node, or a platform where safeStorage isn't available) secrets
// are stored as plain strings — callers should surface that via
// `secretsAvailable` rather than silently claiming protection they don't have.
'use strict';

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { newId } from './id.js';
import { sanitizeSyncName } from './provider-shim.js';

const FILE_NAME = 'profiles.json';
const SECRET_FIELDS = ['token', 'passphrase'];
const KNOWN_PROVIDERS = new Set(['custom', 'gist', 'jsonbin']);
// Loopback is the one exception to the https-only rule below — it never
// leaves the machine. Deliberately the same list and the same reasoning as
// the extension's own options.js (not vendored — that file is UI code, not
// a shared engine module — so this is a hand-kept parity, not automatic).
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1'];

/**
 * A self-hosted server's access token rides in an Authorization header on
 * every request, outside whatever the sync passphrase encrypts — so a plain
 * http:// destination hands that long-lived credential to anyone on the
 * network path. Mirrors the extension's options.js serverUrlProblem() check
 * exactly, so a self-hosted profile gets the same protection here as it
 * would in the extension.
 */
function serverUrlProblem(url) {
  let u;
  try { u = new URL(url); } catch {
    return 'Server URL must be a full address, e.g. https://example.com/tabbysync/tabbysync.php';
  }
  if (u.protocol === 'https:') return '';
  if (u.protocol === 'http:' && LOOPBACK_HOSTS.includes(u.hostname)) return '';
  if (u.protocol === 'http:') {
    return 'Server URL must use https:// — your token is sent on every request and would cross the network in the clear. http:// is accepted only for localhost.';
  }
  return `Server URL must use https:// (this one uses "${u.protocol}").`;
}
// Kept on the record but currently unused by the UI — the sidebar's dot
// shows live connection status instead (renderer/app.js's combinedStatus),
// not an arbitrary per-profile color. Left in place rather than removed:
// it's harmless, still a reasonable place to hang a future "pick your own
// color" feature, and ripping it out isn't what was asked for.
const DEFAULT_COLORS = ['#5b8def', '#3ec28f', '#f2994a', '#eb5757', '#9b6bd9', '#2ea6b7', '#c2825b', '#6b7280'];

function emptyStore() {
  return { version: 1, profiles: [] };
}

function redact(p) {
  const { token, passphrase, ...rest } = p;
  return { ...rest, hasToken: !!token, hasPassphrase: !!passphrase };
}

/**
 * @param {string} dir - directory to hold profiles.json (created if missing)
 * @param {object} [opts]
 * @param {(plain:string)=>Promise<any>} [opts.encrypt] - defaults to a no-op passthrough
 * @param {(stored:any)=>Promise<string>} [opts.decrypt] - defaults to a no-op passthrough
 * @param {boolean} [opts.secretsAvailable] - whether encrypt/decrypt do real OS-backed encryption
 */
export function createProfileStore(dir, opts = {}) {
  const filePath = path.join(dir, FILE_NAME);
  const encrypt = opts.encrypt || (async (s) => s);
  const decrypt = opts.decrypt || (async (s) => s);
  const secretsAvailable = !!opts.secretsAvailable;

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
      if (e.code === 'ENOENT') { cache = emptyStore(); return cache; }
      throw e;
    }
    let onDisk;
    try {
      onDisk = JSON.parse(raw);
    } catch {
      throw new Error(`${filePath} is not valid JSON. Fix or move it aside by hand — refusing to overwrite a file that can't be parsed.`);
    }
    const profiles = [];
    for (const p of onDisk.profiles || []) {
      const copy = { ...p };
      for (const f of SECRET_FIELDS) {
        if (copy[f] && typeof copy[f] === 'object') copy[f] = await decrypt(copy[f]);
      }
      profiles.push(copy);
    }
    cache = { version: onDisk.version || 1, profiles };
    return cache;
  }

  async function writeToDisk(store) {
    const onDisk = { version: store.version, profiles: [] };
    for (const p of store.profiles) {
      const copy = { ...p };
      for (const f of SECRET_FIELDS) {
        if (copy[f]) copy[f] = await encrypt(copy[f]);
      }
      onDisk.profiles.push(copy);
    }
    await mkdir(dir, { recursive: true });
    const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(tmp, JSON.stringify(onDisk, null, 2));
    await rename(tmp, filePath); // atomic on the same filesystem — never leaves profiles.json half-written
  }

  function validate(profile) {
    if (!KNOWN_PROVIDERS.has(profile.provider)) throw new Error(`Unknown provider "${profile.provider}".`);
    if (profile.provider === 'custom' && !profile.serverUrl) throw new Error('A self-hosted profile needs a server address.');
    if (profile.provider === 'custom' && profile.serverUrl) {
      const problem = serverUrlProblem(profile.serverUrl);
      if (problem) throw new Error(problem);
    }
    if (!profile.label || !profile.label.trim()) throw new Error('A profile needs a name.');
    return profile;
  }

  async function list({ includeSecrets = false } = {}) {
    const store = await load();
    return store.profiles.map((p) => (includeSecrets ? { ...p } : redact(p)));
  }

  async function get(id, { includeSecrets = true } = {}) {
    const store = await load();
    const p = store.profiles.find((x) => x.id === id);
    if (!p) return null;
    return includeSecrets ? { ...p } : redact(p);
  }

  async function add(input) {
    return enqueue(async () => {
      const store = await load();
      const now = Date.now();
      const profile = validate({
        id: newId('profile'),
        label: (input.label || 'New profile').trim(),
        color: input.color || DEFAULT_COLORS[store.profiles.length % DEFAULT_COLORS.length],
        provider: input.provider || 'custom',
        serverUrl: input.serverUrl || '',
        token: input.token || '',
        syncName: sanitizeSyncName(input.syncName || ''),
        passphrase: input.passphrase || '',
        gistId: input.gistId || '',
        jsonbinTabsId: input.jsonbinTabsId || '',
        jsonbinBookmarksId: input.jsonbinBookmarksId || '',
        createdAt: now,
        updatedAt: now,
      });
      store.profiles.push(profile);
      await writeToDisk(store);
      return { ...profile };
    });
  }

  async function update(id, patch) {
    return enqueue(async () => {
      const store = await load();
      const idx = store.profiles.findIndex((x) => x.id === id);
      if (idx < 0) throw new Error(`No such profile: ${id}`);
      const next = { ...store.profiles[idx], ...patch, id, updatedAt: Date.now() };
      if ('syncName' in patch) next.syncName = sanitizeSyncName(patch.syncName);
      if ('label' in patch) next.label = (patch.label || '').trim();
      validate(next);
      store.profiles[idx] = next;
      await writeToDisk(store);
      return { ...next };
    });
  }

  async function remove(id) {
    return enqueue(async () => {
      const store = await load();
      const before = store.profiles.length;
      store.profiles = store.profiles.filter((x) => x.id !== id);
      if (store.profiles.length === before) throw new Error(`No such profile: ${id}`);
      await writeToDisk(store);
      return { ok: true };
    });
  }

  /**
   * Clones a profile's connection settings. Deliberately does NOT copy
   * gistId/jsonbinTabsId/jsonbinBookmarksId: those name a specific remote
   * gist/bin, and carrying them over would make the "duplicate" secretly
   * point at and overwrite the SAME remote data as the original the moment
   * it's used, rather than getting its own. It starts blank; providers.js
   * creates a fresh one on first save, same as any brand-new profile.
   */
  async function duplicate(id, overrides = {}) {
    return enqueue(async () => {
      const store = await load();
      const srcIdx = store.profiles.findIndex((x) => x.id === id);
      if (srcIdx < 0) throw new Error(`No such profile: ${id}`);
      const src = store.profiles[srcIdx];
      const now = Date.now();
      const copy = validate({
        ...src,
        gistId: '',
        jsonbinTabsId: '',
        jsonbinBookmarksId: '',
        ...overrides,
        id: newId('profile'),
        label: (overrides.label || `${src.label} (copy)`).trim(),
        createdAt: now,
        updatedAt: now,
      });
      store.profiles.splice(srcIdx + 1, 0, copy);
      await writeToDisk(store);
      return { ...copy };
    });
  }

  /**
   * Wipes every profile and writes the supplied ones in their place, keeping
   * whatever ids they arrive with. Only a full restore-from-backup should
   * call this — it is the one operation here that destroys data the user did
   * not individually delete, and the caller is responsible for having asked
   * first. Ids are kept rather than minted because a restore's settings
   * (lastActiveProfileId, expandedTabGroups) are keyed by them.
   */
  async function replaceAll(profiles) {
    return enqueue(async () => {
      const now = Date.now();
      const seen = new Set();
      const next = [];
      for (const input of profiles) {
        const id = input.id || newId('profile');
        if (seen.has(id)) throw new Error(`replaceAll() was given the same profile id twice: ${id}`);
        seen.add(id);
        next.push(validate({
          ...input,
          id,
          label: (input.label || 'Imported profile').trim(),
          color: input.color || DEFAULT_COLORS[next.length % DEFAULT_COLORS.length],
          provider: input.provider || 'custom',
          serverUrl: input.serverUrl || '',
          token: input.token || '',
          syncName: sanitizeSyncName(input.syncName || ''),
          passphrase: input.passphrase || '',
          gistId: input.gistId || '',
          jsonbinTabsId: input.jsonbinTabsId || '',
          jsonbinBookmarksId: input.jsonbinBookmarksId || '',
          createdAt: input.createdAt || now,
          updatedAt: now,
        }));
      }
      // Built and validated in full before anything is written, so a bad
      // profile halfway down a restore file can't leave you with half your
      // old setup deleted and half a new one in place.
      const store = await load();
      store.profiles = next;
      await writeToDisk(store);
      return store.profiles.map(redact);
    });
  }

  /** idsInOrder must contain every existing profile id exactly once. */
  async function reorder(idsInOrder) {
    return enqueue(async () => {
      const store = await load();
      const byId = new Map(store.profiles.map((p) => [p.id, p]));
      const valid = idsInOrder.length === store.profiles.length && idsInOrder.every((id) => byId.has(id));
      if (!valid) throw new Error('reorder() must list every existing profile id exactly once.');
      store.profiles = idsInOrder.map((id) => byId.get(id));
      await writeToDisk(store);
      return store.profiles.map(redact);
    });
  }

  return {
    filePath,
    secretsAvailable,
    load, // mostly for tests; prefer list()/get()
    list,
    get,
    add,
    update,
    remove,
    duplicate,
    reorder,
    replaceAll,
  };
}
