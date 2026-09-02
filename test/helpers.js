// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// helpers.js — tree builders and assertions shared by the test files.
// Not a test file itself (the runner only picks up *.test.js).

import { emptyTree, walk, ROOT_ID, BAR_ID, OTHER_ID } from '../bookmarks/lib/tree.js';

export { ROOT_ID, BAR_ID, OTHER_ID };

/** A bookmark node. */
export function bm(id, title, url, mtime = 1) {
  return { id, type: 'bookmark', title, url, mtime };
}

/** A folder node. */
export function folder(id, title, children = [], mtime = 1, orderRev = 0) {
  return { id, type: 'folder', title, mtime, orderRev, children };
}

/** A whole tree: children of the bookmarks bar, and of "other bookmarks". */
export function tree(barKids = [], otherKids = [], barRev = 0, otherRev = 0) {
  const t = emptyTree();
  t.children[0].children = barKids;
  t.children[0].orderRev = barRev;
  t.children[1].children = otherKids;
  t.children[1].orderRev = otherRev;
  return t;
}

/** Every non-fixed node id in the tree, as a sorted array. */
export function ids(t) {
  const out = [];
  walk(t, (n) => {
    if (n.id === ROOT_ID || n.id === BAR_ID || n.id === OTHER_ID) return;
    out.push(n.id);
  });
  return out.sort();
}

/** Every bookmark URL in the tree, sorted. The thing a user would call "my data". */
export function urls(t) {
  const out = [];
  walk(t, (n) => { if (n.type === 'bookmark') out.push(n.url); });
  return out.sort();
}

/** Find a node by id, or null. */
export function node(t, id) {
  let found = null;
  walk(t, (n) => { if (n.id === id) found = n; });
  return found;
}

/** The id of a node's parent, or null if the node isn't in the tree. */
export function parentOf(t, id) {
  let p = null;
  walk(t, (n, parent) => { if (n.id === id && parent) p = parent.id; });
  return p;
}

/** Child ids of a folder, in order. */
export function order(t, folderId) {
  const f = node(t, folderId);
  return f && f.children ? f.children.map((c) => c.id) : [];
}

/** A cheap deterministic PRNG, so generated cases are reproducible. */
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
