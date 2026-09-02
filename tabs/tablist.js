// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

/* TabbySync — tab-list page (single list per install). */
(function () {
  "use strict";

  var state = TabbySync.emptyState();
  var settings = null;

  var listEl = document.getElementById("list");
  var statusEl = document.getElementById("status-block");
  var suppressReload = false;
  var searchQuery = "";
  var countsOverride = null; // set while a search is active; null shows the normal tab/group counts

  // ---- utilities -----------------------------------------------------------

  function hostname(url) {
    try { return new URL(url).hostname.replace(/^www\./, ""); }
    catch (e) { return ""; }
  }
  function formatDate(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) +
      " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  function totals() {
    var tabs = 0;
    state.groups.forEach(function (g) { tabs += g.tabs.length; });
    return { tabs: tabs, groups: state.groups.length };
  }
  function groupById(id) { return state.groups.find(function (g) { return g.id === id; }); }
  function sortedGroups() { return state.groups.slice().sort(TabbySync.compareGroups); }

  // ---- persistence ---------------------------------------------------------

  function persist() {
    suppressReload = true;
    // Local save only — this always succeeds almost instantly, so it isn't
    // meaningful "sync" status. The status block reflects the real remote
    // sync outcome instead (see renderStatusBlock), which lands a moment
    // later via the debounced background push.
    TabbySync.saveState(state).catch(function () {})
      .finally(function () { setTimeout(function () { suppressReload = false; }, 200); });
  }

  // ---- status block (profile / encryption / sync status) -------------------

  function encryptionOn() { return !!(settings && settings.passphrase); }
  function profileLabel() {
    if (settings && settings.syncKey) return settings.syncKey;
    // No functional sync name (e.g. JSONBin, which has one profile per key)
    // — prefer the cosmetic profile label the user set for it, then fall
    // back to naming the sync method instead of showing a blank name.
    if (settings && settings.profileLabel) return settings.profileLabel;
    try { return self.TabbySyncProviders.providerMeta(settings && settings.provider).label; }
    catch (e) { return "Profile"; }
  }
  function countsLabel() {
    var t = totals();
    return t.tabs === 0 ? "no stashed tabs" :
      t.tabs + " tab" + (t.tabs === 1 ? "" : "s") + " in " +
      t.groups + " group" + (t.groups === 1 ? "" : "s");
  }
  function setCountsDisplay(text) {
    var c = statusEl && statusEl.querySelector(".status-count");
    if (c) c.textContent = text;
  }
  // Rebuilds the whole status block from the real, persisted sync status
  // (TabbySync.getSyncStatus()) plus current settings — not from whether the
  // last local edit merely saved, which is a different (and always-succeeds)
  // thing.
  function renderStatusBlock() {
    if (!statusEl) return;
    TabbySync.getSyncStatus().then(function (st) {
      var kind = st.status === "ok" ? "ok" : st.status === "error" ? "err" : "";
      var syncText = st.status === "ok" ? "Synced" : st.status === "error" ? "Sync error" : "Never synced";
      statusEl.className = "status-block" + (kind ? " " + kind : "");
      statusEl.title = (st.status === "error" && st.error) ? st.error : "Sync status";
      statusEl.innerHTML = "";
      statusEl.appendChild(el("span", "status-dot"));
      var nameEl = el("span", "status-name", profileLabel());
      nameEl.title = nameEl.textContent; // full name on hover if it's truncated
      statusEl.appendChild(nameEl);
      statusEl.appendChild(el("span", "status-enc" + (encryptionOn() ? " on" : ""),
        encryptionOn() ? "🔒 Encrypted" : "Not encrypted"));
      statusEl.appendChild(el("span", "status-sync", syncText));
      if (st.at) statusEl.appendChild(el("span", "status-last", formatDate(st.at)));
      statusEl.appendChild(el("span", "status-count", countsOverride != null ? countsOverride : countsLabel()));
    });
  }
  // Immediate feedback for a manually-triggered sync; renderStatusBlock()
  // (called once the request settles) replaces it with the real outcome.
  function setSyncBusy(on) {
    if (!statusEl) return;
    if (!on) { renderStatusBlock(); return; }
    statusEl.classList.add("busy");
    var s = statusEl.querySelector(".status-sync");
    if (s) s.textContent = "Syncing…";
  }

  // ---- actions -------------------------------------------------------------

  function openTabs(urls, active) {
    urls.forEach(function (url, i) {
      try { chrome.tabs.create({ url: url, active: !!active && i === 0 }); } catch (e) {}
    });
  }

  // Open one link in a background tab, keeping focus on the tab-list page.
  function openBackground(url) {
    try { chrome.tabs.create({ url: url, active: false }); } catch (e) {}
  }

  // Open the URLs and put them in a native browser tab group named `title`.
  // Falls back to plain tabs if the tabGroups API isn't available.
  function openTabsGrouped(urls, title, color) {
    if (!urls.length) return;
    if (!chrome.tabs || !chrome.tabs.group) { openTabs(urls, false); return; }
    var creations = urls.map(function (u) {
      return new Promise(function (resolve) {
        try { chrome.tabs.create({ url: u, active: false }, function (tab) { resolve(tab && tab.id); }); }
        catch (e) { resolve(null); }
      });
    });
    Promise.all(creations).then(function (ids) {
      ids = ids.filter(function (id) { return typeof id === "number"; });
      if (!ids.length) return;
      try {
        chrome.tabs.group({ tabIds: ids }, function (groupId) {
          if (chrome.runtime.lastError || groupId == null) return;
          if (chrome.tabGroups && chrome.tabGroups.update) {
            var props = {};
            if (title) props.title = title.slice(0, 60);
            if (color) props.color = color;
            if (Object.keys(props).length) {
              try { chrome.tabGroups.update(groupId, props, function () { void chrome.runtime.lastError; }); }
              catch (e) {}
            }
          }
        });
      } catch (e) { /* grouping unsupported on this browser */ }
    });
  }

  function groupLabel(g) { return g.name || formatDate(g.createdAt); }
  // Whether restoring should also remove the link(s) from the list.
  // Default OFF (restoring keeps the link); toggled in the toolbar / Options.
  function removeOnRestore() { return !!(settings && settings.removeOnRestore); }

  // After a tab has been opened (restored), remove it from the list if the
  // "remove after restore" setting is on and its group isn't locked.
  function removeTabAfterRestore(gid, index) {
    var g = groupById(gid); if (!g || g.locked) return;
    if (!removeOnRestore()) return;
    g.tabs.splice(index, 1); TabbySync.touchGroup(g);
    if (!g.tabs.length) TabbySync.removeGroup(state, gid);
    persist(); render();
  }

  function restoreTab(gid, index) {
    var g = groupById(gid); if (!g) return;
    var tab = g.tabs[index]; if (!tab) return;
    openTabs([tab.url], true);
    removeTabAfterRestore(gid, index);
  }
  // asGroupOverride: true = force tab group, false = force loose tabs,
  // undefined = use the Options default.
  function restoreGroup(gid, asGroupOverride) {
    var g = groupById(gid); if (!g) return;
    var urls = g.tabs.map(function (t) { return t.url; });
    var asGroup = typeof asGroupOverride === "boolean"
      ? asGroupOverride
      : !!(settings && settings.restoreAsGroup);
    if (asGroup) openTabsGrouped(urls, groupLabel(g));
    else openTabs(urls, false);
    if (!g.locked && removeOnRestore()) { TabbySync.removeGroup(state, gid); persist(); render(); }
  }
  function copyTab(t) { return { url: t.url, title: t.title || t.url, favIconUrl: t.favIconUrl || "" }; }
  function groupLabelSafe(g) { return g.name || formatDate(g.createdAt); }

  function deleteTab(gid, index) {
    var g = groupById(gid); if (!g || g.locked) return; // locked groups are protected
    var tab = g.tabs[index];
    if (tab) TabbySync.trashAdd(state, [{ kind: "tab", name: tab.title || tab.url, sourceName: groupLabelSafe(g), tabs: [copyTab(tab)] }]);
    g.tabs.splice(index, 1); TabbySync.touchGroup(g);
    if (!g.tabs.length) TabbySync.removeGroup(state, gid);
    persist(); render();
  }
  function deleteGroup(gid) {
    var g = groupById(gid); if (!g || g.locked) return; // must unlock first
    TabbySync.trashAdd(state, [{ kind: "group", name: groupLabelSafe(g), tabs: g.tabs.map(copyTab) }]);
    TabbySync.removeGroup(state, gid); persist(); render();
  }
  function toggleLock(gid) {
    var g = groupById(gid); if (!g) return;
    g.locked = !g.locked; TabbySync.touchGroup(g); persist(); render();
  }
  function togglePin(gid) {
    var g = groupById(gid); if (!g) return;
    g.pinned = !g.pinned;
    // place it at the top of the section it just joined
    var minOrder = 0;
    state.groups.forEach(function (x) {
      if (x.id !== gid && !!x.pinned === !!g.pinned) minOrder = Math.min(minOrder, TabbySync.orderVal(x));
    });
    g.order = minOrder - 1;
    TabbySync.touchGroup(g); persist(); render();
  }
  function renameGroup(gid, name) {
    var g = groupById(gid); if (!g) return;
    if (g.name === name) return;
    g.name = name; TabbySync.touchGroup(g); persist();
  }
  function restoreAll() {
    if (!state.groups.length) return;
    if (settings && settings.restoreAsGroup) {
      var colors = ["blue", "green", "red", "yellow", "purple", "cyan", "orange", "pink"];
      state.groups.forEach(function (g, i) {
        openTabsGrouped(g.tabs.map(function (t) { return t.url; }), groupLabel(g), colors[i % colors.length]);
      });
    } else {
      var urls = [];
      state.groups.forEach(function (g) { g.tabs.forEach(function (t) { urls.push(t.url); }); });
      openTabs(urls, false);
    }
    if (removeOnRestore()) {
      var keep = state.groups.filter(function (g) { return g.locked; });
      state.groups.forEach(function (g) { if (!g.locked) state.deleted[g.id] = Date.now(); });
      state.groups = keep;
      persist(); render();
    }
  }
  function deleteAllUnlocked() {
    var unlocked = state.groups.filter(function (g) { return !g.locked; });
    if (!unlocked.length) return;
    if (!confirm("Delete all " + unlocked.length + " unlocked list" + (unlocked.length === 1 ? "" : "s") +
      "? Locked lists are kept, and you can recover these from Trash.")) return;
    TabbySync.trashAdd(state, unlocked.map(function (g) {
      return { kind: "group", name: groupLabelSafe(g), tabs: g.tabs.map(copyTab) };
    }));
    var locked = state.groups.filter(function (g) { return g.locked; });
    state.groups.forEach(function (g) { if (!g.locked) state.deleted[g.id] = Date.now(); });
    state.groups = locked;
    persist(); render();
  }

  // ---- drag & drop ---------------------------------------------------------

  var dragCtx = null;       // dragging a single tab
  var dragGroupCtx = null;  // dragging a whole group

  function onGroupDragStart(e, gid) {
    dragGroupCtx = { gid: gid };
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", "group"); } catch (x) {}
    e.stopPropagation();
  }

  function onDragStart(e) {
    var li = e.target.closest("li.tab"); if (!li) return;
    dragCtx = { gid: li.dataset.gid, idx: parseInt(li.dataset.idx, 10) };
    li.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", "tab"); } catch (x) {}
  }
  function clearDropMarks() {
    document.querySelectorAll(".drop-before,.drop-after")
      .forEach(function (n) { n.classList.remove("drop-before", "drop-after"); });
  }

  // Reorder a whole group (and move it between the pinned/unpinned sections).
  function onGroupDrop(e) {
    var targetEl = e.target.closest(".group");
    clearDropMarks();
    var moved = groupById(dragGroupCtx.gid);
    dragGroupCtx = null;
    if (!moved || !targetEl) { return; }
    var target = groupById(targetEl.dataset.gid);
    if (!target || target.id === moved.id) { render(); return; }

    var rect = targetEl.getBoundingClientRect();
    var below = e.clientY > rect.top + rect.height / 2;
    moved.pinned = !!target.pinned; // adopt the section you dropped into

    var section = sortedGroups().filter(function (g) {
      return !!g.pinned === !!target.pinned && g.id !== moved.id;
    });
    var ti = section.findIndex(function (g) { return g.id === target.id; });
    var insertAt = ti + (below ? 1 : 0);
    section.splice(insertAt, 0, moved);
    section.forEach(function (g, i) {
      if (g.order !== i) { g.order = i; TabbySync.touchGroup(g); }
    });
    persist(); render();
  }

  function onDragOver(e) {
    if (dragGroupCtx) {
      e.preventDefault(); e.dataTransfer.dropEffect = "move";
      clearDropMarks();
      var gel = e.target.closest(".group");
      if (gel && gel.dataset.gid !== dragGroupCtx.gid) {
        var r = gel.getBoundingClientRect();
        gel.classList.add(e.clientY > r.top + r.height / 2 ? "drop-after" : "drop-before");
      }
      return;
    }
    if (!dragCtx) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "move";
    clearDropMarks();
    var li = e.target.closest("li.tab");
    if (li) {
      var rect = li.getBoundingClientRect();
      li.classList.add(e.clientY > rect.top + rect.height / 2 ? "drop-after" : "drop-before");
    }
  }
  function onDrop(e) {
    if (dragGroupCtx) { e.preventDefault(); onGroupDrop(e); return; }
    if (!dragCtx) return;
    e.preventDefault();
    var targetLi = e.target.closest("li.tab");
    var targetGroupEl = e.target.closest(".group");
    clearDropMarks();
    var src = groupById(dragCtx.gid);
    if (!src) { dragCtx = null; return; }
    var moving = src.tabs[dragCtx.idx];
    if (!moving) { dragCtx = null; return; }

    var destGid, destIndex;
    if (targetLi) {
      destGid = targetLi.dataset.gid;
      destIndex = parseInt(targetLi.dataset.idx, 10);
      var rect = targetLi.getBoundingClientRect();
      if (e.clientY > rect.top + rect.height / 2) destIndex += 1;
    } else if (targetGroupEl) {
      destGid = targetGroupEl.dataset.gid;
      var dg = groupById(destGid);
      destIndex = dg ? dg.tabs.length : 0;
    } else { dragCtx = null; return; }

    var dest = groupById(destGid);
    if (!dest) { dragCtx = null; return; }
    // Locked lists: reorder within the same list only — no moving links across
    // a locked boundary (in or out).
    if (dest.id !== src.id && (src.locked || dest.locked)) { dragCtx = null; return; }

    src.tabs.splice(dragCtx.idx, 1);
    if (destGid === dragCtx.gid && destIndex > dragCtx.idx) destIndex -= 1;
    dest.tabs.splice(destIndex, 0, moving);
    TabbySync.touchGroup(src); TabbySync.touchGroup(dest);
    if (!src.tabs.length) TabbySync.removeGroup(state, src.id);
    dragCtx = null; persist(); render();
  }
  function onDragEnd() {
    dragCtx = null; dragGroupCtx = null; clearDropMarks();
    document.querySelectorAll(".dragging").forEach(function (n) { n.classList.remove("dragging"); });
  }

  // ---- rendering -----------------------------------------------------------

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function render() {
    countsOverride = null;
    setCountsDisplay(countsLabel());

    listEl.innerHTML = "";
    if (!state.groups.length) {
      var empty = el("div", "empty");
      empty.appendChild(el("h2", null, "Nothing stashed"));
      var p = el("p");
      p.innerHTML =
        "Click the TabbySync toolbar icon and choose <b>Stash all tabs</b> (or press <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>O</kbd>) " +
        "to send this window's tabs here and free up memory.";
      empty.appendChild(p);
      listEl.appendChild(empty);
      return;
    }

    var groups = sortedGroups();
    var pinned = groups.filter(function (g) { return g.pinned; });
    var rest = groups.filter(function (g) { return !g.pinned; });

    if (pinned.length) {
      listEl.appendChild(sectionLabel("📌 Pinned"));
      pinned.forEach(function (g) { listEl.appendChild(renderGroup(g)); });
      if (rest.length) listEl.appendChild(sectionLabel("Groups"));
    }
    rest.forEach(function (g) { listEl.appendChild(renderGroup(g)); });
    applyFilter();
  }

  // Live search: hide tabs/groups that don't match the query (title, URL, or
  // group name). Filters the DOM in place so tab indices stay valid.
  function applyFilter() {
    var q = searchQuery.trim().toLowerCase();
    var groups = listEl.querySelectorAll(".group");
    var labels = listEl.querySelectorAll(".section-label");
    if (!q) {
      labels.forEach(function (l) { l.hidden = false; });
      groups.forEach(function (g) {
        g.hidden = false;
        g.querySelectorAll("li.tab").forEach(function (t) { t.hidden = false; });
      });
      countsOverride = null;
      setCountsDisplay(countsLabel());
      return;
    }
    labels.forEach(function (l) { l.hidden = true; });
    var shown = 0;
    groups.forEach(function (g) {
      var nameMatch = (g.dataset.name || "").indexOf(q) >= 0;
      var any = false;
      g.querySelectorAll("li.tab").forEach(function (t) {
        var vis = nameMatch || (t.dataset.search || "").indexOf(q) >= 0;
        t.hidden = !vis;
        if (vis) { any = true; shown++; }
      });
      g.hidden = !any;
    });
    countsOverride = shown + " matching tab" + (shown === 1 ? "" : "s") +
      " · “" + searchQuery.trim() + "”";
    setCountsDisplay(countsOverride);
  }

  function sectionLabel(text) {
    var d = el("div", "section-label", text);
    return d;
  }

  function renderGroup(g) {
    var group = el("div", "group" + (g.locked ? " locked" : "") + (g.pinned ? " pinned" : ""));
    group.dataset.gid = g.id;
    group.dataset.name = (g.name || "").toLowerCase();

    var head = el("div", "group-head");

    // group drag handle (reorder whole group)
    var ghandle = el("span", "group-handle", "⠿");
    ghandle.title = "Drag to reorder this group";
    ghandle.draggable = true;
    ghandle.addEventListener("dragstart", function (e) { onGroupDragStart(e, g.id); });
    ghandle.addEventListener("dragend", onDragEnd);
    head.appendChild(ghandle);

    // pin toggle
    var pin = el("span", "pin" + (g.pinned ? " on" : ""), "📌");
    pin.title = g.pinned ? "Unpin from top" : "Pin to top";
    pin.addEventListener("click", function () { togglePin(g.id); });
    head.appendChild(pin);

    var star = el("span", "star" + (g.locked ? " on" : ""), g.locked ? "🔒" : "🔓");
    star.title = g.locked
      ? "Locked — protected from deleting; click to unlock"
      : "Lock this group to protect it from accidental deletion";
    star.addEventListener("click", function () { toggleLock(g.id); });
    head.appendChild(star);

    var restore = el("button", "gbtn restore", "Restore");
    restore.title = "Reopen all these tabs as normal tabs (and clear the list unless locked)";
    restore.addEventListener("click", function () { restoreGroup(g.id, false); });
    head.appendChild(restore);

    var restoreG = el("button", "gbtn asgroup", "Restore as group");
    restoreG.title = "Reopen all these tabs together in a browser tab group";
    restoreG.addEventListener("click", function () { restoreGroup(g.id, true); });
    head.appendChild(restoreG);

    var exp = el("button", "gbtn export", "Export");
    exp.title = "Export just this list, to import into another profile";
    exp.addEventListener("click", function () { openExportScope(g.id); });
    head.appendChild(exp);

    if (g.locked) {
      head.appendChild(el("span", "lock-note", "Locked"));
    } else {
      var del = el("button", "gbtn delete", "Delete");
      del.title = "Delete this whole list";
      del.addEventListener("click", function () { deleteGroup(g.id); });
      head.appendChild(del);
    }

    var name = el("input", "group-name");
    name.value = g.name || "";
    name.placeholder = "Name this group…";
    name.addEventListener("change", function () { renameGroup(g.id, name.value.trim()); });
    name.addEventListener("keydown", function (e) { if (e.key === "Enter") name.blur(); });
    head.appendChild(name);

    head.appendChild(el("span", "spacer"));
    head.appendChild(el("span", "group-meta",
      g.tabs.length + " tab" + (g.tabs.length === 1 ? "" : "s") + " · " + formatDate(g.createdAt)));
    group.appendChild(head);

    var ul = el("ul", "tabs");
    g.tabs.forEach(function (tab, i) { ul.appendChild(renderTab(g, tab, i)); });
    group.appendChild(ul);

    group.addEventListener("dragover", onDragOver);
    group.addEventListener("drop", onDrop);
    return group;
  }

  function renderTab(g, tab, index) {
    var li = el("li", "tab");
    li.dataset.gid = g.id;
    li.dataset.idx = String(index);
    li.dataset.search = ((tab.title || "") + " " + (tab.url || "")).toLowerCase();
    li.draggable = true; // reordering allowed; locked lists only reorder in place

    var dh = el("span", "drag-handle", "⠿");
    dh.title = g.locked ? "Drag to reorder within this locked list" : "Drag to reorder";
    li.appendChild(dh);

    if (!g.locked) {
      var close = el("span", "close", "✕");
      close.title = "Remove from list";
      close.addEventListener("click", function (e) { e.stopPropagation(); deleteTab(g.id, index); });
      li.appendChild(close);
    } else {
      // keep alignment where the ✕ would be (no per-tab delete on locked lists)
      li.appendChild(el("span", "close-placeholder"));
    }

    var fav = el("img", "fav");
    fav.src = tab.favIconUrl || faviconFallback();
    fav.addEventListener("error", function () { fav.src = faviconFallback(); });
    li.appendChild(fav);

    var a = el("a", "title", tab.title || tab.url);
    a.href = tab.url;
    a.title = tab.url + (removeOnRestore() && !g.locked
      ? "  (opens in a background tab; removed from the list, like Restore)"
      : "  (opens in a background tab; stays in the list)");
    a.addEventListener("click", function (e) {
      // Left click with no modifiers: open in background, keep list open so
      // several can be launched in a row (the link itself is removed below
      // if "remove after restore" is on).
      if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        openBackground(tab.url);
      }
      // Any left-click variant counts as a restore — including ctrl/cmd/
      // shift-click, which falls through to the browser's own handling of
      // the href. Defer the removal so that native navigation (which relies
      // on the anchor still being in the document) isn't disrupted by the
      // re-render it triggers.
      setTimeout(function () { removeTabAfterRestore(g.id, index); }, 0);
    });
    // Middle-click also opens the link (native browser behavior) and should
    // count as a restore too.
    a.addEventListener("auxclick", function (e) {
      if (e.button === 1) setTimeout(function () { removeTabAfterRestore(g.id, index); }, 0);
    });
    li.appendChild(a);

    li.appendChild(el("span", "host", hostname(tab.url)));

    li.addEventListener("dragstart", onDragStart);
    li.addEventListener("dragover", onDragOver);
    li.addEventListener("drop", onDrop);
    li.addEventListener("dragend", onDragEnd);
    return li;
  }

  function faviconFallback() {
    return "data:image/svg+xml;utf8," + encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16'>" +
      "<rect width='16' height='16' rx='3' fill='#c7c7c7'/></svg>");
  }

  // ---- modal (import / export) --------------------------------------------

  var overlay = document.getElementById("overlay");
  var modalTitle = document.getElementById("modal-title");
  var modalHelp = document.getElementById("modal-help");
  var modalText = document.getElementById("modal-text");
  var modalPrimary = document.getElementById("modal-primary");
  var modalEncryptRow = document.getElementById("modal-encrypt-row");
  var modalEncrypt = document.getElementById("modal-encrypt");

  function exportObject(groups) {
    return {
      app: "TabbySync", version: 1,
      exportedAt: new Date().toISOString(),
      key: (settings && settings.syncKey) || "",
      groups: groups
    };
  }

  // scope: "all" for the whole profile, or a group id for a single list.
  function openExportScope(scope) {
    var groups, titleName;
    if (scope === "all") {
      groups = sortedGroups();
      titleName = "all lists";
    } else {
      var g = groupById(scope);
      if (!g) return;
      groups = [g];
      titleName = "“" + (g.name || formatDate(g.createdAt)) + "”";
    }
    var plaintext = JSON.stringify(exportObject(groups), null, 2);
    var hasPass = !!(settings && settings.passphrase);

    modalTitle.textContent = "Export " + titleName;
    modalText.readOnly = true;
    modalPrimary.textContent = "Copy";
    modalPrimary.onclick = function () {
      modalText.select();
      navigator.clipboard.writeText(modalText.value).catch(function () { document.execCommand("copy"); });
      modalPrimary.textContent = "Copied!";
      setTimeout(function () { modalPrimary.textContent = "Copy"; }, 1200);
    };

    function renderText() {
      if (hasPass && modalEncrypt.checked) {
        modalHelp.textContent = "Encrypted with your passphrase — importing needs the same passphrase.";
        modalText.value = "Encrypting…";
        TabbySync.encryptString(settings.passphrase, plaintext).then(function (env) {
          modalText.value = JSON.stringify(env, null, 2);
        });
      } else {
        modalHelp.textContent = scope === "all"
          ? "Plain JSON of every list. Import it in another profile from the Import dialog."
          : "Plain JSON of this one list. In another profile, click Import and paste it.";
        modalText.value = plaintext;
      }
    }

    if (hasPass) {
      modalEncryptRow.style.display = "flex";
      // default: encrypt full backups, but plain text for single-list transfers
      modalEncrypt.checked = (scope === "all");
      modalEncrypt.onchange = renderText;
    } else {
      modalEncryptRow.style.display = "none";
    }
    renderText();
    overlay.classList.add("show");
  }
  function openImport() {
    modalTitle.textContent = "Import";
    modalEncryptRow.style.display = "none";
    modalHelp.textContent = "Paste an exported list (JSON), or a plain list of URLs (one per line, optionally 'url | title'). Separate groups with a blank line. Added to the top of this profile.";
    modalText.value = ""; modalText.readOnly = false;
    modalPrimary.textContent = "Import";
    modalPrimary.onclick = function () {
      var text = modalText.value.trim();
      if (!text) return;
      TabbySync.importBackup(state, text, settings).then(function () {
        persist(); render();
        overlay.classList.remove("show");
      }).catch(function (e) { modalHelp.textContent = "Could not import: " + e.message; });
    };
    overlay.classList.add("show");
  }

  document.getElementById("modal-close").addEventListener("click", function () {
    overlay.classList.remove("show");
  });
  overlay.addEventListener("click", function (e) { if (e.target === overlay) overlay.classList.remove("show"); });

  // ---- trash panel ---------------------------------------------------------

  var trashOverlay = document.getElementById("trash-overlay");
  var trashListEl = document.getElementById("trash-list");
  var trashHelp = document.getElementById("trash-help");

  function relTime(ts) {
    var s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return "just now";
    var m = Math.floor(s / 60); if (m < 60) return m + " min ago";
    var h = Math.floor(m / 60); if (h < 24) return h + " hr ago";
    var d = Math.floor(h / 24); if (d < 30) return d + " day" + (d === 1 ? "" : "s") + " ago";
    return new Date(ts).toLocaleDateString();
  }

  function renderTrashList() {
    var list = (state.trash || []).slice();
    trashListEl.innerHTML = "";
    trashHelp.textContent = list.length
      ? "Deleted lists and links are kept for 30 days and sync across your computers. Restore adds them back to this profile."
      : "";
    if (!list.length) {
      trashListEl.appendChild(el("div", "trash-empty-note", "Trash is empty."));
    } else {
      list.forEach(function (entry) { trashListEl.appendChild(renderTrashEntry(entry)); });
    }
  }

  function openTrash() {
    renderTrashList();
    trashOverlay.classList.add("show");
  }

  function renderTrashEntry(entry) {
    var row = el("div", "trash-entry");
    row.appendChild(el("span", "trash-kind", entry.kind === "tab" ? "link" : "list"));

    var info = el("div", "trash-info");
    var nm = entry.name || (entry.tabs[0] && entry.tabs[0].url) || "(untitled)";
    info.appendChild(el("div", "trash-name", nm));
    var count = entry.tabs.length + " link" + (entry.tabs.length === 1 ? "" : "s");
    var src = entry.kind === "tab" && entry.sourceName ? " · from " + entry.sourceName : "";
    info.appendChild(el("div", "trash-meta", count + " · deleted " + relTime(entry.deletedAt) + src));
    row.appendChild(info);

    var actions = el("div", "trash-actions");
    var restore = el("button", "btn", "Restore");
    restore.addEventListener("click", function () { restoreFromTrash(entry); });
    var rm = el("button", "btn ghost", "Remove");
    rm.title = "Delete permanently from trash";
    rm.addEventListener("click", function () {
      TabbySync.trashRemove(state, entry.tid); persist(); renderTrashList();
    });
    actions.appendChild(restore); actions.appendChild(rm);
    row.appendChild(actions);
    return row;
  }

  function restoreFromTrash(entry) {
    TabbySync.addGroup(state, entry.tabs, entry.kind === "tab" ? "" : entry.name);
    TabbySync.trashRemove(state, entry.tid);
    persist(); render(); renderTrashList();
  }

  document.getElementById("trash-close").addEventListener("click", function () {
    trashOverlay.classList.remove("show");
  });
  trashOverlay.addEventListener("click", function (e) {
    if (e.target === trashOverlay) trashOverlay.classList.remove("show");
  });
  document.getElementById("trash-empty").addEventListener("click", function () {
    if (!confirm("Permanently empty the trash? This can't be undone.")) return;
    TabbySync.trashEmpty(state); persist(); renderTrashList();
  });

  // ---- toolbar wiring ------------------------------------------------------

  document.getElementById("search").addEventListener("input", function (e) {
    searchQuery = e.target.value || "";
    applyFilter();
  });
  document.getElementById("restore-all").addEventListener("click", restoreAll);
  document.getElementById("delete-all").addEventListener("click", deleteAllUnlocked);
  document.getElementById("export").addEventListener("click", function () { openExportScope("all"); });
  document.getElementById("import").addEventListener("click", openImport);
  document.getElementById("trash-link").addEventListener("click", openTrash);
  document.getElementById("options-link").addEventListener("click", function () {
    chrome.runtime.openOptionsPage();
  });
  document.getElementById("sync-now").addEventListener("click", function () {
    setSyncBusy(true);
    chrome.runtime.sendMessage({ type: "tabbysync-sync" }).then(function () {
      reload();
    }).catch(function () { renderStatusBlock(); });
  });
  document.getElementById("remove-on-restore").addEventListener("change", function (e) {
    var on = e.target.checked;
    if (settings) settings.removeOnRestore = on;
    TabbySync.setSettings({ removeOnRestore: on });
  });

  // ---- load / live updates -------------------------------------------------

  function reload() {
    return Promise.all([TabbySync.getState(), TabbySync.getSettings()]).then(function (r) {
      state = r[0]; settings = r[1];
      var rr = document.getElementById("remove-on-restore");
      if (rr) rr.checked = !!settings.removeOnRestore;
      render();
      renderStatusBlock();
      if (trashOverlay.classList.contains("show")) renderTrashList();
    });
  }

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== "local") return;
    if (changes[TabbySync.STATE_KEY] && !suppressReload) { reload(); return; }
    // The real sync outcome can change from elsewhere (the background alarm,
    // another open copy of this page) — keep the status block live.
    if (changes[TabbySync.STATUS_KEY]) { renderStatusBlock(); }
    // Reload if any tab-relevant setting changed (shared config keys).
    var K = self.TabbySyncConfig.KEYS;
    if ([K.tabRestoreGroup, K.tabDedupe, K.syncName, K.gistToken, K.gistSyncName, K.jsonbinToken,
      K.profileLabel, K.passphrase, K.tabRemoveOnRestore, K.provider].some(function (k) {
      return k in changes;
    })) { reload(); }
  });

  chrome.runtime.onMessage.addListener(function (msg) {
    if (msg && msg.type === "tabbysync-refresh") reload();
  });

  // Just render what's already stored — syncing stays on the "Sync now"
  // button and the background timer, not on opening this page.
  reload();
})();
