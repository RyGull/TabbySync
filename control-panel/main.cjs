// main.cjs — Electron main process.
//
// Plain CommonJS on purpose: Electron's main/preload story for
// contextIsolation + a sandboxed preload is best documented and most
// battle-tested as CJS. The actual application logic (src/core/*.js) is ES
// modules — loaded here via dynamic import(), which CJS supports natively.
'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Menu } = require('electron');

/** Wraps an IPC handler so thrown errors (with .code/.had/.keeps etc.) survive the trip to the renderer as data, not as Electron's own re-serialized Error (which drops custom properties). See preload.cjs's call() for the matching unwrap. */
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      const data = await fn(...args);
      return { ok: true, data };
    } catch (e) {
      return {
        ok: false,
        error: {
          message: (e && e.message) || String(e),
          code: e && e.code,
          had: e && e.had,
          keeps: e && e.keeps,
        },
      };
    }
  });
}

let mainWindow = null;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 860,
    minHeight: 560,
    title: 'TabbySync Control Panel',
    backgroundColor: '#1b1d23',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // This app never needs to navigate anywhere or open new windows — any
  // attempt (a bookmark's own link clicked from inside the app, say) should
  // open in the system browser instead of inside this one.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  // Surfaces renderer console output (including our own window.onerror hook
  // in app.js) in the main process's own log — the only place to see a
  // renderer crash when there is no DevTools window open to look at.
  mainWindow.webContents.on('console-message', (_event, _level, message, line, sourceId) => {
    console.log(`[renderer] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[renderer] process gone:', details);
  });

  await mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' },
        { role: 'togglefullscreen' },
        { label: 'Toggle Developer Tools', accelerator: isMac ? 'Alt+Cmd+I' : 'Ctrl+Shift+I', click: (_i, win) => win && win.webContents.toggleDevTools() },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'TabbySync on GitHub',
          click: () => shell.openExternal('https://github.com/RyGull/TabbySync'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function main() {
  app.setName('TabbySync Control Panel');
  await app.whenReady();
  buildMenu();

  const core = await loadCore();
  const userDataDir = app.getPath('userData');
  const secretsAvailable = safeStorage.isEncryptionAvailable();

  const profileStore = core.createProfileStore(userDataDir, {
    secretsAvailable,
    encrypt: secretsAvailable
      ? async (plain) => ({ dpapi: true, b64: safeStorage.encryptString(plain).toString('base64') })
      : undefined,
    decrypt: secretsAvailable
      ? async (stored) => safeStorage.decryptString(Buffer.from(stored.b64, 'base64'))
      : undefined,
  });

  await core.loadVendored(); // fail fast at startup rather than on the first click
  const sessions = core.createSessionManager(profileStore);

  registerIpc(core, profileStore, sessions, { secretsAvailable, userDataDir });

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // Dev-only smoke test hook (see control-panel/scripts/smoke-test.mjs) —
  // renders the real startup path, drives a few basic interactions, saves a
  // screenshot, then exits. Inert unless this exact env var is set.
  if (process.env.TABBYSYNC_SMOKE_TEST) {
    await runSmokeTest(mainWindow, core, profileStore);
  }
}

async function runSmokeTest(win, core, profileStore) {
  const outDir = process.env.TABBYSYNC_SMOKE_TEST;
  async function shot(name) {
    await new Promise((r) => setTimeout(r, 250));
    const img = await win.webContents.capturePage();
    await fs.writeFile(path.join(outDir, name), img.toPNG());
  }
  try {
    await shot('01-empty.png');
    const p = await profileStore.add({ label: 'Demo', provider: 'jsonbin', token: 'demo-token' });
    await win.webContents.executeJavaScript(`refreshProfiles().then(() => selectProfile(${JSON.stringify(p.id)}))`);
    await shot('02-profile-selected.png');
    await win.webContents.executeJavaScript(`openAddBookmarkModal('${core.BAR_ID}')`);
    await new Promise((r) => setTimeout(r, 200));
    await win.webContents.executeJavaScript(`document.querySelector('.modal-body input[type=url]').value = 'https://example.com'`);
    await win.webContents.executeJavaScript(`document.querySelector('.modal-footer .btn-primary').click()`);
    await shot('03-bookmark-added.png');
    await win.webContents.executeJavaScript(`document.querySelector('.tab-btn[data-panel=tabs]').click()`);
    await win.webContents.executeJavaScript(`openAddListModal()`);
    await new Promise((r) => setTimeout(r, 200));
    await win.webContents.executeJavaScript(`document.querySelector('.modal-body input[type=text]').value = 'Reading list'`);
    await win.webContents.executeJavaScript(`document.querySelector('.modal-footer .btn-primary').click()`);
    await shot('04-list-added.png');
    console.log('[smoke-test] done, screenshots in', outDir);
  } catch (e) {
    console.error('[smoke-test] FAILED:', e);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
}

async function loadCore() {
  const [
    profileStoreMod, sessionsMod, providerShimMod, bmOpsMod, tabOpsMod,
    remoteBookmarksMod, remoteTabsMod, cfgMapMod,
  ] = await Promise.all([
    import('./src/core/profile-store.js'),
    import('./src/core/sessions.js'),
    import('./src/core/provider-shim.js'),
    import('./src/core/bookmarks-ops.js'),
    import('./src/core/tabs-ops.js'),
    import('./src/core/remote-bookmarks.js'),
    import('./src/core/remote-tabs.js'),
    import('./src/core/cfg-map.js'),
  ]);
  const bookmarksIoMod = await import('./vendor/bookmarks-lib/bookmarks-io.js');
  const treeMod = await import('./vendor/bookmarks-lib/tree.js');
  return {
    createProfileStore: profileStoreMod.createProfileStore,
    createSessionManager: sessionsMod.createSessionManager,
    loadVendored: providerShimMod.loadVendored,
    getVendored: providerShimMod.getVendored,
    sanitizeSyncName: providerShimMod.sanitizeSyncName,
    bmOps: bmOpsMod,
    tabOps: tabOpsMod,
    remoteBookmarks: remoteBookmarksMod,
    remoteTabs: remoteTabsMod,
    fullCfgForDelete: cfgMapMod.fullCfgForDelete,
    bookmarksCfg: cfgMapMod.bookmarksCfg,
    tabsCfg: cfgMapMod.tabsCfg,
    buildHtml: bookmarksIoMod.buildHtml,
    parseNetscape: bookmarksIoMod.parseNetscape,
    treeStats: treeMod.stats,
    BAR_ID: treeMod.BAR_ID,
    OTHER_ID: treeMod.OTHER_ID,
  };
}

function registerIpc(core, profileStore, sessions, appMeta) {
  const { bmOps, tabOps } = core;

  // ---- app / profiles -----------------------------------------------------
  handle('app:info', async () => ({
    version: app.getVersion(),
    secretsAvailable: appMeta.secretsAvailable,
    profilesFile: profileStore.filePath,
    platform: process.platform,
  }));

  handle('profiles:list', () => profileStore.list());
  handle('profiles:get', (id) => profileStore.get(id));
  handle('profiles:add', (input) => profileStore.add(input));
  handle('profiles:update', (id, patch) => profileStore.update(id, patch));
  handle('profiles:remove', async (id) => {
    sessions.dropSession(id);
    return profileStore.remove(id);
  });
  handle('profiles:duplicate', (id, overrides) => profileStore.duplicate(id, overrides));
  handle('profiles:reorder', (idsInOrder) => profileStore.reorder(idsInOrder));
  handle('profiles:sanitizeSyncName', (name) => core.sanitizeSyncName(name));
  handle('profiles:meta', async () => {
    const { PROVIDERS } = core.getVendored().TabbySyncProviders;
    return PROVIDERS;
  });

  handle('profiles:testConnection', async (id) => {
    const profile = await profileStore.get(id);
    if (!profile) throw new Error(`No such profile: ${id}`);
    const results = {};
    try { await core.remoteBookmarks.load(profile); results.bookmarks = { ok: true }; }
    catch (e) { results.bookmarks = { ok: false, message: e.message }; }
    try { await core.remoteTabs.load(profile); results.tabs = { ok: true }; }
    catch (e) { results.tabs = { ok: false, message: e.message }; }
    return results;
  });

  handle('profiles:deleteRemoteData', async (id) => {
    const profile = await profileStore.get(id);
    if (!profile) throw new Error(`No such profile: ${id}`);
    const fullCfg = core.fullCfgForDelete(profile);
    const deleted = await core.getVendored().TabbySyncProviders.deleteProviderData(fullCfg, profile.provider);
    sessions.dropSession(id);
    return { deleted };
  });

  // ---- bookmarks ------------------------------------------------------------
  handle('bookmarks:load', (profileId, opts) => sessions.loadBookmarks(profileId, opts));
  handle('bookmarks:status', (profileId) => sessions.status(profileId));
  handle('bookmarks:addBookmark', (profileId, args) => sessions.applyBookmarkOp(profileId, (tree) => bmOps.addBookmark(tree, args.parentId, args)));
  handle('bookmarks:addFolder', (profileId, args) => sessions.applyBookmarkOp(profileId, (tree) => bmOps.addFolder(tree, args.parentId, args)));
  handle('bookmarks:rename', (profileId, { id, title }) => sessions.applyBookmarkOp(profileId, (tree) => bmOps.renameNode(tree, id, title)));
  handle('bookmarks:editUrl', (profileId, { id, url }) => sessions.applyBookmarkOp(profileId, (tree) => bmOps.editUrl(tree, id, url)));
  handle('bookmarks:remove', (profileId, { id }) => sessions.applyBookmarkOp(profileId, (tree) => bmOps.removeNode(tree, id)));
  handle('bookmarks:move', (profileId, { id, newParentId, index }) => sessions.applyBookmarkOp(profileId, (tree) => bmOps.moveNode(tree, id, newParentId, index)));
  handle('bookmarks:copy', (profileId, { id, newParentId, index }) => sessions.applyBookmarkOp(profileId, (tree) => bmOps.copyNode(tree, id, newParentId, { index })));
  handle('bookmarks:reorder', (profileId, { parentId, orderedIds }) => sessions.applyBookmarkOp(profileId, (tree) => bmOps.reorderChildren(tree, parentId, orderedIds)));
  handle('bookmarks:moveWithinParent', (profileId, { id, direction }) => sessions.applyBookmarkOp(profileId, (tree) => bmOps.moveWithinParent(tree, id, direction)));
  handle('bookmarks:save', (profileId, opts) => sessions.saveBookmarks(profileId, opts));
  handle('bookmarks:discard', (profileId) => sessions.discardBookmarks(profileId));
  handle('bookmarks:copyToProfile', (sourceId, nodeId, targetId, targetParentId) => sessions.copyBookmarkToProfile(sourceId, nodeId, targetId, targetParentId));
  handle('bookmarks:moveToProfile', (sourceId, nodeId, targetId, targetParentId) => sessions.moveBookmarkToProfile(sourceId, nodeId, targetId, targetParentId));

  handle('bookmarks:exportHtml', async (profileId, tree) => {
    const profile = await profileStore.get(profileId);
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Export bookmarks',
      defaultPath: `${(profile && profile.label) || 'bookmarks'}.html`,
      filters: [{ name: 'Bookmarks HTML', extensions: ['html'] }],
    });
    if (canceled || !filePath) return { saved: false };
    await fs.writeFile(filePath, core.buildHtml(tree), 'utf8');
    return { saved: true, filePath };
  });

  handle('bookmarks:importHtml', async (profileId, { destParentId }) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Import bookmarks',
      properties: ['openFile'],
      filters: [{ name: 'Bookmarks HTML', extensions: ['html', 'htm'] }],
    });
    if (canceled || !filePaths.length) return { imported: 0 };
    const html = await fs.readFile(filePaths[0], 'utf8');
    const nodes = core.parseNetscape(html);
    let count = 0;
    let result = null;
    for (const n of nodes) {
      result = await sessions.applyBookmarkOp(profileId, (tree) => insertParsed(bmOps, tree, destParentId, n));
      count += 1;
    }
    return { imported: count, tree: result && result.tree };
  });

  // ---- saved tabs -------------------------------------------------------
  handle('tabs:load', (profileId, opts) => sessions.loadTabs(profileId, opts));
  handle('tabs:status', (profileId) => sessions.status(profileId));
  handle('tabs:addList', (profileId, args) => sessions.applyTabsOp(profileId, (state) => tabOps.addList(state, args)));
  handle('tabs:renameList', (profileId, { id, name }) => sessions.applyTabsOp(profileId, (state) => tabOps.renameList(state, id, name)));
  handle('tabs:setLocked', (profileId, { id, locked }) => sessions.applyTabsOp(profileId, (state) => tabOps.setLocked(state, id, locked)));
  handle('tabs:setPinned', (profileId, { id, pinned }) => sessions.applyTabsOp(profileId, (state) => tabOps.setPinned(state, id, pinned)));
  handle('tabs:removeList', (profileId, { id }) => sessions.applyTabsOp(profileId, (state) => tabOps.removeList(state, id)));
  handle('tabs:duplicateList', (profileId, { id }) => sessions.applyTabsOp(profileId, (state) => tabOps.duplicateList(state, id)));
  handle('tabs:reorderLists', (profileId, { orderedIds }) => sessions.applyTabsOp(profileId, (state) => tabOps.reorderLists(state, orderedIds)));
  handle('tabs:addTab', (profileId, { groupId, url, title, favIconUrl }) => sessions.applyTabsOp(profileId, (state) => tabOps.addTab(state, groupId, { url, title, favIconUrl })));
  handle('tabs:removeTab', (profileId, { groupId, index }) => sessions.applyTabsOp(profileId, (state) => tabOps.removeTab(state, groupId, index)));
  handle('tabs:moveTab', (profileId, { fromGroupId, fromIndex, toGroupId, toIndex }) => sessions.applyTabsOp(profileId, (state) => tabOps.moveTab(state, fromGroupId, fromIndex, toGroupId, toIndex)));
  handle('tabs:copyTab', (profileId, { fromGroupId, fromIndex, toGroupId, toIndex }) => sessions.applyTabsOp(profileId, (state) => tabOps.copyTab(state, fromGroupId, fromIndex, toGroupId, toIndex)));
  handle('tabs:restoreFromTrash', (profileId, { tid }) => sessions.applyTabsOp(profileId, (state) => tabOps.restoreFromTrash(state, tid)));
  handle('tabs:emptyTrash', (profileId) => sessions.applyTabsOp(profileId, (state) => tabOps.emptyTrash(state)));
  handle('tabs:save', (profileId) => sessions.saveTabs(profileId));
  handle('tabs:discard', (profileId) => sessions.discardTabs(profileId));
  handle('tabs:copyListToProfile', (sourceId, listId, targetId) => sessions.copyListToProfile(sourceId, listId, targetId));
  handle('tabs:moveListToProfile', (sourceId, listId, targetId) => sessions.moveListToProfile(sourceId, listId, targetId));
  handle('tabs:copyTabToProfile', (sourceId, listId, tabIndex, targetId, targetListId, targetListName) => sessions.copyTabToProfile(sourceId, listId, tabIndex, targetId, targetListId, targetListName));
  handle('tabs:moveTabToProfile', (sourceId, listId, tabIndex, targetId, targetListId, targetListName) => sessions.moveTabToProfile(sourceId, listId, tabIndex, targetId, targetListId, targetListName));

  handle('shell:openExternal', (url) => shell.openExternal(url));
}

/** Inserts one bookmarks-io.js parsed node (and its children, recursively) under destParentId, preserving folder structure. */
function insertParsed(bmOps, tree, destParentId, node) {
  if (node.type === 'folder') {
    const { tree: t1, id: folderId } = bmOps.addFolder(tree, destParentId, { title: node.title });
    let t = t1;
    for (const child of node.children || []) {
      const r = insertParsed(bmOps, t, folderId, child);
      t = r.tree;
    }
    return { tree: t };
  }
  return bmOps.addBookmark(tree, destParentId, { title: node.title, url: node.url });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

main().catch((e) => {
  console.error('[TabbySync Control Panel] fatal startup error:', e);
  dialog.showErrorBox('TabbySync Control Panel failed to start', (e && e.stack) || String(e));
  app.exit(1);
});
