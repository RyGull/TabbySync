// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// confirm-stash.js — the "Save and close N tabs?" popup window.
//
// Opened by tabs/background-core.js's confirmBulkStash() as its own small
// chrome.windows.create() window rather than a desktop notification, so
// confirming doesn't mean leaving the browser for the OS notification
// tray. Sends its answer back as a runtime message keyed by the confirmId
// in the URL; the background service worker is what's actually waiting on
// it (see pendingStashConfirms in background-core.js).
"use strict";

var params = new URLSearchParams(location.search);
var confirmId = params.get("confirmId") || "";
var count = parseInt(params.get("count"), 10) || 0;

document.getElementById("title").textContent = "Save and close " + count + " tabs?";
document.getElementById("body").textContent =
  "This saves " + count + " tabs from that window as a new list, then closes them.";

function respond(proceed) {
  var remember = document.getElementById("remember").checked;
  try {
    chrome.runtime.sendMessage({ type: "sl-stash-confirm-result", confirmId: confirmId, proceed: proceed, remember: remember });
  } catch (e) { /* the background worker may already be gone — nothing to do */ }
  window.close();
}

document.getElementById("confirm").addEventListener("click", function () { respond(true); });
document.getElementById("cancel").addEventListener("click", function () { respond(false); });
document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") respond(false);
  else if (e.key === "Enter") respond(true);
});

document.getElementById("confirm").focus();
