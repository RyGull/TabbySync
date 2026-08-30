// popup.js — SyncLocker hub. Shows both engines side by side, lets you enable
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
  $("tabStash").disabled = !s.enabled;
  $("tabSync").disabled = !s.enabled || !s.configured;
  return s;
}

// ---- server-configured banner ---------------------------------------------

function esc(s) {
  return String(s).replace(/[&<>"]/g, function (ch) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch];
  });
}

async function refreshBanner() {
  var c = await self.SyncLockerConfig.getConfig();
  var configured = !!(c.serverUrl && c.token && c.syncName);
  $("setup").hidden = configured;
  var note = $("footNote");
  if (!configured) {
    note.textContent = "Not set up yet — open Options to add your server.";
    return configured;
  }
  var name = "<b>" + esc(c.syncName) + "</b>";
  if (c.passphrase) {
    note.innerHTML = "Profile " + name + "<br><span class=\"okenc\">🔒 Encryption on</span>";
  } else {
    note.innerHTML = "Profile " + name +
      "<br><span class=\"warn\">Encryption off</span> — <a id=\"encLink\">turn it on</a> for better security.";
    var link = document.getElementById("encLink");
    if (link) link.addEventListener("click", openOptions);
  }
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

$("bmEnable").addEventListener("change", async function () {
  await self.SyncLockerConfig.setConfig({ bookmarks: { enabled: $("bmEnable").checked } });
  await refreshBookmarks();
});
$("tabEnable").addEventListener("change", async function () {
  await self.SyncLockerConfig.setConfig({ tabs: { enabled: $("tabEnable").checked } });
  await refreshTabs();
});

$("bmSync").addEventListener("click", async function () {
  $("bmSync").disabled = true; $("bmSync").textContent = "Syncing…"; setDot($("bmDot"), "busy");
  await send({ type: "syncNow" });
  $("bmSync").textContent = "Sync now";
  await refreshBookmarks();
});

$("tabStash").addEventListener("click", async function () {
  $("tabStash").disabled = true;
  await send({ type: "sl-stash", mode: "all" });
  window.close(); // the list tab opens; close the popup
});
$("tabOpen").addEventListener("click", async function () {
  await send({ type: "sl-open-list" });
  window.close();
});
$("tabSync").addEventListener("click", async function () {
  $("tabSync").disabled = true; $("tabSync").textContent = "…"; setDot($("tabDot"), "busy");
  await send({ type: "tabstash-sync" });
  $("tabSync").textContent = "Sync";
  await refreshTabs();
});

// ---- donation + feedback (each swaps the whole popup to its own screen) -----
var PAYPAL_URL = "https://www.paypal.com/ncp/payment/B25W7V9VRGQG4";
// The feedback form is hosted on the developer's domain (reCAPTCHA v3 + email
// can't run inside an MV3 extension page), and embedded here in an iframe.
var FEEDBACK_URL = "https://propctuner.com/synclocker/feedback.html";

function showView(view) {
  $("mainView").hidden = view !== "main";
  $("donateView").hidden = view !== "donate";
  $("feedbackView").hidden = view !== "feedback";
}
$("donateOpen").addEventListener("click", function () { showView("donate"); });
$("donateBack").addEventListener("click", function () { showView("main"); });
$("donateBtn").addEventListener("click", function () {
  try { chrome.tabs.create({ url: PAYPAL_URL }); }
  catch (e) { window.open(PAYPAL_URL, "_blank"); }
});

$("feedbackOpen").addEventListener("click", function () {
  var f = $("feedbackFrame");
  if (!f.getAttribute("src")) f.setAttribute("src", FEEDBACK_URL); // lazy-load on first open
  showView("feedback");
});
$("feedbackBack").addEventListener("click", function () { showView("main"); });
$("feedbackTab").addEventListener("click", function () {
  try { chrome.tabs.create({ url: FEEDBACK_URL }); }
  catch (e) { window.open(FEEDBACK_URL, "_blank"); }
});

// On open: just render the last-known status for whatever is enabled +
// configured. Syncing itself stays on the manual "Sync now" buttons and the
// background timer — opening the popup shouldn't kick off its own sync.
(async function init() {
  await refreshAll();
})();
