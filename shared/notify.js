// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// notify.js — desktop notifications for sync failures.
//
// Off by default per engine (Options > Bookmarks/Tabs > More options): the
// popup's badge dot already shows an error, this is only for someone who
// doesn't have the popup open. Each engine calls syncError() itself, gated
// on its own "notifyErrors" setting, only when a sync transitions INTO an
// error state — never on every retry of one that's already failing, which
// would turn a slow network into a notification storm.
//
// Needs the "notifications" permission (manifest.json).
//
// Loaded for its side effect (sets self.TabbySyncNotify). Safe to import
// from the module service worker; never referenced from a page — a
// notification only ever fires from the background worker's own sync
// attempts, never from the popup/options/tab-list UI directly.
(function () {
  "use strict";

  function syncError(engineLabel, message) {
    if (!(self.chrome && chrome.notifications && chrome.notifications.create)) return;
    var id = "tabbysync-sync-error-" + engineLabel.toLowerCase() + "-" + Date.now();
    try {
      chrome.notifications.create(id, {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon-128.png"),
        title: "TabbySync — " + engineLabel + " sync failed",
        message: message || "Open the TabbySync popup for details.",
      }, function () { void chrome.runtime.lastError; });
    } catch (e) { /* notifications unavailable in this context — not fatal */ }
  }

  self.TabbySyncNotify = { syncError: syncError };
})();
