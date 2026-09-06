// preload.cjs — the only thing the renderer can reach into Node/Electron
// through. Runs with contextIsolation+sandbox on (see main.cjs's
// BrowserWindow config), so the renderer gets exactly the surface exposed
// here via contextBridge — no direct `require`, no raw ipcRenderer.
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

/** Invokes a main-process handler and unwraps main.cjs's {ok,data}/{ok:false,error} envelope back into a normal resolve/throw, so renderer code can just `await` and `try/catch` like anything else. */
async function call(channel, ...args) {
  const res = await ipcRenderer.invoke(channel, ...args);
  if (res && res.ok) return res.data;
  const err = new Error((res && res.error && res.error.message) || `${channel} failed`);
  if (res && res.error) Object.assign(err, res.error);
  throw err;
}

contextBridge.exposeInMainWorld('tabbysync', {
  app: {
    info: () => call('app:info'),
    openExternal: (url) => call('shell:openExternal', url),
  },

  profiles: {
    list: () => call('profiles:list'),
    get: (id) => call('profiles:get', id),
    add: (input) => call('profiles:add', input),
    update: (id, patch) => call('profiles:update', id, patch),
    remove: (id) => call('profiles:remove', id),
    duplicate: (id, overrides) => call('profiles:duplicate', id, overrides),
    reorder: (idsInOrder) => call('profiles:reorder', idsInOrder),
    sanitizeSyncName: (name) => call('profiles:sanitizeSyncName', name),
    meta: () => call('profiles:meta'),
    testConnection: (id) => call('profiles:testConnection', id),
    deleteRemoteData: (id) => call('profiles:deleteRemoteData', id),
  },

  bookmarks: {
    load: (profileId, opts) => call('bookmarks:load', profileId, opts),
    status: (profileId) => call('bookmarks:status', profileId),
    addBookmark: (profileId, args) => call('bookmarks:addBookmark', profileId, args),
    addFolder: (profileId, args) => call('bookmarks:addFolder', profileId, args),
    rename: (profileId, args) => call('bookmarks:rename', profileId, args),
    editUrl: (profileId, args) => call('bookmarks:editUrl', profileId, args),
    remove: (profileId, args) => call('bookmarks:remove', profileId, args),
    move: (profileId, args) => call('bookmarks:move', profileId, args),
    copy: (profileId, args) => call('bookmarks:copy', profileId, args),
    reorder: (profileId, args) => call('bookmarks:reorder', profileId, args),
    moveWithinParent: (profileId, args) => call('bookmarks:moveWithinParent', profileId, args),
    save: (profileId, opts) => call('bookmarks:save', profileId, opts),
    discard: (profileId) => call('bookmarks:discard', profileId),
    copyToProfile: (sourceId, nodeId, targetId, targetParentId) => call('bookmarks:copyToProfile', sourceId, nodeId, targetId, targetParentId),
    moveToProfile: (sourceId, nodeId, targetId, targetParentId) => call('bookmarks:moveToProfile', sourceId, nodeId, targetId, targetParentId),
    exportHtml: (profileId, tree) => call('bookmarks:exportHtml', profileId, tree),
    importHtml: (profileId, args) => call('bookmarks:importHtml', profileId, args),
  },

  tabs: {
    load: (profileId, opts) => call('tabs:load', profileId, opts),
    status: (profileId) => call('tabs:status', profileId),
    addList: (profileId, args) => call('tabs:addList', profileId, args),
    renameList: (profileId, args) => call('tabs:renameList', profileId, args),
    setLocked: (profileId, args) => call('tabs:setLocked', profileId, args),
    setPinned: (profileId, args) => call('tabs:setPinned', profileId, args),
    removeList: (profileId, args) => call('tabs:removeList', profileId, args),
    duplicateList: (profileId, args) => call('tabs:duplicateList', profileId, args),
    reorderLists: (profileId, args) => call('tabs:reorderLists', profileId, args),
    addTab: (profileId, args) => call('tabs:addTab', profileId, args),
    removeTab: (profileId, args) => call('tabs:removeTab', profileId, args),
    moveTab: (profileId, args) => call('tabs:moveTab', profileId, args),
    copyTab: (profileId, args) => call('tabs:copyTab', profileId, args),
    restoreFromTrash: (profileId, args) => call('tabs:restoreFromTrash', profileId, args),
    emptyTrash: (profileId) => call('tabs:emptyTrash', profileId),
    save: (profileId) => call('tabs:save', profileId),
    discard: (profileId) => call('tabs:discard', profileId),
    copyListToProfile: (sourceId, listId, targetId) => call('tabs:copyListToProfile', sourceId, listId, targetId),
    moveListToProfile: (sourceId, listId, targetId) => call('tabs:moveListToProfile', sourceId, listId, targetId),
    copyTabToProfile: (sourceId, listId, tabIndex, targetId, targetListId, targetListName) =>
      call('tabs:copyTabToProfile', sourceId, listId, tabIndex, targetId, targetListId, targetListName),
    moveTabToProfile: (sourceId, listId, tabIndex, targetId, targetListId, targetListName) =>
      call('tabs:moveTabToProfile', sourceId, listId, tabIndex, targetId, targetListId, targetListName),
  },
});
