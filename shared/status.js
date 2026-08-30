// status.js — combined toolbar badge for SyncLocker.
//
// SyncLocker has two sync engines (bookmarks + tabs) but only one toolbar
// action, so they can't each own the icon. Instead both report their state
// here and this module renders a single badge dot that reflects the worst of
// the two:  amber = something syncing, red = an error, green = all good,
// cleared = nothing configured / both disabled.
//
// Loaded for its side effect (sets self.SyncLockerStatus). Safe to import from
// the module service worker and to reference from classic scripts.
(function () {
  "use strict";

  var state = { bookmarks: "none", tabs: "none" };

  var BADGE = {
    ok:      { color: "#16a34a", text: "●" },
    error:   { color: "#dc2626", text: "●" },
    syncing: { color: "#eab308", text: "●" },
    none:    { color: "#000000", text: "" },
  };

  function combined() {
    var v = [state.bookmarks, state.tabs];
    if (v.indexOf("syncing") >= 0) return "syncing";
    if (v.indexOf("error") >= 0) return "error";
    if (v.indexOf("ok") >= 0) return "ok";
    return "none";
  }

  function render() {
    var b = BADGE[combined()] || BADGE.none;
    try {
      chrome.action.setBadgeText({ text: b.text });
      if (b.text) {
        chrome.action.setBadgeBackgroundColor({ color: b.color });
        if (chrome.action.setBadgeTextColor) {
          chrome.action.setBadgeTextColor({ color: "#ffffff" });
        }
      }
    } catch (e) { /* action API not available in this context */ }
  }

  self.SyncLockerStatus = {
    // module: "bookmarks" | "tabs" ; kind: "ok" | "error" | "syncing" | "none"
    report: function (module, kind) {
      if (module in state) { state[module] = kind || "none"; render(); }
    },
    get: function () { return { bookmarks: state.bookmarks, tabs: state.tabs }; },
  };
})();
