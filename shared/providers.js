/*
 * TabbySync — pluggable sync backends ("providers").
 *
 * Both engines (bookmarks + tabs) read/write ONE small JSON file per engine
 * (bookmarks-<name>.json / tabs-<name>.json). Historically that file lived on
 * a self-hosted endpoint (tabbysync.php) — the most private option, since
 * the data never leaves a server you control, but it requires having a web
 * server at all, which is a real barrier for non-technical users.
 *
 * This module abstracts "read this named file" / "write this named file"
 * behind a small interface so other free, no-server options can be offered
 * alongside self-hosting:
 *   - custom  — the original self-hosted endpoint (GET/PUT, bearer token)
 *   - gist    — a private GitHub Gist (one gist holds both engines' files)
 *   - jsonbin — JSONBin.io (one bin per engine; auto-created on first use)
 *
 * All the encryption, parsing and multi-device merge logic stays exactly
 * where it already lived (tabs/storage.js, bookmarks/lib/sync.js) — this
 * module only knows how to fetch or store raw text for a given provider.
 * `get` returns { text, etag } (text is null if nothing is stored yet);
 * `put` takes an optional etag and returns { etag }. Only the "custom"
 * provider actually honors etags for conditional writes (If-Match) — Gist
 * and JSONBin don't support that, so they just overwrite unconditionally
 * and return etag: ""; the app's own content-level merge (last-write-wins
 * per group, with tombstones) is what keeps concurrent edits safe either way.
 *
 * Written as a classic IIFE that sets self.TabbySyncProviders, so it works
 * both as a <script> on the pages and as a side-effect import in the module
 * worker — same pattern as shared/config.js.
 */
(function () {
  "use strict";

  function shared() { return self.TabbySyncConfig; }

  // ---- provider metadata, for the Options UI --------------------------------
  // `disclaimer` is shown next to the picker for anything that isn't your own
  // server — these are third-party services with their own access + retention
  // policies, so callers should surface it and steer people toward turning on
  // the encryption passphrase.
  var PROVIDERS = {
    custom: {
      id: "custom",
      label: "Self-hosted (recommended)",
      tokenLabel: "Bearer token",
      tokenPlaceholder: "the token inside tabbysync.php",
      needsUrl: true,
      needsSyncName: true,
      setupHint: "Your own server — see <a href=\"#selfhostCard\">“Self-hosting” below</a> if you don't have one yet.",
      disclaimer: ""
    },
    gist: {
      id: "gist",
      label: "GitHub Gist (free, no server)",
      tokenLabel: "GitHub personal access token",
      tokenPlaceholder: "github_pat_…",
      needsUrl: false,
      needsSyncName: true,
      setupHint: "Create a token at <a href=\"https://github.com/settings/personal-access-tokens/new\" target=\"_blank\" rel=\"noopener\">github.com → Settings → Developer settings → " +
        "Personal access tokens → Fine-grained tokens</a>, scoped to just “Gists: Read and write”. " +
        "TabbySync creates one private gist for you the first time you save.",
      disclaimer: "⚠️ Less private than self-hosting: your data is stored on GitHub's " +
        "servers in a “secret” gist. That means it's unlisted, not truly access-controlled — " +
        "anyone with the raw link, or anyone who gets your token, can read it. Strongly recommended: " +
        "turn on the encryption passphrase above so GitHub only ever sees ciphertext."
    },
    jsonbin: {
      id: "jsonbin",
      label: "JSONBin.io (free, no server)",
      tokenLabel: "JSONBin X-Master-Key",
      tokenPlaceholder: "your JSONBin API key",
      needsUrl: false,
      needsSyncName: false,
      setupHint: "Requires a free JSONBin.io account — sign up / log in at " +
        "<a href=\"https://jsonbin.io/login\" target=\"_blank\" rel=\"noopener\">jsonbin.io</a>, then open " +
        "<b>API Keys</b> from your account menu, create a key (the <b>X-Master-Key</b>), and paste it here. " +
        "TabbySync creates the bin(s) for you the first time you save. One profile per key " +
        "(no separate “sync name”) — use self-hosting or GitHub Gist if you need more than one.",
      disclaimer: "⚠️ Least private option: your data is stored on JSONBin's free " +
        "third-party service, which doesn't offer the durability, access-control or longevity " +
        "guarantees of your own server or a GitHub account — free bins can also be rate-limited " +
        "or reclaimed. Strongly recommended: turn on the encryption passphrase above, and avoid this " +
        "option for anything sensitive."
    }
  };

  function providerMeta(id) { return PROVIDERS[id] || PROVIDERS.custom; }

  // ---- shared helpers --------------------------------------------------------
  function jsonHeaders(extra) { return Object.assign({ "Content-Type": "application/json" }, extra || {}); }

  // ---- custom (self-hosted tabbysync.php or any GET/PUT+bearer endpoint) ---
  function customEndpoint(cfg, fileName) {
    if (!cfg.baseUrl) return "";
    var base = cfg.baseUrl.replace(/\/+$/, "");
    var file = encodeURIComponent(fileName);
    // A base URL ending in ".php" is the standalone TabbySync script — route
    // via ?name= (no URL rewriting needed on the server).
    if (/\.php$/i.test(base)) return base + "?name=" + file;
    return base + "/" + file;
  }
  function customAuth(cfg, extra) {
    var h = Object.assign({}, extra || {});
    if (cfg.token) h["Authorization"] = "Bearer " + cfg.token;
    return h;
  }
  function customGet(cfg, fileName) {
    var url = customEndpoint(cfg, fileName);
    if (!url) return Promise.resolve({ text: null, etag: "" });
    return fetch(url, { method: "GET", headers: customAuth(cfg), cache: "no-store" }).then(function (res) {
      if (res.status === 404) return { text: null, etag: "" };
      if (res.status === 401 || res.status === 403) throw new Error("Server rejected the token (auth failed).");
      if (!res.ok) throw new Error("Server GET failed (HTTP " + res.status + ").");
      var etag = res.headers.get("ETag") || "";
      return res.text().then(function (t) { return { text: t, etag: etag }; });
    });
  }
  function customPut(cfg, fileName, text, etag) {
    var url = customEndpoint(cfg, fileName);
    if (!url) throw new Error("No server URL configured (need a base URL + sync name).");
    var headers = customAuth(cfg, { "Content-Type": "application/json" });
    if (etag) headers["If-Match"] = etag;
    return fetch(url, { method: "PUT", headers: headers, body: text }).then(function (res) {
      if (res.status === 412) { var e = new Error("conflict"); e.conflict = true; throw e; }
      if (res.status === 401 || res.status === 403) throw new Error("Server rejected the token (auth failed).");
      if (!res.ok) throw new Error("Server PUT failed (HTTP " + res.status + ").");
      return { etag: res.headers.get("ETag") || "" };
    });
  }

  // ---- GitHub Gist ------------------------------------------------------------
  // One private ("secret") gist holds every file for every engine/profile —
  // the gist ID is created once (on the first write) and remembered in config.
  var GIST_API = "https://api.github.com";
  function ghHeaders(cfg, extra) {
    return Object.assign({ "Accept": "application/vnd.github+json", "Authorization": "Bearer " + cfg.token }, extra || {});
  }
  function gistCreate(cfg, fileName) {
    var files = {}; files[fileName] = { content: "{}" };
    return fetch(GIST_API + "/gists", {
      method: "POST",
      headers: ghHeaders(cfg, jsonHeaders()),
      body: JSON.stringify({ description: "TabbySync data (private)", public: false, files: files })
    }).then(function (res) {
      if (res.status === 401 || res.status === 403) throw new Error("GitHub rejected the token (check it has the “Gists” scope).");
      if (!res.ok) throw new Error("Could not create a Gist (HTTP " + res.status + ").");
      return res.json();
    }).then(function (g) {
      return shared().setConfig({ gistId: g.id }).then(function () { return g.id; });
    });
  }
  function gistGet(cfg, fileName) {
    if (!cfg.gistId) return Promise.resolve({ text: null, etag: "" });
    return fetch(GIST_API + "/gists/" + cfg.gistId, { method: "GET", headers: ghHeaders(cfg), cache: "no-store" })
      .then(function (res) {
        if (res.status === 404) throw new Error("Gist not found — it may have been deleted, or the token can't see it.");
        if (res.status === 401 || res.status === 403) throw new Error("GitHub rejected the token (check it has the “Gists” scope).");
        if (!res.ok) throw new Error("GitHub GET failed (HTTP " + res.status + ").");
        return res.json();
      })
      .then(function (g) {
        var f = g.files && g.files[fileName];
        if (!f) return { text: null, etag: "" };
        if (f.truncated && f.raw_url) {
          return fetch(f.raw_url, { cache: "no-store" }).then(function (r) { return r.text(); })
            .then(function (t) { return { text: t, etag: "" }; });
        }
        return { text: f.content, etag: "" };
      });
  }
  function gistPut(cfg, fileName, text) {
    function write(gistId) {
      var files = {}; files[fileName] = { content: text };
      return fetch(GIST_API + "/gists/" + gistId, {
        method: "PATCH",
        headers: ghHeaders(cfg, jsonHeaders()),
        body: JSON.stringify({ files: files })
      }).then(function (res) {
        if (res.status === 401 || res.status === 403) throw new Error("GitHub rejected the token (check it has the “Gists” scope).");
        if (!res.ok) throw new Error("GitHub PATCH failed (HTTP " + res.status + ").");
        return { etag: "" };
      });
    }
    if (cfg.gistId) return write(cfg.gistId);
    return gistCreate(cfg, fileName).then(write);
  }

  // ---- JSONBin.io ---------------------------------------------------------
  // Bins have no internal filenames, so each engine gets its own bin,
  // auto-created (and remembered) the first time that engine writes.
  var JSONBIN_API = "https://api.jsonbin.io/v3";
  function jsonbinField(fileName) {
    return fileName.indexOf("tabs-") === 0 ? "jsonbinTabsId" : "jsonbinBookmarksId";
  }
  function jsonbinHeaders(cfg, extra) {
    return Object.assign({ "X-Master-Key": cfg.token }, extra || {});
  }
  // JSONBin's error responses carry a useful { message: "..." } body — a bare
  // "HTTP 400" tells the user nothing about *why*, so pull that message out
  // (falling back to the raw body, then nothing) and fold it into the error.
  function jsonbinErrorDetail(res) {
    return res.text().then(function (t) {
      if (!t) return "";
      try { var j = JSON.parse(t); return (j && j.message) ? j.message : t; }
      catch (e) { return t; }
    }).catch(function () { return ""; });
  }
  function jsonbinFail(res, prefix) {
    return jsonbinErrorDetail(res).then(function (detail) {
      throw new Error(prefix + " (HTTP " + res.status + ")" + (detail ? ": " + detail : "") + ".");
    });
  }
  function jsonbinCreate(cfg, fileName) {
    var field = jsonbinField(fileName);
    return fetch(JSONBIN_API + "/b", {
      method: "POST",
      headers: jsonbinHeaders(cfg, jsonHeaders({ "X-Bin-Private": "true", "X-Bin-Name": fileName })),
      body: "{}"
    }).then(function (res) {
      if (res.status === 401 || res.status === 403) throw new Error("JSONBin rejected the API key.");
      if (!res.ok) return jsonbinFail(res, "Could not create a JSONBin bin");
      return res.json();
    }).then(function (r) {
      var patch = {}; patch[field] = r.metadata.id;
      return shared().setConfig(patch).then(function () { return r.metadata.id; });
    });
  }
  function jsonbinGet(cfg, fileName) {
    var id = cfg[jsonbinField(fileName)];
    if (!id) return Promise.resolve({ text: null, etag: "" });
    return fetch(JSONBIN_API + "/b/" + id + "/latest", { method: "GET", headers: jsonbinHeaders(cfg), cache: "no-store" })
      .then(function (res) {
        if (res.status === 404) return null;
        if (res.status === 401 || res.status === 403) throw new Error("JSONBin rejected the API key.");
        if (!res.ok) return jsonbinFail(res, "JSONBin GET failed");
        return res.json();
      })
      .then(function (r) { return { text: r ? JSON.stringify(r.record) : null, etag: "" }; });
  }
  function jsonbinPut(cfg, fileName, text) {
    var field = jsonbinField(fileName);
    function write(id) {
      return fetch(JSONBIN_API + "/b/" + id, {
        method: "PUT",
        headers: jsonbinHeaders(cfg, jsonHeaders()),
        body: text
      }).then(function (res) {
        if (res.status === 401 || res.status === 403) throw new Error("JSONBin rejected the API key.");
        if (!res.ok) return jsonbinFail(res, "JSONBin PUT failed");
        return { etag: "" };
      });
    }
    var id = cfg[field];
    if (id) return write(id);
    return jsonbinCreate(cfg, fileName).then(write);
  }

  // ---- dispatch ---------------------------------------------------------
  var IMPL = {
    custom: { get: customGet, put: customPut },
    gist: { get: gistGet, put: gistPut },
    jsonbin: { get: jsonbinGet, put: jsonbinPut }
  };
  function impl(cfg) { return IMPL[cfg.provider] || IMPL.custom; }

  function get(cfg, fileName) { return impl(cfg).get(cfg, fileName); }
  function put(cfg, fileName, text, etag) { return impl(cfg).put(cfg, fileName, text, etag); }

  // Enough to attempt a sync — the per-field validation (e.g. required
  // fields on the Options form) is separate from this "can we even try" check.
  function isConfigured(cfg) {
    if (cfg.provider === "gist") return !!cfg.token;
    if (cfg.provider === "jsonbin") return !!cfg.token;
    return !!(cfg.baseUrl && cfg.token && cfg.syncName); // custom (self-hosted)
  }

  self.TabbySyncProviders = {
    PROVIDERS: PROVIDERS,
    providerMeta: providerMeta,
    get: get,
    put: put,
    isConfigured: isConfigured
  };
})();
