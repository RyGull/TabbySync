// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// main.js — the whole site's interactivity. No dependencies, no network
// calls, nothing sent anywhere. Mirrors the extension's own "no tracking"
// claim on the page that advertises it.
(function () {
  "use strict";

  // ---- theme toggle: explicit choice remembered per-browser, else follows
  // the system — same pattern as the extension's own shared/theme.js. -----
  var root = document.documentElement;
  var STORAGE_KEY = "tabbysync-site-theme";

  function applyTheme(theme) {
    if (theme === "light" || theme === "dark") root.setAttribute("data-theme", theme);
    else root.removeAttribute("data-theme");
  }

  function currentTheme() {
    try { return localStorage.getItem(STORAGE_KEY); } catch (e) { return null; }
  }

  applyTheme(currentTheme());

  var themeToggle = document.getElementById("themeToggle");
  if (themeToggle) {
    themeToggle.addEventListener("click", function () {
      var systemDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      var effective = currentTheme() || (systemDark ? "dark" : "light");
      var next = effective === "dark" ? "light" : "dark";
      applyTheme(next);
      try { localStorage.setItem(STORAGE_KEY, next); } catch (e) { /* private browsing, etc. — fine, just doesn't persist */ }
    });
  }

  // ---- mobile nav ---------------------------------------------------------
  var navToggle = document.getElementById("navToggle");
  var siteNav = document.getElementById("siteNav");
  if (navToggle && siteNav) {
    navToggle.addEventListener("click", function () {
      var open = siteNav.classList.toggle("is-open");
      navToggle.classList.toggle("is-open", open);
      navToggle.setAttribute("aria-expanded", String(open));
    });
    siteNav.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        siteNav.classList.remove("is-open");
        navToggle.classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  // ---- scroll-reveal: fade/slide sections and cards into view -------------
  //
  // Content is visible by default (see the CSS comment above .reveal-armed).
  // Only elements NOT already on screen when this runs are opted into the
  // hidden-then-fade-in treatment, so nothing already-visible ever flashes
  // to invisible and back.
  //
  // Deliberately plain rect math on scroll/resize, rAF-throttled, rather
  // than IntersectionObserver: under rapid programmatic scrolling (a fast
  // trackpad flick, scroll-restoration on back-navigation, a big Page Down
  // jump) IntersectionObserver callbacks can be coalesced and an element can
  // pass through the viewport without ever firing — verified against this
  // exact page, where it left a heading permanently invisible. This has no
  // such edge case: every scroll/resize event re-measures every remaining
  // armed element directly. With at most a few dozen elements on a page like
  // this, the cost of that is not worth trading reliability for.
  var revealTargets = document.querySelectorAll(".feature-card, .steps li, .section-title, .section-lede, .privacy-copy, .privacy-visual");
  var armed = [];
  revealTargets.forEach(function (el) {
    var r = el.getBoundingClientRect();
    var alreadyOnScreen = r.top < window.innerHeight && r.bottom > 0;
    if (alreadyOnScreen) return; // leave it visible, no animation needed
    el.classList.add("reveal-armed");
    armed.push(el);
  });

  var ticking = false;
  function sweep() {
    ticking = false;
    armed = armed.filter(function (el) {
      var r = el.getBoundingClientRect();
      var onScreen = r.top < window.innerHeight && r.bottom > 0;
      if (onScreen) el.classList.add("is-visible");
      return !onScreen; // drop it from future sweeps once revealed
    });
  }
  function requestSweep() {
    if (ticking || armed.length === 0) return;
    ticking = true;
    requestAnimationFrame(sweep);
  }

  if (armed.length) {
    window.addEventListener("scroll", requestSweep, { passive: true });
    window.addEventListener("resize", requestSweep);
    // Safety net for anything scroll/resize wouldn't otherwise catch — a
    // late web font swap or an image finishing load can shift layout enough
    // to bring an armed element on screen with no scroll event at all.
    setTimeout(sweep, 500);
    setTimeout(sweep, 1500);
  }
})();
