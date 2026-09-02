// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// merge.test.js — behaviour of the three-way bookmark merge.
//
// The tests are grouped by the question they answer, and the first group is
// the one that matters most: under what circumstances can a bookmark that
// exists on one of your machines fail to exist after a sync?

import test from 'node:test';
import assert from 'node:assert/strict';

import { threeWayMerge } from '../bookmarks/lib/merge.js';
import {
  bm, folder, tree, ids, urls, node, parentOf, order, rng,
  BAR_ID, OTHER_ID,
} from './helpers.js';

const A = 'https://a.example/';
const B = 'https://b.example/';
const C = 'https://c.example/';

// ---------------------------------------------------------------------------
// 1. Data loss — the properties that must never break
// ---------------------------------------------------------------------------

test('first sync (no base) unions both sides and deletes nothing', () => {
  const local = tree([bm('a', 'A', A)]);
  const remote = tree([bm('b', 'B', B)]);

  const out = threeWayMerge(null, local, remote);

  assert.deepEqual(ids(out), ['a', 'b']);
  assert.deepEqual(urls(out), [A, B].sort());
});

test('first sync cannot delete even when the two sides share nothing', () => {
  const local = tree(
    [bm('l1', 'L1', A), folder('lf', 'Local folder', [bm('l2', 'L2', B)])],
    [bm('l3', 'L3', C)],
  );
  const remote = tree([bm('r1', 'R1', 'https://r1.example/')], []);

  const out = threeWayMerge(null, local, remote);

  // Every URL from both sides survives.
  assert.deepEqual(urls(out), [A, B, C, 'https://r1.example/'].sort());
  assert.ok(node(out, 'lf'), 'the local folder survives');
});

test('a lost or corrupted base degrades to a union, never to deletion', () => {
  // If the last-synced snapshot goes missing, the engine falls back to an
  // empty base. That must produce duplicates at worst — not data loss.
  const local = tree([bm('a', 'A', A)]);
  const remote = tree([bm('b', 'B', B)]);

  const withBase = threeWayMerge(tree([bm('a', 'A', A), bm('b', 'B', B)]), local, remote);
  const noBase = threeWayMerge(undefined, local, remote);

  // With a real base, this reads as "each side deleted one" -> both go.
  assert.deepEqual(ids(withBase), []);
  // With the base gone, nothing is deleted.
  assert.deepEqual(ids(noBase), ['a', 'b']);
});

test('an edited bookmark survives its folder being deleted elsewhere', () => {
  const base = tree([folder('F', 'F', [bm('a', 'A', A)])]);
  const local = tree([folder('F', 'F', [bm('a', 'A edited', A, 9)])]);
  const remote = tree([]); // whole folder deleted on the other machine

  const out = threeWayMerge(base, local, remote);

  assert.ok(node(out, 'a'), 'the edited bookmark is not lost with its folder');
  assert.equal(node(out, 'a').title, 'A edited');
  // Its parent is gone, so it is reattached rather than dropped.
  assert.equal(parentOf(out, 'a'), OTHER_ID);
});

test('a move cycle is broken by reattaching, not by discarding', () => {
  // Local moves F2 into F1; remote moves F1 into F2. Naively applied that is
  // an unreachable loop — both folders would vanish from the tree.
  const base = tree([folder('F1', 'F1'), folder('F2', 'F2')]);
  const local = tree([folder('F1', 'F1', [folder('F2', 'F2', [], 5)], 5)]);
  const remote = tree([folder('F2', 'F2', [folder('F1', 'F1', [], 5)], 5)]);

  const out = threeWayMerge(base, local, remote);

  // Both folders still exist, and every node is reachable from the root --
  // the cycle is broken by reattaching the minimum, not by dropping either
  // side. Here F1 is lifted to "other" and F2 stays nested inside it.
  assert.deepEqual(ids(out), ['F1', 'F2']);
  assert.equal(parentOf(out, 'F1'), OTHER_ID);
  assert.equal(parentOf(out, 'F2'), 'F1');
});

test('every merged tree is acyclic and fully reachable from the root', () => {
  const cases = [
    // a move cycle
    [tree([folder('F1', 'F1'), folder('F2', 'F2')]),
     tree([folder('F1', 'F1', [folder('F2', 'F2', [], 5)], 5)]),
     tree([folder('F2', 'F2', [folder('F1', 'F1', [], 5)], 5)])],
    // an item whose parent folder was deleted on the other side
    [tree([folder('F', 'F', [bm('a', 'A', A)])]),
     tree([folder('F', 'F', [bm('a', 'A edited', A, 9)])]),
     tree([])],
    // deep nesting moved in opposite directions
    [tree([folder('P', 'P', [folder('Q', 'Q', [bm('a', 'A', A)])])]),
     tree([folder('Q', 'Q', [folder('P', 'P', [], 7)], 7)]),
     tree([folder('P', 'P', [folder('Q', 'Q', [bm('a', 'A', A)], 3)], 3)])],
  ];

  for (const [base, local, remote] of cases) {
    const out = threeWayMerge(base, local, remote);
    const seen = new Set();
    const visit = (n, depth) => {
      assert.ok(depth < 50, 'no runaway nesting');
      assert.equal(seen.has(n.id), false, `${n.id} appears twice`);
      seen.add(n.id);
      for (const c of n.children || []) visit(c, depth + 1);
    };
    visit(out, 0); // throws if a node is unreachable, duplicated, or looping
  }
});

test('a type conflict keeps the folder, so its subtree is not dropped', () => {
  // Same id is a folder here and a bookmark there. Preferring the folder
  // costs one URL; preferring the bookmark would cost the whole subtree.
  const local = tree([folder('x', 'X', [bm('c', 'C', C)])]);
  const remote = tree([bm('x', 'X', 'https://x.example/')]);

  const out = threeWayMerge(null, local, remote);

  assert.equal(node(out, 'x').type, 'folder');
  assert.ok(node(out, 'c'), 'the subtree under the folder survives');
  assert.equal(parentOf(out, 'c'), 'x');
});

test('no-base merges never lose a URL, over many generated shapes', () => {
  const rand = rng(20260902);
  for (let round = 0; round < 200; round++) {
    const mk = (prefix) => {
      const n = 1 + Math.floor(rand() * 5);
      const kids = [];
      for (let i = 0; i < n; i++) {
        const id = `${prefix}${i}`;
        kids.push(rand() < 0.3
          ? folder(id, `F${id}`, [bm(`${id}b`, 'B', `https://${id}.example/`)])
          : bm(id, `B${id}`, `https://${id}.example/`));
      }
      return kids;
    };
    const local = tree(mk('l'), mk('m'));
    const remote = tree(mk('r'), mk('s'));
    const expected = new Set([...urls(local), ...urls(remote)]);

    const out = threeWayMerge(null, local, remote);

    for (const u of expected) {
      assert.ok(urls(out).includes(u), `round ${round}: lost ${u}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 2. Deletions — propagating a real delete, without honouring a stale one
// ---------------------------------------------------------------------------

test('a delete propagates when the other side did not touch the item', () => {
  const base = tree([bm('a', 'A', A)]);
  const local = tree([bm('a', 'A', A)]);
  const remote = tree([]);

  assert.deepEqual(ids(threeWayMerge(base, local, remote)), []);
});

test('delete loses to a concurrent edit by default', () => {
  const base = tree([bm('a', 'A', A)]);
  const local = tree([bm('a', 'A edited', A, 9)]);
  const remote = tree([]);

  const out = threeWayMerge(base, local, remote);

  assert.deepEqual(ids(out), ['a']);
  assert.equal(node(out, 'a').title, 'A edited');
});

test('delete loses to a concurrent move by default', () => {
  const base = tree([bm('a', 'A', A)], []);
  const local = tree([], [bm('a', 'A', A)]); // moved to "other"
  const remote = tree([], []);               // deleted

  assert.deepEqual(ids(threeWayMerge(base, local, remote)), ['a']);
});

test('deleteWins:true lets the delete beat the edit', () => {
  const base = tree([bm('a', 'A', A)]);
  const local = tree([bm('a', 'A edited', A, 9)]);
  const remote = tree([]);

  assert.deepEqual(ids(threeWayMerge(base, local, remote, { deleteWins: true })), []);
});

test('deleteWins defaults to off when no options are passed', () => {
  const base = tree([bm('a', 'A', A)]);
  const local = tree([bm('a', 'A edited', A, 9)]);
  const remote = tree([]);

  assert.deepEqual(
    ids(threeWayMerge(base, local, remote)),
    ids(threeWayMerge(base, local, remote, { deleteWins: false })),
  );
});

test('deleting on both sides removes the item', () => {
  const base = tree([bm('a', 'A', A)]);
  assert.deepEqual(ids(threeWayMerge(base, tree([]), tree([]))), []);
});

// ---------------------------------------------------------------------------
// 3. Duplicate suppression
// ---------------------------------------------------------------------------

test('the same URL added independently on two devices merges into one node', () => {
  const local = tree([bm('local-1', 'A', A)]);
  const remote = tree([bm('remote-1', 'A', A)]);

  const out = threeWayMerge(null, local, remote);

  assert.equal(urls(out).length, 1, 'not duplicated');
  assert.deepEqual(ids(out), ['local-1'], 'unified onto the local id');
});

test('URLs differing only by trailing slash or case are treated as the same', () => {
  const local = tree([bm('local-1', 'A', 'https://Example.com/path/')]);
  const remote = tree([bm('remote-1', 'A', 'https://example.com/path')]);

  assert.equal(urls(threeWayMerge(null, local, remote)).length, 1);
});

test('a folder of the same name under the same parent merges rather than duplicating', () => {
  const local = tree([folder('lf', 'Recipes', [bm('a', 'A', A)])]);
  const remote = tree([folder('rf', 'Recipes', [bm('b', 'B', B)])]);

  const out = threeWayMerge(null, local, remote);

  assert.deepEqual(ids(out).filter((id) => node(out, id).type === 'folder'), ['lf']);
  assert.deepEqual(urls(out), [A, B].sort(), 'both folders’ contents kept');
});

// ---------------------------------------------------------------------------
// 4. Conflict resolution
// ---------------------------------------------------------------------------

test('when both sides edit, the later mtime wins', () => {
  const base = tree([bm('a', 'A', A)]);
  const local = tree([bm('a', 'local title', A, 5)]);
  const remote = tree([bm('a', 'remote title', A, 9)]);

  assert.equal(node(threeWayMerge(base, local, remote), 'a').title, 'remote title');
});

test('an edit on one side is taken even if the other side has a later mtime', () => {
  // Only local actually changed anything; remote just has a newer clock.
  const base = tree([bm('a', 'A', A)]);
  const local = tree([bm('a', 'edited', A, 2)]);
  const remote = tree([bm('a', 'A', A, 99)]);

  assert.equal(node(threeWayMerge(base, local, remote), 'a').title, 'edited');
});

test('a move on one side is applied', () => {
  const base = tree([bm('a', 'A', A)], []);
  const local = tree([], [bm('a', 'A', A)]);
  const remote = tree([bm('a', 'A', A)], []);

  assert.equal(parentOf(threeWayMerge(base, local, remote), 'a'), OTHER_ID);
});

test('folder ordering: the higher orderRev wins', () => {
  const base = tree([bm('a', 'A', A), bm('b', 'B', B)]);
  const local = tree([bm('a', 'A', A), bm('b', 'B', B)], [], 5);
  const remote = tree([bm('b', 'B', B), bm('a', 'A', A)], [], 2);

  assert.deepEqual(order(threeWayMerge(base, local, remote), BAR_ID), ['a', 'b']);
});

test('equal orderRev with different orders converges and bumps the rev', () => {
  const base = tree([bm('a', 'A', A), bm('b', 'B', B)]);
  const local = tree([bm('a', 'A', A), bm('b', 'B', B)], [], 3);
  const remote = tree([bm('b', 'B', B), bm('a', 'A', A)], [], 3);

  const out = threeWayMerge(base, local, remote);
  const swapped = threeWayMerge(base, remote, local);

  assert.deepEqual(order(out, BAR_ID), order(swapped, BAR_ID),
    'both machines pick the same winner');
  assert.equal(node(out, BAR_ID).orderRev, 4, 'rev bumped so it settles next round');
});

// ---------------------------------------------------------------------------
// 5. Purity and convergence
// ---------------------------------------------------------------------------

test('the inputs are not mutated', () => {
  const base = tree([bm('a', 'A', A)]);
  const local = tree([bm('a', 'A edited', A, 9), bm('b', 'B', B)]);
  const remote = tree([bm('a', 'A', A)]);

  const snap = [base, local, remote].map((t) => JSON.stringify(t));
  threeWayMerge(base, local, remote);

  assert.deepEqual([base, local, remote].map((t) => JSON.stringify(t)), snap);
});

test('merging is stable: running it again on its own output changes nothing', () => {
  const base = tree([bm('a', 'A', A)]);
  const local = tree([bm('a', 'A edited', A, 9), bm('b', 'B', B)]);
  const remote = tree([bm('a', 'A', A), bm('c', 'C', C)]);

  const once = threeWayMerge(base, local, remote);
  const twice = threeWayMerge(once, once, once);

  assert.deepEqual(ids(twice), ids(once));
  assert.deepEqual(urls(twice), urls(once));
});

test('both machines reach the same set of data regardless of which side is "local"', () => {
  const base = tree([bm('a', 'A', A)]);
  const local = tree([bm('a', 'A edited', A, 9), bm('b', 'B', B)]);
  const remote = tree([bm('a', 'A', A), bm('c', 'C', C)]);

  assert.deepEqual(
    urls(threeWayMerge(base, local, remote)),
    urls(threeWayMerge(base, remote, local)),
  );
});
