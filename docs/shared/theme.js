// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// theme.js — shared Light / Dark / System theme control for all TabbySync
// extension pages (popup, options, tab list).
//
// The choice is stored in localStorage, which every extension page shares (same
// chrome-extension:// origin), so it persists and stays consistent everywhere.
// A `storage` event keeps already-open pages in sync live. "System" leaves
// data-theme unset so each page's `prefers-color-scheme` CSS takes over.
//
// Load this in <head> (before the body) so the theme applies before first paint
// — no flash. It auto-mounts a picker into an element with id="sl-theme".
(function () {
  "use strict";
  var KEY = "sl.theme";
  var MODES = [
    { id: "light",  icon: "☀️", label: "Light" },
    { id: "dark",   icon: "🌙", label: "Dark" },
    { id: "system", icon: "🖥️", label: "System" },
  ];
  var controls = [];

  function get() { try { return localStorage.getItem(KEY) || "system"; } catch (e) { return "system"; } }
  function info(mode) { for (var i = 0; i < MODES.length; i++) if (MODES[i].id === mode) return MODES[i]; return MODES[2]; }

  function apply(mode) {
    mode = mode || get();
    var root = document.documentElement;
    if (mode === "light" || mode === "dark") root.setAttribute("data-theme", mode);
    else root.removeAttribute("data-theme"); // system → follow prefers-color-scheme
    updateControls();
  }
  function set(mode) {
    try { localStorage.setItem(KEY, mode); } catch (e) { /* private mode, etc. */ }
    apply(mode);
  }

  // Apply immediately (runs during <head> parse) to avoid a flash of wrong theme.
  apply();

  // Live-sync across other open extension pages.
  window.addEventListener("storage", function (e) { if (e.key === KEY) apply(); });
  try {
    matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
      if (get() === "system") updateControls();
    });
  } catch (e) { /* older browsers */ }

  // ---- injected styles for the picker (uses each page's vars with fallbacks) --
  function injectStyle() {
    if (document.getElementById("sl-theme-style")) return;
    var css =
      ".sl-theme{position:relative;display:inline-block;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}" +
      ".sl-theme-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 10px;border-radius:8px;" +
        "background:var(--panel,var(--card,#f3f4f6));color:var(--text,#222);" +
        "border:1px solid var(--line,var(--border,#d9dce1));font-size:12.5px;font-weight:600;line-height:1;cursor:pointer;}" +
      ".sl-theme-btn:hover{border-color:var(--muted,#9aa0a6);}" +
      ".sl-theme-btn .cx{font-size:10px;color:var(--muted,#9aa0a6);}" +
      ".sl-theme-menu{position:absolute;right:0;top:calc(100% + 6px);min-width:158px;z-index:2147483000;" +
        "background:var(--panel,var(--card,#fff));border:1px solid var(--line,var(--border,#d9dce1));" +
        "border-radius:11px;box-shadow:0 10px 30px rgba(0,0,0,.22);padding:6px;}" +
      ".sl-theme-menu[hidden]{display:none;}" +
      ".sl-theme-item{display:flex;align-items:center;gap:9px;width:100%;padding:9px 10px;border:0;border-radius:8px;" +
        "background:transparent;color:var(--text,#222);font-size:13px;font-weight:600;cursor:pointer;text-align:left;}" +
      ".sl-theme-item:hover{background:rgba(127,127,127,.14);}" +
      ".sl-theme-item .ic{font-size:15px;}" +
      ".sl-theme-item .chk{margin-left:auto;color:var(--accent,var(--bm,#2563eb));visibility:hidden;font-weight:800;}" +
      ".sl-theme-item.active .chk{visibility:visible;}";
    var s = document.createElement("style");
    s.id = "sl-theme-style";
    s.textContent = css;
    document.head.appendChild(s);
  }

  function updateControls() {
    var cur = get();
    controls.forEach(function (c) {
      var m = info(cur);
      c.label.textContent = m.label;
      c.icon.textContent = m.icon;
      Array.prototype.forEach.call(c.menu.querySelectorAll(".sl-theme-item"), function (it) {
        it.classList.toggle("active", it.dataset.mode === cur);
      });
    });
  }

  function closeAll() { controls.forEach(function (c) { c.menu.hidden = true; c.btn.setAttribute("aria-expanded", "false"); }); }

  function mount(container) {
    if (!container) return;
    injectStyle();
    var wrap = document.createElement("div");
    wrap.className = "sl-theme";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "sl-theme-btn";
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");
    btn.title = "Theme: Light, Dark, or System";
    var icon = document.createElement("span"); icon.className = "ic";
    var label = document.createElement("span"); label.className = "lbl";
    var caret = document.createElement("span"); caret.className = "cx"; caret.textContent = "▾";
    btn.appendChild(icon); btn.appendChild(label); btn.appendChild(caret);

    var menu = document.createElement("div");
    menu.className = "sl-theme-menu";
    menu.setAttribute("role", "menu");
    menu.hidden = true;
    MODES.forEach(function (m) {
      var it = document.createElement("button");
      it.type = "button";
      it.className = "sl-theme-item";
      it.dataset.mode = m.id;
      it.setAttribute("role", "menuitemradio");
      it.innerHTML = '<span class="ic">' + m.icon + '</span><span>' + m.label + '</span><span class="chk">✓</span>';
      it.addEventListener("click", function () { set(m.id); closeAll(); });
      menu.appendChild(it);
    });

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var willOpen = menu.hidden;
      closeAll();
      menu.hidden = !willOpen;
      btn.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    container.appendChild(wrap);
    controls.push({ wrap: wrap, btn: btn, icon: icon, label: label, menu: menu });
    updateControls();
  }

  // Close menus on outside click / Escape.
  document.addEventListener("click", closeAll);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeAll(); });

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }
  ready(function () {
    var m = document.getElementById("sl-theme");
    if (m) mount(m);
  });

  self.TabbySyncTheme = { get: get, set: set, apply: apply, mount: mount };
})();
