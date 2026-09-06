// main.cjs — Electron main process.
//
// Plain CommonJS on purpose: Electron's main/preload story for
// contextIsolation + a sandboxed preload is best documented and most
// battle-tested as CJS. The actual application logic (src/core/*.js) is ES
// modules — loaded here via dynamic import(), which CJS supports natively.
'use strict';

const path = require('node:path');
const fs = require('node:fs/promises');
const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, Menu, Tray, nativeTheme, Notification, clipboard } = require('electron');
const { autoUpdater } = require('electron-updater');

const ICON_PATH = path.join(__dirname, 'build', 'icon.ico');
// Kept beside the same URLs in website/config.php (SITE_URL, PAYPAL_URL) —
// there is no way to share the constant across a PHP file and this one, so
// if either changes on the website, update it here too.
const WEBSITE_URL = 'https://tabbysync.com';
const DONATE_URL = 'https://www.paypal.com/ncp/payment/B25W7V9VRGQG4';
const GITHUB_URL = 'https://github.com/RyGull/TabbySync';

let isQuitting = false;
let tray = null;
// Last thing setupAutoUpdate()/the manual "Check for updates" button in the
// About modal found out, for app:checkForUpdates to report back. Not
// persisted — just today's in-memory answer to "what happened last time?".
let updateStatus = { state: 'idle' };

// Single-instance lock: without this, launching TabbySync Control Panel
// again while it's already running — clicking a taskbar-pinned icon while
// the window is minimized/hidden is the case that was actually reported —
// starts a second, fully independent process instead of just bringing the
// existing one forward. Both would then load/write the same profiles.json
// with no coordination between them.
//
// Must happen before anything else touches app.* (whenReady included): a
// losing second launch needs to bail out immediately, not do any of the
// real startup work first. Scoped by userData path, not by the .exe file,
// so this doesn't interfere with the Xvfb smoke test — every run there
// passes its own --user-data-dir, so each is its own "app" as far as the
// lock is concerned.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.exit(0);
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  });
}

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

async function createWindow(settingsStore) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 860,
    minHeight: 560,
    title: 'TabbySync Control Panel',
    // nativeTheme.themeSource is set from the saved theme before this runs
    // (see main()), so shouldUseDarkColors already reflects it — including
    // the 'system' case, which nativeTheme resolves against the real OS
    // preference. Avoids a flash of the wrong-theme background before the
    // page's own CSS loads.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1d23' : '#ffffff',
    show: false, // shown explicitly below, once — respects "start minimized"
    icon: ICON_PATH, // mostly a dev-mode nicety; the packaged .exe carries its own icon resource
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  // The X button (and Alt+F4) hits this, not a real close — see
  // handleWindowClose's own comment for what "ask" actually asks.
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    handleWindowClose(settingsStore);
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

  const settings = await settingsStore.get();
  if (!settings.startMinimized) mainWindow.show();
  // If it IS starting minimized, the window stays hidden — the tray icon
  // (always created, regardless of this setting — see createTray) is the
  // only way back to it, same as clicking the tray icon at any other time.
}

/** One tray icon for the app's whole lifetime, independent of any setting — it's the safety net that makes "start minimized" and "minimize to tray" both recoverable rather than a trap with no way back in. */
function createTray(settingsStore) {
  try {
    tray = new Tray(ICON_PATH);
  } catch (e) {
    // Missing/unreadable icon shouldn't take the whole app down with it —
    // minimize-to-tray degrades to "just hide the window" without a tray
    // affordance to bring it back, which is why every close/minimize path
    // also leaves the Show item reachable from the taskbar (Windows still
    // lists a hidden-but-not-destroyed window's app in some contexts) —
    // but this really shouldn't happen for a properly built app; log it.
    console.error('[TabbySync Control Panel] could not create tray icon:', e.message);
    return;
  }
  tray.setToolTip('TabbySync Control Panel');
  const menu = Menu.buildFromTemplate([
    { label: 'Show TabbySync Control Panel', click: () => { mainWindow.show(); mainWindow.focus(); } },
    { type: 'separator' },
    { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (mainWindow.isVisible()) mainWindow.focus();
    else mainWindow.show();
  });
}

/**
 * What the X button / Alt+F4 actually does, per the saved closeBehavior:
 *   'minimize' — just hide the window; the app keeps running in the tray.
 *   'quit'     — really quit.
 *   'ask'      — a native Yes/No-style dialog decides, once, for this click;
 *                checking its box saves the choice as closeBehavior so this
 *                dialog stops appearing (change it back from Options any
 *                time).
 *
 * This app does no background syncing (see the README's "Known
 * limitations") — minimizing keeps the window a click away in the tray,
 * nothing more, and the dialog's own wording is careful not to imply
 * otherwise.
 */
async function handleWindowClose(settingsStore) {
  const settings = await settingsStore.get();
  if (settings.closeBehavior === 'minimize') { mainWindow.hide(); return; }
  if (settings.closeBehavior === 'quit') { isQuitting = true; app.quit(); return; }

  const result = await dialog.showMessageBox(mainWindow, {
    type: 'question',
    buttons: ['Minimize to Tray', 'Quit'],
    defaultId: 0,
    cancelId: 0,
    checkboxLabel: "Don't ask me again",
    checkboxChecked: false,
    message: 'Keep TabbySync Control Panel running in the background?',
    detail: 'Minimizing keeps it a click away from the system tray. This doesn’t sync anything in the background — it just keeps the window ready. Change this anytime from File → Options.',
  });
  const choice = result.response === 0 ? 'minimize' : 'quit';
  if (result.checkboxChecked) await settingsStore.update({ closeBehavior: choice });
  if (choice === 'minimize') mainWindow.hide();
  else { isQuitting = true; app.quit(); }
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'Options…',
          accelerator: 'Ctrl+,',
          click: () => mainWindow && mainWindow.webContents.send('menu:open-options'),
        },
        { type: 'separator' },
        // A deliberate menu click is an unambiguous "quit" — unlike the
        // window's own close button, this skips the ask-to-minimize dialog
        // entirely rather than asking someone who just asked to exit.
        {
          label: 'Exit',
          accelerator: isMac ? undefined : 'Ctrl+Q',
          click: () => { isQuitting = true; app.quit(); },
        },
      ],
    },
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
        { label: 'TabbySync website', click: () => shell.openExternal(WEBSITE_URL) },
        { label: 'TabbySync on GitHub', click: () => shell.openExternal(GITHUB_URL) },
        {
          label: 'Privacy Policy',
          click: () => mainWindow && mainWindow.webContents.send('menu:open-privacy'),
        },
        { type: 'separator' },
        { label: 'Donate…', click: () => shell.openExternal(DONATE_URL) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/**
 * Records the latest update state and pushes it to the renderer immediately
 * (an open About modal listens for this — see api.app.onUpdateStatus) —
 * NOT just returned from app:checkForUpdates. That was the original bug:
 * autoUpdater.checkForUpdates()'s own promise resolves once it knows
 * whether an update EXISTS, not once downloading it finishes, so awaiting
 * it and returning updateStatus right after only ever reported "found it,
 * downloading" and nothing else ever arrived — the download's actual
 * progress and completion happened later, with nothing listening.
 */
function setUpdateStatus(next) {
  updateStatus = next;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('updater:status', updateStatus);
}

/** Brings the window to the front, then asks to restart — shared by the notification's click and by update-downloaded firing while the window's already visible. */
async function promptInstallUpdate(version) {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  const result = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    buttons: ['Restart and Install', 'Later'],
    defaultId: 0,
    cancelId: 1,
    message: `TabbySync Control Panel ${version} is ready to install.`,
    detail: 'Restarting installs it right away. Choosing Later installs it automatically the next time you fully quit the app.',
  });
  if (result.response === 0) { isQuitting = true; autoUpdater.quitAndInstall(); }
}

const UPDATE_FREQUENCY_MS = { daily: 24 * 60 * 60 * 1000, weekly: 7 * 24 * 60 * 60 * 1000, monthly: 30 * 24 * 60 * 60 * 1000 };
/** Whether enough time has passed since lastCheckAt for this frequency setting to check again — exported-shaped as a plain function so it's easy to reason about/test by inspection. 'startup' (the default) and a never-yet-checked install always say yes; 'never' always says no. */
function updateCheckDue(frequency, lastCheckAt) {
  if (frequency === 'never') return false;
  if (frequency === 'startup' || !lastCheckAt) return true;
  const intervalMs = UPDATE_FREQUENCY_MS[frequency];
  if (!intervalMs) return true; // unrecognized value — fail open to checking rather than silently never checking again
  return (Date.now() - lastCheckAt) >= intervalMs;
}

/**
 * Actually calls electron-updater. Shared by the startup check and the
 * manual button — both just need "run a check, record when", the rest
 * happens via the event listeners wired in setupAutoUpdate().
 *
 * One retry, after a short pause, before reporting failure: a real user
 * hit "Cannot find latest.yml" checking within the first ~20 seconds of a
 * tag being pushed — the GitHub Release exists (and is already "latest")
 * the instant the tag lands, but build-windows takes a few minutes to
 * actually build and upload latest.yml/the installer to it. Nobody should
 * have to know to just try again for a race that's entirely this app's
 * release process, not anything they did — not indefinite retrying, so a
 * genuine, lasting problem (network down, no such release) still surfaces.
 */
async function runUpdateCheck(settingsStore) {
  settingsStore.update({ lastUpdateCheckAt: Date.now() }).catch((e) => console.error(e));
  try {
    await autoUpdater.checkForUpdates();
  } catch (err) {
    console.error('[TabbySync Control Panel] update check failed, retrying once in 15s:', err && err.message);
    await new Promise((r) => setTimeout(r, 15000));
    try {
      await autoUpdater.checkForUpdates();
    } catch (err2) {
      setUpdateStatus({ state: 'error', message: err2 && err2.message });
    }
  }
}

/**
 * Update checking: electron-updater, fed by the GitHub Releases this repo
 * already publishes (package.json's build.publish tells electron-builder
 * what to bake into dist/latest.yml at build time — .github/workflows/
 * control-panel.yml's release step attaches it, and the installer's own
 * .exe.blockmap, alongside the installer itself).
 *
 * Deliberately "auto-download, then ask before restarting" rather than
 * either silent extreme:
 *   - not check-only: most people never remember to come back and check,
 *     so a purely manual check would mean most installs just go stale.
 *   - not silent auto-install: this app's whole safety model is "never
 *     touch what wasn't asked for" (the large-deletion brake, confirming
 *     before switching away from unsaved edits) — a restart landing
 *     mid-edit would cut against that.
 * Declining the prompt doesn't mean staying on the old version forever:
 * autoInstallOnAppQuit (electron-updater's default, left untouched here)
 * installs it on the next real quit anyway, prompt or not.
 *
 * The event listeners below are wired unconditionally — harmless in a dev
 * checkout or the smoke test, since nothing there ever calls
 * checkForUpdates() on its own to trigger them. What IS gated on
 * app.isPackaged/PORTABLE_EXECUTABLE_DIR, at the bottom, is automatically
 * checking on startup: app.isPackaged is false for `npm start`/the smoke
 * test (there's no dist/resources/app-update.yml in a dev checkout for
 * electron-updater to read), and a portable .exe has nothing installed for
 * it to update in place. app:checkForUpdates (main.cjs's IPC handler) has
 * this same guard for the manual button, independently of this function.
 */
async function setupAutoUpdate(settingsStore) {
  autoUpdater.autoDownload = true;

  autoUpdater.on('checking-for-update', () => setUpdateStatus({ state: 'checking' }));
  autoUpdater.on('update-not-available', () => setUpdateStatus({ state: 'not-available' }));
  autoUpdater.on('error', (err) => {
    setUpdateStatus({ state: 'error', message: err && err.message });
    console.error('[TabbySync Control Panel] update check failed:', err && err.message);
  });
  autoUpdater.on('update-available', (info) => {
    // No percent yet — the first download-progress tick fills that in.
    // Kept as its own state (rather than waiting for the first tick) so
    // the About modal has something to say immediately: "found it" is
    // itself useful feedback, not silence until progress happens to load.
    setUpdateStatus({ state: 'downloading', version: info.version });
  });
  autoUpdater.on('download-progress', (progress) => {
    setUpdateStatus({ state: 'downloading', version: updateStatus.version, percent: progress.percent });
  });
  autoUpdater.on('update-downloaded', async (info) => {
    setUpdateStatus({ state: 'downloaded', version: info.version });

    // Exactly one of these, not both: if the window's already up and
    // visible, ask directly — a toast on top of a dialog you're already
    // looking at is just noise. Otherwise (minimized, hidden in the tray,
    // or no window at all) a dialog parented to that window won't surface
    // on its own, so a toast notification is the one thing that reaches
    // someone in that state; clicking it prompts the same way.
    if (mainWindow && mainWindow.isVisible() && !mainWindow.isMinimized()) {
      await promptInstallUpdate(info.version);
    } else {
      // Best-effort, same spirit as createTray()'s own try/catch: a
      // platform where notifications don't actually work despite
      // isSupported() saying so (this sandbox's Xvfb has no D-Bus session
      // for Linux's notification API to talk to, for instance) must not
      // take the rest of this handler down with it.
      try {
        if (Notification.isSupported()) {
          const n = new Notification({
            title: 'TabbySync Control Panel update ready',
            body: `Version ${info.version} has finished downloading. Click to restart and install.`,
          });
          n.on('click', () => promptInstallUpdate(info.version));
          n.show();
        }
      } catch (e) {
        console.error('[TabbySync Control Panel] could not show the update-ready notification:', e.message);
      }
    }
  });

  if (!app.isPackaged || process.env.PORTABLE_EXECUTABLE_DIR) return;
  const settings = await settingsStore.get();
  if (updateCheckDue(settings.updateCheckFrequency, settings.lastUpdateCheckAt)) {
    runUpdateCheck(settingsStore);
  }
}

async function main() {
  app.setName('TabbySync Control Panel');
  // Set before any window exists: a real quit (menu Exit, tray Quit,
  // app.quit() from anywhere) always fires this before the window's own
  // 'close' event, which is how that handler tells "actually quitting"
  // apart from "the X button was clicked" without asking twice.
  app.on('before-quit', () => { isQuitting = true; });
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
  const settingsStore = core.createSettingsStore(userDataDir);

  await core.loadVendored(); // fail fast at startup rather than on the first click
  const sessions = core.createSessionManager(profileStore);

  const settings = await settingsStore.get();
  // Drives prefers-color-scheme for every renderer in the app AND the
  // window's own native chrome — 'system' resolves against the real OS
  // preference, exactly like leaving it unset would, so this is a no-op for
  // the default and only actually forces anything for 'light'/'dark'.
  nativeTheme.themeSource = settings.theme;
  // Electron's own login-item mechanism (registry Run key on Windows) —
  // nothing hand-rolled here. Re-applied on every launch rather than only
  // when the setting changes, so it can't drift from what's actually
  // registered if something external (a Windows "clean up startup apps"
  // tool, say) touched it.
  app.setLoginItemSettings({ openAtLogin: settings.startWithWindows });

  registerIpc(core, profileStore, sessions, settingsStore, { secretsAvailable, userDataDir });

  createTray(settingsStore);
  await createWindow(settingsStore);
  setupAutoUpdate(settingsStore).catch((e) => console.error('[TabbySync Control Panel] setupAutoUpdate failed:', e));

  app.on('activate', () => {
    if (mainWindow) { mainWindow.show(); return; }
    if (BrowserWindow.getAllWindows().length === 0) createWindow(settingsStore);
  });

  // Dev-only smoke test hook (see control-panel/scripts/smoke-test.mjs) —
  // renders the real startup path, drives a few basic interactions, saves a
  // screenshot, then exits. Inert unless this exact env var is set.
  if (process.env.TABBYSYNC_SMOKE_TEST) {
    await runSmokeTest(mainWindow, core, profileStore, settingsStore);
  }
}

async function runSmokeTest(win, core, profileStore, settingsStore) {
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
    // Reproduce the reported bug: edit the active profile's connection
    // details and confirm the panel reloads WITHOUT an app restart, rather
    // than silently keeping whatever was cached under the old settings.
    await win.webContents.executeJavaScript(`openProfileModal(state.profiles.find((p) => p.id === state.activeId))`);
    await new Promise((r) => setTimeout(r, 200));
    await win.webContents.executeJavaScript(`document.querySelector('.modal-body input[type="text"]').value = 'Demo (renamed)'`);
    await win.webContents.executeJavaScript(`document.querySelector('.modal-footer .btn-primary').click()`);
    await new Promise((r) => setTimeout(r, 400));
    await shot('05-after-edit-reload.png');
    const headerLabel = await win.webContents.executeJavaScript(`document.getElementById('pv-label').textContent`);
    console.log('[smoke-test] header after edit:', headerLabel);

    // Double-clicking a bookmark must open it externally, not the edit
    // modal (that's in the right-click menu now, on purpose).
    const originalOpenExternal = shell.openExternal;
    let openedUrl = null;
    shell.openExternal = async (url) => { openedUrl = url; };
    try {
      await win.webContents.executeJavaScript(`document.querySelector('#bm-tree .tree-row[data-type="bookmark"]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
      await new Promise((r) => setTimeout(r, 150));
      const modalCountAfterDblClick = await win.webContents.executeJavaScript(`document.querySelectorAll('.modal').length`);
      console.log('[smoke-test] double-click bookmark: opened =', openedUrl, ' modals open =', modalCountAfterDblClick);
      if (openedUrl !== 'https://example.com' || modalCountAfterDblClick !== 0) {
        throw new Error(`double-click regression: expected an external open and no modal, got openedUrl=${openedUrl} modals=${modalCountAfterDblClick}`);
      }
    } finally {
      shell.openExternal = originalOpenExternal;
    }

    // Options dialog, opened the same way the File menu does it, and the
    // theme dropdown next to it — both write through to settings.json.
    win.webContents.send('menu:open-options');
    await new Promise((r) => setTimeout(r, 200));
    await shot('06-options-modal.png');
    await win.webContents.executeJavaScript(`document.getElementById('opt-start-minimized').click()`);
    await new Promise((r) => setTimeout(r, 150));

    // Update-check frequency, added to Options alongside the rest.
    const updateFreqOptions = await win.webContents.executeJavaScript(
      `Array.from(document.getElementById('opt-update-frequency').options).map((o) => o.value)`
    );
    console.log('[smoke-test] update frequency options:', JSON.stringify(updateFreqOptions));
    if (JSON.stringify(updateFreqOptions) !== JSON.stringify(['startup', 'daily', 'weekly', 'monthly', 'never'])) {
      throw new Error(`unexpected update-frequency options: ${JSON.stringify(updateFreqOptions)}`);
    }
    await win.webContents.executeJavaScript(
      `document.getElementById('opt-update-frequency').value = 'weekly'; document.getElementById('opt-update-frequency').dispatchEvent(new Event('change'))`
    );
    await new Promise((r) => setTimeout(r, 250)); // let buildUpdateStatusUI's getUpdateStatus() call resolve

    // Updates is its own clearly separated section within Options (heading
    // + divider), not just another field blended into the rest — but the
    // live status/progress/actions themselves no longer live inline here;
    // this section is just the frequency setting plus a button that opens
    // the same dedicated popup the sidebar's "Updates" button does.
    const optionsUpdateSection = await win.webContents.executeJavaScript(`(() => {
      const section = document.querySelector('.options-section');
      const title = section && section.querySelector('.options-section-title');
      const popupBtn = section && Array.from(section.querySelectorAll('button')).find((b) => b.textContent === 'Check for updates…');
      return {
        sectionExists: !!section,
        titleText: title && title.textContent,
        popupBtnExists: !!popupBtn,
        popupBtnIsSmall: popupBtn && popupBtn.classList.contains('btn-sm'),
        inlineStatusStillHere: !!(section && section.querySelector('.update-status')),
      };
    })()`);
    console.log('[smoke-test] Options Updates section:', JSON.stringify(optionsUpdateSection));
    if (!optionsUpdateSection.sectionExists || optionsUpdateSection.titleText !== 'Updates') {
      throw new Error(`expected a distinct "Updates" section in Options, got: ${JSON.stringify(optionsUpdateSection)}`);
    }
    if (!optionsUpdateSection.popupBtnExists || optionsUpdateSection.popupBtnIsSmall) {
      throw new Error(`expected a normal-sized (not btn-sm) "Check for updates…" button in Options, got: ${JSON.stringify(optionsUpdateSection)}`);
    }
    if (optionsUpdateSection.inlineStatusStillHere) {
      throw new Error('the live update status UI should no longer be embedded inline in Options — it moved to its own popup');
    }
    await shot('07-options-updates-section.png');

    // Clicking it opens the popup (stacked on top of Options) and checks
    // right away, same as the sidebar button.
    await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.options-section button')).find((b) => b.textContent === 'Check for updates…').click()`);
    await new Promise((r) => setTimeout(r, 400));
    const stackedModalTitles = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.modal-header span')).map((s) => s.textContent)`);
    console.log('[smoke-test] Options -> popup button opened:', JSON.stringify(stackedModalTitles));
    if (stackedModalTitles[stackedModalTitles.length - 1] !== 'Check for Updates') {
      throw new Error(`Options' button should open the "Check for Updates" popup on top, got stack: ${JSON.stringify(stackedModalTitles)}`);
    }
    const fromOptionsStatusText = await win.webContents.executeJavaScript(`document.querySelector('.update-status').textContent`);
    if (!/dev build/i.test(fromOptionsStatusText)) {
      throw new Error(`Options' popup button should have auto-triggered a check, got: "${fromOptionsStatusText}"`);
    }
    // Close the popup (topmost modal), leaving Options open underneath.
    await win.webContents.executeJavaScript(`(() => {
      const closeButtons = document.querySelectorAll('.modal-header .close-x');
      closeButtons[closeButtons.length - 1].click();
    })()`);
    await new Promise((r) => setTimeout(r, 150));

    await win.webContents.executeJavaScript(`document.querySelector('.modal-header .close-x').click()`);
    await win.webContents.executeJavaScript(`document.getElementById('theme-select').value = 'dark'; document.getElementById('theme-select').dispatchEvent(new Event('change'))`);
    await new Promise((r) => setTimeout(r, 150));
    const afterSettings = await settingsStore.get();
    console.log('[smoke-test] settings after Options + theme change:', JSON.stringify(afterSettings));
    if (afterSettings.startMinimized !== true) throw new Error('Options toggle did not persist to settings.json');
    if (afterSettings.theme !== 'dark') throw new Error('theme dropdown did not persist to settings.json');
    if (nativeTheme.themeSource !== 'dark') throw new Error('theme dropdown did not update nativeTheme.themeSource');
    if (afterSettings.updateCheckFrequency !== 'weekly') throw new Error('update-frequency dropdown did not persist to settings.json');

    // Light theme is brand-new code (the app was dark-only before this),
    // so it gets its own screenshot rather than trusting the CSS by
    // inspection alone.
    await win.webContents.executeJavaScript(`document.getElementById('theme-select').value = 'light'; document.getElementById('theme-select').dispatchEvent(new Event('change'))`);
    await new Promise((r) => setTimeout(r, 200));
    await shot('07-light-theme.png');

    // --- batch #2, items 1/2: tab double-click opens externally, and the
    // ↗/✎ row-action buttons are colour-coded, not identical grey ghosts ---
    const readingListId = await win.webContents.executeJavaScript(
      `state.tb.state.groups.find((g) => g.name === 'Reading list').id`
    );
    await win.webContents.executeJavaScript(`state.expandedGroups.add('${readingListId}'); renderTabLists(); openAddTabModal('${readingListId}')`);
    await new Promise((r) => setTimeout(r, 200));
    await win.webContents.executeJavaScript(`document.querySelector('.modal-body input[type=url]').value = 'https://example.org/tab-one'`);
    await win.webContents.executeJavaScript(`document.querySelector('.modal-footer .btn-primary').click()`);
    await new Promise((r) => setTimeout(r, 200));

    let openedTabUrl = null;
    shell.openExternal = async (url) => { openedTabUrl = url; };
    try {
      await win.webContents.executeJavaScript(`document.querySelector('.tab-row').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`);
      await new Promise((r) => setTimeout(r, 150));
      const modalCountAfterTabDblClick = await win.webContents.executeJavaScript(`document.querySelectorAll('.modal').length`);
      console.log('[smoke-test] double-click tab: opened =', openedTabUrl, ' modals open =', modalCountAfterTabDblClick);
      if (openedTabUrl !== 'https://example.org/tab-one' || modalCountAfterTabDblClick !== 0) {
        throw new Error(`tab double-click regression: expected an external open and no modal, got openedUrl=${openedTabUrl} modals=${modalCountAfterTabDblClick}`);
      }
    } finally {
      shell.openExternal = originalOpenExternal;
    }

    // The ↗/✎ buttons only reveal on hover (CSS) — check computed colour
    // directly rather than trying to fake a hover state for a screenshot.
    const rowActionColors = await win.webContents.executeJavaScript(`(() => {
      const row = document.querySelector('.tab-row');
      return {
        open: getComputedStyle(row.querySelector('.btn-icon-open')).color,
        edit: getComputedStyle(row.querySelector('.btn-icon-edit')).color,
      };
    })()`);
    console.log('[smoke-test] row-action colours:', JSON.stringify(rowActionColors));
    if (rowActionColors.open === rowActionColors.edit) {
      throw new Error(`open/edit row-action buttons must be visually distinct, both got ${rowActionColors.open}`);
    }
    // Force them visible (normally hover-only) for one screenshot so this is
    // actually seen, not just asserted by computed style.
    await win.webContents.executeJavaScript(`document.querySelectorAll('.row-actions').forEach((el) => { el.style.display = 'flex'; })`);
    await shot('08-row-actions.png');
    await win.webContents.executeJavaScript(`document.querySelectorAll('.row-actions').forEach((el) => { el.style.display = ''; })`);

    // --- item 3: the profile dot reflects live connection status ---
    const dotColor = await win.webContents.executeJavaScript(`getComputedStyle(document.getElementById('pv-color')).backgroundColor`);
    console.log('[smoke-test] profile status dot colour:', dotColor);

    // --- item 4: Privacy Policy, opened the same way the Help menu does it ---
    win.webContents.send('menu:open-privacy');
    await new Promise((r) => setTimeout(r, 200));
    const privacyText = await win.webContents.executeJavaScript(
      `(document.querySelector('.privacy-body') || {}).textContent || ''`
    );
    if (!privacyText.includes('Data Protection API') || !privacyText.includes('AES-256-GCM')) {
      throw new Error('Privacy Policy modal is missing expected content');
    }
    await shot('09-privacy-policy.png');
    await win.webContents.executeJavaScript(`document.querySelector('.modal-header .close-x').click()`);

    // --- item 5: bulk-open ceiling protection, mirrors the browser
    // extension's own tabs/tablist.js thresholds exactly ---
    await win.webContents.executeJavaScript(`(async () => {
      let s;
      for (let i = 0; i < 29; i++) {
        s = (await window.tabbysync.tabs.addTab(${JSON.stringify(p.id)}, { groupId: '${readingListId}', url: 'https://example.org/bulk-' + i })).state;
      }
      state.tb.state = s;
      renderTabLists();
    })()`);
    const bulkTotal = await win.webContents.executeJavaScript(`state.tb.state.groups.find((g) => g.id === '${readingListId}').tabs.length`);
    console.log('[smoke-test] bulk-open list size:', bulkTotal); // 30 = 1 (tab-one, above) + 29 here — above BULK_WARN_AT (15)
    if (bulkTotal !== 30) throw new Error(`expected 30 tabs in the bulk-open list, got ${bulkTotal}`);

    const openedBulkUrls = [];
    shell.openExternal = async (url) => { openedBulkUrls.push(url); };
    try {
      // Not awaited: askHowMany's promise only resolves once a dialog button
      // is clicked, which happens further down.
      win.webContents.executeJavaScript(
        `openTabsBulk(state.tb.state.groups.find((g) => g.id === '${readingListId}'))`
      ).catch((e) => console.error('[smoke-test] openTabsBulk threw:', e));
      await new Promise((r) => setTimeout(r, 250));
      await shot('10-bulk-ask.png');
      const askText = await win.webContents.executeJavaScript(`(document.querySelector('.bulk-msg') || {}).textContent || ''`);
      console.log('[smoke-test] bulk-open ask dialog text:', askText);
      if (!askText.includes('30 tabs')) throw new Error(`bulk-open ask dialog missing expected count, got: ${askText}`);

      // First button is "Open the first 25" (min(BULK_FIRST_N, total)).
      const chooseFirst25Text = await win.webContents.executeJavaScript(`document.querySelectorAll('.bulk-choices button')[0].textContent`);
      if (chooseFirst25Text !== 'Open the first 25') throw new Error(`expected "Open the first 25", got "${chooseFirst25Text}"`);
      await win.webContents.executeJavaScript(`document.querySelectorAll('.bulk-choices button')[0].click()`);
      await new Promise((r) => setTimeout(r, 200));
      await shot('11-bulk-progress.png');
      await new Promise((r) => setTimeout(r, 1800)); // 25 tabs / 5 per batch / 140ms tick ≈ 700ms — generous margin
      const overlaysLeft = await win.webContents.executeJavaScript(`document.querySelectorAll('.bulk-overlay').length`);
      console.log('[smoke-test] bulk-open finished: opened', openedBulkUrls.length, 'of 25 chosen, overlays left =', overlaysLeft);
      if (openedBulkUrls.length !== 25) throw new Error(`bulk-open should have opened exactly the 25 chosen, got ${openedBulkUrls.length}`);
      if (overlaysLeft !== 0) throw new Error('bulk-open progress overlay did not close itself once done');
    } finally {
      shell.openExternal = originalOpenExternal;
    }

    // --- update checking now lives in its own popup, not About. About was
    // checked earlier (03-bookmark-added.png etc. all show it without any
    // update UI); confirm explicitly that neither the button nor the
    // status text are still there. ---
    await win.webContents.executeJavaScript(`openAboutModal()`);
    await new Promise((r) => setTimeout(r, 200));
    const aboutHasNoUpdateUi = await win.webContents.executeJavaScript(`(() => {
      const body = document.querySelector('.modal-body');
      return !body.querySelector('.update-status') && !Array.from(body.querySelectorAll('button')).some((b) => /check for updates/i.test(b.textContent));
    })()`);
    if (!aboutHasNoUpdateUi) throw new Error('About still has update-related UI in it — it should have been removed entirely');
    await win.webContents.executeJavaScript(`document.querySelector('.modal-header .close-x').click()`);

    // --- item 6: update checking should identify itself as unavailable in
    // this dev/unpackaged run, not crash or silently do nothing. Its own
    // popup now (openUpdateModal), not About. ---
    await win.webContents.executeJavaScript(`openUpdateModal()`);
    await new Promise((r) => setTimeout(r, 200));
    const updatePopupTitle = await win.webContents.executeJavaScript(`document.querySelector('.modal-header span').textContent`);
    if (updatePopupTitle !== 'Check for Updates') throw new Error(`expected the popup titled "Check for Updates", got "${updatePopupTitle}"`);
    await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.modal-body button')).find((b) => b.textContent === 'Check for updates').click()`);
    await new Promise((r) => setTimeout(r, 300));
    const updateStatusText = await win.webContents.executeJavaScript(`document.querySelector('.update-status').textContent`);
    console.log('[smoke-test] update-check status (dev build):', updateStatusText);
    if (!/dev build/i.test(updateStatusText)) {
      throw new Error(`expected the update-check button to report a dev build, got: "${updateStatusText}"`);
    }
    await shot('12-update-popup.png');

    // Copy-link button: writes the real (not simulated) OS clipboard, read
    // back directly here rather than through any renderer-side proxy.
    // clipboard.readText()/writeText() are documented as synchronous (and
    // are, on Windows — this app's actual target) but this sandbox's
    // headless Linux clipboard is backed by X11's own inherently
    // asynchronous selection protocol, so Electron hands back a genuine
    // pending Promise here instead of a string — confirmed directly with
    // a standalone script, not assumed. Promise.resolve(...) unwraps
    // either shape (a plain string included) the same way.
    const releaseUrlSent = await win.webContents.executeJavaScript(`(async () => {
      const btn = Array.from(document.querySelectorAll('.modal-body button')).find((b) => b.textContent === 'Copy download link');
      btn.click();
      await new Promise((r) => setTimeout(r, 100));
      return btn.textContent; // should read "Copied!" right after
    })()`);
    const clipboardText = await Promise.resolve(clipboard.readText());
    console.log('[smoke-test] copy-link button:', JSON.stringify({ releaseUrlSent, clipboardText }));
    if (releaseUrlSent !== 'Copied!') throw new Error(`expected the button to say "Copied!" right after clicking, got "${releaseUrlSent}"`);
    if (clipboardText !== 'https://github.com/RyGull/TabbySync/releases/latest') {
      throw new Error(`expected the OS clipboard to hold the latest-release URL, got: "${clipboardText}"`);
    }

    // --- fix: a progress bar + percent, live while the modal stays open —
    // setUpdateStatus() is called directly (same function
    // download-progress's own listener calls) rather than driving a real
    // download, since this sandbox has no route to actually reach GitHub
    // Releases. That's the one thing this can't cover end to end; what it
    // does cover is exactly the gap that was reported: does the modal
    // update itself as progress arrives, instead of freezing on whatever
    // the initial check call happened to return. ---
    setUpdateStatus({ state: 'downloading', version: '9.9.9', percent: 42.3 });
    await new Promise((r) => setTimeout(r, 150));
    const midDownload = await win.webContents.executeJavaScript(`({
      text: document.querySelector('.update-status').textContent,
      barHidden: document.querySelector('.update-progress').hidden,
      barWidth: document.querySelector('.update-progress-fill').style.width,
      restartHidden: document.querySelector('.update-actions .btn-primary').hidden,
    })`);
    console.log('[smoke-test] mid-download UI:', JSON.stringify(midDownload));
    if (!midDownload.text.includes('42%')) throw new Error(`expected the progress percent in the status text, got: "${midDownload.text}"`);
    if (midDownload.barHidden || midDownload.barWidth !== '42%') throw new Error(`expected a visible progress bar at 42%, got: ${JSON.stringify(midDownload)}`);
    if (!midDownload.restartHidden) throw new Error('restart button should not show until the download is actually finished');
    await shot('13-update-progress.png');

    // Fires the REAL update-downloaded listener (autoUpdater is a plain
    // EventEmitter) rather than just calling setUpdateStatus by hand, so
    // this also exercises the notification + auto-prompt-if-visible logic,
    // not just the status push. dialog.showMessageBox is swapped out for
    // the duration — it's a real blocking native dialog, and nothing in a
    // headless Xvfb run is going to click its button.
    const originalShowMessageBox = dialog.showMessageBox;
    let dialogArgs = null;
    dialog.showMessageBox = async (_win, opts) => { dialogArgs = opts; return { response: 1 }; }; // 1 = "Later" — never actually quitAndInstall in a test
    try {
      autoUpdater.emit('update-downloaded', { version: '9.9.9' });
      await new Promise((r) => setTimeout(r, 200));
    } finally {
      dialog.showMessageBox = originalShowMessageBox;
    }
    console.log('[smoke-test] update-downloaded fired: dialog shown =', !!dialogArgs, dialogArgs && dialogArgs.message);
    if (!dialogArgs || !dialogArgs.message.includes('9.9.9')) {
      throw new Error('update-downloaded should have prompted to install (the window is visible) — got no dialog or the wrong version');
    }
    const downloaded = await win.webContents.executeJavaScript(`({
      text: document.querySelector('.update-status').textContent,
      barHidden: document.querySelector('.update-progress').hidden,
      restartHidden: document.querySelector('.update-actions .btn-primary').hidden,
    })`);
    console.log('[smoke-test] downloaded UI:', JSON.stringify(downloaded));
    if (!downloaded.text.includes('9.9.9')) throw new Error(`expected the downloaded version in the status text, got: "${downloaded.text}"`);
    if (!downloaded.barHidden) throw new Error('progress bar should hide again once the download is done');
    if (downloaded.restartHidden) throw new Error('expected the Restart and install button to appear once the download finished');
    await shot('14-update-downloaded.png');
    await win.webContents.executeJavaScript(`document.querySelector('.modal-header .close-x').click()`);

    // Reopening the popup (no auto-check) should show that "downloaded"
    // state immediately, from app:getUpdateStatus — not a blank slate that
    // needs its own click to reveal a download that's already sitting
    // there.
    await win.webContents.executeJavaScript(`openUpdateModal()`);
    await new Promise((r) => setTimeout(r, 200));
    const reopenedText = await win.webContents.executeJavaScript(`document.querySelector('.update-status').textContent`);
    console.log('[smoke-test] popup reopened, status shown immediately:', reopenedText);
    if (!reopenedText.includes('9.9.9')) throw new Error(`reopening the popup should show the still-downloaded state immediately, got: "${reopenedText}"`);
    await win.webContents.executeJavaScript(`document.querySelector('.modal-header .close-x').click()`);

    // The sidebar's own "Updates" button opens this same dedicated popup
    // (not About) AND fires a check immediately.
    await win.webContents.executeJavaScript(`document.getElementById('btn-check-updates').click()`);
    await new Promise((r) => setTimeout(r, 200));
    const sidebarOpenedTitle = await win.webContents.executeJavaScript(`document.querySelector('.modal-header span').textContent`);
    if (sidebarOpenedTitle !== 'Check for Updates') throw new Error(`sidebar Updates button should open the "Check for Updates" popup, got "${sidebarOpenedTitle}"`);
    await new Promise((r) => setTimeout(r, 400));
    const sidebarButtonText = await win.webContents.executeJavaScript(`document.querySelector('.update-status').textContent`);
    console.log('[smoke-test] sidebar Updates button auto-checked:', sidebarButtonText);
    if (!/dev build/i.test(sidebarButtonText)) {
      throw new Error(`sidebar Updates button should have auto-triggered a check, got: "${sidebarButtonText}"`);
    }
    await win.webContents.executeJavaScript(`document.querySelector('.modal-header .close-x').click()`);

    // --- fix: retry once before surfacing an update-check failure. A real
    // user hit "Cannot find latest.yml" checking in the ~20s window right
    // after a release tag landed but before build-windows had finished
    // uploading its assets to it — runUpdateCheck() shouldn't require
    // knowing to just try again for a race that's this app's own release
    // process, not anything the user did. Mocks checkForUpdates() itself
    // (not the network) so this doesn't depend on GitHub being reachable
    // either way: fails once, then succeeds — the exact shape of that race
    // once the upload catches up. ---
    const originalCheckForUpdates = autoUpdater.checkForUpdates.bind(autoUpdater);
    let checkAttempts = 0;
    autoUpdater.checkForUpdates = () => {
      checkAttempts++;
      return checkAttempts === 1
        ? Promise.reject(new Error('Cannot find latest.yml in the latest release artifacts (simulated)'))
        : Promise.resolve();
    };
    const statusBeforeRetryTest = JSON.stringify(updateStatus);
    try {
      runUpdateCheck(settingsStore); // not awaited — same as both its real callers; the retry runs in the background
      await new Promise((r) => setTimeout(r, 500));
      if (checkAttempts !== 1) throw new Error(`expected exactly 1 attempt before the retry delay, got ${checkAttempts}`);
      console.log('[smoke-test] update-check retry: 1st attempt failed as expected, waiting for the retry...');
      await new Promise((r) => setTimeout(r, 15000)); // the real retry delay — this one's worth the wait
      if (checkAttempts !== 2) throw new Error(`expected a 2nd attempt after the retry delay, got ${checkAttempts} attempts total`);
      if (updateStatus.state === 'error') {
        throw new Error(`expected the retry to succeed silently (no error surfaced), got: ${JSON.stringify(updateStatus)}`);
      }
      console.log('[smoke-test] update-check retry: 2nd attempt succeeded, no error surfaced. status unchanged:', statusBeforeRetryTest === JSON.stringify(updateStatus));
    } finally {
      autoUpdater.checkForUpdates = originalCheckForUpdates;
    }

    // --- newest batch, item 1/6: theme options carry an icon, and the
    // theme row now shows the app version alongside it ---
    const themeOptionsText = await win.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('#theme-select option')).map((o) => o.textContent)`
    );
    console.log('[smoke-test] theme option labels:', JSON.stringify(themeOptionsText));
    if (!themeOptionsText.every((t) => /[\u{1F300}-\u{1FAFF}☀-➿]/u.test(t))) {
      throw new Error(`expected every theme option to carry an icon, got: ${JSON.stringify(themeOptionsText)}`);
    }
    const versionText = await win.webContents.executeJavaScript(`document.getElementById('app-version').textContent`);
    if (!/^v\d+\.\d+\.\d+$/.test(versionText)) throw new Error(`expected the sidebar version text to look like "v1.2.0", got "${versionText}"`);

    // --- item 5: Test connection now lives in the Edit Profile modal, not
    // its own toolbar button ---
    if (await win.webContents.executeJavaScript(`!!document.getElementById('btn-test-connection')`)) {
      throw new Error('the old standalone #btn-test-connection button is still in the DOM — it should have moved into the Edit Profile modal');
    }
    await win.webContents.executeJavaScript(`openProfileModal(state.profiles.find((p) => p.id === state.activeId))`);
    await new Promise((r) => setTimeout(r, 200));
    await win.webContents.executeJavaScript(
      `Array.from(document.querySelectorAll('.modal-footer button')).find((b) => b.textContent === 'Test connection').click()`
    );
    await new Promise((r) => setTimeout(r, 300));
    const draftTestText = await win.webContents.executeJavaScript(`document.querySelector('.test-status').textContent`);
    console.log('[smoke-test] test-connection-in-modal result:', draftTestText);
    if (!draftTestText || draftTestText === 'Testing…') throw new Error(`Test connection in the modal never resolved, got: "${draftTestText}"`);
    await shot('13-test-connection-in-modal.png');
    await win.webContents.executeJavaScript(`document.querySelector('.modal-header .close-x').click()`);

    // --- item 2: drag-and-drop reordering for profiles and tab lists,
    // "Move up"/"Move down" kept working alongside it ---
    await win.webContents.executeJavaScript(`(async () => {
      const p2 = await window.tabbysync.profiles.add({ label: 'Second', provider: 'jsonbin', token: 'demo-token-2' });
      state.profiles = await window.tabbysync.profiles.list();
      renderProfileList();
    })()`);
    const beforeProfileOrder = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('#profile-list .p-label')).map((n) => n.textContent)`);
    console.log('[smoke-test] profile order before drag:', JSON.stringify(beforeProfileOrder));
    if (beforeProfileOrder.length !== 2) throw new Error(`expected 2 profiles before the drag test, got ${beforeProfileOrder.length}`);

    // Drags the 2nd profile row onto the 1st's top half — i.e. "put me
    // first" — the same gesture wireListReorderDrag actually listens for.
    // Split into separate steps (rather than firing dragstart/dragover/drop
    // back to back in one synchronous block) specifically to check the
    // MID-drag visual state — dragging-source's opacity applies via
    // requestAnimationFrame, one frame after dragstart, so drop can't
    // follow immediately or there'd be nothing to observe.
    await win.webContents.executeJavaScript(`(() => {
      window.__fireDrag = (el, type, clientY) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: new DataTransfer(), clientY }));
      const [first, second] = document.querySelectorAll('#profile-list .profile-item');
      window.__dragRect = first.getBoundingClientRect();
      window.__fireDrag(second, 'dragstart', window.__dragRect.top);
    })()`);
    await new Promise((r) => setTimeout(r, 80)); // let requestAnimationFrame apply dragging-source
    await win.webContents.executeJavaScript(`(() => {
      const [first] = document.querySelectorAll('#profile-list .profile-item');
      window.__fireDrag(first, 'dragover', window.__dragRect.top + 2); // top half -> insert before
    })()`);
    await new Promise((r) => setTimeout(r, 80));
    const midDrag = await win.webContents.executeJavaScript(`(() => {
      const [first, second] = document.querySelectorAll('#profile-list .profile-item');
      return {
        sourceDimmed: second.classList.contains('dragging-source'),
        sourceOpacity: getComputedStyle(second).opacity,
        targetHighlighted: first.classList.contains('drag-over-top'),
        targetBg: getComputedStyle(first).backgroundColor,
        lineColor: getComputedStyle(first, '::before').backgroundColor,
      };
    })()`);
    console.log('[smoke-test] mid-drag visual state (profiles):', JSON.stringify(midDrag));
    if (!midDrag.sourceDimmed || Number(midDrag.sourceOpacity) >= 0.9) {
      throw new Error(`expected the dragged profile row to visibly dim, got: ${JSON.stringify(midDrag)}`);
    }
    if (!midDrag.targetHighlighted || midDrag.targetBg === 'rgba(0, 0, 0, 0)') {
      throw new Error(`expected the drop-target profile row to show a highlighted background, got: ${JSON.stringify(midDrag)}`);
    }
    if (midDrag.lineColor === 'rgba(0, 0, 0, 0)') {
      throw new Error(`expected a visible insertion line (::before) above the drop target, got: ${JSON.stringify(midDrag)}`);
    }
    await shot('15-drag-mid-drag.png');
    await win.webContents.executeJavaScript(`(() => {
      const [first] = document.querySelectorAll('#profile-list .profile-item');
      window.__fireDrag(first, 'drop', window.__dragRect.top + 2);
    })()`);
    await new Promise((r) => setTimeout(r, 200));
    const afterProfileOrder = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('#profile-list .p-label')).map((n) => n.textContent)`);
    console.log('[smoke-test] profile order after dragging 2nd onto 1st\'s top half:', JSON.stringify(afterProfileOrder));
    if (JSON.stringify(afterProfileOrder) !== JSON.stringify([beforeProfileOrder[1], beforeProfileOrder[0]])) {
      throw new Error(`drag-to-reorder didn't swap the profiles: before=${JSON.stringify(beforeProfileOrder)} after=${JSON.stringify(afterProfileOrder)}`);
    }
    // "Move down" (kept alongside drag) should un-swap them back.
    await win.webContents.executeJavaScript(`moveProfile(state.profiles[0], 1)`);
    await new Promise((r) => setTimeout(r, 200));
    const afterMoveDown = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('#profile-list .p-label')).map((n) => n.textContent)`);
    if (JSON.stringify(afterMoveDown) !== JSON.stringify(beforeProfileOrder)) {
      throw new Error(`"Move down" after a drag didn't restore the original order, got: ${JSON.stringify(afterMoveDown)}`);
    }

    // Same drag gesture, one level down: tab-group headers.
    await win.webContents.executeJavaScript(`(async () => {
      const r = await window.tabbysync.tabs.addList(${JSON.stringify(p.id)}, { name: 'Second list' });
      state.tb.state = r.state;
      renderTabLists();
    })()`);
    const beforeGroupOrder = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.tab-group .g-name')).map((n) => n.textContent)`);
    console.log('[smoke-test] tab-group order before drag:', JSON.stringify(beforeGroupOrder));
    if (beforeGroupOrder.length !== 2) throw new Error(`expected 2 tab-group headers before the drag test, got ${beforeGroupOrder.length}`);
    // Same two-step split as the profile drag above, and for the same
    // reason: this is specifically the case that was silently broken
    // before — the drag-over CSS targeted .tab-group (the whole card),
    // but wireListReorderDrag puts the classes on .tab-group-header, so
    // the indicator never matched anything and never painted, even though
    // the reorder itself worked. A DOM-order assertion alone can't catch
    // that; it takes actually checking what got a visible style.
    await win.webContents.executeJavaScript(`(() => {
      const [first, second] = document.querySelectorAll('.tab-group-header');
      window.__dragRect = first.getBoundingClientRect();
      window.__fireDrag(second, 'dragstart', window.__dragRect.top);
    })()`);
    await new Promise((r) => setTimeout(r, 80));
    await win.webContents.executeJavaScript(`(() => {
      const [first] = document.querySelectorAll('.tab-group-header');
      window.__fireDrag(first, 'dragover', window.__dragRect.top + 2);
    })()`);
    await new Promise((r) => setTimeout(r, 80));
    const midDragGroup = await win.webContents.executeJavaScript(`(() => {
      const [first, second] = document.querySelectorAll('.tab-group-header');
      return {
        sourceDimmed: second.classList.contains('dragging-source'),
        sourceOpacity: getComputedStyle(second).opacity,
        targetHighlighted: first.classList.contains('drag-over-top'),
        targetBg: getComputedStyle(first).backgroundColor,
        lineColor: getComputedStyle(first, '::before').backgroundColor,
      };
    })()`);
    console.log('[smoke-test] mid-drag visual state (tab lists):', JSON.stringify(midDragGroup));
    if (!midDragGroup.sourceDimmed || Number(midDragGroup.sourceOpacity) >= 0.9) {
      throw new Error(`expected the dragged tab-list header to visibly dim, got: ${JSON.stringify(midDragGroup)}`);
    }
    if (!midDragGroup.targetHighlighted || midDragGroup.targetBg === 'rgba(0, 0, 0, 0)') {
      throw new Error(`expected the drop-target tab-list header to show a highlighted background, got: ${JSON.stringify(midDragGroup)}`);
    }
    if (midDragGroup.lineColor === 'rgba(0, 0, 0, 0)') {
      throw new Error(`expected a visible insertion line (::before) above the drop-target tab-list header, got: ${JSON.stringify(midDragGroup)}`);
    }
    await win.webContents.executeJavaScript(`(() => {
      const [first] = document.querySelectorAll('.tab-group-header');
      window.__fireDrag(first, 'drop', window.__dragRect.top + 2);
    })()`);
    await new Promise((r) => setTimeout(r, 200));
    const afterGroupOrder = await win.webContents.executeJavaScript(`Array.from(document.querySelectorAll('.tab-group .g-name')).map((n) => n.textContent)`);
    console.log('[smoke-test] tab-group order after dragging 2nd onto 1st\'s top half:', JSON.stringify(afterGroupOrder));
    if (JSON.stringify(afterGroupOrder) !== JSON.stringify([beforeGroupOrder[1], beforeGroupOrder[0]])) {
      throw new Error(`drag-to-reorder didn't swap the tab-group headers: before=${JSON.stringify(beforeGroupOrder)} after=${JSON.stringify(afterGroupOrder)}`);
    }
    await shot('14-drag-reordered.png');

    // --- item 3: the same ↗/✎ icons appear in the tab-list context menu ---
    const groupMenuIcons = await win.webContents.executeJavaScript(`(() => {
      document.querySelector('.tab-group-header').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 200, clientY: 200 }));
      return Array.from(document.querySelectorAll('.context-menu-item')).slice(0, 2).map((row) => ({
        label: row.querySelector('.context-menu-main > span:last-child').textContent,
        iconClass: (row.querySelector('.context-menu-icon') || {}).className || null,
      }));
    })()`);
    console.log('[smoke-test] tab-list context menu icons:', JSON.stringify(groupMenuIcons));
    if (!groupMenuIcons[0].iconClass || !groupMenuIcons[0].iconClass.includes('icon-open')) {
      throw new Error(`expected "Open all in browser…" to carry icon-open, got: ${JSON.stringify(groupMenuIcons)}`);
    }
    await shot('15-group-context-menu.png');
    await win.webContents.executeJavaScript(`closeAllMenus()`);

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
    remoteBookmarksMod, remoteTabsMod, cfgMapMod, appSettingsMod,
  ] = await Promise.all([
    import('./src/core/profile-store.js'),
    import('./src/core/sessions.js'),
    import('./src/core/provider-shim.js'),
    import('./src/core/bookmarks-ops.js'),
    import('./src/core/tabs-ops.js'),
    import('./src/core/remote-bookmarks.js'),
    import('./src/core/remote-tabs.js'),
    import('./src/core/cfg-map.js'),
    import('./src/core/app-settings.js'),
  ]);
  const bookmarksIoMod = await import('./vendor/bookmarks-lib/bookmarks-io.js');
  const treeMod = await import('./vendor/bookmarks-lib/tree.js');
  return {
    createProfileStore: profileStoreMod.createProfileStore,
    createSettingsStore: appSettingsMod.createSettingsStore,
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

function registerIpc(core, profileStore, sessions, settingsStore, appMeta) {
  const { bmOps, tabOps } = core;

  // ---- settings ---------------------------------------------------------
  handle('settings:get', () => settingsStore.get());
  handle('settings:update', async (patch) => {
    const next = await settingsStore.update(patch);
    // Side effects live here, not in the renderer, so every caller — the
    // Options dialog, and a future one — gets them applied consistently
    // rather than each having to remember to ask for them separately.
    if ('theme' in patch) nativeTheme.themeSource = next.theme;
    if ('startWithWindows' in patch) app.setLoginItemSettings({ openAtLogin: next.startWithWindows });
    return next;
  });

  // ---- app / profiles -----------------------------------------------------
  handle('app:info', async () => ({
    version: app.getVersion(),
    secretsAvailable: appMeta.secretsAvailable,
    profilesFile: profileStore.filePath,
    platform: process.platform,
    // GitHub's own stable "whatever's newest" redirect — never points at a
    // specific version, so the Update popup's Copy-link button doesn't
    // need to know the current version's exact filename to hand someone a
    // link that resolves to it.
    latestReleaseUrl: `${GITHUB_URL}/releases/latest`,
  }));

  handle('app:copyToClipboard', (text) => { clipboard.writeText(String(text)); });

  // Whatever's true right now, with no side effect — so opening the About
  // modal shows a download already under way (started from the sidebar
  // button, or the automatic startup check) instead of a blank slate that
  // needs its own click to reveal what's already happening.
  handle('app:getUpdateStatus', () => updateStatus);

  // Manual "Check for updates" (About modal, and the sidebar button next to
  // it). Reuses setupAutoUpdate()'s own autoUpdater instance/listeners —
  // this just triggers a check; live progress arrives over the
  // updater:status push (api.app.onUpdateStatus), not this call's return
  // value. Awaiting the checkForUpdates() promise itself and returning
  // updateStatus right after used to be the whole handler — that only ever
  // reports "found it, downloading", because that promise resolves once
  // electron-updater knows whether an update EXISTS, not once downloading
  // it finishes. Nothing was wrong with the download; nothing was left
  // listening for how it turned out.
  handle('app:checkForUpdates', () => {
    if (!app.isPackaged) { setUpdateStatus({ state: 'not-available', reason: 'This is a dev build — update checking only runs in an installed copy.' }); return updateStatus; }
    if (process.env.PORTABLE_EXECUTABLE_DIR) { setUpdateStatus({ state: 'not-available', reason: 'The portable build has nothing installed to update in place — download a new copy from the website or GitHub instead.' }); return updateStatus; }
    runUpdateCheck(settingsStore);
    return updateStatus; // whatever it is right this instant (often 'checking') — the push channel carries the rest
  });

  // "Restart and install" button in the About modal, once a download has
  // finished — the same action the native prompt's own button takes.
  handle('app:installUpdate', () => {
    isQuitting = true;
    autoUpdater.quitAndInstall();
  });

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

  /**
   * Shared by profiles:testConnection (an already-saved profile, by id) and
   * profiles:testConnectionDraft (whatever's currently typed into the Edit
   * Profile modal, not saved yet) — both just need a profile-shaped object;
   * neither core.bookmarksCfg/tabsCfg nor remoteBookmarks/remoteTabs care
   * whether it came from disk or a form.
   */
  async function testConnectionFor(profile) {
    const providers = core.getVendored().TabbySyncProviders;
    const results = {};

    // bookmarks-lib/sync.js's getRemote always attempts the request — an
    // incomplete profile just fails there for a real reason (bad URL, bad
    // token). vendor/tabs/storage.js's pullRemote is different: it checks
    // isConfigured() FIRST and, if that's false, resolves with no request
    // and no error at all — which remote-tabs.js's load() then reports as
    // an empty, "reachable" result. Checked here explicitly so an
    // unconfigured profile is reported as exactly that, not as a silent,
    // untested "ok" that happens to look identical to a real success.
    const bmCfg = core.bookmarksCfg(profile);
    if (!providers.isConfigured(bmCfg)) {
      results.bookmarks = { ok: false, message: 'Not fully configured yet — check the server address, token and sync name.' };
    } else {
      try { await core.remoteBookmarks.load(profile); results.bookmarks = { ok: true }; }
      catch (e) { results.bookmarks = { ok: false, message: e.message }; }
    }

    const tbCfg = core.tabsCfg(profile);
    if (!providers.isConfigured(tbCfg)) {
      results.tabs = { ok: false, message: 'Not fully configured yet — check the server address, token and sync name.' };
    } else {
      try { await core.remoteTabs.load(profile); results.tabs = { ok: true }; }
      catch (e) { results.tabs = { ok: false, message: e.message }; }
    }
    return results;
  }

  handle('profiles:testConnection', async (id) => {
    const profile = await profileStore.get(id);
    if (!profile) throw new Error(`No such profile: ${id}`);
    return testConnectionFor(profile);
  });

  // Lives in the Edit Profile modal now (used to be its own toolbar button
  // that only ever tested the saved profile). Tests exactly what's in the
  // form right now — including an edit that hasn't been saved yet, and a
  // brand-new profile that has no id at all — never touches profileStore or
  // disk. draft.gistId/jsonbinTabsId/jsonbinBookmarksId come from the
  // renderer merging in the saved profile's own ids first (see
  // openProfileModal): those name a specific already-created remote
  // gist/bin and aren't form fields a person edits directly.
  handle('profiles:testConnectionDraft', async (draft) => {
    if (!draft || !draft.provider) throw new Error('Nothing to test yet — fill in the connection details first.');
    return testConnectionFor(draft);
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
  handle('tabs:editTab', (profileId, { groupId, index, url, title }) => sessions.applyTabsOp(profileId, (state) => tabOps.editTab(state, groupId, index, { url, title })));
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

// gotSingleInstanceLock is false only for a second launch that's already
// being torn down (app.exit(0) above) — skip real startup work for it
// rather than race that exit.
if (gotSingleInstanceLock) {
  main().catch((e) => {
    console.error('[TabbySync Control Panel] fatal startup error:', e);
    dialog.showErrorBox('TabbySync Control Panel failed to start', (e && e.stack) || String(e));
    app.exit(1);
  });
}
