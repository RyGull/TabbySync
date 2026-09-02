// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// tree.test.js — the pure tree model helpers the merge is built on.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  emptyTree, cloneTree, flatten, sameFields, normUrl, semanticKey, stats,
  findNode, isFolder, ROOT_ID, BAR_ID, OTHER_ID,
} from '../bookmarks/lib/tree.js';
import { bm, folder, tree } from './helpers.js';

test('an empty tree has exactly the two fixed roots and no content', () => {
  const t = emptyTree();
  assert.deepEqual(t.children.map((c) => c.id), [BAR_ID, OTHER_ID]);
  assert.deepEqual(stats(t), { bookmarks: 0, folders: 0 });
});

test('cloneTree produces an independent copy', () => {
  const t = tree([bm('a', 'A', 'https://a.example/')]);
  const c = cloneTree(t);
  c.children[0].children[0].title = 'changed';
  assert.equal(findNode(t, 'a').title, 'A');
});

test('flatten records each node’s parent, and skips the synthetic root', () => {
  const t = tree([folder('f', 'F', [bm('a', 'A', 'https://a.example/')])]);
  const m = flatten(t);

  assert.equal(m.has(ROOT_ID), false);
  assert.equal(m.get(BAR_ID).parentId, ROOT_ID);
  assert.equal(m.get('f').parentId, BAR_ID);
  assert.equal(m.get('a').parentId, 'f');
  assert.equal(m.get('a').index, 0);
});

test('stats counts content but not the fixed roots', () => {
  const t = tree(
    [folder('f', 'F', [bm('a', 'A', 'https://a.example/')])],
    [bm('b', 'B', 'https://b.example/')],
  );
  assert.deepEqual(stats(t), { bookmarks: 2, folders: 1 });
});

test('normUrl ignores trailing slash, fragment and host case', () => {
  assert.equal(normUrl('https://Example.com/path/'), normUrl('https://example.com/path'));
  assert.equal(normUrl('https://example.com/p#section'), normUrl('https://example.com/p'));
  assert.equal(normUrl('https://example.com/'), 'https://example.com');
});

test('normUrl keeps distinct pages distinct', () => {
  assert.notEqual(normUrl('https://example.com/a'), normUrl('https://example.com/b'));
  assert.notEqual(normUrl('https://example.com/?q=1'), normUrl('https://example.com/?q=2'));
});

test('normUrl falls back to the raw string for unparseable input', () => {
  assert.equal(normUrl('  Not A Url  '), 'not a url');
  assert.equal(normUrl(''), '');
  assert.equal(normUrl(undefined), '');
});

test('semanticKey matches bookmarks by URL and folders by title', () => {
  assert.equal(
    semanticKey(bm('x', 'One name', 'https://a.example/')),
    semanticKey(bm('y', 'Different name', 'https://a.example/')),
    'title does not affect a bookmark’s identity',
  );
  assert.equal(
    semanticKey(folder('x', 'Recipes')),
    semanticKey(folder('y', ' recipes ')),
    'folder titles match case- and space-insensitively',
  );
  assert.notEqual(semanticKey(folder('x', 'Recipes')), semanticKey(bm('y', 'Recipes', 'https://r/')));
});

test('sameFields compares own fields only, ignoring children and mtime', () => {
  assert.ok(sameFields(
    bm('a', 'A', 'https://a.example/', 1),
    bm('a', 'A', 'https://a.example/', 999),
  ));
  assert.ok(sameFields(folder('f', 'F', []), folder('f', 'F', [bm('x', 'X', 'https://x/')])));
  assert.equal(sameFields(bm('a', 'A', 'https://a/'), bm('a', 'A', 'https://b/')), false);
  assert.equal(sameFields(bm('a', 'A', 'https://a/'), folder('a', 'A')), false);
  assert.equal(sameFields(null, bm('a', 'A', 'https://a/')), false);
});

test('isFolder distinguishes the two node types', () => {
  assert.ok(isFolder(folder('f', 'F')));
  assert.equal(isFolder(bm('a', 'A', 'https://a/')), false);
});
