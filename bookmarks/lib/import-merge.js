// import-merge.js — apply an imported model tree to the live bookmarks by
// MERGING (no duplicates: bookmarks matched by URL, folders by name), and read
// the live bookmarks back into a plain model. Uses chrome.bookmarks; no DOM, so
// it's Node-testable with a fake chrome.

import { normUrl } from './tree.js';

export async function getRoots() {
  const [root] = await chrome.bookmarks.getTree();
  const kids = root.children || [];
  return { barLocalId: kids[0].id, otherLocalId: (kids[1] || kids[0]).id };
}

// Live bookmarks -> { type:'folder', title:'', children:[barFolder, otherFolder] }.
export async function readLiveModel() {
  const { barLocalId, otherLocalId } = await getRoots();
  const conv = (bn) => bn.url
    ? { type: 'bookmark', title: bn.title || '', url: bn.url }
    : { type: 'folder', title: bn.title || '', children: (bn.children || []).map(conv) };
  const bar = (await chrome.bookmarks.getSubTree(barLocalId))[0].children || [];
  const other = (await chrome.bookmarks.getSubTree(otherLocalId))[0].children || [];
  return { type: 'folder', title: '', children: [
    { type: 'folder', title: 'Bookmarks bar', children: bar.map(conv) },
    { type: 'folder', title: 'Other bookmarks', children: other.map(conv) },
  ] };
}

// Merge `children` into the browser folder `targetId` without duplicates.
// Returns the number of bookmarks actually created.
export async function mergeIntoFolder(children, targetId) {
  const existing = await chrome.bookmarks.getChildren(targetId);
  const folderByName = new Map();
  const urlSet = new Set();
  let added = 0;
  for (const e of existing) {
    if (e.url) urlSet.add(normUrl(e.url));
    else folderByName.set((e.title || '').toLowerCase(), e.id);
  }
  for (const ch of children || []) {
    if (ch.type === 'bookmark') {
      if (ch.url && !urlSet.has(normUrl(ch.url))) {
        await chrome.bookmarks.create({ parentId: targetId, title: ch.title || '', url: ch.url });
        urlSet.add(normUrl(ch.url)); added++;
      }
    } else {
      const key = (ch.title || '').toLowerCase();
      let fid = folderByName.get(key);
      if (!fid) {
        const f = await chrome.bookmarks.create({ parentId: targetId, title: ch.title || '' });
        fid = f.id; folderByName.set(key, fid);
      }
      added += await mergeIntoFolder(ch.children || [], fid);
    }
  }
  return added;
}

const BAR_ALIASES = ['bookmarks bar', 'bookmarks toolbar', 'toolbar', 'favorites bar', 'bar'];
const OTHER_ALIASES = ['other bookmarks', 'other favorites', 'other'];

// Distribute top-level import nodes to the bar / other roots. Unknown folders
// and loose bookmarks go under Other bookmarks.
export async function importTopLevel(rootChildren) {
  const { barLocalId, otherLocalId } = await getRoots();
  let added = 0;
  for (const node of rootChildren || []) {
    const name = (node.title || '').toLowerCase();
    if (node.type === 'folder' && BAR_ALIASES.includes(name)) added += await mergeIntoFolder(node.children || [], barLocalId);
    else if (node.type === 'folder' && OTHER_ALIASES.includes(name)) added += await mergeIntoFolder(node.children || [], otherLocalId);
    else added += await mergeIntoFolder([node], otherLocalId);
  }
  return added;
}
