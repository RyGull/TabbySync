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
  var RETRY_ALARM = "sl.tab.retry";

  // A conflict usually clears on its own within doSync's own retries (see
  // tabs/storage.js) — but if those are exhausted too, don't just sit on it
  // until the next scheduled sync, which can be minutes away. Follow up
  // again soon instead. Capped, so a conflict that never clears (as
  // opposed to two devices racing at the same moment) doesn't turn into an
  // indefinite once-a-minute retry loop — it falls back to the normal
  // interval, same as any other sync error.
  var MAX_AUTO_RETRIES = 3;
  var autoRetryCount = 0;
  function scheduleConflictRetry() {
    if (autoRetryCount >= MAX_AUTO_RETRIES) return;
    autoRetryCount++;
    // Jittered, same reasoning as doSync's own backoff (tabs/storage.js): if
    // two devices are conflicting because their sync timing is aligned, a
    // fixed delay here just lines the follow-up retries up the same way,
    // burning the whole budget without ever breaking the tie.
    var delay = autoRetryCount + Math.random();
    chrome.alarms.create(RETRY_ALARM, { delayInMinutes: delay });
  }

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

  function stash(mode) {
    return tabsEnabled().then(function (enabled) {
      if (!enabled) return openOrFocusList();
      return collectTabs(mode).then(function (tabs) {
        if (!tabs.length) return openOrFocusList();
        return Promise.all([TabbySync.getSettings(), TabbySync.getState()]).then(function (r) {
          var settings = r[0], state = r[1];
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
      // A reschedule (startup, install, or a settings change) starts a new
      // episode — give it a fresh short-retry budget, and drop any retry
      // left over from whatever was going on before.
      autoRetryCount = 0;
      return Promise.all([chrome.alarms.clear(POLL_ALARM), chrome.alarms.clear(RETRY_ALARM)]).then(function () {
        if (settings.syncEnabled && settings.autoSyncMinutes > 0) {
          chrome.alarms.create(POLL_ALARM, { periodInMinutes: Math.max(1, settings.autoSyncMinutes) });
        }
      });
    });
  }

  chrome.alarms.onAlarm.addListener(function (alarm) {
    if (alarm.name !== POLL_ALARM && alarm.name !== RETRY_ALARM) return;
    if (alarm.name === POLL_ALARM) autoRetryCount = 0; // each scheduled cycle gets its own budget
    TabbySync.syncNow()
      .then(function () {
        autoRetryCount = 0;
        chrome.runtime.sendMessage({ type: "tabbysync-refresh" }).catch(function () {});
      })
      .catch(function (e) { if (e && e.conflict) scheduleConflictRetry(); });
  });

  chrome.runtime.onInstalled.addListener(function () {
    buildMenus();
    rescheduleAlarm().then(function () { return TabbySync.syncNow(); })
      .catch(function (e) { if (e && e.conflict) scheduleConflictRetry(); });
  });

  chrome.runtime.onStartup.addListener(function () {
    buildMenus();
    rescheduleAlarm().then(function () { return TabbySync.syncNow(); })
      .catch(function (e) { if (e && e.conflict) scheduleConflictRetry(); });
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
      .catch(function (e) { if (e && e.conflict) scheduleConflictRetry(); });
  });

  // ---- messages from pages -------------------------------------------------

  chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
    if (!msg) return;
    if (msg.type === "tabbysync-sync") {
      TabbySync.syncNow(true)
        .then(function () { autoRetryCount = 0; sendResponse({ ok: true }); })
        .catch(function (e) {
          // The popup shows this error right away, but also follow up in
          // the background in case the user doesn't retry manually.
          if (e && e.conflict) scheduleConflictRetry();
          sendResponse({ ok: false, error: e && e.message });
        });
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
