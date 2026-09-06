// bookmarks-ops.js — add/remove/move/copy/rename over a bookmark tree.
//
// The extension never needs these: it only ever mirrors whatever the real
// browser bookmarks API already did. The Control Panel edits the tree data
// structure directly (there is no browser here), so it needs its own
// mutation layer — this is that layer. Every op is a pure function: it
// clones the tree, mutates the clone, and returns { tree, ... }, never the
// input. That keeps a caller's "before" snapshot (used as the merge base on
// save — see remote-bookmarks.js) trustworthy even if it forgot to clone.
//
// Two fields matter to vendor/bookmarks-lib/merge.js and must stay correct
// here exactly as they would coming from a real browser:
//   - mtime on a node: bumped whenever ITS OWN fields (title/url) change.
//   - orderRev on a folder: bumped whenever ITS children array changes
//     (add/remove/move/reorder) — this is what lets the merge decide whose
//     ordering of a folder wins when two devices disagree (see merge.js's
//     own comment on orderChildren). Forgetting to bump it here would mean
//     edits made in this app silently lose reordering conflicts to a stale
//     device next time the browser extension syncs.
'use strict';

import { flatten, findNode, cloneTree, isFolder, walk, ROOT_ID, BAR_ID, OTHER_ID } from '../../vendor/bookmarks-lib/tree.js';
import { newId } from './id.js';

const FIXED_IDS = new Set([ROOT_ID, BAR_ID, OTHER_ID]);

function requireEntry(map, id, what = 'bookmark/folder') {
  const entry = map.get(id);
  if (!entry) throw new Error(`No such ${what}: ${id}`);
  return entry;
}

function requireFolder(map, id) {
  const entry = requireEntry(map, id, 'folder');
  if (!isFolder(entry.node)) throw new Error(`Not a folder: ${id}`);
  return entry.node;
}

function bumpOrder(folderNode) {
  folderNode.orderRev = (folderNode.orderRev || 0) + 1;
}

function clampIndex(children, index) {
  if (typeof index !== 'number' || Number.isNaN(index) || index < 0 || index > children.length) return children.length;
  return index;
}

function isSelfOrDescendant(tree, ancestorId, id) {
  if (ancestorId === id) return true;
  const ancestor = findNode(tree, ancestorId);
  if (!ancestor || !isFolder(ancestor)) return false;
  let found = false;
  walk(ancestor, (n) => { if (n.id === id) found = true; });
  return found;
}

export function addBookmark(tree, parentId, { title, url, index } = {}) {
  if (!url || !String(url).trim()) throw new Error('A bookmark needs a URL.');
  const next = cloneTree(tree);
  const parent = requireFolder(flatten(next), parentId);
  const node = { id: newId('bm'), type: 'bookmark', title: title || url, url, mtime: Date.now() };
  parent.children.splice(clampIndex(parent.children, index), 0, node);
  bumpOrder(parent);
  return { tree: next, id: node.id };
}

export function addFolder(tree, parentId, { title, index } = {}) {
  const next = cloneTree(tree);
  const parent = requireFolder(flatten(next), parentId);
  const node = { id: newId('fld'), type: 'folder', title: title || 'New folder', mtime: Date.now(), orderRev: 0, children: [] };
  parent.children.splice(clampIndex(parent.children, index), 0, node);
  bumpOrder(parent);
  return { tree: next, id: node.id };
}

export function renameNode(tree, id, title) {
  if (FIXED_IDS.has(id)) throw new Error("The Bookmarks bar and Other bookmarks folders can't be renamed.");
  const next = cloneTree(tree);
  const entry = requireEntry(flatten(next), id);
  entry.node.title = title || '';
  entry.node.mtime = Date.now();
  return { tree: next };
}

export function editUrl(tree, id, url) {
  const next = cloneTree(tree);
  const entry = requireEntry(flatten(next), id, 'bookmark');
  if (isFolder(entry.node)) throw new Error('That is a folder, not a bookmark.');
  if (!url || !String(url).trim()) throw new Error('A bookmark needs a URL.');
  entry.node.url = url;
  entry.node.mtime = Date.now();
  return { tree: next };
}

export function removeNode(tree, id) {
  if (FIXED_IDS.has(id)) throw new Error("The Bookmarks bar and Other bookmarks folders can't be deleted.");
  const next = cloneTree(tree);
  const map = flatten(next);
  const entry = requireEntry(map, id);
  const parent = map.get(entry.parentId).node;
  const idx = parent.children.findIndex((c) => c.id === id);
  parent.children.splice(idx, 1);
  bumpOrder(parent);
  return { tree: next, removed: entry.node };
}

/**
 * Moves node `id` into folder `newParentId`, inserting it at `index`. `index`
 * is a plain splice() index into the DESTINATION's children array AFTER `id`
 * has already been removed from its old parent — when moving within the
 * same folder, the caller must account for the removal shifting later
 * positions down by one (subtract 1 from a drop target that came after the
 * dragged item's original position). Omit `index` to append at the end.
 */
export function moveNode(tree, id, newParentId, index) {
  if (FIXED_IDS.has(id)) throw new Error("The Bookmarks bar and Other bookmarks folders can't be moved.");
  if (isSelfOrDescendant(tree, id, newParentId)) throw new Error("Can't move a folder inside itself.");
  const next = cloneTree(tree);
  const map = flatten(next);
  const entry = requireEntry(map, id);
  const destFolder = requireFolder(map, newParentId);
  const oldParent = map.get(entry.parentId).node;
  const oldIdx = oldParent.children.findIndex((c) => c.id === id);
  const [moved] = oldParent.children.splice(oldIdx, 1);
  bumpOrder(oldParent);
  moved.mtime = Date.now();
  destFolder.children.splice(clampIndex(destFolder.children, index), 0, moved);
  if (destFolder !== oldParent) bumpOrder(destFolder);
  return { tree: next };
}

function cloneWithNewIds(node) {
  const copy = { ...node, id: newId(node.type === 'folder' ? 'fld' : 'bm'), mtime: Date.now() };
  if (node.type === 'folder') {
    copy.orderRev = 0;
    copy.children = (node.children || []).map(cloneWithNewIds);
  }
  return copy;
}

/** Like moveNode, but leaves the original in place and inserts a deep copy (fresh ids throughout) at the destination. */
export function copyNode(tree, id, newParentId, { index } = {}) {
  const next = cloneTree(tree);
  const map = flatten(next);
  const entry = requireEntry(map, id);
  const destFolder = requireFolder(map, newParentId);
  const copy = cloneWithNewIds(entry.node);
  destFolder.children.splice(clampIndex(destFolder.children, index), 0, copy);
  bumpOrder(destFolder);
  return { tree: next, id: copy.id };
}

/**
 * Deep-clones `sourceNode` (a node object taken from some OTHER tree, e.g.
 * another profile) with fresh ids throughout, and inserts it into `destTree`
 * at folder `destParentId`. This is copyNode's cross-tree twin: copyNode
 * looks its source id up inside the SAME tree it's editing; this one is for
 * when the source lives in a different tree entirely, as with the Control
 * Panel's "copy/move to another profile" (see src/core/sessions.js).
 */
export function insertClone(destTree, sourceNode, destParentId, { index } = {}) {
  const next = cloneTree(destTree);
  const destFolder = requireFolder(flatten(next), destParentId);
  const copy = cloneWithNewIds(sourceNode);
  destFolder.children.splice(clampIndex(destFolder.children, index), 0, copy);
  bumpOrder(destFolder);
  return { tree: next, id: copy.id };
}

/** Reassigns a folder's children to exactly the given order (drag-to-reorder). */
export function reorderChildren(tree, parentId, orderedIds) {
  const next = cloneTree(tree);
  const parent = requireFolder(flatten(next), parentId);
  const byId = new Map(parent.children.map((c) => [c.id, c]));
  const valid = orderedIds.length === parent.children.length && orderedIds.every((id) => byId.has(id));
  if (!valid) throw new Error('reorderChildren() must list every child id exactly once.');
  parent.children = orderedIds.map((id) => byId.get(id));
  bumpOrder(parent);
  return { tree: next };
}

/** Swaps `id` with its previous (-1) or next (+1) sibling. No-ops at either end. */
export function moveWithinParent(tree, id, direction) {
  const map = flatten(tree);
  const entry = requireEntry(map, id);
  const parent = map.get(entry.parentId).node;
  const ids = parent.children.map((c) => c.id);
  const idx = ids.indexOf(id);
  const target = idx + direction;
  if (target < 0 || target >= ids.length) return { tree: cloneTree(tree) };
  [ids[idx], ids[target]] = [ids[target], ids[idx]];
  return reorderChildren(tree, entry.parentId, ids);
}

/** Every folder as { id, title, depth }, in display order — for a "move/copy to…" picker. */
export function listFolders(tree) {
  const out = [];
  function visit(node, depth) {
    if (!isFolder(node)) return;
    if (node.id !== ROOT_ID) {
      const title = node.title || (node.id === BAR_ID ? 'Bookmarks bar' : node.id === OTHER_ID ? 'Other bookmarks' : '(untitled folder)');
      out.push({ id: node.id, title, depth });
    }
    const childDepth = node.id === ROOT_ID ? depth : depth + 1;
    (node.children || []).forEach((c) => visit(c, childDepth));
  }
  visit(tree, 0);
  return out;
}
