// config.js — SyncLocker's shared configuration layer.
//
// Both engines (bookmarks + tabs) talk to ONE server, with ONE token, one
// sync name and one optional encryption passphrase. That shared config lives
// here so there is a single source of truth for the storage keys; each engine
// reads it and maps it onto its own internal field names.
//
// Files on the server are namespaced by a per-engine prefix, so a single
// endpoint + token serves both without collisions:
//     <endpoint>?name=bookmarks-<syncName>.json
//     <endpoint>?name=tabs-<syncName>.json
//
// Written as a classic IIFE that sets self.SyncLockerConfig, so it works both
// as a <script> on the pages and as a side-effect import in the module worker.
(function () {
  "use strict";

  // Canonical chrome.storage.local keys. Never write these strings anywhere
  // else — go through this module.
  var K = {
    serverUrl: "sl.serverUrl",
    token: "sl.token",
    syncName: "sl.syncName",
    passphrase: "sl.passphrase",
    genToken: "sl.genToken",

    // Which sync backend "serverUrl"/"token" above apply to. "custom" (the
    // default) is the self-hosted synclocker.php endpoint; "gist" and
    // "jsonbin" are free no-server alternatives (see shared/providers.js).
    provider: "sl.provider",
    gistId: "sl.gist.id",
    jsonbinTabsId: "sl.jsonbin.tabsId",
    jsonbinBookmarksId: "sl.jsonbin.bookmarksId",

    bmEnabled: "sl.bm.enabled",
    bmInterval: "sl.bm.intervalMin",
    bmAutoSync: "sl.bm.autoSync",
    bmDeleteWins: "sl.bm.deleteWins",

    tabEnabled: "sl.tab.enabled",
    tabInterval: "sl.tab.intervalMin",
    tabDedupe: "sl.tab.dedupe",
    tabRestoreGroup: "sl.tab.restoreAsGroup",
    tabBackupPass: "sl.tab.backupPass",
    tabRemoveOnRestore: "sl.tab.removeOnRestore",
    tabPinList: "sl.tab.pinList",
  };

  var ALL = Object.keys(K).map(function (k) { return K[k]; });

  // Changing any of these should kick an immediate re-sync on both engines.
  var SERVER_KEYS = [
    K.serverUrl, K.token, K.syncName, K.passphrase,
    K.provider, K.gistId, K.jsonbinTabsId, K.jsonbinBookmarksId,
  ];

  function num(v, d) { var n = Number(v); return isNaN(n) ? d : n; }

  // Read the whole shared config as a nested object with defaults applied.
  function getConfig() {
    return chrome.storage.local.get(ALL).then(function (s) {
      return {
        serverUrl: s[K.serverUrl] || "",
        token: s[K.token] || "",
        syncName: s[K.syncName] || "",
        passphrase: s[K.passphrase] || "",
        genToken: s[K.genToken] || "",
        provider: s[K.provider] || "custom",       // default: self-hosted
        gistId: s[K.gistId] || "",
        jsonbinTabsId: s[K.jsonbinTabsId] || "",
        jsonbinBookmarksId: s[K.jsonbinBookmarksId] || "",
        bookmarks: {
          enabled: s[K.bmEnabled] !== false,          // default on
          intervalMin: Math.max(1, num(s[K.bmInterval], 5)),
          autoSync: s[K.bmAutoSync] !== false,        // default on
          deleteWins: s[K.bmDeleteWins] === true,     // default off
        },
        tabs: {
          enabled: s[K.tabEnabled] !== false,         // default on
          intervalMin: num(s[K.tabInterval], 5),
          dedupe: s[K.tabDedupe] || "",   // no default — the user must choose in Options
          restoreAsGroup: s[K.tabRestoreGroup] === true,
          backupPass: s[K.tabBackupPass] || "",
          removeOnRestore: s[K.tabRemoveOnRestore] === true, // default off (keep on restore)
          pinList: s[K.tabPinList] === true,                 // default off
        },
      };
    });
  }

  // Write a partial config. Accepts the same nested shape as getConfig()
  // returns; only provided fields are written.
  function setConfig(patch) {
    var out = {};
    if ("serverUrl" in patch) out[K.serverUrl] = patch.serverUrl;
    if ("token" in patch) out[K.token] = patch.token;
    if ("syncName" in patch) out[K.syncName] = patch.syncName;
    if ("passphrase" in patch) out[K.passphrase] = patch.passphrase;
    if ("genToken" in patch) out[K.genToken] = patch.genToken;
    if ("provider" in patch) out[K.provider] = patch.provider;
    if ("gistId" in patch) out[K.gistId] = patch.gistId;
    if ("jsonbinTabsId" in patch) out[K.jsonbinTabsId] = patch.jsonbinTabsId;
    if ("jsonbinBookmarksId" in patch) out[K.jsonbinBookmarksId] = patch.jsonbinBookmarksId;
    if (patch.bookmarks) {
      var b = patch.bookmarks;
      if ("enabled" in b) out[K.bmEnabled] = b.enabled;
      if ("intervalMin" in b) out[K.bmInterval] = b.intervalMin;
      if ("autoSync" in b) out[K.bmAutoSync] = b.autoSync;
      if ("deleteWins" in b) out[K.bmDeleteWins] = b.deleteWins;
    }
    if (patch.tabs) {
      var t = patch.tabs;
      if ("enabled" in t) out[K.tabEnabled] = t.enabled;
      if ("intervalMin" in t) out[K.tabInterval] = t.intervalMin;
      if ("dedupe" in t) out[K.tabDedupe] = t.dedupe;
      if ("restoreAsGroup" in t) out[K.tabRestoreGroup] = t.restoreAsGroup;
      if ("backupPass" in t) out[K.tabBackupPass] = t.backupPass;
      if ("removeOnRestore" in t) out[K.tabRemoveOnRestore] = t.removeOnRestore;
      if ("pinList" in t) out[K.tabPinList] = t.pinList;
    }
    return chrome.storage.local.set(out);
  }

  // Does a storage.onChanged `changes` object touch any server field?
  function serverChanged(changes) {
    return SERVER_KEYS.some(function (k) { return k in changes; });
  }

  // The sync name is embedded in remote filenames (bookmarks-<name>.json /
  // tabs-<name>.json) and shown all over the UI (Options preview, the
  // popup, the tab-list status block) — so it needs to be both filename-safe
  // and short enough not to overflow those layouts. This matches the regex
  // the generated synclocker.php server itself requires
  // (/^(bookmarks|tabs)-[A-Za-z0-9._-]+\.json$/), so a name that passes here
  // is guaranteed to be accepted there too.
  var SYNC_NAME_MAX = 40;
  function sanitizeSyncName(name) {
    return (name || "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .slice(0, SYNC_NAME_MAX)
      // Trim leading/trailing separators — including any left dangling right
      // at the cut point by the length limit above.
      .replace(/^[-.]+|[-.]+$/g, "");
  }

  self.SyncLockerConfig = {
    KEYS: K,
    SERVER_KEYS: SERVER_KEYS,
    SYNC_NAME_MAX: SYNC_NAME_MAX,
    sanitizeSyncName: sanitizeSyncName,
    getConfig: getConfig,
    setConfig: setConfig,
    serverChanged: serverChanged,
    keyFor: function (name) { return K[name]; },
  };
})();
