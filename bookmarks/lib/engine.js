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
    const base = state.cacheTree || emptyTree();

    const { tree: local, stableToLocal } = await readBrowserTree(state.stableToLocal, state.cacheTree);
    const remoteRaw = await getRemote(cfg);
    const remote = remoteRaw || emptyTree();
    console.log(`[SyncLocker] sync (${trigger}): remote ${remoteRaw ? 'found' : 'empty/none'}, local ${stats(local).bookmarks} bookmarks`);

    const merged = threeWayMerge(base, local, remote, { deleteWins: cfg.deleteWins });

    const newMap = await applyTree(merged, stableToLocal);
    await putRemote(cfg, merged);

    const ts = Date.now();
    console.log(`[SyncLocker] sync ok: ${stats(merged).bookmarks} bookmarks, ${stats(merged).folders} folders after merge`);
    await setState({
      cacheTree: merged,
      stableToLocal: newMap,
      lastSync: ts,
      lastError: '',
      lastStatus: 'ok',
    });
    suppressUntil = Date.now() + 3000; // let our own bookmark writes settle
    const s = stats(merged);
    return { ok: true, status: 'ok', trigger, lastSync: ts, ...s };
  } catch (e) {
    console.warn('[SyncLocker] sync error:', e && (e.message || e));
    await setState({ lastStatus: 'error', lastError: e.message || String(e) });
    return { ok: false, status: 'error', message: e.message || String(e) };
  } finally {
    busy = false;
    if (suppressUntil < Date.now() + 1500) suppressUntil = Date.now() + 1500;
  }
}
