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

export async function runSync(trigger = 'manual') {
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
