// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// fake-chrome.js — an in-memory stand-in for the slice of chrome.bookmarks
// that import-merge.js uses. Not a test file.

let seq = 0;

/**
 * Build a fake `chrome` global from a plain spec:
 *   installFakeChrome({ bar: [...], other: [...] })
 * where each entry is { title, url } for a bookmark or
 * { title, children: [...] } for a folder.
 * Returns { chrome, dump, created } — `dump` reads the live tree back as the
 * same plain shape, `created` lists every create() call in order.
 */
export function installFakeChrome(spec = {}) {
  seq = 0;
  const nodes = new Map(); // id -> { id, parentId, title, url?, children? }

  const add = (parentId, item) => {
    const id = `n${++seq}`;
    const isFolder = !item.url;
    const node = { id, parentId, title: item.title || '' };
    if (isFolder) node.children = [];
    else node.url = item.url;
    nodes.set(id, node);
    if (parentId != null) nodes.get(parentId).children.push(id);
    for (const c of item.children || []) add(id, c);
    return node;
  };

  const root = { id: 'root', parentId: null, title: '', children: [] };
  nodes.set('root', root);
  const bar = add('root', { title: 'Bookmarks bar', children: spec.bar || [] });
  const other = add('root', { title: 'Other bookmarks', children: spec.other || [] });

  // chrome.bookmarks returns nested BookmarkTreeNodes, not our flat store.
  const inflate = (id) => {
    const n = nodes.get(id);
    const out = { id: n.id, parentId: n.parentId, title: n.title };
    if (n.url) out.url = n.url;
    else out.children = n.children.map(inflate);
    return out;
  };

  const created = [];
  const chrome = {
    bookmarks: {
      async getTree() { return [inflate('root')]; },
      async getSubTree(id) { return [inflate(id)]; },
      async getChildren(id) {
        return nodes.get(id).children.map((c) => {
          const n = nodes.get(c);
          const out = { id: n.id, parentId: n.parentId, title: n.title };
          if (n.url) out.url = n.url;
          return out;
        });
      },
      async create({ parentId, title, url }) {
        created.push({ parentId, title, url: url || null });
        return add(parentId, { title, url });
      },
    },
  };

  const plain = (id) => {
    const n = nodes.get(id);
    if (n.url) return { title: n.title, url: n.url };
    return { title: n.title, children: n.children.map(plain) };
  };

  return {
    chrome,
    created,
    barId: bar.id,
    otherId: other.id,
    dump: () => ({ bar: nodes.get(bar.id).children.map(plain), other: nodes.get(other.id).children.map(plain) }),
    /** Every URL anywhere in the live tree, sorted. */
    urls: () => {
      const out = [];
      for (const n of nodes.values()) if (n.url) out.push(n.url);
      return out.sort();
    },
  };
}
