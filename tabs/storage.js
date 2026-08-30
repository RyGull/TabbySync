/*
 * SyncLocker — tabs engine: storage + server-sync layer (single-list model).
 *
 * One stash list per extension install (i.e. per browser profile). The list is
 * stored in chrome.storage.local and mirrored to a remote JSON file via
 * shared/providers.js, which abstracts over whichever backend is configured
 * (a self-hosted endpoint, a GitHub Gist, or a JSONBin.io bin).
 *
 * Cross-machine model: you replicate your browser profiles (Work, Multimedia, …)
 * across computers with your browser's sync. In each browser profile you set a "sync key"
 * once (e.g. "work"); the list then syncs to a file named after it. The same-named
 * profile on another computer uses the same key -> same file -> shared list.
 *
 * Merges use per-group updatedAt (last-write-wins) plus tombstones so deletes
 * propagate instead of resurrecting.
 *
 * Part of SyncLocker: provider/server URL/token/sync name/passphrase come from
 * the SHARED config (self.SyncLockerConfig); tab files are namespaced
 * "tabs-<name>" so they share one destination + token with the bookmarks
 * engine. Loaded as a <script> in pages and imported for its side effect in
 * the module worker, so everything hangs off the global `TabStash`.
 */
(function () {
  "use strict";

  var STATE_KEY = "sl.tab.state";
  var ETAG_KEY = "sl.tab.etag";
  var pushTimer = null;

  function shared() { return self.SyncLockerConfig; }
  function providers() { return self.SyncLockerProviders; }

  function uid() {
    return Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  // Report tab-sync status to the shared toolbar badge. SyncLocker has one
  // action shared with the bookmarks engine, so we don't drive the icon here —
  // we hand our state to the badge coordinator, which shows the worst of both.
  //   "ok" (green), "err" (red), "neutral"/anything else (cleared).
  function setBadge(status) {
    try {
      var kind = status === "ok" ? "ok" : status === "err" ? "error" : "none";
      if (self.SyncLockerStatus) self.SyncLockerStatus.report("tabs", kind);
    } catch (e) { /* not available in this context */ }
  }

  function slugify(name) {
    return (
      (name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
    );
  }

  var TRASH_MAX = 200;
  var TRASH_TTL_MS = 30 * 24 * 3600 * 1000;

  function emptyState() {
    return { version: 1, groups: [], deleted: {}, trash: [], trashDeleted: {}, updatedAt: 0 };
  }

  // ---- local state ---------------------------------------------------------

  function getState() {
    return chrome.storage.local.get(STATE_KEY).then(function (r) {
      var s = r[STATE_KEY];
      if (!s || !Array.isArray(s.groups)) return emptyState();
      if (!s.deleted) s.deleted = {};
      if (!Array.isArray(s.trash)) s.trash = [];
      if (!s.trashDeleted) s.trashDeleted = {};
      return s;
    });
  }

  function saveState(state, opts) {
    opts = opts || {};
    state.updatedAt = Date.now();
    var o = {}; o[STATE_KEY] = state;
    return chrome.storage.local.set(o).then(function () {
      if (!opts.skipPush) schedulePush();
      return state;
    });
  }

  // ---- group helpers -------------------------------------------------------

  function makeGroup(tabs, name) {
    var now = Date.now();
    return {
      id: uid(), createdAt: now, updatedAt: now, name: name || "", locked: false, pinned: false,
      tabs: tabs.map(function (t) {
        return { url: t.url, title: t.title || t.url, favIconUrl: t.favIconUrl || "" };
      })
    };
  }

  function addGroup(state, tabs, name) {
    if (!tabs || !tabs.length) return state;
    state.groups.unshift(makeGroup(tabs, name));
    return state;
  }

  function touchGroup(g) { g.updatedAt = Date.now(); }

  // Filter a batch of tabs about to be stashed, per the dedupe mode:
  //   "allow" -> keep everything
  //   "group" -> drop repeats within this batch only
  //   "all"   -> also drop any URL already present anywhere in the list
  function dedupeTabsForStash(state, tabs, mode) {
    if (!mode || mode === "allow") return tabs.slice();
    var seen = {};
    if (mode === "all") {
      state.groups.forEach(function (g) {
        g.tabs.forEach(function (t) { seen[t.url] = true; });
      });
    }
    var out = [];
    tabs.forEach(function (t) {
      if (seen[t.url]) return;
      seen[t.url] = true;
      out.push(t);
    });
    return out;
  }

  // One-shot cleanup: remove duplicate URLs already in the list, keeping the
  // first occurrence (top = newest). Locked groups are left untouched but their
  // URLs win, so duplicates of a locked tab are removed from unlocked groups.
  function removeDuplicates(state) {
    var seen = {};
    state.groups.forEach(function (g) {
      if (g.locked) g.tabs.forEach(function (t) { seen[t.url] = true; });
    });
    state.groups.forEach(function (g) {
      if (g.locked) return;
      var before = g.tabs.length;
      g.tabs = g.tabs.filter(function (t) {
        if (seen[t.url]) return false;
        seen[t.url] = true;
        return true;
      });
      if (g.tabs.length !== before) touchGroup(g);
    });
    for (var i = state.groups.length - 1; i >= 0; i--) {
      if (!state.groups[i].tabs.length && !state.groups[i].locked) {
        state.deleted[state.groups[i].id] = Date.now();
        state.groups.splice(i, 1);
      }
    }
    return state;
  }

  function removeGroup(state, groupId) {
    var idx = state.groups.findIndex(function (g) { return g.id === groupId; });
    if (idx >= 0) {
      state.groups.splice(idx, 1);
      state.deleted[groupId] = Date.now();
    }
    return state;
  }

  // ---- settings ------------------------------------------------------------

  // Read the tabs engine's settings out of SyncLocker's shared config. Server
  // URL / token / sync name / passphrase are shared with the bookmarks engine;
  // syncEnabled mirrors the tabs feature toggle, so turning the feature off
  // stops the poll and the server writes.
  function getSettings() {
    return shared().getConfig().then(function (c) {
      return {
        syncEnabled: c.tabs.enabled,
        baseUrl: c.serverUrl,
        token: c.token,
        syncKey: c.syncName,             // shared profile name, e.g. "work"
        syncName: c.syncName,            // same value, name expected by shared/providers.js
        customUrl: "",                    // (no per-engine override in SyncLocker)
        // which sync backend the fields above apply to (see shared/providers.js)
        provider: c.provider,
        gistId: c.gistId,
        jsonbinTabsId: c.jsonbinTabsId,
        jsonbinBookmarksId: c.jsonbinBookmarksId,
        autoSyncMinutes: typeof c.tabs.intervalMin === "number" ? c.tabs.intervalMin : 5,
        // duplicate handling when stashing: "allow" | "group" | "all"
        dedupe: c.tabs.dedupe,
        // open restored lists into a native browser tab group
        restoreAsGroup: c.tabs.restoreAsGroup,
        // remove links from the list when restoring them (default off = keep)
        removeOnRestore: c.tabs.removeOnRestore,
        // keep the tab-list tab pinned
        pinList: c.tabs.pinList,
        // end-to-end encryption passphrase (shared; never sent to the server)
        passphrase: c.passphrase,
        // passphrase for encrypted backup files (local only, file use only)
        backupPass: c.tabs.backupPass
      };
    });
  }

  // Map a tab-shaped patch back onto the shared config keys.
  function setSettings(patch) {
    var out = {};
    if ("baseUrl" in patch) out.serverUrl = patch.baseUrl;
    if ("token" in patch) out.token = patch.token;
    if ("syncKey" in patch) out.syncName = patch.syncKey;
    if ("syncName" in patch) out.syncName = patch.syncName;
    if ("passphrase" in patch) out.passphrase = patch.passphrase;
    if ("provider" in patch) out.provider = patch.provider;
    if ("gistId" in patch) out.gistId = patch.gistId;
    if ("jsonbinTabsId" in patch) out.jsonbinTabsId = patch.jsonbinTabsId;
    if ("jsonbinBookmarksId" in patch) out.jsonbinBookmarksId = patch.jsonbinBookmarksId;
    var tabs = {};
    if ("syncEnabled" in patch) tabs.enabled = patch.syncEnabled;
    if ("autoSyncMinutes" in patch) tabs.intervalMin = patch.autoSyncMinutes;
    if ("dedupe" in patch) tabs.dedupe = patch.dedupe;
    if ("restoreAsGroup" in patch) tabs.restoreAsGroup = patch.restoreAsGroup;
    if ("backupPass" in patch) tabs.backupPass = patch.backupPass;
    if ("removeOnRestore" in patch) tabs.removeOnRestore = patch.removeOnRestore;
    if ("pinList" in patch) tabs.pinList = patch.pinList;
    out.tabs = tabs;
    return shared().setConfig(out).then(function () { return getSettings(); });
  }

  // ---- encryption (AES-256-GCM, key from passphrase via PBKDF2) ------------
  // The passphrase never leaves the device. Each saved file carries its own
  // random salt + IV, so any device that knows the passphrase can decrypt it.
  var PBKDF2_ITERS = 200000;

  function b64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  function ub64(str) {
    var bin = atob(str);
    var arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  }

  function deriveKey(passphrase, salt, iters) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, ["deriveKey"])
      .then(function (baseKey) {
        return crypto.subtle.deriveKey(
          { name: "PBKDF2", salt: salt, iterations: iters || PBKDF2_ITERS, hash: "SHA-256" },
          baseKey, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      });
  }

  function encryptString(passphrase, plaintext) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return deriveKey(passphrase, salt, PBKDF2_ITERS).then(function (key) {
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key,
        new TextEncoder().encode(plaintext));
    }).then(function (ctBuf) {
      return {
        app: "SyncLocker", enc: "v1", cipher: "AES-GCM", kdf: "PBKDF2-SHA256",
        iter: PBKDF2_ITERS, salt: b64(salt), iv: b64(iv), ct: b64(new Uint8Array(ctBuf))
      };
    });
  }

  function decryptEnvelope(passphrase, env) {
    var salt = ub64(env.salt), iv = ub64(env.iv), ct = ub64(env.ct);
    return deriveKey(passphrase, salt, env.iter || PBKDF2_ITERS).then(function (key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ct);
    }).then(function (ptBuf) {
      return new TextDecoder().decode(ptBuf);
    });
  }

  function isEncrypted(obj) { return obj && obj.enc === "v1" && obj.ct; }

  // ---- remote transport ------------------------------------------------------

  // Files are namespaced "tabs-<name>.json" so they share one destination +
  // token with the bookmarks engine ("bookmarks-<name>.json") without
  // colliding, regardless of which provider (self-hosted / Gist / JSONBin —
  // see shared/providers.js) that destination actually is.
  function remoteFileName(settings) {
    return "tabs-" + slugify(settings.syncKey || "") + ".json";
  }

  function serialize(settings, state) {
    return JSON.stringify({
      app: "SyncLocker",
      version: 1,
      key: settings.syncKey || "",
      updatedAt: state.updatedAt || Date.now(),
      deleted: state.deleted || {},
      trash: state.trash || [],
      trashDeleted: state.trashDeleted || {},
      groups: state.groups
    });
  }

  function parse(text) {
    var d = JSON.parse(text);
    var groups = d.groups || [];
    return {
      version: 1,
      updatedAt: d.updatedAt || 0,
      deleted: d.deleted || {},
      trash: Array.isArray(d.trash) ? d.trash : [],
      trashDeleted: d.trashDeleted || {},
      groups: groups.map(function (g) {
        return {
          id: g.id || uid(),
          createdAt: g.createdAt || Date.now(),
          updatedAt: g.updatedAt || g.createdAt || Date.now(),
          name: g.name || "",
          locked: !!g.locked,
          pinned: !!g.pinned,
          order: (typeof g.order === "number") ? g.order : undefined,
          tabs: (g.tabs || []).map(function (t) {
            return { url: t.url, title: t.title || t.url, favIconUrl: t.favIconUrl || "" };
          })
        };
      })
    };
  }

  function getEtag() {
    return chrome.storage.local.get(ETAG_KEY).then(function (r) { return r[ETAG_KEY] || ""; });
  }
  function setEtag(etag) {
    var o = {}; o[ETAG_KEY] = etag || "";
    return chrome.storage.local.set(o);
  }

  function pullRemote(settings) {
    if (!providers().isConfigured(settings)) return Promise.resolve(null);
    return providers().get(settings, remoteFileName(settings)).then(function (r) {
      var text = (r && r.text != null) ? r.text.trim() : "";
      var etag = (r && r.etag) || "";
      if (!text) return null;
      var obj = null;
      try { obj = JSON.parse(text); } catch (e) { obj = null; }
      if (isEncrypted(obj)) {
        if (!settings.passphrase) {
          var e1 = new Error("The synced list is encrypted — set your passphrase in Options to read it.");
          e1.needPass = true; throw e1;
        }
        return decryptEnvelope(settings.passphrase, obj)
          .then(function (json) { return { state: parse(json), etag: etag, encrypted: true }; })
          .catch(function (err) {
            if (err && err.needPass) throw err;
            var e2 = new Error("Wrong passphrase — could not decrypt the synced list.");
            e2.badPass = true; throw e2;
          });
      }
      // plaintext (unencrypted) file
      return { state: parse(text), etag: etag, encrypted: false };
    });
  }

  function pushRemote(settings, state, etag) {
    if (!providers().isConfigured(settings)) throw new Error("No sync destination configured — pick one in Options.");
    var bodyPromise = settings.passphrase
      ? encryptString(settings.passphrase, serialize(settings, state))
          .then(function (env) { return JSON.stringify(env); })
      : Promise.resolve(serialize(settings, state));

    return bodyPromise.then(function (body) {
      return providers().put(settings, remoteFileName(settings), body, etag);
    });
  }

  // ---- merge ---------------------------------------------------------------

  // A group's sort weight: explicit `order` if set, else newest-first fallback.
  function orderVal(g) {
    return (typeof g.order === "number") ? g.order : -g.createdAt;
  }
  // Pinned groups first; within each section by order; stable by createdAt.
  function compareGroups(a, b) {
    var pa = a.pinned ? 0 : 1, pb = b.pinned ? 0 : 1;
    if (pa !== pb) return pa - pb;
    var oa = orderVal(a), ob = orderVal(b);
    if (oa !== ob) return oa - ob;
    return b.createdAt - a.createdAt;
  }

  function mergeStates(local, remote) {
    if (!remote) return { state: local, changed: false };
    var deleted = {};
    [local.deleted || {}, remote.deleted || {}].forEach(function (map) {
      Object.keys(map).forEach(function (id) {
        deleted[id] = Math.max(deleted[id] || 0, map[id]);
      });
    });
    var byId = {};
    function consider(g) {
      var prev = byId[g.id];
      if (!prev || g.updatedAt >= prev.updatedAt) byId[g.id] = g;
    }
    (local.groups || []).forEach(consider);
    (remote.groups || []).forEach(consider);

    var groups = [];
    Object.keys(byId).forEach(function (id) {
      var g = byId[id];
      var delTs = deleted[id];
      if (delTs && delTs >= g.updatedAt) return;
      groups.push(g);
    });
    groups.sort(compareGroups);

    // merge trash: union by tid, drop tombstoned, prune by age + cap
    var trashDeleted = {};
    [local.trashDeleted || {}, remote.trashDeleted || {}].forEach(function (map) {
      Object.keys(map).forEach(function (id) {
        trashDeleted[id] = Math.max(trashDeleted[id] || 0, map[id]);
      });
    });
    var trashById = {};
    (local.trash || []).concat(remote.trash || []).forEach(function (e) {
      if (e && e.tid && !trashById[e.tid]) trashById[e.tid] = e;
    });
    var cutoff = Date.now() - TRASH_TTL_MS;
    var trash = Object.keys(trashById).map(function (k) { return trashById[k]; })
      .filter(function (e) { return !trashDeleted[e.tid]; })
      .filter(function (e) { return e.deletedAt >= cutoff; })
      .sort(function (a, b) { return b.deletedAt - a.deletedAt; })
      .slice(0, TRASH_MAX);
    Object.keys(trashDeleted).forEach(function (id) {
      if (trashDeleted[id] < cutoff) delete trashDeleted[id];
    });

    var merged = {
      version: 1, groups: groups, deleted: deleted,
      trash: trash, trashDeleted: trashDeleted,
      updatedAt: Math.max(local.updatedAt || 0, remote.updatedAt || 0)
    };
    var changed =
      JSON.stringify(stripVolatile(merged)) !== JSON.stringify(stripVolatile(local));
    return { state: merged, changed: changed };
  }

  function stripVolatile(state) {
    return {
      groups: (state.groups || []).map(function (g) {
        return {
          id: g.id, name: g.name, locked: g.locked,
          pinned: !!g.pinned, order: (typeof g.order === "number" ? g.order : null),
          tabs: g.tabs
        };
      }),
      trash: (state.trash || []).map(function (e) { return e.tid + "@" + e.deletedAt; }),
      trashDeleted: Object.keys(state.trashDeleted || {}).sort()
    };
  }
  function remoteDiffers(local, remote) {
    return JSON.stringify(stripVolatile(local)) !== JSON.stringify(stripVolatile(remote));
  }

  // ---- sync ----------------------------------------------------------------

  // Last sync outcome, so the popup can surface an error (mirrors the bookmarks
  // engine). Stored under its own key; changes here don't trigger a re-sync.
  var STATUS_KEY = "sl.tab.status";
  function setSyncStatus(status, error) {
    var o = {}; o[STATUS_KEY] = { status: status, error: error || "", at: Date.now() };
    return chrome.storage.local.set(o);
  }
  function getSyncStatus() {
    return chrome.storage.local.get(STATUS_KEY).then(function (r) {
      return r[STATUS_KEY] || { status: "never synced", error: "", at: 0 };
    });
  }

  function syncNow(force) {
    return getSettings().then(function (settings) {
      if (!settings.syncEnabled && !force) { setBadge("neutral"); return getState(); }
      if (!providers().isConfigured(settings)) { setBadge("neutral"); return getState(); }
      return doSync(settings, 0).then(function (st) {
        setBadge("ok");
        setSyncStatus("ok", "");
        return st;
      }).catch(function (e) {
        setBadge("err");
        setSyncStatus("error", e && (e.message || String(e)));
        throw e;
      });
    });
  }

  function doSync(settings, attempt) {
    return Promise.all([getState(), pullRemote(settings)]).then(function (r) {
      var initialLocal = r[0];
      var pulled = r[1];
      var remote = pulled ? pulled.state : null;
      var etag = pulled ? pulled.etag : "";
      var afterPull = mergeStates(initialLocal, remote).state;

      // Re-read local storage right before writing. Pulling from the server
      // can take a while (network round trip), and in that window this same
      // page (or another open tab, or the background worker's own sync) may
      // have saved a newer local change — e.g. a delete that added a trash
      // entry. Merging the freshest local state against what we just pulled
      // folds any such change back in, instead of this write silently
      // clobbering it with the stale snapshot we started with.
      return getState().then(function (freshLocal) {
        var m = mergeStates(freshLocal, afterPull);

        var saveIfChanged = m.changed
          ? saveState(m.state, { skipPush: true })
          : Promise.resolve(m.state);

        return saveIfChanged.then(function () {
          // Force a re-write if the file's encryption state doesn't match our
          // current setting (e.g. we just turned encryption on or off).
          var wantEnc = !!settings.passphrase;
          var remoteEnc = pulled ? !!pulled.encrypted : false;
          var encMismatch = !!remote && remoteEnc !== wantEnc;
          var needPush = !remote || m.changed || remoteDiffers(m.state, remote) || encMismatch;
          if (!needPush) return setEtag(etag).then(function () { return m.state; });
          return pushRemote(settings, m.state, etag)
            .then(function (res) { return setEtag(res.etag).then(function () { return m.state; }); })
            .catch(function (e) {
              if (e.conflict && attempt < 1) return doSync(settings, attempt + 1);
              throw e;
            });
        });
      });
    });
  }

  // Overwrite the server file with our current local state, no pull/merge and
  // no If-Match. Used for encryption transitions (turn on/off, change phrase),
  // where reading the old remote may be impossible with the new passphrase.
  function pushLocalOverwrite() {
    return Promise.all([getSettings(), getState()]).then(function (r) {
      var settings = r[0], state = r[1];
      if (!providers().isConfigured(settings)) return state;
      return pushRemote(settings, state, "").then(function (res) {
        return setEtag(res.etag).then(function () { return state; });
      });
    });
  }

  function testConnection(settings) {
    if (!providers().isConfigured(settings)) return Promise.reject(new Error("Not configured yet — pick a sync method in Options."));
    return providers().get(settings, remoteFileName(settings))
      .then(function (r) { return { status: (r && r.text != null) ? 200 : 404, ok: true }; })
      .catch(function (e) { return { status: 0, ok: false, error: e && e.message }; });
  }

  function schedulePush() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushTimer = null;
      getSettings().then(function (settings) {
        if (!settings.syncEnabled || !providers().isConfigured(settings)) return;
        return syncNow().catch(function (e) {
          console.warn("[SyncLocker] sync failed:", e && e.message);
        });
      });
    }, 1500);
  }

  // ---- trash (recovery history, part of synced state) ----------------------
  // Deleted groups/tabs are copied into state.trash so they can be restored.
  // Removals are tombstoned in state.trashDeleted so they don't resurrect on
  // sync. Both are capped by count and age.
  function pruneTrash(state) {
    var cutoff = Date.now() - TRASH_TTL_MS;
    state.trash = (state.trash || [])
      .filter(function (e) { return !state.trashDeleted[e.tid]; })
      .filter(function (e) { return e.deletedAt >= cutoff; })
      .sort(function (a, b) { return b.deletedAt - a.deletedAt; })
      .slice(0, TRASH_MAX);
    Object.keys(state.trashDeleted || {}).forEach(function (id) {
      if (state.trashDeleted[id] < cutoff) delete state.trashDeleted[id];
    });
    return state;
  }
  // entries: [{ kind:"group"|"tab", name, sourceName?, tabs:[...] }]
  function trashAdd(state, entries) {
    if (!entries || !entries.length) return state;
    if (!state.trash) state.trash = [];
    if (!state.trashDeleted) state.trashDeleted = {};
    var now = Date.now();
    entries.forEach(function (e) {
      state.trash.unshift({
        tid: uid(), deletedAt: now,
        kind: e.kind || "group",
        name: e.name || "",
        sourceName: e.sourceName || "",
        tabs: (e.tabs || []).map(function (t) {
          return { url: t.url, title: t.title || t.url, favIconUrl: t.favIconUrl || "" };
        })
      });
    });
    return pruneTrash(state);
  }
  function trashRemove(state, tid) {
    if (!state.trashDeleted) state.trashDeleted = {};
    state.trash = (state.trash || []).filter(function (x) { return x.tid !== tid; });
    state.trashDeleted[tid] = Date.now();
    return state;
  }
  function trashEmpty(state) {
    if (!state.trashDeleted) state.trashDeleted = {};
    (state.trash || []).forEach(function (x) { state.trashDeleted[x.tid] = Date.now(); });
    state.trash = [];
    return state;
  }

  // ---- import / export -----------------------------------------------------

  function exportJSON(settings, state) {
    return JSON.stringify(
      {
        app: "SyncLocker", version: 1,
        key: (settings && settings.syncKey) || "",
        exportedAt: new Date().toISOString(),
        groups: state.groups
      },
      null, 2
    );
  }

  function importFromJSON(state, text) {
    var data = JSON.parse(text);
    var incoming = data.groups || data;
    if (!Array.isArray(incoming)) throw new Error("No groups found in file");
    incoming.forEach(function (g) {
      var now = Date.now();
      state.groups.unshift({
        id: uid(), createdAt: g.createdAt || now, updatedAt: now,
        name: g.name || "", locked: !!g.locked, pinned: !!g.pinned,
        tabs: (g.tabs || []).map(function (t) {
          return { url: t.url, title: t.title || t.url, favIconUrl: t.favIconUrl || "" };
        })
      });
    });
    return state;
  }

  // Backup string: encrypted envelope when a passphrase is set, else plain JSON.
  function makeBackup(settings, state) {
    var plaintext = exportJSON(settings, state);
    if (settings && settings.passphrase) {
      return encryptString(settings.passphrase, plaintext).then(function (env) {
        return JSON.stringify(env, null, 2);
      });
    }
    return Promise.resolve(plaintext);
  }

  // Import a backup (plain JSON, encrypted envelope, or a URL list) into state.
  function importBackup(state, text, settings) {
    var trimmed = (text || "").trim();
    var obj = null;
    try { obj = JSON.parse(trimmed); } catch (e) { obj = null; }
    if (isEncrypted(obj)) {
      if (!settings || !settings.passphrase) {
        return Promise.reject(new Error("This backup is encrypted — set your passphrase in Options first."));
      }
      return decryptEnvelope(settings.passphrase, obj)
        .then(function (json) { return importFromJSON(state, json); })
        .catch(function (err) {
          if (err && /passphrase/i.test(err.message)) throw err;
          throw new Error("Wrong passphrase for this backup.");
        });
    }
    if (trimmed[0] === "{" || trimmed[0] === "[") return Promise.resolve(importFromJSON(state, trimmed));
    return Promise.resolve(importFromText(state, trimmed));
  }

  // Merge groups into state without creating duplicate links (matched by URL).
  // Existing links win; imported duplicates are skipped. Nothing is removed.
  function importMergeGroups(state, groups) {
    var seen = {};
    state.groups.forEach(function (g) { g.tabs.forEach(function (t) { seen[t.url] = true; }); });
    var added = 0, skipped = 0, newGroups = 0;
    // iterate reversed so the first imported group ends up on top
    (groups || []).slice().reverse().forEach(function (g) {
      var tabs = [];
      (g.tabs || []).forEach(function (t) {
        if (!t || !t.url) return;
        if (seen[t.url]) { skipped++; return; }
        seen[t.url] = true;
        tabs.push({ url: t.url, title: t.title || t.url, favIconUrl: t.favIconUrl || "" });
      });
      if (tabs.length) {
        state.groups.unshift({
          id: uid(), createdAt: g.createdAt || Date.now(), updatedAt: Date.now(),
          name: g.name || "", locked: !!g.locked, pinned: !!g.pinned, tabs: tabs
        });
        added += tabs.length; newGroups++;
      }
    });
    return { added: added, skipped: skipped, groups: newGroups };
  }

  function importMergeText(state, text) {
    var trimmed = (text || "").trim();
    var groups = [];
    var obj = null;
    try { obj = JSON.parse(trimmed); } catch (e) { obj = null; }
    if (obj) {
      groups = obj.groups || (Array.isArray(obj) ? obj : []);
    } else {
      // Plain URL list. One or more BLANK LINES split it into separate groups;
      // each block of consecutive URL lines becomes its own group.
      trimmed.split(/\r?\n[ \t]*\r?\n+/).forEach(function (block) {
        var tabs = [];
        block.split(/\r?\n/).forEach(function (line) {
          line = line.trim(); if (!line) return;
          var p = line.split("|");
          var url = p[0].trim(); var title = p.slice(1).join("|").trim();
          if (/^(https?|file|chrome):/i.test(url)) tabs.push({ url: url, title: title || url });
        });
        if (tabs.length) groups.push({ name: "", tabs: tabs });
      });
    }
    return importMergeGroups(state, groups);
  }

  // Merge-import a backup file: plain JSON, encrypted envelope, or URL list.
  function importBackupMerge(state, text, passphrase) {
    var trimmed = (text || "").trim();
    var obj = null;
    try { obj = JSON.parse(trimmed); } catch (e) { obj = null; }
    if (isEncrypted(obj)) {
      if (!passphrase) {
        return Promise.reject(new Error("This backup is encrypted — enter the backup passphrase and use “Import encrypted backup”."));
      }
      return decryptEnvelope(passphrase, obj)
        .then(function (json) { return importMergeText(state, json); })
        .catch(function (e) {
          if (e && /passphrase|encrypted/i.test(e.message)) throw e;
          throw new Error("Wrong passphrase for this backup.");
        });
    }
    return Promise.resolve(importMergeText(state, trimmed));
  }

  function importFromText(state, text) {
    // One or more BLANK LINES split the pasted list into separate groups; each
    // block of consecutive URL lines becomes its own group (added top-first).
    var blocks = (text || "").replace(/^\s+|\s+$/g, "").split(/\r?\n[ \t]*\r?\n+/);
    blocks.slice().reverse().forEach(function (block) {
      var tabs = [];
      block.split(/\r?\n/).forEach(function (line) {
        line = line.trim();
        if (!line) return;
        var parts = line.split("|");
        var url = parts[0].trim();
        var title = parts.slice(1).join("|").trim();
        if (/^https?:\/\//i.test(url) || /^chrome/i.test(url) || /^file:/i.test(url)) {
          tabs.push({ url: url, title: title || url, favIconUrl: "" });
        }
      });
      if (tabs.length) addGroup(state, tabs, "");
    });
    return state;
  }

  var TabStash = {
    STATE_KEY: STATE_KEY,
    STATUS_KEY: STATUS_KEY,
    emptyState: emptyState,
    uid: uid,
    slugify: slugify,
    getState: getState,
    saveState: saveState,
    addGroup: addGroup,
    makeGroup: makeGroup,
    touchGroup: touchGroup,
    removeGroup: removeGroup,
    compareGroups: compareGroups,
    orderVal: orderVal,
    dedupeTabsForStash: dedupeTabsForStash,
    removeDuplicates: removeDuplicates,
    getSettings: getSettings,
    setSettings: setSettings,
    pullRemote: pullRemote,
    pushRemote: pushRemote,
    mergeStates: mergeStates,
    syncNow: syncNow,
    getSyncStatus: getSyncStatus,
    pushLocalOverwrite: pushLocalOverwrite,
    testConnection: testConnection,
    schedulePush: schedulePush,
    exportJSON: exportJSON,
    importFromJSON: importFromJSON,
    importFromText: importFromText,
    makeBackup: makeBackup,
    importBackup: importBackup,
    importBackupMerge: importBackupMerge,
    importMergeText: importMergeText,
    trashAdd: trashAdd,
    trashRemove: trashRemove,
    trashEmpty: trashEmpty,
    encryptString: encryptString,
    decryptEnvelope: decryptEnvelope,
    isEncrypted: isEncrypted
  };

  if (typeof self !== "undefined") self.TabStash = TabStash;
  if (typeof window !== "undefined") window.TabStash = TabStash;
  if (typeof module !== "undefined" && module.exports) module.exports = TabStash;
})();
