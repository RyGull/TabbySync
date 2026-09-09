// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// desktop-app.js — the one place the extension knows about TabbySync Control
// Panel, the companion Windows desktop app.
//
// It is mentioned in three places (the popup, the saved-tabs page's More menu,
// and Options), which is three chances for a URL or a sentence to drift. They
// all read from here instead.
//
// WHY THE LINK GOES TO /releases AND NOT /releases/latest: the extension (v*)
// and the app (control-panel-v*) both cut GitHub Releases in one repository,
// so "latest" is whichever came last OVERALL — usually the extension's, which
// contains store zips and no installer. A link that is right until the next
// unrelated release is not right. The website pins the exact installer URL
// because it can be redeployed the moment a version changes; a published
// extension cannot, so it points at the list and says which release to pick.
//
// ON PLATFORM: this is a Windows-only app, and the extension now runs on
// Chromium and Firefox across every desktop OS. Offering a .exe to someone on
// macOS or Linux is noise, so every entry point below is gated on isWindows()
// and simply is not rendered elsewhere.
//
// Classic IIFE -> self.TabbySyncDesktopApp, so it works as a <script> on the
// pages and as an import in the module worker, same as config.js/contact.js.
(function () {
  "use strict";

  var NAME = "TabbySync Control Panel";

  // github.com is already one of the hosts the privacy policy names (the
  // token-setup help links in Options), so this adds no new destination to
  // disclose — see test/privacy-policy.test.js, which enforces that list.
  var URL = "https://github.com/RyGull/TabbySync/releases";

  // One sentence for a menu, one paragraph for somewhere with room. Kept here
  // rather than in three templates so the pitch cannot say different things in
  // different places.
  var TAGLINE = "Manage every sync profile from one window, without a browser.";
  var PITCH =
    "Juggling more than one sync profile — work, personal, a home server? " +
    NAME + " is a free Windows app that opens all of them side by side, so you " +
    "can move and copy bookmarks and saved tab lists between profiles. Same " +
    "destinations, same merge, same encryption as this extension. Entirely " +
    "optional: nothing here needs it.";

  /** Which release to pick, since the link lands on the list. */
  var WHICH_RELEASE = "Pick the newest release tagged control-panel-v…";

  /**
   * Windows, or as close as a browser will say.
   *
   * userAgentData.platform is the exact, non-deprecated answer where it
   * exists (Chromium). Firefox does not implement it, so navigator.platform
   * is the fallback — deprecated, frozen, and still the only thing Firefox
   * offers. "Win" rather than "Windows" because the frozen value is "Win32"
   * even on 64-bit.
   *
   * Being wrong here costs one entry point appearing or not appearing, so a
   * best guess is the right level of effort. It never gates anything a person
   * has asked for.
   */
  function isWindows() {
    try {
      var data = navigator.userAgentData;
      if (data && typeof data.platform === "string" && data.platform !== "") {
        return data.platform === "Windows";
      }
      return /^Win/i.test(navigator.platform || "");
    } catch (e) {
      return false; // no navigator at all (the worker) — offer nothing
    }
  }

  /** Opens the releases page in a tab, falling back to window.open off-worker. */
  function open() {
    try { chrome.tabs.create({ url: URL }); }
    catch (e) { window.open(URL, "_blank", "noopener"); }
  }

  self.TabbySyncDesktopApp = {
    NAME: NAME,
    URL: URL,
    TAGLINE: TAGLINE,
    PITCH: PITCH,
    WHICH_RELEASE: WHICH_RELEASE,
    isWindows: isWindows,
    open: open,
  };
})();
