// sync.js — transport to the shared SyncLocker sync destination.
// Reads/writes bookmarks-<syncName>.json via shared/providers.js, which
// abstracts over whichever backend is configured (self-hosted endpoint,
// GitHub Gist, or JSONBin.io). Optional AES-GCM on top, same as before.
// The "bookmarks-" prefix namespaces these files so they never collide with
// the tabs engine's "tabs-" files on the same destination.

import { encryptJSON, decryptJSON, isEncrypted } from './crypto.js';

// Keep this in sync with the same constant in the options page.
export const FILE_PREFIX = 'bookmarks-';

function fileName(cfg) {
  return FILE_PREFIX + (cfg.syncName || '') + '.json';
}

// Returns the remote bookmark tree, or null if nothing stored yet.
export async function getRemote(cfg) {
  let r;
  try {
    r = await self.SyncLockerProviders.get(cfg, fileName(cfg));
  } catch (e) {
    throw new Error(e.message || `Network error contacting the sync destination: ${e}`);
  }
  const text = (r && r.text != null) ? r.text.trim() : '';
  if (!text) return null;
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('Sync destination returned invalid JSON.'); }

  if (isEncrypted(payload)) {
    if (!cfg.passphrase) throw new Error('Remote data is encrypted but no passphrase is set.');
    return await decryptJSON(payload, cfg.passphrase);
  }
  return payload;
}

// Writes the merged tree to the sync destination (encrypted if a passphrase is set).
export async function putRemote(cfg, tree) {
  const body = cfg.passphrase ? await encryptJSON(tree, cfg.passphrase) : tree;
  try {
    await self.SyncLockerProviders.put(cfg, fileName(cfg), JSON.stringify(body));
  } catch (e) {
    throw new Error(e.message || `Network error writing to the sync destination: ${e}`);
  }
  return true;
}
