// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// tree.js — pure bookmark-tree model helpers (no chrome APIs; Node-testable).
//
// Model node shape:
//   { id, type:'folder'|'bookmark', title, url?, mtime, children? }
// A folder always has a children array (possibly empty). A bookmark has url.
//
// The tree is rooted at a synthetic node whose two children are the two
// synced browser roots: the bookmarks bar and "other bookmarks". Those two
// folders always exist and are never created/deleted by the merge.

export const ROOT_ID = 'root';
export const BAR_ID = '__bar__';     // Bookmarks bar
export const OTHER_ID = '__other__'; // Other bookmarks

export function now() { return Date.now(); }

export function emptyTree() {
  return {
    id: ROOT_ID, type: 'folder', title: '', mtime: 0, orderRev: 0, children: [
      { id: BAR_ID, type: 'folder', title: 'Bookmarks bar', mtime: 0, orderRev: 0, children: [] },
      { id: OTHER_ID, type: 'folder', title: 'Other bookmarks', mtime: 0, orderRev: 0, children: [] },
    ],
  };
}

export function isFolder(n) { return n.type === 'folder'; }

export function cloneTree(n) {
  return JSON.parse(JSON.stringify(n));
}

// Normalize a URL for semantic matching/dedup. Trailing slash & hash removed,
// lowercased host. Best-effort; falls back to the raw string.
export function normUrl(url) {
  if (!url) return '';
  try {
    const u = new URL(url);
    u.hash = '';
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return String(url).trim().toLowerCase();
  }
}

export function semanticKey(n) {
  if (isFolder(n)) return 'f:' + (n.title || '').trim().toLowerCase();
  return 'b:' + normUrl(n.url);
}

// Depth-first walk. cb(node, parentNode, index).
export function walk(root, cb, parent = null, index = -1) {
  cb(root, parent, index);
  if (root.children) {
    root.children.forEach((c, i) => walk(c, cb, root, i));
  }
}

// Flatten to a Map: id -> { node, parentId, index }. Excludes the synthetic
// root itself but includes the two fixed root folders.
export function flatten(root) {
  const map = new Map();
  walk(root, (node, parent, index) => {
    if (node === root) return;
    map.set(node.id, { node, parentId: parent ? parent.id : null, index });
  });
  return map;
}

// Shallow structural equality of a node's own fields (ignores children).
export function sameFields(a, b) {
  if (!a || !b) return false;
  if (a.type !== b.type) return false;
  if ((a.title || '') !== (b.title || '')) return false;
  if (a.type === 'bookmark' && (a.url || '') !== (b.url || '')) return false;
  return true;
}

// Find a node by id anywhere in the tree; returns the node or null.
export function findNode(root, id) {
  let found = null;
  walk(root, (n) => { if (n.id === id) found = n; });
  return found;
}

// Count bookmarks + folders (excluding synthetic root and the 2 fixed roots).
export function stats(root) {
  let bookmarks = 0, folders = 0;
  walk(root, (n) => {
    if (n.id === ROOT_ID || n.id === BAR_ID || n.id === OTHER_ID) return;
    if (isFolder(n)) folders++; else bookmarks++;
  });
  return { bookmarks, folders };
}
