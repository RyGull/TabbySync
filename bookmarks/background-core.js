// background-core.js — the bookmarks sync engine, running inside SyncLocker's
// shared module service worker. Runs syncs on: bookmark changes (debounced),
// a periodic alarm, and manual requests from the popup/options.
//
// It reports its status to the shared badge (self.SyncLockerStatus) rather than
// driving the toolbar icon directly, since the tabs engine shares that icon.

import { runSync, isSuppressed } from './lib/engine.js';
import { getConfig, getState } from './lib/config.js';
import { readBrowserTree } from './lib/browser.js';
import { putRemote } from './lib/sync.js';
import { stats } from './lib/tree.js';

const PERIODIC = 'sl.bm.periodic';
const DEBOUNCE = 'sl.bm.debounce';
const INITIAL = 'sl.bm.initial';

function report(kind) {
  try { self.SyncLockerStatus.report('bookmarks', kind); } catch { /* not ready */ }
}

// Run a sync and reflect the outcome on the shared badge.
async function doSync(trigger) {
  report('syncing');
  const res = await runSync(trigger);
  if (res && res.ok) report('ok');
  else if (res && (res.status === 'not configured')) report('none');
  else if (res && res.status === 'busy') { /* another run will set it */ }
  else report('error');
  return res;
}

// Set the dot from stored state without running a sync (e.g. on worker wake).
async function refreshBadgeFromState() {
  const [cfg, state] = await Promise.all([getConfig(), getState()]);
  if (!(cfg.enabled && cfg.baseUrl && cfg.token && cfg.syncName)) return report('none');
  if (state.lastStatus === 'error') return report('error');
  if (state.lastStatus === 'ok') return report('ok');
  return report('none');
}

async function setupPeriodic() {
  const cfg = await getConfig();
  await chrome.alarms.clear(PERIODIC);
  if (!cfg.enabled) return;
  const minutes = Math.max(1, Number(cfg.intervalMin) || 5);
  await chrome.alarms.create(PERIODIC, { periodInMinutes: minutes });
}

chrome.runtime.onInstalled.addListener(async () => {
  await setupPeriodic();
  await refreshBadgeFromState();
  chrome.alarms.create(INITIAL, { delayInMinutes: 0.1 });
});

chrome.runtime.onStartup.addListener(async () => {
  await setupPeriodic();
  await refreshBadgeFromState();
  chrome.alarms.create(INITIAL, { delayInMinutes: 0.1 });
});
// Also set the dot whenever the service worker wakes up.
refreshBadgeFromState();

// Re-arm the periodic alarm if the interval / enabled state changed, and pull
// right after the user changes server settings so a freshly configured second
// computer syncs immediately instead of waiting for a timer.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  const K = self.SyncLockerConfig.KEYS;
  if ((K.bmInterval in changes) || (K.bmEnabled in changes)) setupPeriodic();
  if (K.bmEnabled in changes) refreshBadgeFromState();
  if (self.SyncLockerConfig.serverChanged(changes) || (K.bmEnabled in changes) ||
      (K.bmAutoSync in changes) || (K.bmDeleteWins in changes)) {
    chrome.alarms.create(INITIAL, { delayInMinutes: 0.02 }); // ~1s later
  }
});

// Pull when a browser window gains focus (switching to this computer), throttled.
let lastFocusSync = 0;
if (chrome.windows && chrome.windows.onFocusChanged) {
  chrome.windows.onFocusChanged.addListener(async (winId) => {
    if (winId === chrome.windows.WINDOW_ID_NONE) return;
    if (Date.now() - lastFocusSync < 45000) return; // at most once per 45s
    const cfg = await getConfig();
    if (!cfg.enabled) return;
    lastFocusSync = Date.now();
    if (!isSuppressed()) doSync('focus');
  });
}

// Debounce bookmark changes into a single sync.
function onBookmarkEvent() {
  if (isSuppressed()) return;
  getConfig().then((cfg) => {
    if (!cfg.enabled || !cfg.autoSync) return;
    chrome.alarms.create(DEBOUNCE, { delayInMinutes: 0.15 }); // ~9s, resets on each change
  });
}

for (const ev of ['onCreated', 'onRemoved', 'onChanged', 'onMoved', 'onChildrenReordered']) {
  if (chrome.bookmarks[ev]) chrome.bookmarks[ev].addListener(onBookmarkEvent);
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PERIODIC) doSync('interval');
  else if (alarm.name === DEBOUNCE) doSync('change');
  else if (alarm.name === INITIAL) doSync('startup');
});

// Messages from popup / options.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'syncNow') {
    doSync('manual').then(sendResponse);
    return true;
  }
  // Force-write the current local bookmarks to the server in the CURRENT
  // encryption state (encrypted per the passphrase, or plaintext if none),
  // without reading remote first. Used by the shared encryption toggle so a
  // turn-off can overwrite a now-unreadable encrypted file.
  if (msg && msg.type === 'bmOverwrite') {
    (async () => {
      try {
        const cfg = await getConfig();
        if (!(cfg.enabled && cfg.baseUrl && cfg.token && cfg.syncName)) {
          return sendResponse({ ok: false, message: 'not configured' });
        }
        const state = await getState();
        const { tree } = await readBrowserTree(state.stableToLocal, state.cacheTree);
        await putRemote(cfg, tree);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, message: e.message || String(e) });
      }
    })();
    return true;
  }
  if (msg && msg.type === 'getStatus') {
    (async () => {
      const [cfg, state] = await Promise.all([getConfig(), getState()]);
      const s = state.cacheTree ? stats(state.cacheTree) : { bookmarks: 0, folders: 0 };
      sendResponse({
        enabled: cfg.enabled,
        configured: !!(cfg.baseUrl && cfg.token && cfg.syncName),
        syncName: cfg.syncName,
        encrypted: !!cfg.passphrase,
        autoSync: cfg.autoSync,
        intervalMin: cfg.intervalMin,
        lastSync: state.lastSync,
        lastStatus: state.lastStatus,
        lastError: state.lastError,
        bookmarks: s.bookmarks,
        folders: s.folders,
      });
    })();
    return true;
  }
  return false;
});
