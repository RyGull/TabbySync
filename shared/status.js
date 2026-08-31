// status.js — combined toolbar status dot for TabbySync.
//
// TabbySync has two sync engines (bookmarks + tabs) but only one toolbar
// action, so they can't each own the icon. Instead both report their state
// here and this module reflects the worst of the two on the toolbar icon:
// amber = something syncing, red = an error, green = all good, cleared =
// nothing configured / both disabled.
//
// Chrome's native setBadgeText() badge is sized by the browser, not by the
// extension, and a single "●" character ends up as a box that covers most
// of a 16px toolbar icon. So instead we paint a small dot ourselves onto a
// copy of the real icon and swap it in with setIcon() — that gives us
// control over how big it actually is. Falls back to the native badge if
// OffscreenCanvas isn't available.
//
// Loaded for its side effect (sets self.TabbySyncStatus). Safe to import from
// the module service worker and to reference from classic scripts.
(function () {
  "use strict";

  var state = { bookmarks: "none", tabs: "none" };

  var COLOR = {
    ok:      "#16a34a",
    error:   "#dc2626",
    syncing: "#eab308",
  };

  // Must match the "action.default_icon" sizes in manifest.json.
  var SIZES = [16, 32, 48, 128];
  var DEFAULT_ICON = {
    16: "icons/icon-16.png",
    32: "icons/icon-32.png",
    48: "icons/icon-48.png",
    128: "icons/icon-128.png",
  };

  var canUseCanvas = typeof OffscreenCanvas !== "undefined";
  var baseIcons = {}; // size -> ImageBitmap, loaded lazily and cached

  function combined() {
    var v = [state.bookmarks, state.tabs];
    if (v.indexOf("syncing") >= 0) return "syncing";
    if (v.indexOf("error") >= 0) return "error";
    if (v.indexOf("ok") >= 0) return "ok";
    return "none";
  }

  function loadBaseIcon(size) {
    if (baseIcons[size]) return Promise.resolve(baseIcons[size]);
    var url = chrome.runtime.getURL(DEFAULT_ICON[size]);
    return fetch(url)
      .then(function (r) { return r.blob(); })
      .then(function (blob) { return createImageBitmap(blob); })
      .then(function (bitmap) { baseIcons[size] = bitmap; return bitmap; });
  }

  // Draws the base icon plus a small colored dot tucked into the bottom-right
  // corner — deliberately smaller than Chrome's own badge box.
  function drawDot(size, color) {
    return loadBaseIcon(size).then(function (bitmap) {
      var canvas = new OffscreenCanvas(size, size);
      var ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0, size, size);

      var r = size * 0.16;
      var cx = size - r - size * 0.05;
      var cy = size - r - size * 0.05;

      // Thin light ring keeps the dot legible against similar-colored icon
      // pixels underneath it.
      ctx.beginPath();
      ctx.arc(cx, cy, r + size * 0.035, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();

      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      return ctx.getImageData(0, 0, size, size);
    });
  }

  function clearIcon() {
    try {
      chrome.action.setIcon({ path: DEFAULT_ICON });
      chrome.action.setBadgeText({ text: "" });
    } catch (e) { /* action API not available in this context */ }
  }

  function fallbackBadge(color) {
    try {
      chrome.action.setBadgeText({ text: "●" });
      chrome.action.setBadgeBackgroundColor({ color: color });
      if (chrome.action.setBadgeTextColor) {
        chrome.action.setBadgeTextColor({ color: "#ffffff" });
      }
    } catch (e) { /* action API not available in this context */ }
  }

  function render() {
    var kind = combined();

    if (kind === "none") { clearIcon(); return; }

    var color = COLOR[kind];
    if (!canUseCanvas) { fallbackBadge(color); return; }

    Promise.all(SIZES.map(function (size) { return drawDot(size, color); }))
      .then(function (images) {
        var imageData = {};
        SIZES.forEach(function (size, i) { imageData[size] = images[i]; });
        try {
          chrome.action.setIcon({ imageData: imageData });
          chrome.action.setBadgeText({ text: "" });
        } catch (e) { /* action API not available in this context */ }
      })
      .catch(function () { fallbackBadge(color); });
  }

  self.TabbySyncStatus = {
    // module: "bookmarks" | "tabs" ; kind: "ok" | "error" | "syncing" | "none"
    report: function (module, kind) {
      if (module in state) { state[module] = kind || "none"; render(); }
    },
    get: function () { return { bookmarks: state.bookmarks, tabs: state.tabs }; },
  };
})();
