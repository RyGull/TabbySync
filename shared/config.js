// config.js — TabbySync's shared configuration layer.
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
// Written as a classic IIFE that sets self.TabbySyncConfig, so it works both
// as a <script> on the pages and as a side-effect import in the module worker.
(function () {
  "use strict";

  // Canonical chrome.storage.local keys. Never write these strings anywhere
  // else — go through this module.
  var K = {
    serverUrl: "sl.serverUrl",
    // "token" and "syncName" are the SELF-HOSTED provider's own credential
    // slots (kept under their original, pre-multi-provider key names).
    // Gist and JSONBin get their own separate slots below — each provider
    // remembers its own credentials independently, so switching the sync
    // method in Options and back doesn't clobber whatever you had saved
    // for the others. See the migration note in getConfig() below.
    token: "sl.token",
    syncName: "sl.syncName",
    gistToken: "sl.gist.token",
    gistSyncName: "sl.gist.syncName",
    jsonbinToken: "sl.jsonbin.token",
    // Purely cosmetic, local-only label — never sent anywhere and never
    // embedded in a remote filename. Exists so profiles that have no
    // functional "sync name" (JSONBin, see needsSyncName in providers.js)
    // can still be told apart in the popup/Options UI.
    profileLabel: "sl.profileLabel",
    // Encryption passphrase — also per-provider, same reasoning as
    // token/syncName above: you might use one passphrase for a self-hosted
    // setup and a different one for a JSONBin profile, and switching
    // methods shouldn't overwrite one with the other.
    passphrase: "sl.passphrase",
    gistPassphrase: "sl.gist.passphrase",
    jsonbinPassphrase: "sl.jsonbin.passphrase",
    genToken: "sl.genToken",

    // Which sync backend applies right now — "custom" (the default) is the
    // self-hosted tabbysync.php endpoint; "gist" and "jsonbin" are free
    // no-server alternatives (see shared/providers.js). getConfig() below
    // resolves "token"/"syncName" to whichever of the slots above matches
    // this.
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
    K.serverUrl, K.token, K.syncName, K.gistToken, K.gistSyncName, K.jsonbinToken,
    K.passphrase, K.gistPassphrase, K.jsonbinPassphrase,
    K.provider, K.gistId, K.jsonbinTabsId, K.jsonbinBookmarksId,
  ];

  function num(v, d) { var n = Number(v); return isNaN(n) ? d : n; }

  // Read the whole shared config as a nested object with defaults applied.
  //
  // "token", "syncName" and "passphrase" here are resolved to whichever
  // provider is currently active, so every existing caller (the sync
  // engines, the popup, the tab-list page) keeps working unchanged — they
  // just always get "this provider's" credentials. The Options page
  // additionally needs each PROVIDER's own remembered value (so switching
  // the sync-method dropdown can restore what you last saved for it,
  // instead of showing whatever's left over from the provider you were
  // just editing), so the raw per-provider fields are exposed too:
  // customToken, customSyncName, customPassphrase, gistToken,
  // gistSyncName, gistPassphrase, jsonbinToken, jsonbinPassphrase.
  function getConfig() {
    return chrome.storage.local.get(ALL).then(function (s) {
      var provider = s[K.provider] || "custom";
      var customToken = s[K.token] || "";
      var customSyncName = s[K.syncName] || "";

      // One-time migration: before Gist/JSONBin had their own credential
      // slots, they shared "token"/"syncName" with self-hosting — whichever
      // provider happened to be active. If this provider has never been
      // given its own slot yet (key never written), and it's the one
      // that's currently active, seed its slot from that shared value so
      // an already-working setup doesn't go blank after this update. Once
      // anything is saved through the new per-provider slots, this no
      // longer applies.
      var gistToken = (K.gistToken in s) ? s[K.gistToken] : (provider === "gist" ? customToken : "");
      var gistSyncName = (K.gistSyncName in s) ? s[K.gistSyncName] : (provider === "gist" ? customSyncName : "");
      var jsonbinToken = (K.jsonbinToken in s) ? s[K.jsonbinToken] : (provider === "jsonbin" ? customToken : "");
      gistToken = gistToken || ""; gistSyncName = gistSyncName || ""; jsonbinToken = jsonbinToken || "";

      var customPassphrase = s[K.passphrase] || "";
      var gistPassphrase = (K.gistPassphrase in s) ? s[K.gistPassphrase] : (provider === "gist" ? customPassphrase : "");
      var jsonbinPassphrase = (K.jsonbinPassphrase in s) ? s[K.jsonbinPassphrase] : (provider === "jsonbin" ? customPassphrase : "");
      gistPassphrase = gistPassphrase || ""; jsonbinPassphrase = jsonbinPassphrase || "";

      var token = provider === "gist" ? gistToken : provider === "jsonbin" ? jsonbinToken : customToken;
      // JSONBin has no sync name of its own (needsSyncName: false).
      var syncName = provider === "gist" ? gistSyncName : customSyncName;
      var passphrase = provider === "gist" ? gistPassphrase : provider === "jsonbin" ? jsonbinPassphrase : customPassphrase;

      return {
        serverUrl: s[K.serverUrl] || "",
        token: token,
        syncName: syncName,
        customToken: customToken,
        customSyncName: customSyncName,
        gistToken: gistToken,
        gistSyncName: gistSyncName,
        jsonbinToken: jsonbinToken,
        profileLabel: s[K.profileLabel] || "",
        passphrase: passphrase,
        customPassphrase: customPassphrase,
        gistPassphrase: gistPassphrase,
        jsonbinPassphrase: jsonbinPassphrase,
        genToken: s[K.genToken] || "",
        provider: provider,
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
  //
  // "token"/"syncName"/"passphrase" route to whichever provider's slot
  // "provider" (in this same patch) names, so saving one provider's
  // credentials never touches another's — that's the whole point of the
  // per-provider slots above. A patch with one of these but no "provider"
  // (there's no such caller today) falls back to the self-hosted slot,
  // matching this module's behavior before Gist/JSONBin got their own.
  function setConfig(patch) {
    var out = {};
    if ("serverUrl" in patch) out[K.serverUrl] = patch.serverUrl;
    if ("token" in patch || "syncName" in patch) {
      var p = patch.provider;
      if (p === "gist") {
        if ("token" in patch) out[K.gistToken] = patch.token;
        if ("syncName" in patch) out[K.gistSyncName] = patch.syncName;
      } else if (p === "jsonbin") {
        // JSONBin has no functional sync name — nothing to route it to.
        if ("token" in patch) out[K.jsonbinToken] = patch.token;
      } else {
        if ("token" in patch) out[K.token] = patch.token;
        if ("syncName" in patch) out[K.syncName] = patch.syncName;
      }
    }
    if ("profileLabel" in patch) out[K.profileLabel] = patch.profileLabel;
    if ("passphrase" in patch) {
      var pp = patch.provider;
      if (pp === "gist") out[K.gistPassphrase] = patch.passphrase;
      else if (pp === "jsonbin") out[K.jsonbinPassphrase] = patch.passphrase;
      else out[K.passphrase] = patch.passphrase;
    }
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
  // the generated tabbysync.php server itself requires
  // (/^(bookmarks|tabs)-[A-Za-z0-9._-]+\.json$/), so a name that passes here
  // is guaranteed to be accepted there too.
  // IMPORTANT: never lowercase (or otherwise alter) an already-valid
  // character here — the server regex explicitly allows mixed case, and
  // changing an existing name's casing/characters silently produces a
  // DIFFERENT filename than whatever this profile has been syncing to all
  // along. The sync engine treats "file not found at the new name" as "the
  // other device deleted everything," and applies that deletion straight to
  // the live browser bookmarks — so a change here that isn't a strict no-op
  // for already-valid names is a data-loss bug, not just a cosmetic one.
  var SYNC_NAME_MAX = 40;
  function sanitizeSyncName(name) {
    return (name || "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .slice(0, SYNC_NAME_MAX)
      // Trim leading/trailing separators — including any left dangling right
      // at the cut point by the length limit above.
      .replace(/^[-.]+|[-.]+$/g, "");
  }

  self.TabbySyncConfig = {
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
