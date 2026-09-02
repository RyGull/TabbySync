// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// import-merge.test.js — importing a bookmark file into the live browser tree.
//
// The README promises imports "merge into your current bookmarks (matched by
// URL, no duplicates)". Import is also the one path that only ever *adds* --
// it must never remove anything you already had.

import test from 'node:test';
import assert from 'node:assert/strict';

import { installFakeChrome } from './fake-chrome.js';

// import-merge.js reads the global `chrome` lazily, inside its functions, so
// the import order here does not matter.
const { mergeIntoFolder, importTopLevel, readLiveModel, getRoots } =
  await import('../bookmarks/lib/import-merge.js');

const A = 'https://a.example/';
const B = 'https://b.example/';
const C = 'https://c.example/';

function withChrome(spec) {
  const fake = installFakeChrome(spec);
  globalThis.chrome = fake.chrome;
  return fake;
}

// ---------------------------------------------------------------------------
// Never removes anything
// ---------------------------------------------------------------------------

test('importing never removes an existing bookmark', async () => {
  const fake = withChrome({ bar: [{ title: 'Keep me', url: A }], other: [{ title: 'Me too', url: B }] });

  await importTopLevel([{ type: 'folder', title: 'Bookmarks bar', children: [
    { type: 'bookmark', title: 'New', url: C },
  ] }]);

  assert.deepEqual(fake.urls(), [A, B, C].sort());
});

test('importing an empty file changes nothing', async () => {
  const fake = withChrome({ bar: [{ title: 'Keep me', url: A }] });
  const before = JSON.stringify(fake.dump());

  assert.equal(await importTopLevel([]), 0);
  assert.equal(await importTopLevel(null), 0);

  assert.equal(JSON.stringify(fake.dump()), before);
});

// ---------------------------------------------------------------------------
// No duplicates
// ---------------------------------------------------------------------------

test('a bookmark already present by URL is not added again', async () => {
  const fake = withChrome({ bar: [{ title: 'Original title', url: A }] });

  const added = await mergeIntoFolder(
    [{ type: 'bookmark', title: 'Different title, same URL', url: A }],
    fake.barId,
  );

  assert.equal(added, 0);
  assert.equal(fake.urls().length, 1);
  assert.equal(fake.dump().bar[0].title, 'Original title', 'the existing title is left alone');
});

test('URL matching ignores trailing slash, fragment and host case', async () => {
  const fake = withChrome({ bar: [{ title: 'A', url: 'https://example.com/path' }] });

  const added = await mergeIntoFolder([
    { type: 'bookmark', title: 'dupe 1', url: 'https://example.com/path/' },
    { type: 'bookmark', title: 'dupe 2', url: 'https://EXAMPLE.com/path' },
    { type: 'bookmark', title: 'dupe 3', url: 'https://example.com/path#section' },
  ], fake.barId);

  assert.equal(added, 0);
  assert.equal(fake.urls().length, 1);
});

test('duplicates within the imported file itself are collapsed', async () => {
  const fake = withChrome({});

  const added = await mergeIntoFolder([
    { type: 'bookmark', title: 'one', url: A },
    { type: 'bookmark', title: 'one again', url: A },
    { type: 'bookmark', title: 'one more', url: 'https://a.example' },
  ], fake.barId);

  assert.equal(added, 1);
  assert.equal(fake.urls().length, 1);
});

test('a folder of the same name is reused, not duplicated', async () => {
  const fake = withChrome({ bar: [{ title: 'Recipes', children: [{ title: 'A', url: A }] }] });

  const added = await mergeIntoFolder([
    { type: 'folder', title: 'recipes', children: [{ type: 'bookmark', title: 'B', url: B }] },
  ], fake.barId);

  assert.equal(added, 1);
  const bar = fake.dump().bar;
  assert.equal(bar.length, 1, 'still one Recipes folder');
  assert.equal(bar[0].title, 'Recipes', 'the existing folder keeps its casing');
  assert.deepEqual(bar[0].children.map((c) => c.url).sort(), [A, B].sort());
});

test('nested folders merge all the way down', async () => {
  const fake = withChrome({ bar: [
    { title: 'Work', children: [{ title: 'Refs', children: [{ title: 'A', url: A }] }] },
  ] });

  const added = await mergeIntoFolder([
    { type: 'folder', title: 'Work', children: [
      { type: 'folder', title: 'Refs', children: [
        { type: 'bookmark', title: 'A again', url: A },   // dupe, deep
        { type: 'bookmark', title: 'B', url: B },         // new, deep
      ] },
    ] },
  ], fake.barId);

  assert.equal(added, 1);
  const refs = fake.dump().bar[0].children[0];
  assert.equal(refs.title, 'Refs');
  assert.deepEqual(refs.children.map((c) => c.url).sort(), [A, B].sort());
});

test('an empty imported folder is created but adds no bookmarks', async () => {
  const fake = withChrome({});

  assert.equal(await mergeIntoFolder([{ type: 'folder', title: 'Empty', children: [] }], fake.barId), 0);
  assert.deepEqual(fake.dump().bar, [{ title: 'Empty', children: [] }]);
});

test('a bookmark with no URL is skipped rather than created broken', async () => {
  const fake = withChrome({});

  assert.equal(await mergeIntoFolder([{ type: 'bookmark', title: 'No URL' }], fake.barId), 0);
  assert.deepEqual(fake.dump().bar, []);
});

// ---------------------------------------------------------------------------
// Routing top-level nodes to the right root
// ---------------------------------------------------------------------------

test('bar aliases from other browsers land on the bookmarks bar', async () => {
  for (const alias of ['Bookmarks bar', 'Bookmarks Toolbar', 'toolbar', 'Favorites Bar', 'bar']) {
    const fake = withChrome({});

    await importTopLevel([{ type: 'folder', title: alias, children: [
      { type: 'bookmark', title: 'A', url: A },
    ] }]);

    assert.deepEqual(fake.dump().bar, [{ title: 'A', url: A }], `alias "${alias}" did not route to the bar`);
    assert.deepEqual(fake.dump().other, [], `alias "${alias}" leaked into other`);
  }
});

test('other-bookmarks aliases land on other bookmarks', async () => {
  for (const alias of ['Other bookmarks', 'Other Favorites', 'other']) {
    const fake = withChrome({});

    await importTopLevel([{ type: 'folder', title: alias, children: [
      { type: 'bookmark', title: 'A', url: A },
    ] }]);

    assert.deepEqual(fake.dump().other, [{ title: 'A', url: A }], `alias "${alias}" did not route to other`);
    assert.deepEqual(fake.dump().bar, []);
  }
});

test('an unrecognised top-level folder is kept whole under other bookmarks', async () => {
  const fake = withChrome({});

  await importTopLevel([{ type: 'folder', title: 'Imported from somewhere', children: [
    { type: 'bookmark', title: 'A', url: A },
  ] }]);

  assert.deepEqual(fake.dump().bar, []);
  assert.deepEqual(fake.dump().other, [
    { title: 'Imported from somewhere', children: [{ title: 'A', url: A }] },
  ], 'the folder is preserved, not flattened away');
});

test('a loose top-level bookmark goes to other bookmarks', async () => {
  const fake = withChrome({});

  assert.equal(await importTopLevel([{ type: 'bookmark', title: 'Loose', url: A }]), 1);
  assert.deepEqual(fake.dump().other, [{ title: 'Loose', url: A }]);
});

test('importTopLevel returns the number of bookmarks actually created', async () => {
  const fake = withChrome({ bar: [{ title: 'Existing', url: A }] });

  const added = await importTopLevel([
    { type: 'folder', title: 'Bookmarks bar', children: [
      { type: 'bookmark', title: 'dupe', url: A },  // not counted
      { type: 'bookmark', title: 'new', url: B },   // counted
    ] },
    { type: 'bookmark', title: 'loose', url: C },   // counted
  ]);

  assert.equal(added, 2);
});

// ---------------------------------------------------------------------------
// Reading the live tree back
// ---------------------------------------------------------------------------

test('readLiveModel round-trips the live tree into the plain model shape', async () => {
  withChrome({
    bar: [{ title: 'Work', children: [{ title: 'A', url: A }] }],
    other: [{ title: 'B', url: B }],
  });

  const model = await readLiveModel();

  assert.equal(model.type, 'folder');
  assert.deepEqual(model.children.map((c) => c.title), ['Bookmarks bar', 'Other bookmarks']);
  assert.deepEqual(model.children[0].children, [
    { type: 'folder', title: 'Work', children: [{ type: 'bookmark', title: 'A', url: A }] },
  ]);
  assert.deepEqual(model.children[1].children, [{ type: 'bookmark', title: 'B', url: B }]);
});

test('a re-import of what was just exported adds nothing', async () => {
  // The round trip that matters: export, then import the same file back.
  const fake = withChrome({
    bar: [{ title: 'Work', children: [{ title: 'A', url: A }] }],
    other: [{ title: 'B', url: B }],
  });

  const exported = await readLiveModel();
  const before = JSON.stringify(fake.dump());

  assert.equal(await importTopLevel(exported.children), 0, 'no bookmarks added');
  assert.equal(JSON.stringify(fake.dump()), before, 'tree is byte-identical');
});

test('getRoots falls back to the first root when a browser exposes only one', async () => {
  const fake = installFakeChrome({});
  globalThis.chrome = {
    bookmarks: {
      ...fake.chrome.bookmarks,
      async getTree() {
        const [root] = await fake.chrome.bookmarks.getTree();
        return [{ ...root, children: [root.children[0]] }]; // bar only
      },
    },
  };

  const { barLocalId, otherLocalId } = await getRoots();
  assert.equal(barLocalId, otherLocalId, 'both ids collapse to the single root rather than throwing');
});
