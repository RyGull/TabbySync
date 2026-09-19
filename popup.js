// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// popup.js — TabbySync hub. Shows both engines side by side, lets you enable
// either or both, and triggers their actions. Shared config for the toggles;
// messages to the worker for status + actions.
"use strict";

var $ = function (id) { return document.getElementById(id); };

// Promise-style on purpose: Chrome answers a promise when the callback is
// omitted, and on Firefox shared/browser-compat.js has pointed `chrome` at the
// promise-based `browser`. A callback here would work in one browser only.
// A rejection means nothing was listening (the worker is asleep, or the
// message went nowhere) — the callers all treat that as "no status yet".
function send(msg) {
  try {
    return Promise.resolve(chrome.runtime.sendMessage(msg)).catch(function () { return null; });
  } catch (e) {
    return Promise.resolve(null);
  }
}

// Absolute date + time, e.g. "Aug 30, 5:59 PM".
function fmtStamp(ts) {
  if (!ts) return "never";
  return new Date(ts).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit"
  });
}

function setDot(el, kind) {
  el.className = "dot" + (kind === "ok" ? " ok" : kind === "err" ? " err" : kind === "busy" ? " busy" : "");
}

// Theme (Light / Dark / System) is handled by shared/theme.js, loaded in <head>.

// ---- version (from the manifest) -------------------------------------------
try { $("ver").textContent = "v" + chrome.runtime.getManifest().version; } catch (e) { /* ignore */ }

// ---- bookmarks -------------------------------------------------------------

async function refreshBookmarks() {
  var s = await send({ type: "getStatus" });
  if (!s) return;
  $("bmEnable").checked = !!s.enabled;
  $("bmCard").classList.toggle("off", !s.enabled);
  $("bmCount").textContent = s.enabled
    ? (s.bookmarks + " bookmark" + (s.bookmarks === 1 ? "" : "s") +
       (s.folders ? " in " + s.folders + " folder" + (s.folders === 1 ? "" : "s") : ""))
    : "off";
  $("bmLast").textContent = s.enabled ? fmtStamp(s.lastSync) : "off";
  var kind = !s.enabled ? "" : s.lastStatus === "ok" ? "ok" : s.lastStatus === "error" ? "err" : "";
  setDot($("bmDot"), kind);
  setDot($("menuBmDot"), kind);
  if (s.enabled && s.lastError) { $("bmErrRow").hidden = false; $("bmErr").textContent = s.lastError; }
  else $("bmErrRow").hidden = true;
  $("bmSync").disabled = !s.enabled || !s.configured;
  $("menuSyncBm").disabled = $("bmSync").disabled;
  return s;
}

// ---- tabs ------------------------------------------------------------------

async function refreshTabs() {
  var s = await send({ type: "sl-tab-status" });
  if (!s) return;
  $("tabEnable").checked = !!s.enabled;
  $("tabCard").classList.toggle("off", !s.enabled);
  $("tabCount").textContent = s.enabled
    ? (s.links + " link" + (s.links === 1 ? "" : "s") + " in " + s.groups + " list" + (s.groups === 1 ? "" : "s"))
    : "off";
  $("tabLast").textContent = s.enabled ? fmtStamp(s.lastAt) : "off";
  var kind = !s.enabled || !s.configured ? ""
    : s.lastStatus === "error" ? "err" : "ok";
  setDot($("tabDot"), kind);
  setDot($("menuTabDot"), kind);
  if (s.enabled && s.lastStatus === "error" && s.lastError) {
    $("tabErrRow").hidden = false; $("tabErr").textContent = s.lastError;
  } else $("tabErrRow").hidden = true;
  $("stashAllTabs").disabled = !s.enabled;
  $("tabSync").disabled = !s.enabled || !s.configured;
  $("menuSaveTabs").disabled = $("stashAllTabs").disabled;
  $("menuSyncTabs").disabled = $("tabSync").disabled;
  return s;
}

// ---- server-configured banner ---------------------------------------------

var encBadgeWired = false;

async function refreshBanner() {
  var c = await self.TabbySyncConfig.getConfig();
  var configured = self.TabbySyncProviders.isConfigured(Object.assign({}, c, { baseUrl: c.serverUrl }));

  // Fresh install: blur the (real, live) cards behind two ways to fix that,
  // rather than a text banner above them — see the overlay markup/CSS.
  $("cardsRow").classList.toggle("blurred", !configured);
  $("setupOverlay").hidden = configured;
  $("footEl").hidden = !configured;
  if (!configured) return configured;

  var label = c.syncName || c.profileLabel || self.TabbySyncProviders.providerMeta(c.provider).label;
  var nameEl = $("profileName");
  nameEl.textContent = label;
  nameEl.title = label;

  var badge = $("encBadge");
  if (c.passphrase) {
    badge.className = "encBadge on";
    badge.textContent = "🔒 Password lock on";
    badge.title = "Your data is scrambled before it leaves this computer. Click to manage it in settings.";
  } else {
    badge.className = "encBadge off";
    badge.textContent = "⚠️ No password lock";
    badge.title = "Whoever stores your data can read it. Click to turn the password lock on in settings.";
  }
  // The badge itself never changes identity, so wire the click once rather
  // than re-binding a fresh listener on every refresh.
  if (!encBadgeWired) { badge.addEventListener("click", openOptions); encBadgeWired = true; }

  return configured;
}

async function refreshAll() {
  await Promise.all([refreshBanner(), refreshBookmarks(), refreshTabs()]);
}

// ---- wiring ----------------------------------------------------------------

function openOptions() { chrome.runtime.openOptionsPage(); }
$("opts").addEventListener("click", openOptions);
$("manualOpen").addEventListener("click", openOptions);

// "Walk me through it": the same options page, just told to start in guided
// (one-step-at-a-time) mode instead of the full scroll-and-fill layout —
// see the "guided setup" block at the end of options.js. openOptionsPage()
// itself takes no arguments, so this opens the URL directly; open_in_tab is
// on in manifest.json, so that's the same kind of tab either button gets.
$("wizardOpen").addEventListener("click", function () {
  var url = chrome.runtime.getURL("options.html?wizard=1");
  try { chrome.tabs.create({ url: url }); }
  catch (e) { window.open(url, "_blank"); }
});

$("privacyLink").addEventListener("click", function () {
  var url = chrome.runtime.getURL("privacy.html");
  try { chrome.tabs.create({ url: url }); }
  catch (e) { window.open(url, "_blank"); }
});

$("bmEnable").addEventListener("change", async function () {
  await self.TabbySyncConfig.setConfig({ bookmarks: { enabled: $("bmEnable").checked } });
  await refreshBookmarks();
});
$("tabEnable").addEventListener("change", async function () {
  await self.TabbySyncConfig.setConfig({ tabs: { enabled: $("tabEnable").checked } });
  await refreshTabs();
});

$("bmSync").addEventListener("click", async function () {
  $("bmSync").disabled = true; $("menuSyncBm").disabled = true;
  $("bmSync").textContent = "Syncing…"; setDot($("bmDot"), "busy"); setDot($("menuBmDot"), "busy");
  await send({ type: "syncNow" });
  $("bmSync").textContent = "Sync Bookmarks";
  await refreshBookmarks();
});

$("stashAllTabs").addEventListener("click", async function () {
  $("stashAllTabs").disabled = true; $("menuSaveTabs").disabled = true;
  await send({ type: "sl-stash", mode: "all" });
  window.close(); // the list tab opens; close the popup
});
$("tabOpen").addEventListener("click", async function () {
  await send({ type: "sl-open-list" });
  window.close();
});
$("tabSync").addEventListener("click", async function () {
  $("tabSync").disabled = true; $("menuSyncTabs").disabled = true;
  $("tabSync").textContent = "…"; setDot($("tabDot"), "busy"); setDot($("menuTabDot"), "busy");
  await send({ type: "tabbysync-sync" });
  $("tabSync").textContent = "Sync Tabs";
  await refreshTabs();
});

// ---- logo menu ---------------------------------------------------------
//
// The logo doubles as a menu trigger (see .logoBtn in the <style>), listing
// the same actions the cards' own hover-reveal panels expose — people can
// use either. Each item just proxies a click to its card's real button
// rather than duplicating the sync logic: a disabled proxied button quietly
// no-ops (a disabled element never dispatches "click"), so there is nothing
// extra to keep in sync beyond the disabled-state mirroring above.
function setLogoMenuOpen(open) {
  $("logoMenu").hidden = !open;
  $("menuScrim").hidden = !open;
  $("logoMenuBtn").setAttribute("aria-expanded", open ? "true" : "false");
}
$("logoMenuBtn").addEventListener("click", function () {
  setLogoMenuOpen($("logoMenu").hidden);
});
$("menuScrim").addEventListener("click", function () { setLogoMenuOpen(false); });
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") setLogoMenuOpen(false);
});
$("menuSyncBm").addEventListener("click", function () { setLogoMenuOpen(false); $("bmSync").click(); });
$("menuSaveTabs").addEventListener("click", function () { setLogoMenuOpen(false); $("stashAllTabs").click(); });
$("menuMyTabs").addEventListener("click", function () { setLogoMenuOpen(false); $("tabOpen").click(); });
$("menuSyncTabs").addEventListener("click", function () { setLogoMenuOpen(false); $("tabSync").click(); });

// ---- donation + feedback ---------------------------------------------------
var PAYPAL_URL = "https://www.paypal.com/ncp/payment/B25W7V9VRGQG4";

// Feedback is a plain mail link, deliberately. It used to be a web form
// embedded in an iframe, which meant merely opening this screen contacted the
// developer's web host and Google reCAPTCHA before you had typed anything.
// Handing the address to your own mail client instead means TabbySync itself
// contacts no server the developer operates, ever — which is a promise that
// can be verified by reading this file rather than taken on trust.
// The address comes from shared/contact.js, which assembles it at runtime.

function showView(view) {
  $("mainView").hidden = view !== "main";
  $("donateView").hidden = view !== "donate";
  $("deskView").hidden = view !== "desktop";
}
$("donateOpen").addEventListener("click", function () { showView("donate"); });
$("donateBack").addEventListener("click", function () { showView("main"); });

// ---- the Windows desktop app ------------------------------------------------
//
// Shown only on Windows, as its own promo card below the two sync cards: the
// full pitch still lives in a slide-over, the same way Donate does, so this
// card only needs a tagline, not the whole paragraph.
//
// The copy and the URL come from shared/desktop-app.js — three places in this
// extension link to the app, and none of them owns the wording.
(function () {
  var app = self.TabbySyncDesktopApp;
  if (!app || !app.isWindows()) return; // not Windows: never rendered at all

  $("deskPromoTitle").textContent = app.NAME;
  $("deskPromoTagline").textContent = app.TAGLINE;
  $("deskTitle").textContent = "🖥️ " + app.NAME;
  $("deskPitch").textContent = app.PITCH;
  $("deskWhich").textContent = app.WHICH_RELEASE;
  $("deskOpen").hidden = false;

  $("deskOpen").addEventListener("click", function () { showView("desktop"); });
  $("deskBack").addEventListener("click", function () { showView("main"); });
  $("deskBtn").addEventListener("click", function () { app.open(); });
})();
$("donateBtn").addEventListener("click", function () {
  try { chrome.tabs.create({ url: PAYPAL_URL }); }
  catch (e) { window.open(PAYPAL_URL, "_blank"); }
});

$("feedbackOpen").addEventListener("click", function () {
  // Subject only — nothing about the user's setup is prefilled. Whatever they
  // choose to type is all that is ever sent, and their own mail client sends it.
  var url = self.TabbySyncContact.mailto(
    "TabbySync feedback (v" + chrome.runtime.getManifest().version + ")");
  try { chrome.tabs.create({ url: url }); }
  catch (e) { window.open(url, "_blank"); }
});

// The background worker broadcasts this after every tabs sync attempt —
// including the short follow-up retries after a conflict (see
// tabs/background-core.js) — so a popup left open while that's happening
// picks up the new status/timestamp instead of sitting frozen on the error
// that prompted the retry in the first place. (tabs/tablist.js listens for
// the same message and reloads for the same reason.)
chrome.runtime.onMessage.addListener(function (msg) {
  if (msg && msg.type === "tabbysync-refresh") refreshTabs();
});

// On open: just render the last-known status for whatever is enabled +
// configured. Syncing itself stays on the manual sync buttons and the
// background timer — opening the popup shouldn't kick off its own sync.
(async function init() {
  await refreshAll();
})();
