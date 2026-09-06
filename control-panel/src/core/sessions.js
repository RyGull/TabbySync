// sessions.js — the in-memory working copy of each open profile's bookmarks
// and saved tabs, sitting between the IPC layer (main.cjs) and the pure ops
// (bookmarks-ops.js / tabs-ops.js) + remote load/save (remote-bookmarks.js /
// remote-tabs.js).
//
// Local edits (add/remove/move/copy/rename) never touch the network — they
// mutate this in-memory copy instantly, which is what makes the UI feel
// immediate. A profile's tree/state is only ever written to its remote
// destination when save() is called explicitly, so an editing session never
// hammers a self-hosted server or a free provider's rate limit on every
// click.
//
// Every operation that touches a given profile's working copy — a local
// edit, a load, or a save — is funneled through that profile's own queue
// (enqueue()), even the synchronous ones. That is what stops a click that
// lands mid-save from being silently overwritten the moment the save
// resolves and replaces the whole working-copy record (see the module
// comment in profile-store.js for the same pattern applied to disk writes).
'use strict';

import { findNode } from '../../vendor/bookmarks-lib/tree.js';
import * as remoteBookmarks from './remote-bookmarks.js';
import * as remoteTabs from './remote-tabs.js';
import * as bmOps from './bookmarks-ops.js';
import * as tabOps from './tabs-ops.js';

export function createSessionManager(profileStore) {
  /** @type {Map<string, {bookmarks: object|null, tabs: object|null, queue: Promise}>} */
  const sessions = new Map();

  function sessionFor(id) {
    let s = sessions.get(id);
    if (!s) {
      s = { bookmarks: null, tabs: null, queue: Promise.resolve() };
      sessions.set(id, s);
    }
    return s;
  }

  function enqueue(profileId, fn) {
    const s = sessionFor(profileId);
    const result = s.queue.then(fn);
    s.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async function requireProfile(id) {
    const p = await profileStore.get(id);
    if (!p) throw new Error(`No such profile: ${id}`);
    return p;
  }

  function requireBookmarksLoaded(profileId) {
    const s = sessionFor(profileId);
    if (!s.bookmarks) throw new Error('Bookmarks not loaded for this profile yet.');
    return s;
  }
  function requireTabsLoaded(profileId) {
    const s = sessionFor(profileId);
    if (!s.tabs) throw new Error('Saved tabs not loaded for this profile yet.');
    return s;
  }

  // ---- bookmarks ------------------------------------------------------

  function loadBookmarks(profileId, { force = false } = {}) {
    return enqueue(profileId, async () => {
      const s = sessionFor(profileId);
      if (s.bookmarks && !force) return { tree: s.bookmarks.tree, dirty: s.bookmarks.dirty };
      const profile = await requireProfile(profileId);
      const { tree } = await remoteBookmarks.load(profile);
      s.bookmarks = { tree, baseline: tree, dirty: false, loadedAt: Date.now() };
      return { tree, dirty: false };
    });
  }

  /** `fn` is one of bookmarks-ops.js's functions, applied with `tree` already bound as the first argument. */
  function applyBookmarkOp(profileId, fn) {
    return enqueue(profileId, async () => {
      const s = requireBookmarksLoaded(profileId);
      const out = fn(s.bookmarks.tree);
      s.bookmarks.tree = out.tree;
      s.bookmarks.dirty = true;
      return { tree: out.tree, dirty: true, extra: out };
    });
  }

  function saveBookmarks(profileId, opts) {
    return enqueue(profileId, async () => {
      const s = requireBookmarksLoaded(profileId);
      const profile = await requireProfile(profileId);
      const { tree, stats } = await remoteBookmarks.save(profile, s.bookmarks.tree, s.bookmarks.baseline, opts);
      s.bookmarks = { tree, baseline: tree, dirty: false, loadedAt: Date.now() };
      return { tree, dirty: false, stats };
    });
  }

  function discardBookmarks(profileId) {
    return loadBookmarks(profileId, { force: true });
  }

  // ---- saved tabs -------------------------------------------------------

  function loadTabs(profileId, { force = false } = {}) {
    return enqueue(profileId, async () => {
      const s = sessionFor(profileId);
      if (s.tabs && !force) return { state: s.tabs.state, dirty: s.tabs.dirty };
      const profile = await requireProfile(profileId);
      const { state } = await remoteTabs.load(profile);
      s.tabs = { state, dirty: false, loadedAt: Date.now() };
      return { state, dirty: false };
    });
  }

  function applyTabsOp(profileId, fn) {
    return enqueue(profileId, async () => {
      const s = requireTabsLoaded(profileId);
      const out = fn(s.tabs.state);
      s.tabs.state = out.state;
      s.tabs.dirty = true;
      return { state: out.state, dirty: true, extra: out };
    });
  }

  function saveTabs(profileId) {
    return enqueue(profileId, async () => {
      const s = requireTabsLoaded(profileId);
      const profile = await requireProfile(profileId);
      const { state } = await remoteTabs.save(profile, s.tabs.state);
      s.tabs = { state, dirty: false, loadedAt: Date.now() };
      return { state, dirty: false };
    });
  }

  function discardTabs(profileId) {
    return loadTabs(profileId, { force: true });
  }

  // ---- status / cleanup ---------------------------------------------------

  function status(profileId) {
    const s = sessionFor(profileId);
    return {
      bookmarksLoaded: !!s.bookmarks,
      bookmarksDirty: !!(s.bookmarks && s.bookmarks.dirty),
      tabsLoaded: !!s.tabs,
      tabsDirty: !!(s.tabs && s.tabs.dirty),
    };
  }

  function dropSession(profileId) {
    sessions.delete(profileId);
  }

  // ---- cross-profile copy/move — the point of having "one roof" -----------
  //
  // Copy always fetches the TARGET fresh from its own remote (or reuses an
  // already-open, possibly-edited session for it, never a stale one it
  // doesn't have) right before inserting, so it can never clobber changes
  // made to the target from elsewhere. Move is copy-then-remove-from-source:
  // if the removal step fails after the copy already succeeded, the item now
  // exists in both places, and that is reported as an explicit error
  // (code: 'MOVE_PARTIAL') rather than a silent, invisible duplicate.

  async function ensureBookmarksSession(profileId) {
    const s = sessionFor(profileId);
    if (!s.bookmarks) {
      const profile = await requireProfile(profileId);
      const { tree } = await remoteBookmarks.load(profile);
      s.bookmarks = { tree, baseline: tree, dirty: false, loadedAt: Date.now() };
    }
    return s;
  }
  async function ensureTabsSession(profileId) {
    const s = sessionFor(profileId);
    if (!s.tabs) {
      const profile = await requireProfile(profileId);
      const { state } = await remoteTabs.load(profile);
      s.tabs = { state, dirty: false, loadedAt: Date.now() };
    }
    return s;
  }

  function copyBookmarkToProfile(sourceProfileId, nodeId, targetProfileId, targetParentId) {
    return (async () => {
      const node = await enqueue(sourceProfileId, async () => {
        const s = requireBookmarksLoaded(sourceProfileId);
        const found = findNode(s.bookmarks.tree, nodeId);
        if (!found) throw new Error('That bookmark/folder no longer exists in the source profile — reload it and try again.');
        return found;
      });
      return enqueue(targetProfileId, async () => {
        const targetProfile = await requireProfile(targetProfileId);
        const targetSession = await ensureBookmarksSession(targetProfileId);
        const { tree, id } = bmOps.insertClone(targetSession.bookmarks.tree, node, targetParentId);
        targetSession.bookmarks.tree = tree;
        targetSession.bookmarks.dirty = true;
        const saved = await remoteBookmarks.save(targetProfile, targetSession.bookmarks.tree, targetSession.bookmarks.baseline);
        targetSession.bookmarks = { tree: saved.tree, baseline: saved.tree, dirty: false, loadedAt: Date.now() };
        return { targetTree: saved.tree, newId: id };
      });
    })();
  }

  async function moveBookmarkToProfile(sourceProfileId, nodeId, targetProfileId, targetParentId) {
    const copyResult = await copyBookmarkToProfile(sourceProfileId, nodeId, targetProfileId, targetParentId);
    try {
      await enqueue(sourceProfileId, async () => {
        const s = requireBookmarksLoaded(sourceProfileId);
        const out = bmOps.removeNode(s.bookmarks.tree, nodeId);
        s.bookmarks.tree = out.tree;
        s.bookmarks.dirty = true;
        const sourceProfile = await requireProfile(sourceProfileId);
        const saved = await remoteBookmarks.save(sourceProfile, s.bookmarks.tree, s.bookmarks.baseline);
        s.bookmarks = { tree: saved.tree, baseline: saved.tree, dirty: false, loadedAt: Date.now() };
      });
      return { ...copyResult, sourceRemoved: true };
    } catch (e) {
      const err = new Error(
        `Copied to the target profile, but couldn't remove it from the source profile: ${e.message} ` +
        `It now exists in BOTH profiles — remove it from the source once the problem is fixed.`
      );
      err.code = 'MOVE_PARTIAL';
      err.cause = e;
      throw err;
    }
  }

  function copyListToProfile(sourceProfileId, listId, targetProfileId) {
    return (async () => {
      const group = await enqueue(sourceProfileId, async () => {
        const s = requireTabsLoaded(sourceProfileId);
        const g = s.tabs.state.groups.find((x) => x.id === listId);
        if (!g) throw new Error('That list no longer exists in the source profile — reload it and try again.');
        return g;
      });
      return enqueue(targetProfileId, async () => {
        const targetProfile = await requireProfile(targetProfileId);
        const targetSession = await ensureTabsSession(targetProfileId);
        const out = tabOps.addList(targetSession.tabs.state, { name: group.name, tabs: group.tabs });
        targetSession.tabs.state = out.state;
        targetSession.tabs.dirty = true;
        const saved = await remoteTabs.save(targetProfile, targetSession.tabs.state);
        targetSession.tabs = { state: saved.state, dirty: false, loadedAt: Date.now() };
        return { targetState: saved.state, newId: out.id };
      });
    })();
  }

  async function moveListToProfile(sourceProfileId, listId, targetProfileId) {
    const copyResult = await copyListToProfile(sourceProfileId, listId, targetProfileId);
    try {
      await enqueue(sourceProfileId, async () => {
        const s = requireTabsLoaded(sourceProfileId);
        const out = tabOps.removeList(s.tabs.state, listId, { toTrash: true });
        s.tabs.state = out.state;
        s.tabs.dirty = true;
        const sourceProfile = await requireProfile(sourceProfileId);
        const saved = await remoteTabs.save(sourceProfile, s.tabs.state);
        s.tabs = { state: saved.state, dirty: false, loadedAt: Date.now() };
      });
      return { ...copyResult, sourceRemoved: true };
    } catch (e) {
      const err = new Error(
        `Copied to the target profile, but couldn't remove the list from the source profile: ${e.message} ` +
        `It now exists in BOTH profiles — remove it from the source once the problem is fixed.`
      );
      err.code = 'MOVE_PARTIAL';
      err.cause = e;
      throw err;
    }
  }

  /** targetListId: an existing list id on the target, or falsy to create a new one named targetListName. */
  function copyTabToProfile(sourceProfileId, listId, tabIndex, targetProfileId, targetListId, targetListName) {
    return (async () => {
      const tab = await enqueue(sourceProfileId, async () => {
        const s = requireTabsLoaded(sourceProfileId);
        const g = s.tabs.state.groups.find((x) => x.id === listId);
        const t = g && g.tabs[tabIndex];
        if (!t) throw new Error('That tab no longer exists in the source profile — reload it and try again.');
        return t;
      });
      return enqueue(targetProfileId, async () => {
        const targetProfile = await requireProfile(targetProfileId);
        const targetSession = await ensureTabsSession(targetProfileId);
        let working = targetSession.tabs.state;
        let destListId = targetListId;
        if (!destListId) {
          const added = tabOps.addList(working, { name: targetListName || 'From another profile' });
          working = added.state;
          destListId = added.id;
        }
        const out = tabOps.addTab(working, destListId, tab);
        targetSession.tabs.state = out.state;
        targetSession.tabs.dirty = true;
        const saved = await remoteTabs.save(targetProfile, targetSession.tabs.state);
        targetSession.tabs = { state: saved.state, dirty: false, loadedAt: Date.now() };
        return { targetState: saved.state, listId: destListId };
      });
    })();
  }

  async function moveTabToProfile(sourceProfileId, listId, tabIndex, targetProfileId, targetListId, targetListName) {
    const tabUrl = await enqueue(sourceProfileId, async () => {
      const s = requireTabsLoaded(sourceProfileId);
      const g = s.tabs.state.groups.find((x) => x.id === listId);
      const t = g && g.tabs[tabIndex];
      if (!t) throw new Error('That tab no longer exists in the source profile — reload it and try again.');
      return t.url;
    });
    const copyResult = await copyTabToProfile(sourceProfileId, listId, tabIndex, targetProfileId, targetListId, targetListName);
    try {
      await enqueue(sourceProfileId, async () => {
        const s = requireTabsLoaded(sourceProfileId);
        const out = tabOps.removeTabMatching(s.tabs.state, listId, { url: tabUrl, index: tabIndex });
        s.tabs.state = out.state;
        s.tabs.dirty = true;
        const sourceProfile = await requireProfile(sourceProfileId);
        const saved = await remoteTabs.save(sourceProfile, s.tabs.state);
        s.tabs = { state: saved.state, dirty: false, loadedAt: Date.now() };
      });
      return { ...copyResult, sourceRemoved: true };
    } catch (e) {
      const err = new Error(
        `Copied to the target profile, but couldn't remove it from the source profile: ${e.message} ` +
        `It now exists in BOTH profiles — remove it from the source once the problem is fixed.`
      );
      err.code = 'MOVE_PARTIAL';
      err.cause = e;
      throw err;
    }
  }

  return {
    loadBookmarks, applyBookmarkOp, saveBookmarks, discardBookmarks,
    loadTabs, applyTabsOp, saveTabs, discardTabs,
    status, dropSession,
    copyBookmarkToProfile, moveBookmarkToProfile,
    copyListToProfile, moveListToProfile,
    copyTabToProfile, moveTabToProfile,
  };
}
