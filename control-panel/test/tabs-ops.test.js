import test from 'node:test';
import assert from 'node:assert/strict';

import { loadVendored } from '../src/core/provider-shim.js';
import * as ops from '../src/core/tabs-ops.js';

await loadVendored(); // tabs-ops.js's getVendored() requires this to have run first

function tab(url, title) { return { url, title: title || url, favIconUrl: '' }; }

test('addList creates a group at the front with the given tabs', () => {
  const s0 = ops.emptyState();
  const { state: s1, id } = ops.addList(s0, { name: 'Reading', tabs: [tab('https://a/'), tab('https://b/')] });
  assert.equal(s1.groups.length, 1);
  assert.equal(s1.groups[0].id, id);
  assert.equal(s1.groups[0].name, 'Reading');
  assert.equal(s1.groups[0].tabs.length, 2);
  assert.equal(s0.groups.length, 0); // original untouched
});

test('addList allows an empty list (unlike the extension\'s own addGroup helper)', () => {
  const { state } = ops.addList(ops.emptyState(), { name: 'Empty' });
  assert.equal(state.groups[0].tabs.length, 0);
});

test('renameList / setLocked / setPinned update the field and bump updatedAt', () => {
  let s = ops.addList(ops.emptyState(), { name: 'X' });
  const id = s.id; s = s.state;
  const before = s.groups[0].updatedAt;
  const r1 = ops.renameList(s, id, 'Y'); s = r1.state;
  assert.equal(s.groups[0].name, 'Y');
  assert.ok(s.groups[0].updatedAt >= before);
  s = ops.setLocked(s, id, true).state;
  assert.equal(s.groups[0].locked, true);
  s = ops.setPinned(s, id, true).state;
  assert.equal(s.groups[0].pinned, true);
});

test('removeList tombstones the group and moves it to trash by default', () => {
  let s = ops.addList(ops.emptyState(), { name: 'Gone', tabs: [tab('https://a/')] });
  const id = s.id; s = s.state;
  const { state: s2 } = ops.removeList(s, id);
  assert.equal(s2.groups.length, 0);
  assert.ok(id in s2.deleted);
  assert.equal(s2.trash.length, 1);
  assert.equal(s2.trash[0].name, 'Gone');
  assert.equal(s2.trash[0].tabs.length, 1);
});

test('removeList with toTrash:false skips the trash but still tombstones', () => {
  let s = ops.addList(ops.emptyState(), { name: 'Gone' });
  const id = s.id; s = s.state;
  const { state: s2 } = ops.removeList(s, id, { toTrash: false });
  assert.equal(s2.trash.length, 0);
  assert.ok(id in s2.deleted);
});

test('removeList refuses a locked list', () => {
  let s = ops.addList(ops.emptyState(), { name: 'Locked' });
  const id = s.id; s = s.state;
  s = ops.setLocked(s, id, true).state;
  assert.throws(() => ops.removeList(s, id), /locked/);
});

test('duplicateList copies tabs under a new id and default "(copy)" name', () => {
  let s = ops.addList(ops.emptyState(), { name: 'Orig', tabs: [tab('https://a/')] });
  const id = s.id; s = s.state;
  const { state: s2, id: copyId } = ops.duplicateList(s, id);
  assert.notEqual(copyId, id);
  const copy = s2.groups.find((g) => g.id === copyId);
  assert.equal(copy.name, 'Orig (copy)');
  assert.equal(copy.tabs.length, 1);
  assert.equal(s2.groups.find((g) => g.id === id).tabs.length, 1); // original untouched
});

test('reorderLists assigns sequential order, re-sorts, and only bumps updatedAt for groups that actually moved', () => {
  let s = ops.emptyState();
  let a = ops.addList(s, { name: 'A' }); s = a.state;
  let b = ops.addList(s, { name: 'B' }); s = b.state;
  let c = ops.addList(s, { name: 'C' }); s = c.state;
  const idsInInsertOrder = [c.id, b.id, a.id]; // addList unshifts, so this is current order
  assert.deepEqual(s.groups.map((g) => g.id), idsInInsertOrder);

  const beforeA = s.groups.find((g) => g.id === a.id).updatedAt;
  const beforeC = s.groups.find((g) => g.id === c.id).updatedAt;

  const wanted = [a.id, b.id, c.id];
  const { state: s2 } = ops.reorderLists(s, wanted);
  assert.deepEqual(s2.groups.map((g) => g.id), wanted);
  // a.id moved (was last, now first) -> updatedAt bumped
  assert.ok(s2.groups.find((g) => g.id === a.id).updatedAt >= beforeA);
  // c.id also moved (was first, now last) -> bumped too
  assert.ok(s2.groups.find((g) => g.id === c.id).updatedAt >= beforeC);

  assert.throws(() => ops.reorderLists(s, [a.id, b.id]), /exactly once/);
});

test('addTab / removeTab', () => {
  let s = ops.addList(ops.emptyState(), { name: 'L' });
  const id = s.id; s = s.state;
  s = ops.addTab(s, id, { url: 'https://a/' }).state;
  assert.equal(s.groups[0].tabs.length, 1);
  assert.throws(() => ops.addTab(s, id, {}), /URL/);
  const { state: s2, removed } = ops.removeTab(s, id, 0);
  assert.equal(s2.groups[0].tabs.length, 0);
  assert.equal(removed.url, 'https://a/');
  assert.throws(() => ops.removeTab(s2, id, 0), /No such tab/);
});

test('editTab updates url and/or title, defaulting title to the new url when cleared', () => {
  let s = ops.addList(ops.emptyState(), { name: 'L', tabs: [tab('https://old/', 'Old title')] });
  const id = s.id; s = s.state;
  s = ops.editTab(s, id, 0, { url: 'https://new/' }).state;
  assert.equal(s.groups[0].tabs[0].url, 'https://new/');
  assert.equal(s.groups[0].tabs[0].title, 'Old title'); // untouched field survives
  s = ops.editTab(s, id, 0, { title: '' }).state;
  assert.equal(s.groups[0].tabs[0].title, 'https://new/'); // falls back to the url, like addTab does
  assert.throws(() => ops.editTab(s, id, 0, { url: '' }), /URL/);
  assert.throws(() => ops.editTab(s, id, 5, { title: 'x' }), /No such tab/);
});

test('moveTab moves a tab between two lists', () => {
  let s = ops.emptyState();
  const from = ops.addList(s, { name: 'From', tabs: [tab('https://x/')] }); s = from.state;
  const to = ops.addList(s, { name: 'To' }); s = to.state;
  const { state: s2 } = ops.moveTab(s, from.id, 0, to.id, 0);
  assert.equal(s2.groups.find((g) => g.id === from.id).tabs.length, 0);
  assert.equal(s2.groups.find((g) => g.id === to.id).tabs[0].url, 'https://x/');
});

test('moveTab reorders within the same list using post-removal index semantics', () => {
  let s = ops.addList(ops.emptyState(), { name: 'L', tabs: [tab('https://a/'), tab('https://b/'), tab('https://c/')] });
  const id = s.id; s = s.state;
  const { state: s2 } = ops.moveTab(s, id, 0, id, 2); // move "a" to the end
  assert.deepEqual(s2.groups[0].tabs.map((t) => t.url), ['https://b/', 'https://c/', 'https://a/']);
});

test('copyTab duplicates a tab into another list, leaving the source untouched', () => {
  let s = ops.emptyState();
  const from = ops.addList(s, { name: 'From', tabs: [tab('https://x/')] }); s = from.state;
  const to = ops.addList(s, { name: 'To' }); s = to.state;
  const { state: s2 } = ops.copyTab(s, from.id, 0, to.id);
  assert.equal(s2.groups.find((g) => g.id === from.id).tabs.length, 1);
  assert.equal(s2.groups.find((g) => g.id === to.id).tabs[0].url, 'https://x/');
});

test('removeTabMatching removes by index when the URL still matches, else falls back to a URL search', () => {
  let s = ops.addList(ops.emptyState(), { name: 'L', tabs: [tab('https://a/'), tab('https://b/')] });
  const id = s.id; s = s.state;
  // stale index (0) no longer points at 'https://b/' -> falls back to searching
  const { state: s2, removed } = ops.removeTabMatching(s, id, { url: 'https://b/', index: 0 });
  assert.equal(removed.url, 'https://b/');
  assert.deepEqual(s2.groups[0].tabs.map((t) => t.url), ['https://a/']);
  assert.throws(() => ops.removeTabMatching(s2, id, { url: 'https://gone/', index: 0 }), /no longer in this list/);
});

test('restoreFromTrash recreates a trashed list under a fresh id and clears the trash entry', () => {
  let s = ops.addList(ops.emptyState(), { name: 'Gone', tabs: [tab('https://a/')] });
  const origId = s.id; s = s.state;
  s = ops.removeList(s, origId).state;
  const tid = s.trash[0].tid;
  const { state: s2, id: restoredId } = ops.restoreFromTrash(s, tid);
  assert.notEqual(restoredId, origId);
  assert.equal(s2.groups.length, 1);
  assert.equal(s2.groups[0].name, 'Gone');
  assert.equal(s2.trash.length, 0);
});

test('emptyTrash clears every entry', () => {
  let s = ops.addList(ops.emptyState(), { name: 'Gone' });
  const id = s.id; s = s.state;
  s = ops.removeList(s, id).state;
  assert.equal(s.trash.length, 1);
  const { state: s2 } = ops.emptyTrash(s);
  assert.equal(s2.trash.length, 0);
});
