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

  // ---- install button: name the browser the visitor is actually using -----
  //
  // Every Chromium browser puts "Chrome" in its user agent, so the order of
  // these checks is the whole trick: the specific ones have to run before the
  // generic one, or Edge, Opera, Vivaldi and Samsung Internet all answer
  // "Chrome". Brave is the exception — it deliberately looks exactly like
  // Chrome, and the only reliable tell is navigator.brave.isBrave(), which is
  // a promise, so it runs as a second pass below.
  //
  // This only ever changes the label, the link and one line of small print.
  // The markup already carries the right default for a visitor with no
  // JavaScript or an unrecognised browser, and nothing here hides an option:
  // the Chrome Web Store link in the Install section stays visible whatever
  // this decides. Detection can be wrong — user agents are freely spoofed —
  // so being wrong has to cost nothing more than a mis-named button.
  var EDGE_NOTE = "Edge installs this from the Chrome Web Store — it asks you to “Allow extensions " +
                  "from other stores” the first time.";
  var OPERA_NOTE = "Opera needs its “Install Chrome Extensions” add-on before it can install from " +
                   "the Chrome Web Store.";

  function hasBrand(name) {
    var brands = (navigator.userAgentData && navigator.userAgentData.brands) || [];
    for (var i = 0; i < brands.length; i++) {
      if (brands[i].brand && brands[i].brand.indexOf(name) !== -1) return true;
    }
    return false;
  }

  function detectBrowser() {
    var ua = navigator.userAgent || "";
    var mobile = /Android|iPhone|iPad|iPod/.test(ua);

    // Gecko first: it is the one engine that cannot use the Chrome Web Store.
    if (/Firefox\/|FxiOS/.test(ua)) return { name: "Firefox", store: "firefox", mobile: mobile };

    if (/Edg(A|iOS)?\//.test(ua) || hasBrand("Microsoft Edge")) {
      return { name: "Edge", store: "chrome", note: EDGE_NOTE, mobile: mobile };
    }
    if (/OPR\/|OPiOS/.test(ua) || hasBrand("Opera")) {
      return { name: "Opera", store: "chrome", note: OPERA_NOTE, mobile: mobile };
    }
    if (/Vivaldi/.test(ua)) return { name: "Vivaldi", store: "chrome", mobile: mobile };
    if (/SamsungBrowser/.test(ua)) return { name: "Samsung Internet", store: "chrome", mobile: mobile };
    if (hasBrand("Brave")) return { name: "Brave", store: "chrome", mobile: mobile };
    if (/Chrome\/|CriOS/.test(ua)) return { name: "Chrome", store: "chrome", mobile: mobile };

    // Safari is last because every browser above also says "Safari".
    if (/Safari\//.test(ua)) {
      return {
        name: "Safari", store: null, mobile: mobile,
        note: "There is no Safari version — Safari uses a different extension system entirely. " +
              "Open this page in Chrome, Edge, Brave, Vivaldi, Opera or Firefox."
      };
    }
    return null; // unrecognised: leave the page exactly as it was rendered
  }

  function applyBrowser(browser) {
    var buttons = document.querySelectorAll("[data-install-cta]");
    var noteEl = document.querySelector("[data-install-note]");
    if (!browser || !buttons.length) return;

    // "Add to Safari" would be a button that cannot do what it says.
    var label = browser.store ? "Add to " + browser.name : "Not available for " + browser.name;
    var href = null;
    var note = browser.note || "";

    if (browser.store === "chrome") {
      href = buttons[0].getAttribute("data-store-chrome") || null;
    } else if (browser.store === "firefox") {
      href = buttons[0].getAttribute("data-store-firefox") || null;
      if (!href) {
        // Reviewed, not published. Saying so beats a dead link or a Chrome
        // Web Store button that Firefox cannot do anything with.
        label = "Firefox version in review";
        note = "The Firefox add-on is with Mozilla for review. Until it is approved you can build " +
               "it from source — see Install, below.";
      }
    }

    if (browser.mobile && browser.store) {
      note = browser.name + " on a phone or tablet cannot install extensions. Open this page on a " +
             "computer.";
    }

    for (var i = 0; i < buttons.length; i++) {
      buttons[i].textContent = label;
      if (href) buttons[i].setAttribute("href", href);
      else buttons[i].setAttribute("href", "#install");
      if (!href) buttons[i].removeAttribute("target");
    }
    if (noteEl && note) {
      noteEl.textContent = note;
      noteEl.hidden = false;
    }
  }

  var detected = detectBrowser();
  applyBrowser(detected);

  // Second pass for Brave, which answers "Chrome" to everything above.
  if (detected && detected.name === "Chrome" && navigator.brave && navigator.brave.isBrave) {
    navigator.brave.isBrave().then(function (isBrave) {
      if (isBrave) applyBrowser({ name: "Brave", store: "chrome", mobile: detected.mobile });
    }).catch(function () { /* not Brave, or it declined to say — Chrome it is */ });
  }
})();
