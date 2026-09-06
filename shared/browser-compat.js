// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// browser-compat.js — makes `chrome.*` mean the same thing in both browsers.
//
// Chrome and Firefox both ship a WebExtensions API, and this extension calls
// it as `chrome.*` throughout. The difference is what that name gives you:
//
//   Chrome   `chrome.*`   returns a promise when you omit the callback (MV3)
//   Firefox  `chrome.*`   callback-style only, for compatibility with old code
//   Firefox  `browser.*`  promise-based — the one Firefox actually wants used
//
// So on Firefox this points `chrome` at `browser`, and the rest of the code
// keeps working unchanged: every call in this codebase is promise-style, and
// both namespaces answer promises once that alias is in place.
//
// Loaded first on every page and at the top of the service worker, before any
// code that touches the API. It must stay a plain script (no imports) so it can
// be the first <script> tag on a page and an import at the top of a module.
(function () {
  "use strict";

  // Chrome: `browser` does not exist, `chrome.*` already returns promises.
  // Nothing to do, and nothing to risk breaking.
  if (typeof globalThis.browser === "undefined" || !globalThis.browser.runtime) return;

  // Firefox: alias, so `await chrome.storage.local.get(...)` resolves rather
  // than returning undefined. `browser` keeps working too, for anything that
  // prefers to name it directly.
  globalThis.chrome = globalThis.browser;
})();
