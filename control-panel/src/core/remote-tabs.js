// remote-tabs.js — load/save orchestration for one profile's saved-tab
// lists, built on the vendored tabs/storage.js (fetch + decrypt/encrypt,
// per-group last-write-wins merge with tombstones — unchanged from the
// extension).
//
// Unlike bookmarks, this merge needs no "base" snapshot: deletions are
// explicit tombstones (added by removeGroup/trashAdd), not inferred from a
// node's absence, so there's no stale-base-reads-as-mass-deletion failure
// mode to guard against here — mergeStates(local, remote) is safe to call
// with local being straight-up "our current working state" every time,
// exactly how tabs/storage.js's own doSync() uses it.
'use strict';

import { tabsCfg } from './cfg-map.js';
import { withCapture, getVendored, loadVendored } from './provider-shim.js';

function ts() {
  return getVendored().TabbySync;
}

/** Fetches the profile's remote tab-list state (already decrypted). `state` is emptyState() when nothing is stored yet. */
export async function load(profile) {
  await loadVendored(); // idempotent — makes this module safe to use regardless of app startup order
  const cfg = tabsCfg(profile);
  const { result: pulled, patch } = await withCapture(() => ts().pullRemote(cfg));
  return { state: pulled ? pulled.state : ts().emptyState(), empty: !pulled, patch };
}

/**
 * Saves `workingState` back to the profile's remote destination: pulls
 * fresh, merges (per-group last-write-wins by updatedAt, tombstones unioned
 * — see tabs/storage.js's mergeStates), and pushes the result, retrying once
 * if the self-hosted provider reports a conflicting concurrent write (412) —
 * the same one-retry policy tabs/storage.js's own doSync() uses. The merged
 * result is returned so the UI reflects what the server now actually holds.
 */
export async function save(profile, workingState, { retriesLeft = 1 } = {}) {
  await loadVendored();
  const T = ts();
  const cfg = tabsCfg(profile);
  const { result: pulled, patch: pullPatch } = await withCapture(() => T.pullRemote(cfg));
  const freshRemote = pulled ? pulled.state : null;
  const merged = T.mergeStates(workingState, freshRemote).state;
  try {
    const { patch: pushPatch } = await withCapture(() => T.pushRemote(cfg, merged, pulled ? pulled.etag : ''));
    return { state: merged, patch: { ...pullPatch, ...pushPatch } };
  } catch (e) {
    if (e && e.conflict && retriesLeft > 0) return save(profile, workingState, { retriesLeft: retriesLeft - 1 });
    throw e;
  }
}
