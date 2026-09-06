import test from 'node:test';
import assert from 'node:assert/strict';

import { emptyTree, flatten, BAR_ID, OTHER_ID, stats } from '../vendor/bookmarks-lib/tree.js';
import * as ops from '../src/core/bookmarks-ops.js';

function bar(tree) { return flatten(tree).get(BAR_ID).node; }
function other(tree) { return flatten(tree).get(OTHER_ID).node; }
function childIds(folderNode) { return folderNode.children.map((c) => c.id); }

test('addBookmark appends to the target folder, bumps its orderRev, sets mtime', () => {
  const t0 = emptyTree();
  const { tree: t1, id } = ops.addBookmark(t0, BAR_ID, { title: 'Example', url: 'https://example.com' });
  const b = bar(t1);
  assert.equal(b.children.length, 1);
  assert.equal(b.children[0].id, id);
  assert.equal(b.children[0].type, 'bookmark');
  assert.equal(b.children[0].title, 'Example');
  assert.equal(b.children[0].url, 'https://example.com');
  assert.ok(b.children[0].mtime > 0);
  assert.equal(b.orderRev, 1);
  // original untouched
  assert.equal(bar(t0).children.length, 0);
});

test('addBookmark requires a URL', () => {
  assert.throws(() => ops.addBookmark(emptyTree(), BAR_ID, { title: 'no url' }), /URL/);
});

test('addBookmark defaults the title to the URL when none is given', () => {
  const { tree } = ops.addBookmark(emptyTree(), BAR_ID, { url: 'https://example.com/x' });
  assert.equal(bar(tree).children[0].title, 'https://example.com/x');
});

test('addFolder creates an empty folder with orderRev 0', () => {
  const { tree, id } = ops.addFolder(emptyTree(), OTHER_ID, { title: 'Reading' });
  const node = flatten(tree).get(id).node;
  assert.equal(node.type, 'folder');
  assert.equal(node.title, 'Reading');
  assert.deepEqual(node.children, []);
  assert.equal(node.orderRev, 0);
  assert.equal(other(tree).orderRev, 1);
});

test('addBookmark/addFolder insert at a given index', () => {
  let t = emptyTree();
  t = ops.addBookmark(t, BAR_ID, { url: 'https://a/' }).tree;
  t = ops.addBookmark(t, BAR_ID, { url: 'https://c/' }).tree;
  const { tree: t2, id: midId } = ops.addBookmark(t, BAR_ID, { url: 'https://b/', index: 1 });
  assert.deepEqual(bar(t2).children.map((c) => c.url), ['https://a/', 'https://b/', 'https://c/']);
  assert.equal(bar(t2).children[1].id, midId);
});

test('renameNode updates title and mtime; refuses the fixed roots', () => {
  const { tree: t1, id } = ops.addFolder(emptyTree(), BAR_ID, { title: 'Old' });
  const { tree: t2 } = ops.renameNode(t1, id, 'New');
  assert.equal(flatten(t2).get(id).node.title, 'New');
  assert.throws(() => ops.renameNode(t1, BAR_ID, 'x'), /can't be renamed/);
  assert.throws(() => ops.renameNode(t1, 'missing', 'x'), /No such/);
});

test('editUrl updates a bookmark, refuses folders and empty urls', () => {
  const { tree: t1, id } = ops.addBookmark(emptyTree(), BAR_ID, { url: 'https://old/' });
  const { tree: t2 } = ops.editUrl(t1, id, 'https://new/');
  assert.equal(flatten(t2).get(id).node.url, 'https://new/');
  assert.throws(() => ops.editUrl(t1, BAR_ID, 'https://x/'), /folder, not a bookmark/);
  assert.throws(() => ops.editUrl(t1, id, ''), /URL/);
});

test('removeNode splices the node out and bumps the parent orderRev; refuses the fixed roots', () => {
  const { tree: t1, id } = ops.addBookmark(emptyTree(), BAR_ID, { url: 'https://x/' });
  const { tree: t2, removed } = ops.removeNode(t1, id);
  assert.equal(bar(t2).children.length, 0);
  assert.equal(removed.id, id);
  assert.equal(bar(t2).orderRev, 2); // 1 from add, 1 from remove
  assert.throws(() => ops.removeNode(t2, BAR_ID), /can't be deleted/);
  assert.throws(() => ops.removeNode(t2, 'nope'), /No such/);
});

test('moveNode moves a bookmark from one folder to another', () => {
  const { tree: t1, id } = ops.addBookmark(emptyTree(), BAR_ID, { url: 'https://x/' });
  const { tree: t2 } = ops.moveNode(t1, id, OTHER_ID);
  assert.equal(bar(t2).children.length, 0);
  assert.equal(other(t2).children.length, 1);
  assert.equal(other(t2).children[0].id, id);
  // both folders' orderRev changed since the child set of each changed
  assert.ok(other(t2).orderRev > other(t1).orderRev);
  assert.ok(bar(t2).orderRev > bar(t1).orderRev);
});

test('moveNode reorders within the same folder using post-removal index semantics', () => {
  let t = emptyTree();
  t = ops.addBookmark(t, BAR_ID, { url: 'https://a/' }).tree;
  t = ops.addBookmark(t, BAR_ID, { url: 'https://b/' }).tree;
  const c = ops.addBookmark(t, BAR_ID, { url: 'https://c/' });
  t = c.tree;
  // move "a" (index 0) to the end: after removal, [b, c] has length 2 -> index 2 appends
  const aId = bar(t).children[0].id;
  const { tree: t2 } = ops.moveNode(t, aId, BAR_ID, 2);
  assert.deepEqual(bar(t2).children.map((n) => n.url), ['https://b/', 'https://c/', 'https://a/']);
});

test('moveNode refuses to move a folder into itself or its own descendant', () => {
  const { tree: t1, id: parentId } = ops.addFolder(emptyTree(), BAR_ID, { title: 'Parent' });
  const { tree: t2, id: childId } = ops.addFolder(t1, parentId, { title: 'Child' });
  assert.throws(() => ops.moveNode(t2, parentId, parentId), /inside itself/);
  assert.throws(() => ops.moveNode(t2, parentId, childId), /inside itself/);
});

test('copyNode deep-clones a folder subtree with fresh ids, leaving the original in place', () => {
  let t = emptyTree();
  const folder = ops.addFolder(t, BAR_ID, { title: 'Folder' });
  t = folder.tree;
  const bm = ops.addBookmark(t, folder.id, { url: 'https://inner/', title: 'Inner' });
  t = bm.tree;

  const { tree: t2, id: copyId } = ops.copyNode(t, folder.id, OTHER_ID);
  assert.notEqual(copyId, folder.id);
  // original subtree untouched
  assert.equal(bar(t2).children.length, 1);
  assert.equal(bar(t2).children[0].id, folder.id);
  assert.equal(flatten(t2).get(folder.id).node.children[0].id, bm.id);
  // copy has its own ids all the way down, but the same content
  const copyNode = other(t2).children[0];
  assert.equal(copyNode.title, 'Folder');
  assert.equal(copyNode.children.length, 1);
  assert.notEqual(copyNode.children[0].id, bm.id);
  assert.equal(copyNode.children[0].url, 'https://inner/');
  assert.equal(stats(t2).bookmarks, 2);
});

test('insertClone copies a node found in one tree into a different tree', () => {
  const treeA = ops.addBookmark(emptyTree(), BAR_ID, { url: 'https://shared/', title: 'Shared' });
  const nodeFromA = flatten(treeA.tree).get(treeA.id).node;

  const treeB = emptyTree();
  const { tree: treeB2, id: newId } = ops.insertClone(treeB, nodeFromA, OTHER_ID);
  assert.notEqual(newId, treeA.id);
  assert.equal(other(treeB2).children[0].url, 'https://shared/');
  assert.equal(bar(treeB2).children.length, 0); // untouched
});

test('reorderChildren applies a full new order and rejects a partial/invalid list', () => {
  let t = emptyTree();
  t = ops.addBookmark(t, BAR_ID, { url: 'https://a/' }).tree;
  t = ops.addBookmark(t, BAR_ID, { url: 'https://b/' }).tree;
  const ids = bar(t).children.map((c) => c.id);
  const { tree: t2 } = ops.reorderChildren(t, BAR_ID, [...ids].reverse());
  assert.deepEqual(bar(t2).children.map((c) => c.id), [...ids].reverse());
  assert.throws(() => ops.reorderChildren(t, BAR_ID, [ids[0]]), /exactly once/);
});

test('moveWithinParent swaps with a neighbour and no-ops at the ends', () => {
  let t = emptyTree();
  t = ops.addBookmark(t, BAR_ID, { url: 'https://a/' }).tree;
  t = ops.addBookmark(t, BAR_ID, { url: 'https://b/' }).tree;
  const ids = bar(t).children.map((c) => c.id);
  const { tree: t2 } = ops.moveWithinParent(t, ids[1], -1);
  assert.deepEqual(bar(t2).children.map((c) => c.id), [ids[1], ids[0]]);
  const { tree: t3 } = ops.moveWithinParent(t2, ids[1], -1); // ids[1] is now first; moving up again is a no-op
  assert.deepEqual(bar(t3).children.map((c) => c.id), [ids[1], ids[0]]);
});

test('listFolders lists every folder with display titles and depth', () => {
  let t = emptyTree();
  const f1 = ops.addFolder(t, BAR_ID, { title: 'A' });
  t = f1.tree;
  const f2 = ops.addFolder(t, f1.id, { title: 'B' });
  t = f2.tree;
  const list = ops.listFolders(t);
  const byId = Object.fromEntries(list.map((f) => [f.id, f]));
  assert.equal(byId[BAR_ID].title, 'Bookmarks bar');
  assert.equal(byId[BAR_ID].depth, 0);
  assert.equal(byId[OTHER_ID].depth, 0);
  assert.equal(byId[f1.id].title, 'A');
  assert.equal(byId[f1.id].depth, 1);
  assert.equal(byId[f2.id].title, 'B');
  assert.equal(byId[f2.id].depth, 2);
});
