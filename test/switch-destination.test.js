// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// switch-destination.test.js — the merge base belongs to one destination.
//
// This exists because of a real, reported data loss: switching sync method in
// Options (self-hosted -> Gist and back) emptied the browser's bookmarks. The
// mechanism was not in the merge, which behaved exactly as designed. It was in
// what the engine handed the merge:
//
//   base   = the cached tree from the destination you just left (full)
//   local  = your actual bookmarks (full)
//   remote = the destination you just switched to (no file there yet, so empty)
//
// A three-way merge reads that as "the other side deleted all of these", and
// deleting them is the correct answer to that question. The question was wrong.
// A base only means "what both sides last agreed on" for the destination it was
// agreed with; against any other destination there is no base at all, and the
// merge must union instead.
//
// The engine now refuses that base in two cases — the destination changed, or
// there is no remote file yet — and both are pinned here.

import test from 'node:test';
import assert from 'node:assert/strict';

import { threeWayMerge } from '../bookmarks/lib/merge.js';
import { emptyTree } from '../bookmarks/lib/tree.js';
import { readFileSync } from 'node:fs';
import { bm, folder, tree, urls } from './helpers.js';

const engine = readFileSync(new URL('../bookmarks/lib/engine.js', import.meta.url), 'utf8');
const bmConfig = readFileSync(new URL('../bookmarks/lib/config.js', import.meta.url), 'utf8');

/** A believable set of bookmarks — the thing that got deleted. */
const mine = () => tree(
  [
    bm('b1', 'MDN', 'https://developer.mozilla.org/'),
    folder('f1', 'Work', [
      bm('b2', 'GitHub', 'https://github.com/'),
      bm('b3', 'Docs', 'https://docs.example/'),
    ]),
  ],
  [bm('b4', 'News', 'https://news.example/')],
);

// ---------------------------------------------------------------------------
// The merge, given the inputs the engine used to hand it
// ---------------------------------------------------------------------------

test('the reported wipe: an old destination\'s base against a new, empty one', () => {
  // Not a claim about what *should* happen — a record of what the merge does
  // with these inputs, which is why the engine must never produce them.
  for (const deleteWins of [false, true]) {
    const merged = threeWayMerge(mine(), mine(), emptyTree(), { deleteWins });
    assert.equal(urls(merged).length, 0,
      'this is the input combination that deleted everything; if it no longer does, ' +
      'the merge changed and this test should be re-read rather than re-pointed');
  }
});

test('dropping the stale base turns that same switch into a union', () => {
  // What the engine does now: no base, because this destination never agreed
  // to anything. Every bookmark survives, and the empty remote gains them.
  const merged = threeWayMerge(null, mine(), emptyTree(), { deleteWins: false });
  assert.deepEqual(urls(merged), [
    'https://developer.mozilla.org/',
    'https://docs.example/',
    'https://github.com/',
    'https://news.example/',
  ]);
});

test('switching back restores from the destination that still has the data', () => {
  // The wipe pushed an empty tree to the NEW destination only, so the original
  // file is intact. Switching back merges local (now empty) with that file.
  const merged = threeWayMerge(null, emptyTree(), mine(), { deleteWins: true });
  assert.equal(urls(merged).length, 4, 'the untouched destination must be able to restore the browser');
});

test('a genuine "deleted everywhere" still propagates', () => {
  // The guards must not turn into "deletes never sync". A remote file that
  // exists and is empty is a real deletion someone made on another machine,
  // and it is not what a destination switch looks like.
  const merged = threeWayMerge(mine(), mine(), tree([], []), { deleteWins: false });
  assert.equal(urls(merged).length, 0, 'an empty remote file is still a real deletion');
});

// ---------------------------------------------------------------------------
// The engine's side of it
// ---------------------------------------------------------------------------

test('the engine keys its cached base to a destination', () => {
  assert.match(engine, /function destinationKey\(cfg\)/,
    'nothing identifies which destination the cached merge base belongs to');
  assert.match(engine, /cfg\.provider[\s\S]{0,80}cfg\.baseUrl[\s\S]{0,80}cfg\.syncName/,
    'the destination key must cover the sync method, the server URL and the sync name');
  assert.match(bmConfig, /cacheKey: 'sl\.bm\.cacheKey'/, 'the key is not persisted with the cache');
  assert.match(engine, /cacheKey: key/, 'the key is not written back after a successful sync');
});

test('the engine refuses a base from another destination, or with no remote file', () => {
  assert.match(engine, /const staleBase = state\.cacheKey !== key/,
    'a base from a different destination is still being trusted');
  assert.match(engine, /const noRemoteYet = !remoteRaw/,
    'a destination with no file yet is still being treated as "everything was deleted"');
  assert.match(engine, /const usableBase = \(staleBase \|\| noRemoteYet\) \? null : state\.cacheTree/,
    'the two guards are no longer what decides the merge base');
  // The same base must not sneak back in through the mtime stamping.
  assert.match(engine, /readBrowserTree\(state\.stableToLocal, usableBase\)/,
    'readBrowserTree is still being handed the unchecked cached tree');
  assert.match(engine, /threeWayMerge\(usableBase,/, 'the merge is not using the checked base');
});

// ---------------------------------------------------------------------------
// The safety brake
// ---------------------------------------------------------------------------
//
// The destination key above fixes one cause. The brake is there for the next
// one: it judges the outcome — how much of what is in the browser a sync is
// about to delete — rather than trying to enumerate the ways that can happen.

test('the brake ignores small collections and ordinary tidying', async () => {
  const { deletionLooksWrong, BRAKE_MIN_BOOKMARKS } = await import('../bookmarks/lib/engine.js');

  // Too few to be worth guarding, and too easy to delete on purpose.
  assert.equal(deletionLooksWrong(5, 0), false);
  assert.equal(deletionLooksWrong(BRAKE_MIN_BOOKMARKS - 1, 0), false);

  // Real deletions people make: a clear-out that keeps a decent share.
  assert.equal(deletionLooksWrong(100, 90), false, 'deleting 10 of 100 is housekeeping');
  assert.equal(deletionLooksWrong(100, 50), false, 'deleting half is drastic but plausible');
  assert.equal(deletionLooksWrong(100, 21), false, 'just above the line still goes through');

  // Nothing removed, or things added: never the brake's business.
  assert.equal(deletionLooksWrong(100, 100), false);
  assert.equal(deletionLooksWrong(100, 140), false);
});

test('the brake catches the shape every data-loss bug here has had', async () => {
  const { deletionLooksWrong } = await import('../bookmarks/lib/engine.js');

  assert.equal(deletionLooksWrong(400, 0), true, 'the reported wipe');
  assert.equal(deletionLooksWrong(20, 0), true, 'the smallest collection it guards');
  assert.equal(deletionLooksWrong(100, 19), true, 'keeping under a fifth is not tidying');
});

test('the brake stops the sync without changing either copy, and can be lifted', async () => {
  const engine = readFileSync(new URL('../bookmarks/lib/engine.js', import.meta.url), 'utf8');

  // It must sit between the merge and both writes — applying locally or
  // pushing first would defeat the entire point.
  const brakeAt = engine.indexOf('deletionLooksWrong(had, keeps)');
  assert.ok(brakeAt > 0, 'the brake is not called in runSync');
  assert.ok(brakeAt < engine.indexOf('await applyTree('), 'the brake must come before the local write');
  assert.ok(brakeAt < engine.indexOf('await putRemote('), 'the brake must come before the remote write');

  assert.match(engine, /status: 'blocked'/, 'a blocked sync must be distinguishable from a failed one');
  assert.match(engine, /blockedDeletion: \{ at: Date\.now\(\), had, keeps \}/,
    'nothing records what was blocked, so no UI can offer a way out');
  assert.match(engine, /blockedDeletion: null/, 'a good sync must clear the block');
  assert.match(engine, /allowLargeDeletion = false/, 'there is no way to accept a deletion that is real');

  const opts = readFileSync(new URL('../options.js', import.meta.url), 'utf8');
  assert.match(opts, /type: 'bmOverwrite'/, 'Options offers no way to keep the local bookmarks');
  assert.match(opts, /allowLargeDeletion: true/, 'Options offers no way to accept the deletion');
});
