// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

/* TabbySync — tabs engine service-worker logic.
 *
 * Runs inside the shared module worker. `TabbySync` comes from storage.js
 * (imported at the top of the worker), and the shared config + badge come from
 * self.TabbySyncConfig / self.TabbySyncStatus.
 *
 * The toolbar action opens the TabbySync popup, so tabs are stashed from the
 * popup button, the keyboard command, or the context menu — not an icon click.
 */
(function () {
  "use strict";

  var LIST_URL = chrome.runtime.getURL("tabs/tablist.html");
  var POLL_ALARM = "sl.tab.poll";

  function tabsEnabled() {
    return self.TabbySyncConfig.getConfig().then(function (c) { return c.tabs.enabled; });
  }

  function isStashableTab(tab) {
    if (!tab.url) return false;
    if (tab.url.indexOf(LIST_URL) === 0) return false;
    return true;
  }

  function collectTabs(mode) {
    return chrome.windows.getCurrent().then(function (win) {
      return chrome.tabs.query({ windowId: win.id });
    }).then(function (tabs) {
      var active = tabs.find(function (t) { return t.active; });
      var activeIndex = active ? active.index : -1;
      return tabs.filter(function (t) {
        if (t.pinned) return false;
        if (!isStashableTab(t)) return false;
        switch (mode) {
          case "this": return active && t.id === active.id;
          case "others": return !active || t.id !== active.id;
          case "left": return t.index < activeIndex;
          case "right": return t.index > activeIndex;
          case "all":
          default: return true;
        }
      });
    });
  }

  function openOrFocusList() {
    return TabbySync.getSettings().then(function (settings) {
      var pin = !!settings.pinList;
      return chrome.tabs.query({ url: LIST_URL + "*" }).then(function (existing) {
        if (existing && existing.length) {
          var t = existing[0];
          var props = { active: true };
          if (pin && !t.pinned) props.pinned = true; // pin it if requested, never force-unpin
          return chrome.tabs.update(t.id, props).then(function () {
            return chrome.windows.update(t.windowId, { focused: true });
          }).then(function () {
            return chrome.tabs.reload(t.id).catch(function () {});
          }).then(function () { return t; });
        }
        return chrome.tabs.create({ url: LIST_URL, pinned: pin });
      });
    });
  }

  // Pending "save & close N tabs?" confirmations, keyed by a confirmId —
  // see confirmBulkStash(). A background service worker has no window to
  // run a blocking confirm() in, and this needs to work the same way
  // whether stash() was triggered by the popup, the keyboard command, or
  // the context menu (none of which is guaranteed to have a live page to
  // show a dialog in already open), so the prompt is its own small
  // chrome.windows.create() popup window — one mechanism, every trigger,
  // and answering it never means leaving the browser for the OS
  // notification tray. Falls back to a chrome.notifications prompt only if
  // window creation itself isn't available.
  var pendingStashConfirms = {};
  var stashConfirmWindows = {}; // confirmId -> windowId, so onRemoved can find it back

  function resolveStashConfirm(confirmId, proceed, remember) {
    var resolve = pendingStashConfirms[confirmId];
    if (!resolve) return;
    delete pendingStashConfirms[confirmId];
    delete stashConfirmWindows[confirmId];
    // "Don't ask me again" — 0 is the existing, documented "never ask"
    // value for this same setting (Options already explains "0 to never
    // ask"), so this reaches for exactly that rather than a second flag.
    // Turning it off applies regardless of which button was clicked; only
    // THIS action still depends on proceed.
    if (remember) self.TabbySyncConfig.setConfig({ tabs: { stashWarnAt: 0 } });
    resolve(proceed);
  }

  // The popup's own content is ~210px tall (measured); chrome.windows.create's
  // width/height are the OUTER window size, title bar included, so asking for
  // exactly that leaves no room for the title bar and the page scrolls —
  // which is the bug this constant exists to not repeat. The extra height
  // is slack for that chrome across platforms, not content.
  var CONFIRM_W = 400, CONFIRM_H = 300;

  // Chrome has no "center the window" option, so this centers it manually
  // against the last-focused browser window — the same computation any
  // "centered dialog" library does, just against the browser window rather
  // than the screen, which is what actually reads as centered while the
  // browser doesn't fill the display.
  function centeredPopupBounds(w, h) {
    return chrome.windows.getLastFocused().then(function (parent) {
      if (!(parent && typeof parent.left === "number" && typeof parent.width === "number")) return {};
      return {
        left: Math.round(parent.left + (parent.width - w) / 2),
        top: Math.round(parent.top + (parent.height - h) / 2),
      };
    }).catch(function () { return {}; });
  }

  function confirmBulkStashWindow(count) {
    var confirmId = "sl-stash-confirm-" + Date.now();
    return new Promise(function (resolve) {
      pendingStashConfirms[confirmId] = resolve;
      var url = chrome.runtime.getURL("tabs/confirm-stash.html") +
        "?confirmId=" + encodeURIComponent(confirmId) + "&count=" + encodeURIComponent(count);
      centeredPopupBounds(CONFIRM_W, CONFIRM_H).then(function (pos) {
        var opts = { url: url, type: "popup", width: CONFIRM_W, height: CONFIRM_H, focused: true };
        if ("left" in pos) { opts.left = pos.left; opts.top = pos.top; }
        return chrome.windows.create(opts);
      })
        .then(function (win) { stashConfirmWindows[confirmId] = win.id; })
        .catch(function () {
          // Couldn't even open the window — fall back to a notification
          // rather than silently doing nothing or silently proceeding.
          delete pendingStashConfirms[confirmId];
          confirmBulkStashNotification(count).then(resolve);
        });
    });
  }

  function confirmBulkStashNotification(count) {
    if (!(chrome.notifications && chrome.notifications.create)) return Promise.resolve(true);
    return new Promise(function (resolve) {
      var id = "sl-stash-confirm-" + Date.now();
      pendingStashConfirms[id] = resolve;
      chrome.notifications.create(id, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
        title: "Save and close " + count + " tabs?",
        message: "This saves " + count + " tabs from this window as a new list, then closes them.",
        buttons: [{ title: "Save & close" }, { title: "Cancel" }],
        requireInteraction: true
      }, function () { void chrome.runtime.lastError; });
    });
  }

  function confirmBulkStash(count) {
    if (chrome.windows && chrome.windows.create) return confirmBulkStashWindow(count);
    return confirmBulkStashNotification(count);
  }

  if (chrome.windows && chrome.windows.onRemoved) {
    // The window's own 'x', or the OS closing it — same as dismissing the
    // notification without a button: when in doubt, don't close tabs
    // nobody confirmed closing.
    chrome.windows.onRemoved.addListener(function (windowId) {
      for (var id in stashConfirmWindows) {
        if (stashConfirmWindows[id] === windowId) { resolveStashConfirm(id, false, false); break; }
      }
    });
  }
  if (chrome.notifications) {
    chrome.notifications.onButtonClicked.addListener(function (id, btnIdx) {
      if (!(id in pendingStashConfirms)) return;
      chrome.notifications.clear(id);
      resolveStashConfirm(id, btnIdx === 0, false); // 0 = "Save & close", 1 = "Cancel"
    });
    // Dismissed without a choice (the OS 'x', or it timed out despite
    // requireInteraction on a platform that doesn't honor it).
    chrome.notifications.onClosed.addListener(function (id) {
      if (!(id in pendingStashConfirms)) return;
      resolveStashConfirm(id, false, false);
    });
  }

  function doStash(settings, state, tabs) {
    var toStash = TabbySync.dedupeTabsForStash(state, tabs, settings.dedupe);
    var saved = toStash.length
      ? (TabbySync.addGroup(state, toStash, ""), TabbySync.saveState(state))
      : Promise.resolve();
    return saved.then(openOrFocusList).then(function () {
      var ids = tabs.map(function (t) { return t.id; })
        .filter(function (id) { return typeof id === "number"; });
      return chrome.tabs.remove(ids).catch(function (e) {
        console.warn("[TabbySync] could not close some tabs:", e && e.message);
      });
    });
  }

  function stash(mode) {
    return tabsEnabled().then(function (enabled) {
      if (!enabled) return openOrFocusList();
      return TabbySync.getSettings().then(function (settings) {
        return collectTabs(mode).then(function (tabs) {
          // Sites on the blocklist are left alone entirely — not saved, not
          // closed — never merely deduped away later.
          var blocklist = TabbySync.parseBlocklist(settings.blocklist);
          var stashable = TabbySync.filterBlocked(tabs, blocklist);
          if (!stashable.length) return openOrFocusList();
          var threshold = settings.stashWarnAt;
          var proceed = (threshold > 0 && stashable.length > threshold)
            ? confirmBulkStash(stashable.length)
            : Promise.resolve(true);
          return proceed.then(function (go) {
            if (!go) return; // cancelled — every tab stays exactly as it was
            return TabbySync.getState().then(function (state) {
              return doStash(settings, state, stashable);
            });
          });
        });
      });
    });
  }

  chrome.action.onClicked.addListener(function () { stash("all"); }); // only fires if no popup

  chrome.commands.onCommand.addListener(function (cmd) {
    if (cmd === "send-all-tabs") stash("all");
    else if (cmd === "open-tabbysync") openOrFocusList();
  });

  var MENU = [
    { id: "sl-stash-all", title: "Send all tabs to TabbySync" },
    { id: "sl-stash-this", title: "Send only this tab to TabbySync" },
    { id: "sl-stash-others", title: "Send all other tabs to TabbySync" },
    { id: "sl-stash-left", title: "Send tabs to the left" },
    { id: "sl-stash-right", title: "Send tabs to the right" },
    { id: "sl-sep", type: "separator" },
    { id: "sl-open-list", title: "Open the TabbySync tab list" }
  ];

  function buildMenus() {
    chrome.contextMenus.removeAll(function () {
      void chrome.runtime.lastError;
      tabsEnabled().then(function (enabled) {
        if (!enabled) return;
        MENU.forEach(function (m) {
          chrome.contextMenus.create({
            id: m.id, title: m.title, type: m.type || "normal",
            contexts: ["action", "page"]
          }, function () { void chrome.runtime.lastError; });
        });
      });
    });
  }

  chrome.contextMenus.onClicked.addListener(function (info) {
    switch (info.menuItemId) {
      case "sl-stash-all": return stash("all");
      case "sl-stash-this": return stash("this");
      case "sl-stash-others": return stash("others");
      case "sl-stash-left": return stash("left");
      case "sl-stash-right": return stash("right");
      case "sl-open-list": return openOrFocusList();
    }
  });

  // ---- periodic server polling --------------------------------------------

  function rescheduleAlarm() {
    return TabbySync.getSettings().then(function (settings) {
      return chrome.alarms.clear(POLL_ALARM).then(function () {
        if (settings.syncEnabled && settings.autoSyncMinutes > 0) {
          chrome.alarms.create(POLL_ALARM, { periodInMinutes: Math.max(1, settings.autoSyncMinutes) });
        }
      });
    });
  }

  chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name !== POLL_ALARM) return;
    TabbySync.syncNow()
      .then(function () { chrome.runtime.sendMessage({ type: "tabbysync-refresh" }).catch(function () {}); })
      .catch(function () {});
  });

  chrome.runtime.onInstalled.addListener(function () {
    buildMenus();
    rescheduleAlarm().then(function () { return TabbySync.syncNow(); }).catch(function () {});
  });

  chrome.runtime.onStartup.addListener(function () {
    buildMenus();
    rescheduleAlarm().then(function () { return TabbySync.syncNow(); }).catch(function () {});
  });

  // React to config changes: server settings, the interval, or the feature
  // toggle. Rebuild menus + reschedule + refresh the badge.
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local") return;
    var K = self.TabbySyncConfig.KEYS;
    var touched = [K.tabEnabled, K.tabInterval].some(function (k) { return k in changes; }) ||
      self.TabbySyncConfig.serverChanged(changes);
    if (!touched) return;
    if (K.tabEnabled in changes) buildMenus();
    rescheduleAlarm()
      .then(function () { return TabbySync.syncNow(); })
      .then(function () { chrome.runtime.sendMessage({ type: "tabbysync-refresh" }).catch(function () {}); })
      .catch(function () {});
  });

  // ---- messages from pages -------------------------------------------------

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) return;
    if (msg.type === "tabbysync-sync") {
      TabbySync.syncNow(true)
        .then(function () { sendResponse({ ok: true }); })
        .catch(function (e) { sendResponse({ ok: false, error: e && e.message }); });
      return true;
    }
    if (msg.type === "tabbysync-reschedule") {
      rescheduleAlarm().then(function () { sendResponse({ ok: true }); });
      return true;
    }
    if (msg.type === "sl-stash") {
      stash(msg.mode || "all").then(function () { sendResponse({ ok: true }); })
        .catch(function (e) { sendResponse({ ok: false, error: e && e.message }); });
      return true;
    }
    if (msg.type === "sl-stash-confirm-result") {
      resolveStashConfirm(msg.confirmId, !!msg.proceed, !!msg.remember);
      return false;
    }
    if (msg.type === "sl-open-list") {
      openOrFocusList().then(function () { sendResponse({ ok: true }); });
      return true;
    }
    if (msg.type === "sl-tab-status") {
      Promise.all([TabbySync.getSettings(), TabbySync.getState(), TabbySync.getSyncStatus()])
        .then(function (r) {
          var settings = r[0], state = r[1], status = r[2];
          var groups = (state.groups || []).length;
          var links = 0;
          (state.groups || []).forEach(function (g) { links += (g.tabs || []).length; });
          sendResponse({
            enabled: settings.syncEnabled,
            configured: self.TabbySyncProviders.isConfigured(settings),
            syncName: settings.syncKey,
            encrypted: !!settings.passphrase,
            intervalMin: settings.autoSyncMinutes,
            groups: groups,
            links: links,
            lastStatus: status.status,
            lastError: status.error,
            lastAt: status.at
          });
        });
      return true;
    }
  });
})();
