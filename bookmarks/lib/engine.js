// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// engine.js — orchestrates one sync cycle:
//   read live bookmarks -> fetch remote -> three-way merge -> apply locally
//   -> push merged to server -> save cache + mappings.

import { getConfig, isConfigured, getState, setState } from './config.js';
import { readBrowserTree, applyTree } from './browser.js';
import { getRemote, putRemote } from './sync.js';
import { threeWayMerge } from './merge.js';
import { emptyTree, stats } from './tree.js';

let busy = false;
let suppressUntil = 0; // ignore bookmark-change events until this time (our own writes)

/**
 * Identifies the destination a cached merge base belongs to.
 *
 * The base of a three-way merge is "what both sides last agreed on". That is
 * only true of the destination it was synced with: point the same base at a
 * different destination and every bookmark in it looks like something the
 * remote has since deleted — which the merge then dutifully deletes locally
 * as well. Switching sync method in Options used to do exactly that, and
 * emptied the browser's bookmarks on the next sync.
 *
 * The token is deliberately not part of the key: it is a credential, not an
 * address, and the missing-remote guard in runSync covers the case where a
 * new credential points at an account with nothing in it.
 */
function destinationKey(cfg) {
  return [cfg.provider || 'custom', cfg.baseUrl || '', cfg.syncName || ''].join('|');
}

export function isSuppressed() { return busy || Date.now() < suppressUntil; }

/**
 * The safety brake.
 *
 * Every data-loss bug this project has had ends the same way: a sync deletes
 * bookmarks that are sitting in the browser right now. The causes differ and
 * the next one will have a cause nobody has thought of yet, so this checks the
 * outcome instead — how many bookmarks a merge is about to remove — and stops
 * if that number looks like an accident rather than a decision.
 *
 * It compares against what is in the browser, not against the cache, because
 * the browser is the copy the user would actually miss. A deletion the user
 * made themselves never trips it: their own deletes are already gone from the
 * live tree, so the merged result matches it.
 *
 * The thresholds are deliberately loose. A brake that second-guesses ordinary
 * tidying would be worse than no brake, because people would learn to click
 * through it. Under 20 bookmarks nothing is checked at all — losing five is
 * bad but survivable, and deleting five on purpose is an ordinary afternoon.
 * Above that, it only objects when four fifths of them would go at once.
 */
export const BRAKE_MIN_BOOKMARKS = 20;
export const BRAKE_MIN_KEPT_FRACTION = 0.2;

export function deletionLooksWrong(localCount, mergedCount) {
  if (localCount < BRAKE_MIN_BOOKMARKS) return false;
  if (mergedCount >= localCount) return false;
  return mergedCount < localCount * BRAKE_MIN_KEPT_FRACTION;
}

/**
 * `allowLargeDeletion` lifts the brake for exactly one run. Options sets it
 * when the user has been shown what would be deleted and has said yes — a
 * brake with no release is just a different way to lose your data, and mass
 * deletes are sometimes real.
 */
export async function runSync(trigger = 'manual', { allowLargeDeletion = false } = {}) {
  if (busy) return { ok: false, status: 'busy', message: 'A sync is already running.' };
  const cfg = await getConfig();
  if (!isConfigured(cfg)) {
    await setState({ lastStatus: 'not configured', lastError: '' });
    return { ok: false, status: 'not configured', message: 'Set up a sync method in Options.' };
  }

  busy = true;
  try {
    const state = await getState();
    const key = destinationKey(cfg);
    const remoteRaw = await getRemote(cfg);

    // Two situations mean there is no honest merge base, and in both the
    // right answer is to union rather than to delete:
    //
    //   1. The cached base was written against a different destination —
    //      the sync method, server URL or sync name has changed since.
    //   2. There is no file at this destination at all. Nothing has been
    //      deleted remotely, because there is no remote state to have
    //      deleted it from; this is a first sync by any other name.
    //
    // Both used to fall through to a full three-way merge against an empty
    // remote, which reads as "the other side deleted everything" and wipes
    // the bookmarks on this machine.
    const staleBase = state.cacheKey !== key;
    const noRemoteYet = !remoteRaw;
    const usableBase = (staleBase || noRemoteYet) ? null : state.cacheTree;
    if (staleBase && state.cacheTree) {
      console.log('[TabbySync] destination changed since the last sync — merging as a first sync, so nothing is deleted.');
    }

    const { tree: local, stableToLocal } = await readBrowserTree(state.stableToLocal, usableBase);
    const remote = remoteRaw || emptyTree();
    console.log(`[TabbySync] sync (${trigger}): remote ${remoteRaw ? 'found' : 'empty/none'}, local ${stats(local).bookmarks} bookmarks`);

    const merged = threeWayMerge(usableBase, local, remote, { deleteWins: cfg.deleteWins });

    const had = stats(local).bookmarks;
    const keeps = stats(merged).bookmarks;
    if (!allowLargeDeletion && deletionLooksWrong(had, keeps)) {
      // Nothing is applied and nothing is pushed: the browser keeps what it
      // has, and the destination keeps what it has, until someone says which
      // one is right. Options offers that choice; the message says what the
      // numbers are, because "sync blocked" on its own tells you nothing.
      const message = `Sync stopped: this would have deleted ${had - keeps} of your ${had} bookmarks, ` +
        `leaving ${keeps}. Nothing was changed. Open Options to keep your bookmarks or accept the deletion.`;
      console.warn('[TabbySync] ' + message);
      await setState({
        lastStatus: 'error',
        lastError: message,
        blockedDeletion: { at: Date.now(), had, keeps },
      });
      return { ok: false, status: 'blocked', had, keeps, message };
    }

    const newMap = await applyTree(merged, stableToLocal);
    await putRemote(cfg, merged);

    const ts = Date.now();
    console.log(`[TabbySync] sync ok: ${stats(merged).bookmarks} bookmarks, ${stats(merged).folders} folders after merge`);
    await setState({
      cacheTree: merged,
      cacheKey: key,
      stableToLocal: newMap,
      lastSync: ts,
      lastError: '',
      lastStatus: 'ok',
      blockedDeletion: null,
    });
    suppressUntil = Date.now() + 3000; // let our own bookmark writes settle
    const s = stats(merged);
    return { ok: true, status: 'ok', trigger, lastSync: ts, ...s };
  } catch (e) {
    console.warn('[TabbySync] sync error:', e && (e.message || e));
    await setState({ lastStatus: 'error', lastError: e.message || String(e) });
    return { ok: false, status: 'error', message: e.message || String(e) };
  } finally {
    busy = false;
    if (suppressUntil < Date.now() + 1500) suppressUntil = Date.now() + 1500;
  }
}
