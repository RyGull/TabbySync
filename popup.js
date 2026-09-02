// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// popup.js — TabbySync hub. Shows both engines side by side, lets you enable
// either or both, and triggers their actions. Shared config for the toggles;
// messages to the worker for status + actions.
"use strict";

var $ = function (id) { return document.getElementById(id); };

function send(msg) {
  return new Promise(function (resolve) {
    try { chrome.runtime.sendMessage(msg, resolve); } catch (e) { resolve(null); }
  });
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
  if (s.enabled && s.lastError) { $("bmErrRow").hidden = false; $("bmErr").textContent = s.lastError; }
  else $("bmErrRow").hidden = true;
  $("bmSync").disabled = !s.enabled || !s.configured;
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
  if (s.enabled && s.lastStatus === "error" && s.lastError) {
    $("tabErrRow").hidden = false; $("tabErr").textContent = s.lastError;
  } else $("tabErrRow").hidden = true;
  $("stashAllTabs").disabled = !s.enabled;
  $("tabSync").disabled = !s.enabled || !s.configured;
  return s;
}

// ---- server-configured banner ---------------------------------------------

var encBadgeWired = false;

// Short display names for the sync-method box under the logo — the
// provider metadata's own .label is the longer Options-dropdown text
// (e.g. "JSONBin.io (free, no server)"), too long for that compact box.
var SYNC_METHOD_SHORT = { custom: "Self-Hosted", gist: "GitHub Gist", jsonbin: "JSONBin.io" };

async function refreshBanner() {
  var c = await self.TabbySyncConfig.getConfig();
  var configured = self.TabbySyncProviders.isConfigured(Object.assign({}, c, { baseUrl: c.serverUrl }));

  var syncLabel = $("syncLabel");
  var shortName = SYNC_METHOD_SHORT[c.provider] || self.TabbySyncProviders.providerMeta(c.provider).label;
  syncLabel.textContent = "Sync: " + shortName;
  syncLabel.title = self.TabbySyncProviders.providerMeta(c.provider).label;

  $("setup").hidden = configured;
  var note = $("footNote");
  var row = $("profileRow");
  if (!configured) {
    note.hidden = false;
    row.hidden = true;
    note.textContent = "Not set up yet — open Options to pick a sync method.";
    return configured;
  }
  note.hidden = true;
  row.hidden = false;

  var label = c.syncName || c.profileLabel || self.TabbySyncProviders.providerMeta(c.provider).label;
  var nameEl = $("profileName");
  nameEl.textContent = label;
  nameEl.title = label;

  var badge = $("encBadge");
  if (c.passphrase) {
    badge.className = "encBadge on";
    badge.textContent = "🔒 Encryption on";
    badge.title = "Encryption is on. Click to manage it in Options.";
  } else {
    badge.className = "encBadge off";
    badge.textContent = "⚠️ Encryption off";
    badge.title = "Encryption is off — click to turn it on in Options.";
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
$("bmOpts").addEventListener("click", openOptions);
$("setupLink").addEventListener("click", openOptions);

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
  $("bmSync").disabled = true; $("bmSync").textContent = "Syncing…"; setDot($("bmDot"), "busy");
  await send({ type: "syncNow" });
  $("bmSync").textContent = "Sync now";
  await refreshBookmarks();
});

$("stashAllTabs").addEventListener("click", async function () {
  $("stashAllTabs").disabled = true;
  await send({ type: "sl-stash", mode: "all" });
  window.close(); // the list tab opens; close the popup
});
$("tabOpen").addEventListener("click", async function () {
  await send({ type: "sl-open-list" });
  window.close();
});
$("tabSync").addEventListener("click", async function () {
  $("tabSync").disabled = true; $("tabSync").textContent = "…"; setDot($("tabDot"), "busy");
  await send({ type: "tabbysync-sync" });
  $("tabSync").textContent = "Sync";
  await refreshTabs();
});

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
}
$("donateOpen").addEventListener("click", function () { showView("donate"); });
$("donateBack").addEventListener("click", function () { showView("main"); });
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

// On open: just render the last-known status for whatever is enabled +
// configured. Syncing itself stays on the manual "Sync now" buttons and the
// background timer — opening the popup shouldn't kick off its own sync.
(async function init() {
  await refreshAll();
})();
