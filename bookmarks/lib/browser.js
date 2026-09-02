// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// browser.js — bridge between chrome.bookmarks and the stable-id model.
//   readBrowserTree(): current bookmarks -> model tree (stable ids), stamping a
//     fresh mtime on anything changed since the last sync (the cache), so the
//     merge's last-writer-wins has a real timestamp to work with.
//   applyTree(): reconcile the live bookmarks to match a merged model tree.

import {
  ROOT_ID, BAR_ID, OTHER_ID, isFolder, flatten, now,
} from './tree.js';

function newId() {
  return (crypto.randomUUID && crypto.randomUUID()) ||
    ('x' + Date.now() + Math.random().toString(16).slice(2));
}

// Locate the two synced roots (bookmarks bar + other bookmarks).
async function getRoots() {
  const [root] = await chrome.bookmarks.getTree();
  const kids = root.children || [];
  // children[0] is the toolbar, children[1] is "other" on Chromium browsers.
  const bar = kids[0];
  const other = kids[1] || kids[0];
  return { barLocalId: bar.id, otherLocalId: other.id };
}

function invert(map) {
  const out = {};
  for (const k of Object.keys(map)) out[map[k]] = k;
  return out;
}

// Build the model tree from live bookmarks. Mutates `stableToLocal` with any
// newly-assigned ids. Returns { tree, stableToLocal }.
export async function readBrowserTree(stableToLocal, cacheTree) {
  const { barLocalId, otherLocalId } = await getRoots();
  const localToStable = invert(stableToLocal);
  const map = { ...stableToLocal };

  const barNodes = (await chrome.bookmarks.getSubTree(barLocalId))[0].children || [];
  const otherNodes = (await chrome.bookmarks.getSubTree(otherLocalId))[0].children || [];

  function conv(bnode) {
    let sid = localToStable[bnode.id];
    if (!sid) { sid = newId(); localToStable[bnode.id] = sid; }
    map[sid] = bnode.id;
    const folder = !bnode.url;
    const m = { id: sid, type: folder ? 'folder' : 'bookmark', title: bnode.title || '', mtime: 0 };
    if (!folder) m.url = bnode.url;
    if (folder) m.children = (bnode.children || []).map(conv);
    return m;
  }

  const tree = {
    id: ROOT_ID, type: 'folder', title: '', mtime: 0, children: [
      { id: BAR_ID, type: 'folder', title: 'Bookmarks bar', mtime: 0, children: barNodes.map(conv) },
      { id: OTHER_ID, type: 'folder', title: 'Other bookmarks', mtime: 0, children: otherNodes.map(conv) },
    ],
  };
  map[BAR_ID] = barLocalId;
  map[OTHER_ID] = otherLocalId;

  stampMtimes(tree, cacheTree);
  return { tree, stableToLocal: map };
}

function stampMtimes(tree, cacheTree) {
  const cache = cacheTree ? flatten(cacheTree) : new Map();
  const cur = flatten(tree);
  const t = now();
  for (const [id, { node, parentId }] of cur) {
    const c = cache.get(id);
    if (!c) {
      // brand new to this device
      node.mtime = t;
      if (isFolder(node)) node.orderRev = 0;
      continue;
    }
    // Field/parent change -> bump mtime (drives title/url/move last-writer-wins).
    let fieldChanged = (c.node.title || '') !== (node.title || '');
    if (node.type === 'bookmark') fieldChanged = fieldChanged || (c.node.url || '') !== (node.url || '');
    if (c.parentId !== parentId) fieldChanged = true;
    node.mtime = fieldChanged ? t : (c.node.mtime || t);

    // Child-order change -> bump the LOGICAL orderRev (drives order authority,
    // independent of wall-clock time so it's comparable across computers).
    if (isFolder(node)) {
      const a = (node.children || []).map((x) => x.id).join(',');
      const b = (c.node.children || []).map((x) => x.id).join(',');
      const baseRev = c.node.orderRev || 0;
      node.orderRev = (a !== b) ? baseRev + 1 : baseRev;
    }
  }
}

// Reconcile live bookmarks to match `merged`. Mutates+returns stableToLocal.
export async function applyTree(merged, stableToLocalIn) {
  const stableToLocal = { ...stableToLocalIn };
  const { barLocalId, otherLocalId } = await getRoots();
  stableToLocal[BAR_ID] = barLocalId;
  stableToLocal[OTHER_ID] = otherLocalId;

  const desired = flatten(merged); // stable id -> {node,parentId,index}

  // Phase 1: delete browser nodes whose stable id is gone from the merge.
  for (const sid of Object.keys(stableToLocal)) {
    if (sid === BAR_ID || sid === OTHER_ID) continue;
    if (desired.has(sid)) continue;
    const localId = stableToLocal[sid];
    try {
      const found = await chrome.bookmarks.get(localId).catch(() => null);
      if (found && found[0]) {
        if (found[0].url) await chrome.bookmarks.remove(localId);
        else await chrome.bookmarks.removeTree(localId);
      }
    } catch { /* parent may have removed it already */ }
    delete stableToLocal[sid];
  }

  // Phase 2: create / update / move to match, top-down.
  const barFolder = merged.children.find((c) => c.id === BAR_ID);
  const otherFolder = merged.children.find((c) => c.id === OTHER_ID);
  await syncFolderChildren(barFolder, barLocalId, stableToLocal);
  await syncFolderChildren(otherFolder, otherLocalId, stableToLocal);

  return stableToLocal;
}

async function syncFolderChildren(mergedFolder, localFolderId, stableToLocal) {
  const children = (mergedFolder && mergedFolder.children) || [];
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    let localId = stableToLocal[child.id];
    let live = null;
    if (localId) live = (await chrome.bookmarks.get(localId).catch(() => null))?.[0] || null;

    if (!live) {
      const createArgs = { parentId: localFolderId, index: i, title: child.title || '' };
      if (child.type === 'bookmark') createArgs.url = child.url || '';
      const created = await chrome.bookmarks.create(createArgs);
      localId = created.id;
      stableToLocal[child.id] = localId;
    } else {
      // update fields if needed
      const patch = {};
      if ((live.title || '') !== (child.title || '')) patch.title = child.title || '';
      if (child.type === 'bookmark' && (live.url || '') !== (child.url || '')) patch.url = child.url || '';
      if (Object.keys(patch).length) await chrome.bookmarks.update(localId, patch);
      // move to correct parent + position
      if (live.parentId !== localFolderId || live.index !== i) {
        await chrome.bookmarks.move(localId, { parentId: localFolderId, index: i });
      }
    }

    if (child.type === 'folder') {
      await syncFolderChildren(child, localId, stableToLocal);
    }
  }
}
