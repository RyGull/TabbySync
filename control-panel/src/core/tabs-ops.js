// tabs-ops.js — add/remove/move/copy over a saved-tabs state object.
//
// Builds on the vendored tabs/storage.js's own group helpers (makeGroup,
// touchGroup, removeGroup, trash*, compareGroups) rather than re-deriving
// them, so a list created or deleted here merges exactly the way the
// extension expects (same tombstone shape in `deleted`, same trash-entry
// shape, same last-write-wins field: `updatedAt`).
//
// Every op is a pure function: clone the state, mutate the clone, return
// { state, ... }. Whenever a change should survive being merged against a
// remote copy that hasn't seen it yet, the touched group's `updatedAt` is
// bumped — see reorderLists' doc comment for why that includes reordering.
//
// Call loadVendored() (provider-shim.js) once at startup before using any of
// these — see getVendored()'s own note.
'use strict';

import { getVendored } from './provider-shim.js';

function ts() {
  return getVendored().TabbySync;
}

function cloneState(state) {
  return JSON.parse(JSON.stringify(state));
}

/**
 * Marks a group touched, guaranteeing its updatedAt strictly advances past
 * whatever it already was — not just "the current time".
 *
 * Why: mergeStates() (vendored, unmodified — see tabs/storage.js) resolves a
 * same-id conflict by updatedAt, and ties go to whichever side it happens to
 * consider second (the remote copy — see its own `consider()` helper). A
 * plain touchGroup() sets updatedAt to Date.now(), which is only
 * millisecond-resolution: an edit made right after loading a group can land
 * on the exact same millisecond that group already carries from its last
 * save, and remote-side.save()'s own fresh pull would then hand back that
 * same, older value for the tie-break to favor — silently discarding the
 * edit that was just made. Real interactive use is not fast enough to hit
 * this (typing, clicking and a network round trip all take much longer than
 * 1ms), but a cross-profile copy/move, which can load, mutate and save
 * again in the same tick, can. Forcing strictly-greater-than-before removes
 * the tie in the one case that matters — nothing here changes the wire
 * format or vendored merge algorithm, just which timestamp this app hands
 * it.
 */
function touch(g) {
  const prev = g.updatedAt || 0;
  ts().touchGroup(g);
  if (g.updatedAt <= prev) g.updatedAt = prev + 1;
}

function requireGroup(state, id) {
  const g = state.groups.find((x) => x.id === id);
  if (!g) throw new Error(`No such list: ${id}`);
  return g;
}

export function emptyState() {
  return ts().emptyState();
}

export function addList(state, { name, tabs } = {}) {
  const next = cloneState(state);
  const group = ts().makeGroup(tabs || [], name || '');
  next.groups.unshift(group);
  return { state: next, id: group.id };
}

export function renameList(state, id, name) {
  const next = cloneState(state);
  const g = requireGroup(next, id);
  g.name = name || '';
  touch(g);
  return { state: next };
}

export function setLocked(state, id, locked) {
  const next = cloneState(state);
  const g = requireGroup(next, id);
  g.locked = !!locked;
  touch(g);
  return { state: next };
}

export function setPinned(state, id, pinned) {
  const next = cloneState(state);
  const g = requireGroup(next, id);
  g.pinned = !!pinned;
  touch(g);
  return { state: next };
}

/** Deletes a list. Refuses a locked list (mirrors the extension's own popup/tab-list UI) — unlock it first. Goes to `state.trash` unless `toTrash:false`. */
export function removeList(state, id, { toTrash = true } = {}) {
  const T = ts();
  const next = cloneState(state);
  const g = requireGroup(next, id);
  if (g.locked) throw new Error(`"${g.name || 'Untitled list'}" is locked — unlock it before deleting.`);
  if (toTrash) T.trashAdd(next, [{ kind: 'group', name: g.name, tabs: g.tabs }]);
  T.removeGroup(next, id);
  return { state: next };
}

export function duplicateList(state, id, { name } = {}) {
  const next = cloneState(state);
  const g = requireGroup(next, id);
  const copy = ts().makeGroup(g.tabs, name || `${g.name || 'Untitled list'} (copy)`);
  next.groups.unshift(copy);
  return { state: next, id: copy.id };
}

/**
 * Assigns explicit, sequential `order` to every list per `orderedIds` (must
 * list every list id exactly once), then re-sorts by the same rule the
 * extension displays with (pinned first, then by order). Bumps `updatedAt`
 * on any group whose order actually changed — order is merged exactly like
 * any other field (last-write-wins by updatedAt, see mergeStates), so a
 * reorder that doesn't bump it can quietly lose to a remote copy that
 * touched the group more recently for an unrelated reason.
 */
export function reorderLists(state, orderedIds) {
  const T = ts();
  const next = cloneState(state);
  const byId = new Map(next.groups.map((g) => [g.id, g]));
  const valid = orderedIds.length === next.groups.length && orderedIds.every((id) => byId.has(id));
  if (!valid) throw new Error('reorderLists() must list every list id exactly once.');
  orderedIds.forEach((id, i) => {
    const g = byId.get(id);
    if (g.order !== i) {
      g.order = i;
      touch(g);
    }
  });
  next.groups.sort(T.compareGroups);
  return { state: next };
}

export function addTab(state, groupId, { url, title, favIconUrl } = {}) {
  if (!url || !String(url).trim()) throw new Error('A tab needs a URL.');
  const next = cloneState(state);
  const g = requireGroup(next, groupId);
  g.tabs.push({ url, title: title || url, favIconUrl: favIconUrl || '' });
  touch(g);
  return { state: next };
}

export function removeTab(state, groupId, index) {
  const next = cloneState(state);
  const g = requireGroup(next, groupId);
  if (index < 0 || index >= g.tabs.length) throw new Error('No such tab at that position.');
  const [removed] = g.tabs.splice(index, 1);
  touch(g);
  return { state: next, removed };
}

/**
 * Like removeTab, but tolerant of the list having changed shape since
 * `index` was captured (used when removing after an async round trip, e.g.
 * the source side of a cross-profile move in sessions.js): removes the tab
 * at `index` only if its URL still matches `url`, otherwise falls back to
 * the first tab in the list with that URL. Throws if neither is found —
 * that tab is simply gone, which the caller should surface rather than
 * remove something else by mistake.
 */
export function removeTabMatching(state, groupId, { url, index } = {}) {
  const next = cloneState(state);
  const g = requireGroup(next, groupId);
  const idx = (typeof index === 'number' && g.tabs[index] && g.tabs[index].url === url)
    ? index
    : g.tabs.findIndex((t) => t.url === url);
  if (idx < 0) throw new Error('That tab is no longer in this list — it may already have been moved or removed.');
  const [removed] = g.tabs.splice(idx, 1);
  touch(g);
  return { state: next, removed };
}

/**
 * Moves one tab between lists (or within one — pass the same id for both).
 * `toIndex` is a splice() index into the destination's post-removal tabs
 * array; omit it to append. Moving within the same list needs the same
 * off-by-one care as bookmarks-ops.js's moveNode.
 */
export function moveTab(state, fromGroupId, fromIndex, toGroupId, toIndex) {
  const next = cloneState(state);
  const from = requireGroup(next, fromGroupId);
  const to = requireGroup(next, toGroupId);
  if (fromIndex < 0 || fromIndex >= from.tabs.length) throw new Error('No such tab at that position.');
  const [moved] = from.tabs.splice(fromIndex, 1);
  touch(from);
  const insertAt = (typeof toIndex === 'number' && toIndex >= 0 && toIndex <= to.tabs.length) ? toIndex : to.tabs.length;
  to.tabs.splice(insertAt, 0, moved);
  touch(to);
  return { state: next };
}

/** Like moveTab, but leaves the original where it is and inserts a copy. */
export function copyTab(state, fromGroupId, fromIndex, toGroupId, toIndex) {
  const next = cloneState(state);
  const from = requireGroup(next, fromGroupId);
  const to = requireGroup(next, toGroupId);
  const tab = from.tabs[fromIndex];
  if (!tab) throw new Error('No such tab at that position.');
  const insertAt = (typeof toIndex === 'number' && toIndex >= 0 && toIndex <= to.tabs.length) ? toIndex : to.tabs.length;
  to.tabs.splice(insertAt, 0, { ...tab });
  touch(to);
  return { state: next };
}

/** Recreates a trashed list as a new list (fresh id — see tabs/storage.js's own note on why restore never reuses the old one), and clears its trash entry. */
export function restoreFromTrash(state, tid) {
  const T = ts();
  const next = cloneState(state);
  const entry = (next.trash || []).find((e) => e.tid === tid);
  if (!entry) throw new Error(`No such trash entry: ${tid}`);
  const group = T.makeGroup(entry.tabs || [], entry.name || '');
  next.groups.unshift(group);
  T.trashRemove(next, tid);
  return { state: next, id: group.id };
}

export function emptyTrash(state) {
  const next = cloneState(state);
  ts().trashEmpty(next);
  return { state: next };
}
