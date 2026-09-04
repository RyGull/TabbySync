// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// contact.js — the one address TabbySync shows, assembled at runtime.
//
// Why it is split up rather than written out: this file ships inside the
// extension and lives in a public repository, and the privacy policy is
// published on the open web. Address harvesters are overwhelmingly regex
// scrapers looking for a name, an at-sign and a domain in page source, and a split
// string defeats every one of those.
//
// Be clear about what this is not. It is obfuscation, not protection. Anyone
// who reads this file — a human, or a scraper that executes JavaScript — can
// reconstruct the address in seconds, and the rendered page shows it in plain
// text to anyone looking. Treat the address as public and disposable: point it
// at a forwarding alias you can rotate, and let your mail host filter.
//
// Classic IIFE -> self.TabbySyncContact, so it works both as a <script> on the
// pages and as an import in the module worker.
(function () {
  "use strict";

  var USER = "contact";
  var HOST = "tabbysync.com";

  function address() { return USER + String.fromCharCode(64) + HOST; }

  function mailto(subject) {
    return "mailto:" + address() +
      (subject ? "?subject=" + encodeURIComponent(subject) : "");
  }

  // Replaces the readable fallback inside any [data-contact] element with a
  // real mail link. The fallback stays visible if scripting is off, so the
  // address is never unreachable — just never machine-readable.
  function render(root) {
    var nodes = (root || document).querySelectorAll("[data-contact]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var a = document.createElement("a");
      a.href = mailto(el.getAttribute("data-contact-subject") || "");
      a.textContent = address();
      el.textContent = "";
      el.appendChild(a);
    }
  }

  self.TabbySyncContact = { address: address, mailto: mailto, render: render };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () { render(); });
    } else {
      render();
    }
  }
})();
