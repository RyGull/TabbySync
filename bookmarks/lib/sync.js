// sync.js — transport to the shared SyncLocker endpoint.
// GET/PUT <serverUrl>?name=bookmarks-<syncName>.json with a bearer token.
// Optional AES-GCM. The "bookmarks-" prefix namespaces these files so they
// never collide with the tabs engine's "tabs-" files on the same endpoint.

import { encryptJSON, decryptJSON, isEncrypted } from './crypto.js';

// Keep this in sync with the same constant in the options page.
export const FILE_PREFIX = 'bookmarks-';

function endpoint(cfg) {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const file = encodeURIComponent(FILE_PREFIX + cfg.syncName + '.json');
  // A base URL ending in ".php" is the standalone SyncLocker script — route
  // via ?name= (no path rewriting needed).
  if (/\.php$/i.test(base)) return `${base}?name=${file}`;
  return `${base}/${file}`;
}

// Returns the remote bookmark tree, or null if nothing stored yet.
export async function getRemote(cfg) {
  let res;
  try {
    res = await fetch(endpoint(cfg), {
      method: 'GET',
      headers: { Authorization: `Bearer ${cfg.token}` },
      cache: 'no-store',
    });
  } catch (e) {
    throw new Error(`Network error contacting server: ${e.message}`);
  }
  if (res.status === 404) return null;
  if (res.status === 401 || res.status === 403) throw new Error('Server rejected the token (auth failed).');
  if (!res.ok) throw new Error(`Server GET failed (HTTP ${res.status}).`);

  const text = (await res.text()).trim();
  if (!text) return null;
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('Server returned invalid JSON.'); }

  if (isEncrypted(payload)) {
    if (!cfg.passphrase) throw new Error('Remote data is encrypted but no passphrase is set.');
    return await decryptJSON(payload, cfg.passphrase);
  }
  return payload;
}

// Writes the merged tree to the server (encrypted if a passphrase is set).
export async function putRemote(cfg, tree) {
  const body = cfg.passphrase ? await encryptJSON(tree, cfg.passphrase) : tree;
  let res;
  try {
    res = await fetch(endpoint(cfg), {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`Network error writing to server: ${e.message}`);
  }
  if (res.status === 401 || res.status === 403) throw new Error('Server rejected the token (auth failed).');
  if (!res.ok) throw new Error(`Server PUT failed (HTTP ${res.status}).`);
  return true;
}
