// remote-bookmarks.js — load/save orchestration for one profile's bookmark
// tree, built on the vendored bookmarks-lib/sync.js (fetch + decrypt/encrypt,
// unchanged from the extension) and merge.js (the same three-way merge the
// extension trusts not to lose data).
'use strict';

import { getRemote, putRemote } from '../../vendor/bookmarks-lib/sync.js';
import { threeWayMerge } from '../../vendor/bookmarks-lib/merge.js';
import { emptyTree, stats } from '../../vendor/bookmarks-lib/tree.js';
import { bookmarksCfg } from './cfg-map.js';
import { withCapture, loadVendored } from './provider-shim.js';

/**
 * The safety brake, verbatim from bookmarks/lib/engine.js (deletionLooksWrong /
 * BRAKE_MIN_BOOKMARKS / BRAKE_MIN_KEPT_FRACTION) — not imported from there
 * because engine.js pulls in browser.js's chrome.bookmarks calls transitively
 * for the parts of it we don't use. test/vendor-parity.test.js checks these
 * constants and this function's behaviour against the real file so the two
 * can't silently drift apart.
 *
 * Under 20 bookmarks nothing is checked — losing a handful is survivable and
 * deleting a handful on purpose is ordinary tidying. Above that, it only
 * objects when four fifths of them would go at once in a single save.
 */
export const BRAKE_MIN_BOOKMARKS = 20;
export const BRAKE_MIN_KEPT_FRACTION = 0.2;
export function deletionLooksWrong(localCount, mergedCount) {
  if (localCount < BRAKE_MIN_BOOKMARKS) return false;
  if (mergedCount >= localCount) return false;
  return mergedCount < localCount * BRAKE_MIN_KEPT_FRACTION;
}

/** Fetches the profile's remote bookmark tree (already decrypted). `tree` is emptyTree() when nothing is stored yet — every op in this app works against a real tree, never null. */
export async function load(profile) {
  await loadVendored(); // idempotent — makes this module safe to use regardless of app startup order
  const cfg = bookmarksCfg(profile);
  const { result: remote, patch } = await withCapture(() => getRemote(cfg));
  return { tree: remote || emptyTree(), empty: !remote, patch };
}

/**
 * Saves `workingTree` (this app's in-memory edits) back to the profile's
 * remote destination.
 *
 * Never a blind overwrite: re-fetches whatever is on the server right now
 * and three-way-merges baseTree (what load() returned before any local
 * edits) / workingTree (the edits) / freshRemote (what's there now — maybe
 * changed by the browser extension or another device meanwhile) — the exact
 * algorithm the extension itself relies on so two concurrent editors don't
 * clobber each other. The merged result is what gets written AND returned,
 * so the UI reflects what the server now actually holds.
 *
 * If the destination now has NOTHING stored (deleted or reset since
 * load()), baseTree is discarded in favour of a first-sync-style union —
 * otherwise every baseline node would read as "the other side deleted it"
 * and the merge would wipe them, exactly the failure engine.js's own
 * "noRemoteYet" check exists to prevent (see its file comment).
 *
 * Throws a BrakeError instead of saving if the merge would remove most of a
 * substantial tree in one go — see deletionLooksWrong(). Pass
 * `{ allowLargeDeletion: true }` once the caller has confirmed with the user
 * (mirrors the extension's own Options-page "blocked deletion" flow).
 */
export async function save(profile, workingTree, baseTree, { allowLargeDeletion = false } = {}) {
  await loadVendored();
  const cfg = bookmarksCfg(profile);
  const { result: freshRemote, patch: pullPatch } = await withCapture(() => getRemote(cfg));
  const usableBase = freshRemote ? (baseTree || null) : null;
  const merged = threeWayMerge(usableBase, workingTree, freshRemote || emptyTree());

  const had = stats(workingTree).bookmarks;
  const keeps = stats(merged).bookmarks;
  if (!allowLargeDeletion && deletionLooksWrong(had, keeps)) {
    const err = new Error(
      `Saving would remove ${had - keeps} of ${had} bookmarks in this profile, leaving ${keeps}. ` +
      `Nothing was saved. Confirm to save anyway, or reload to see what's actually on the server.`
    );
    err.code = 'LARGE_DELETION';
    err.had = had;
    err.keeps = keeps;
    throw err;
  }

  const { patch: pushPatch } = await withCapture(() => putRemote(cfg, merged));
  return { tree: merged, patch: { ...pullPatch, ...pushPatch }, stats: stats(merged) };
}
