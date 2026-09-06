// app.js — the whole renderer UI. Plain classic script (no bundler, no
// framework — matches the rest of this project's zero-dependency ethos).
// Everything the user's own data touches is written via textContent/DOM
// APIs, never innerHTML, so a bookmark title or URL can never be interpreted
// as markup no matter what it contains.
'use strict';

const api = window.tabbysync;

window.addEventListener('error', (e) => {
  console.error('Uncaught error:', e.message, e.filename, e.lineno, e.colno, e.error && e.error.stack);
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason && (e.reason.stack || e.reason));
});

// ---------------------------------------------------------------------------
// tiny DOM helpers
// ---------------------------------------------------------------------------

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') for (const [dk, dv] of Object.entries(v)) el.dataset[dk] = dv;
    else if (k === 'checked' || k === 'disabled' || k === 'hidden') el[k] = !!v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}
function $(sel, root) { return (root || document).querySelector(sel); }
function clearNode(node) { while (node.firstChild) node.removeChild(node.firstChild); }
function fmtWhen(ts) {
  if (!ts) return 'never';
  const d = new Date(ts);
  return d.toLocaleString();
}

// ---------------------------------------------------------------------------
// toasts
// ---------------------------------------------------------------------------

function showToast(message, type, opts) {
  opts = opts || {};
  const root = $('#toasts');
  const node = h('div', { class: `toast ${type || ''}` }, message);
  root.appendChild(node);
  if (!opts.sticky) setTimeout(() => node.remove(), opts.duration || 5000);
  else {
    node.style.cursor = 'pointer';
    node.title = 'Click to dismiss';
    node.addEventListener('click', () => node.remove());
  }
  return node;
}
function showError(err, fallback) {
  const message = (err && err.message) || fallback || 'Something went wrong.';
  showToast(message, 'error', { sticky: true });
  console.error(err);
}

// ---------------------------------------------------------------------------
// modal system
// ---------------------------------------------------------------------------

let modalStack = [];

function openModal({ title, body, footer, wide }) {
  const overlay = h('div', { class: 'modal-root' });
  const modal = h('div', { class: 'modal' }, [
    h('div', { class: 'modal-header' }, [
      h('span', { text: title }),
      h('button', { class: 'close-x', type: 'button', onclick: () => close() }, '✕'),
    ]),
    h('div', { class: 'modal-body' }, body),
    footer ? h('div', { class: 'modal-footer' }, footer) : null,
  ]);
  if (wide) modal.style.width = '640px';
  overlay.appendChild(modal);
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  document.body.appendChild(overlay);
  const entry = { overlay, close: () => close() };
  function close() {
    overlay.remove();
    modalStack = modalStack.filter((m) => m !== entry);
  }
  modalStack.push(entry);
  return entry;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length) modalStack[modalStack.length - 1].close();
});

function confirmDialog({ title, message, confirmLabel, danger }) {
  return new Promise((resolve) => {
    const m = openModal({
      title,
      body: h('p', {}, message),
      footer: [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { m.close(); resolve(false); } }, 'Cancel'),
        h('button', { class: danger ? 'btn btn-danger' : 'btn btn-primary', type: 'button', onclick: () => { m.close(); resolve(true); } }, confirmLabel || 'OK'),
      ],
    });
  });
}

/** Mirrors the extension's own "type DELETE to unlock" pattern for destructive remote-data actions. */
function promptTypeToConfirm({ title, message, requiredText }) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'text', placeholder: requiredText });
    const confirmBtn = h('button', { class: 'btn btn-danger', type: 'button', disabled: true }, `I understand, delete it`);
    input.addEventListener('input', () => { confirmBtn.disabled = input.value.trim() !== requiredText; });
    confirmBtn.addEventListener('click', () => { m.close(); resolve(true); });
    const m = openModal({
      title,
      body: h('div', {}, [
        h('p', {}, message),
        h('div', { class: 'confirm-type-guard' }, [
          h('label', {}, `Type "${requiredText}" to confirm:`),
          input,
        ]),
      ]),
      footer: [
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { m.close(); resolve(false); } }, 'Cancel'),
        confirmBtn,
      ],
    });
  });
}

// ---------------------------------------------------------------------------
// context menu
// ---------------------------------------------------------------------------

let openMenus = [];
function closeAllMenus() { openMenus.forEach((m) => m.remove()); openMenus = []; }
document.addEventListener('mousedown', (e) => {
  if (!e.target.closest('.context-menu, .context-submenu')) closeAllMenus();
});
document.addEventListener('scroll', closeAllMenus, true);

/** items: [{label, danger, disabled, icon, iconClass, onClick} | {label, items: () => items} | '-']. icon is a glyph shown before the label (e.g. '↗'); iconClass colours it ('icon-open'/'icon-edit' match the row-action buttons of the same name). */
function openContextMenu(x, y, items) {
  closeAllMenus();
  const menu = buildMenu(items, x, y, 'context-menu');
  document.body.appendChild(menu);
  openMenus.push(menu);
}
function buildMenu(items, x, y, cls) {
  const menu = h('div', { class: cls });
  for (const item of items) {
    if (item === '-') { menu.appendChild(h('div', { class: 'context-menu-sep' })); continue; }
    const main = h('span', { class: 'context-menu-main' }, [
      item.icon ? h('span', { class: `context-menu-icon${item.iconClass ? ` ${item.iconClass}` : ''}` }, item.icon) : null,
      h('span', {}, item.label),
    ]);
    const row = h('div', {
      class: `context-menu-item${item.danger ? ' danger' : ''}${item.disabled ? ' disabled' : ''}`,
    }, main, item.items ? h('span', {}, '▸') : null);
    if (!item.disabled) {
      if (item.items) {
        row.addEventListener('mouseenter', () => {
          document.querySelectorAll('.context-submenu').forEach((n) => n.remove());
          const rect = row.getBoundingClientRect();
          const sub = buildMenu(item.items(), rect.right, rect.top, 'context-submenu');
          document.body.appendChild(sub);
          openMenus.push(sub);
        });
      } else {
        row.addEventListener('click', () => { closeAllMenus(); item.onClick(); });
      }
    }
    menu.appendChild(row);
  }
  document.body.appendChild(menu); // measure first
  const rect = menu.getBoundingClientRect();
  menu.remove();
  const left = Math.min(x, window.innerWidth - rect.width - 8);
  const top = Math.min(y, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(4, left)}px`;
  menu.style.top = `${Math.max(4, top)}px`;
  return menu;
}

// ---------------------------------------------------------------------------
// drag-to-reorder for a flat, vertically-stacked list (profiles, tab-group
// cards) — drop above or below a sibling to move it there. A separate thing
// from wireDragAndDrop (bookmarks, which drops INTO a folder) and dragTab
// (which drops a tab INTO a different list): this is plain "put this row
// where I dropped it" reordering, so it gets its own single shared drag
// token rather than overloading either of those.
// ---------------------------------------------------------------------------

let dragListItem = null;

/**
 * @param {HTMLElement} el - the draggable row/card for this item
 * @param {string} id - this item's id
 * @param {() => string[]} getOrder - the current ordered list of every item's id
 * @param {(idsInOrder: string[]) => void} onReorder - called with the proposed new order once a drop completes
 */
function wireListReorderDrag(el, id, getOrder, onReorder) {
  el.addEventListener('dragstart', (e) => {
    dragListItem = id;
    e.dataTransfer.effectAllowed = 'move';
  });
  el.addEventListener('dragover', (e) => {
    if (!dragListItem || dragListItem === id) return;
    e.preventDefault();
    const rect = el.getBoundingClientRect();
    const before = (e.clientY - rect.top) < rect.height / 2;
    el.classList.toggle('drag-over-top', before);
    el.classList.toggle('drag-over-bottom', !before);
  });
  el.addEventListener('dragleave', () => el.classList.remove('drag-over-top', 'drag-over-bottom'));
  el.addEventListener('dragend', () => { dragListItem = null; el.classList.remove('drag-over-top', 'drag-over-bottom'); });
  el.addEventListener('drop', (e) => {
    const draggedId = dragListItem;
    if (!draggedId || draggedId === id) return;
    e.preventDefault();
    e.stopPropagation(); // don't also let a same-card tab-drop handler (wireGroupDrop) react to this drop
    const before = el.classList.contains('drag-over-top');
    el.classList.remove('drag-over-top', 'drag-over-bottom');
    dragListItem = null;
    const order = getOrder().filter((x) => x !== draggedId);
    const targetIdx = order.indexOf(id);
    order.splice(before ? targetIdx : targetIdx + 1, 0, draggedId);
    onReorder(order);
  });
}

// ---------------------------------------------------------------------------
// state
// ---------------------------------------------------------------------------

const state = {
  profiles: [],
  activeId: null,
  panel: 'bookmarks',
  bm: { tree: null, dirty: false, status: 'not loaded' },
  tb: { state: null, dirty: false, status: 'not loaded' },
  expandedFolders: new Set(),
  expandedGroups: new Set(),
  selectedNodeId: null,
  providerMeta: null,
  // Per-profile, per-engine live connection status this session — not
  // persisted, reset on every launch, since "is this reachable right now"
  // is a live question, not something to trust from a previous run.
  // id -> { bookmarks: 'unknown'|'ok'|'error', tabs: 'unknown'|'ok'|'error' }
  engineStatus: new Map(),
};

function activeProfile() { return state.profiles.find((p) => p.id === state.activeId) || null; }

/** Mirrors shared/status.js's own combined-badge rule: error beats ok beats unknown, and either engine alone being confirmed ok is enough — the profile doesn't have to have touched both to read as "this is working". */
function setEngineStatus(id, engine, status) {
  const cur = state.engineStatus.get(id) || { bookmarks: 'unknown', tabs: 'unknown' };
  cur[engine] = status;
  state.engineStatus.set(id, cur);
  renderProfileList();
  if (id === state.activeId) applyHeaderStatusDot();
}
function combinedStatus(id) {
  const s = state.engineStatus.get(id);
  if (!s) return 'unknown';
  if (s.bookmarks === 'error' || s.tabs === 'error') return 'error';
  if (s.bookmarks === 'ok' || s.tabs === 'ok') return 'ok';
  return 'unknown';
}
function statusColorVar(status) {
  return status === 'ok' ? 'var(--success)' : status === 'error' ? 'var(--danger)' : 'var(--text-faint)';
}

// ---------------------------------------------------------------------------
// profile sidebar
// ---------------------------------------------------------------------------

async function refreshProfiles() {
  state.profiles = await api.profiles.list();
  renderProfileList();
}

function renderProfileList() {
  const root = $('#profile-list');
  clearNode(root);
  if (!state.profiles.length) {
    root.appendChild(h('div', { class: 'profile-list-empty' }, 'No profiles yet. Add one with the button above to connect to your self-hosted server, GitHub Gist, or JSONBin destination.'));
    return;
  }
  state.profiles.forEach((p) => {
    const dirty = (p.id === state.activeId) && (state.bm.dirty || state.tb.dirty);
    const status = combinedStatus(p.id);
    const item = h('div', {
      class: `profile-item${p.id === state.activeId ? ' active' : ''}`,
      role: 'option',
      draggable: 'true',
      onclick: () => selectProfile(p.id),
    }, [
      h('span', { class: 'color-dot', title: statusTitle(status) }, ''),
      h('span', { class: 'p-label' }, [
        document.createTextNode(p.label),
      ]),
      dirty ? h('span', { class: 'p-dirty', title: 'Unsaved changes' }, '●') : null,
      h('span', { class: 'p-meta' }, providerShortLabel(p.provider)),
      h('button', {
        class: 'p-menu-btn', type: 'button', title: 'Profile options',
        onclick: (e) => { e.stopPropagation(); openProfileMenu(p, e.currentTarget); },
      }, '⋯'),
    ]);
    item.querySelector('.color-dot').style.background = statusColorVar(status);
    // Drag a profile onto another to reorder — "Move up"/"Move down" in its
    // ⋯ menu still does the same thing, for anyone who hasn't noticed
    // dragging works.
    wireListReorderDrag(item, p.id, () => state.profiles.map((x) => x.id), reorderProfilesTo);
    root.appendChild(item);
  });
}

/** Drag-and-drop's landing spot: applies whatever order wireListReorderDrag worked out. */
async function reorderProfilesTo(orderedIds) {
  try {
    state.profiles = await api.profiles.reorder(orderedIds);
    renderProfileList();
  } catch (e) { showError(e, 'Could not reorder profiles.'); }
}

function statusTitle(status) {
  return status === 'ok' ? 'Connected' : status === 'error' ? 'Connection error' : 'Not checked yet this session';
}

function providerShortLabel(id) {
  return { custom: 'Self-hosted', gist: 'GitHub Gist', jsonbin: 'JSONBin.io' }[id] || id;
}

function openProfileMenu(profile, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const idx = state.profiles.findIndex((p) => p.id === profile.id);
  openContextMenu(rect.left, rect.bottom + 4, [
    { label: 'Edit connection…', onClick: () => openProfileModal(profile) },
    { label: 'Duplicate', onClick: () => duplicateProfile(profile) },
    { label: 'Move up', disabled: idx === 0, onClick: () => moveProfile(profile, -1) },
    { label: 'Move down', disabled: idx === state.profiles.length - 1, onClick: () => moveProfile(profile, 1) },
    '-',
    { label: 'Delete synced data…', danger: true, onClick: () => openDeleteRemoteDataModal(profile) },
    { label: 'Remove profile…', danger: true, onClick: () => removeProfile(profile) },
  ]);
}

async function moveProfile(profile, dir) {
  const ids = state.profiles.map((p) => p.id);
  const idx = ids.indexOf(profile.id);
  const target = idx + dir;
  if (target < 0 || target >= ids.length) return;
  [ids[idx], ids[target]] = [ids[target], ids[idx]];
  try {
    state.profiles = await api.profiles.reorder(ids);
    renderProfileList();
  } catch (e) { showError(e, 'Could not reorder profiles.'); }
}

async function duplicateProfile(profile) {
  try {
    const copy = await api.profiles.duplicate(profile.id);
    await refreshProfiles();
    showToast(`Duplicated as "${copy.label}". Its remote destination starts empty — save something into it to give it its own data.`, 'success');
  } catch (e) { showError(e, 'Could not duplicate profile.'); }
}

async function removeProfile(profile) {
  const ok = await confirmDialog({
    title: 'Remove profile',
    message: `Remove "${profile.label}" from the Control Panel? This only forgets it here — it does NOT delete anything from its remote server/Gist/bin. Use "Delete synced data…" first if you also want that gone.`,
    confirmLabel: 'Remove',
    danger: true,
  });
  if (!ok) return;
  try {
    await api.profiles.remove(profile.id);
    state.engineStatus.delete(profile.id);
    if (state.activeId === profile.id) { state.activeId = null; showEmptyState(); }
    await refreshProfiles();
  } catch (e) { showError(e, 'Could not remove profile.'); }
}

async function openDeleteRemoteDataModal(profile) {
  const ok = await promptTypeToConfirm({
    title: `Delete synced data — ${profile.label}`,
    message: `This permanently deletes this profile's remote bookmarks and saved tabs (the server file / Gist / JSONBin bins), for anyone and any device using it. Your saved credentials for this profile are left as-is. This cannot be undone.`,
    requiredText: 'DELETE',
  });
  if (!ok) return;
  try {
    await api.profiles.deleteRemoteData(profile.id);
    if (state.activeId === profile.id) { state.bm = { tree: null, dirty: false, status: 'not loaded' }; state.tb = { state: null, dirty: false, status: 'not loaded' }; }
    showToast('Remote data deleted.', 'success');
  } catch (e) { showError(e, 'Could not delete remote data.'); }
}

// ---------------------------------------------------------------------------
// profile add/edit modal
// ---------------------------------------------------------------------------

async function ensureProviderMeta() {
  if (!state.providerMeta) state.providerMeta = await api.profiles.meta();
  return state.providerMeta;
}

async function openProfileModal(existing) {
  const meta = await ensureProviderMeta();
  const providers = ['custom', 'gist', 'jsonbin'];
  let provider = existing ? existing.provider : 'custom';
  const full = existing ? await api.profiles.get(existing.id) : null;

  const labelInput = h('input', { type: 'text', value: existing ? existing.label : '', placeholder: 'e.g. Work, Personal, Home server' });
  const urlInput = h('input', { type: 'url', value: full ? full.serverUrl : '', placeholder: 'https://example.com/tabbysync/tabbysync.php' });
  const tokenInput = h('input', { type: 'password', value: full ? full.token : '' });
  const syncNameInput = h('input', { type: 'text', value: full ? full.syncName : '' });
  const passInput = h('input', { type: 'password', value: full ? full.passphrase : '', placeholder: '(optional) end-to-end encryption passphrase' });

  const urlField = h('div', { class: 'field' }, [h('label', {}, 'Server address'), urlInput]);
  const tokenField = h('div', { class: 'field' }, [h('label', {}, 'Token'), tokenInput]);
  const syncNameField = h('div', { class: 'field' }, [h('label', {}, 'Sync name'), syncNameInput,
    h('div', { class: 'hint' }, 'Same name as another device/browser to share data with it. Different names stay separate.')]);
  const setupHint = h('div', { class: 'hint setup-hint' });
  const disclaimer = h('div', { class: 'disclaimer' });

  const providerBtns = {};
  const providerPicker = h('div', { class: 'provider-picker' },
    providers.map((id) => {
      const btn = h('button', { class: 'btn', type: 'button', onclick: () => { provider = id; applyProviderUi(); } }, meta[id].label.replace(' (recommended)', '').replace(' (free, no server)', ''));
      providerBtns[id] = btn;
      return btn;
    }));

  function applyProviderUi() {
    Object.entries(providerBtns).forEach(([id, btn]) => btn.classList.toggle('active', id === provider));
    const m = meta[provider];
    urlField.hidden = !m.needsUrl;
    syncNameField.hidden = !m.needsSyncName;
    tokenField.querySelector('label').textContent = m.tokenLabel;
    tokenInput.placeholder = m.tokenPlaceholder;
    setupHint.innerHTML = ''; // safe: setupHint.textContent set below via a text node built from trusted, hardcoded provider metadata — see note
    setupHint.appendChild(trustedHintNode(m.setupHint));
    disclaimer.hidden = !m.disclaimer;
    if (m.disclaimer) disclaimer.textContent = m.disclaimer.replace(/^⚠️\s*/, '⚠️ ');
  }
  applyProviderUi();

  const testStatus = h('div', { class: 'test-status' }, '');

  const body = h('div', {}, [
    h('div', { class: 'field' }, [h('label', {}, 'Profile name'), labelInput]),
    h('div', { class: 'field' }, [h('label', {}, 'Sync method'), providerPicker]),
    urlField,
    tokenField,
    setupHint,
    syncNameField,
    disclaimer,
    h('div', { class: 'field' }, [h('label', {}, 'Encryption passphrase (optional, recommended for Gist/JSONBin)'), passInput,
      h('div', { class: 'hint' }, "Never leaves this device. If you forget it, the data can't be recovered.")]),
    testStatus,
  ]);

  /**
   * Whatever's in the form right now, shaped like a profile — never saved,
   * just handed to profiles:testConnectionDraft. gistId/jsonbinTabsId/
   * jsonbinBookmarksId aren't editable fields (they name a specific
   * already-created remote gist/bin), so those come from the saved record
   * when editing an existing profile, and stay blank for a brand-new one —
   * same as duplicate() does in profile-store.js.
   */
  function buildDraftProfile() {
    return {
      provider,
      serverUrl: urlInput.value.trim(),
      token: tokenInput.value,
      syncName: syncNameInput.value.trim(),
      passphrase: passInput.value,
      gistId: full ? full.gistId : '',
      jsonbinTabsId: full ? full.jsonbinTabsId : '',
      jsonbinBookmarksId: full ? full.jsonbinBookmarksId : '',
    };
  }

  const testBtn = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Test connection');
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testStatus.className = 'test-status';
    testStatus.textContent = 'Testing…';
    try {
      const r = await api.profiles.testConnectionDraft(buildDraftProfile());
      const { message, ok } = formatTestConnectionResult(r);
      testStatus.className = `test-status ${ok ? 'success' : 'warning'}`;
      testStatus.textContent = message;
      // Only an already-saved profile has a sidebar dot to update — a
      // brand-new one isn't in state.profiles yet.
      if (existing) {
        setEngineStatus(existing.id, 'bookmarks', r.bookmarks.ok ? 'ok' : 'error');
        setEngineStatus(existing.id, 'tabs', r.tabs.ok ? 'ok' : 'error');
      }
    } catch (e) {
      testStatus.className = 'test-status warning';
      testStatus.textContent = (e && e.message) || 'Could not test the connection.';
    } finally {
      testBtn.disabled = false;
    }
  });

  const m = openModal({
    title: existing ? 'Edit profile' : 'New sync profile',
    body,
    footer: [
      testBtn,
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: onSave }, existing ? 'Save' : 'Add profile'),
    ],
  });

  async function onSave() {
    const payload = {
      label: labelInput.value,
      provider,
      serverUrl: urlInput.value.trim(),
      token: tokenInput.value,
      syncName: syncNameInput.value.trim(),
      passphrase: passInput.value,
    };
    try {
      if (existing) await api.profiles.update(existing.id, payload);
      else await api.profiles.add(payload);
      m.close();
      await refreshProfiles();
      if (existing && existing.id === state.activeId) {
        showProfileView(); // header shows label/color/provider live
        // The connection details just changed — whatever's cached (data or
        // a cached error, e.g. an auth failure from a token just corrected
        // above) was fetched under the OLD settings. Reload so the panel
        // reflects the fix now instead of only on the next app restart.
        // Skipped when there are unsaved local edits so this never
        // silently discards them — Refresh's own discard-confirmation
        // covers that case instead.
        if (!state.bm.dirty) await loadBookmarks(true);
        if (!state.tb.dirty) await loadTabs(true);
      }
      if (!existing) showToast('Profile added.', 'success');
    } catch (e) { showError(e, 'Could not save this profile.'); }
  }
}

/**
 * shared/providers.js's setupHint strings are small, hand-written HTML
 * fragments authored by this project (links to github.com/jsonbin.io setup
 * pages) — not user data. Rendering them via a detached template keeps that
 * trust boundary explicit instead of quietly reusing innerHTML elsewhere.
 */
function trustedHintNode(htmlString) {
  const template = document.createElement('template');
  template.innerHTML = htmlString;
  return template.content;
}

// ---------------------------------------------------------------------------
// selecting a profile / panel switching
// ---------------------------------------------------------------------------

async function selectProfile(id) {
  if (state.activeId === id) return;
  if (!(await confirmDiscardIfDirty())) return;
  state.activeId = id;
  state.bm = { tree: null, dirty: false, status: 'not loaded' };
  state.tb = { state: null, dirty: false, status: 'not loaded' };
  state.selectedNodeId = null;
  renderProfileList();
  showProfileView();
  // Recorded regardless of whether "reopen last profile" is turned on, so
  // turning it on later has something to act on right away instead of
  // waiting for the next selection.
  api.settings.update({ lastActiveProfileId: id }).catch((e) => console.error(e));
  await Promise.all([loadBookmarks(false), loadTabs(false)]);
}

async function confirmDiscardIfDirty() {
  if (!state.bm.dirty && !state.tb.dirty) return true;
  return confirmDialog({
    title: 'Unsaved changes',
    message: 'This profile has unsaved changes. Switching profiles keeps them in memory only until you save — leave anyway? (Nothing is lost yet; come back to this profile and save when ready.)',
    confirmLabel: 'Switch anyway',
  });
}

function showEmptyState() {
  $('#empty-state').hidden = false;
  $('#profile-view').hidden = true;
}
function showProfileView() {
  const p = activeProfile();
  if (!p) return showEmptyState();
  $('#empty-state').hidden = true;
  $('#profile-view').hidden = false;
  $('#pv-label').textContent = p.label;
  $('#pv-provider').textContent = providerShortLabel(p.provider);
  applyHeaderStatusDot();
}

function applyHeaderStatusDot() {
  const p = activeProfile();
  if (!p) return;
  const status = combinedStatus(p.id);
  const dot = $('#pv-color');
  dot.style.background = statusColorVar(status);
  dot.title = statusTitle(status);
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    state.panel = btn.dataset.panel;
    document.querySelectorAll('.tab-btn').forEach((b) => { b.classList.toggle('active', b === btn); b.setAttribute('aria-selected', b === btn); });
    document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.dataset.panel !== state.panel; });
  });
});

/** Shared by the profile modal's Test connection button — turns {bookmarks, tabs} into one readable line plus whether either engine actually failed. */
function formatTestConnectionResult(r) {
  const parts = [
    r.bookmarks.ok ? '✅ Bookmarks reachable' : `❌ Bookmarks: ${r.bookmarks.message}`,
    r.tabs.ok ? '✅ Saved tabs reachable' : `❌ Saved tabs: ${r.tabs.message}`,
  ];
  return { message: parts.join('  ·  '), ok: r.bookmarks.ok && r.tabs.ok };
}

$('#btn-edit-profile').addEventListener('click', () => { const p = activeProfile(); if (p) openProfileModal(p); });
$('#btn-profile-menu').addEventListener('click', (e) => { const p = activeProfile(); if (p) openProfileMenu(p, e.currentTarget); });
$('#btn-new-profile').addEventListener('click', () => openProfileModal(null));
$('#btn-about').addEventListener('click', openAboutModal);

async function openAboutModal() {
  const info = await api.app.info();
  const updateLine = h('p', { class: 'update-status' }, 'Updates download automatically in the background and ask before installing.');
  const checkBtn = h('button', { class: 'btn btn-sm', type: 'button' }, 'Check for updates');
  checkBtn.addEventListener('click', async () => {
    checkBtn.disabled = true;
    updateLine.textContent = 'Checking…';
    try {
      const status = await api.app.checkForUpdates();
      updateLine.textContent = describeUpdateStatus(status, info.version);
    } catch (e) {
      updateLine.textContent = 'Could not check for updates.';
      console.error(e);
    } finally {
      checkBtn.disabled = false;
    }
  });

  openModal({
    title: 'About TabbySync Control Panel',
    body: h('div', {}, [
      h('p', {}, `Version ${info.version}`),
      h('p', {}, `Profiles are stored at: ${info.profilesFile}`),
      h('p', {}, info.secretsAvailable
        ? 'Tokens and passphrases are encrypted at rest using your operating system’s secure storage.'
        : '⚠️ Your OS secure storage is not available — tokens and passphrases are stored in plain text in the file above.'),
      h('p', {}, 'A companion desktop app for TabbySync: manages the same self-hosted / GitHub Gist / JSONBin sync destinations your browser extension uses, so you can add, remove, move and copy bookmarks and saved tabs across every profile from one place.'),
      h('div', { class: 'field' }, [updateLine, checkBtn]),
    ]),
    footer: [h('button', { class: 'btn btn-primary', type: 'button', onclick: (e) => e.target.closest('.modal-root').remove() }, 'Close')],
  });
}

/** Turns main.cjs's app:checkForUpdates result into one line of human text. */
function describeUpdateStatus(status, currentVersion) {
  switch (status && status.state) {
    case 'checking': return 'Checking…';
    case 'not-available': return status.reason || `You're up to date (${currentVersion}).`;
    case 'downloading': return `A new version (${status.version}) was found and is downloading in the background.`;
    case 'downloaded': return `Version ${status.version} is downloaded and ready — restart to install it (you'll be asked).`;
    case 'error': return `Couldn't check for updates: ${status.message || 'unknown error'}`;
    default: return `You're up to date (${currentVersion}).`;
  }
}

// ---------------------------------------------------------------------------
// BOOKMARKS panel
// ---------------------------------------------------------------------------

async function loadBookmarks(force) {
  const p = activeProfile(); if (!p) return;
  state.bm.status = 'loading…';
  renderStatusLine();
  try {
    const { tree, dirty } = await api.bookmarks.load(p.id, { force });
    state.bm.tree = tree;
    state.bm.dirty = dirty;
    state.bm.status = 'loaded';
    setEngineStatus(p.id, 'bookmarks', 'ok');
    renderBookmarkTree();
  } catch (e) {
    state.bm.status = 'error';
    setEngineStatus(p.id, 'bookmarks', 'error');
    showError(e, 'Could not load bookmarks for this profile.');
  }
  renderStatusLine();
}

function renderStatusLine() {
  $('#bm-status').textContent = state.bm.status === 'loaded' ? '' : state.bm.status;
  $('#tb-status').textContent = state.tb.status === 'loaded' ? '' : state.tb.status;
  $('#bm-dirty-dot').hidden = !state.bm.dirty;
  $('#tb-dirty-dot').hidden = !state.tb.dirty;
  renderProfileList();
}

const BAR_ID = '__bar__', OTHER_ID = '__other__';

function renderBookmarkTree() {
  const root = $('#bm-tree');
  clearNode(root);
  if (!state.bm.tree) return;
  root.appendChild(renderTreeNode(state.bm.tree.children[0], 0)); // Bookmarks bar
  root.appendChild(renderTreeNode(state.bm.tree.children[1], 0)); // Other bookmarks
}

function renderTreeNode(node, depth) {
  const isFolder = node.type === 'folder';
  const expanded = isFolder && (depth === 0 || state.expandedFolders.has(node.id));
  const wrap = h('div', { class: 'tree-node' });
  const row = h('div', {
    class: `tree-row${state.selectedNodeId === node.id ? ' selected' : ''}`,
    draggable: 'true',
    dataset: { id: node.id, type: node.type },
    onclick: () => { state.selectedNodeId = node.id; renderBookmarkTree(); },
    // Double-clicking a bookmark opens it, matching what double-clicking a
    // bookmark does everywhere else (a browser's own bookmarks bar
    // included) — editing is still one right-click away, in the context
    // menu, for anyone who reaches for the double-click out of habit.
    ondblclick: () => (isFolder ? toggleFolder(node.id) : api.app.openExternal(node.url)),
    oncontextmenu: (e) => { e.preventDefault(); state.selectedNodeId = node.id; renderBookmarkTree(); openBookmarkContextMenu(node, e.clientX, e.clientY); },
  }, [
    isFolder ? h('span', { class: 'twisty', onclick: (e) => { e.stopPropagation(); toggleFolder(node.id); } }, expanded ? '▾' : '▸') : h('span', { class: 'twisty' }, ''),
    h('span', { class: 'icon' }, isFolder ? (depth === 0 ? '📌' : '📁') : '🔖'),
    h('span', { class: 'title' }, node.title || (node.type === 'bookmark' ? node.url : '(untitled)')),
    node.type === 'bookmark' ? h('span', { class: 'url' }, node.url) : h('span', { class: 'url' }, isFolder ? `${(node.children || []).length} item${(node.children || []).length === 1 ? '' : 's'}` : ''),
    h('div', { class: 'row-actions' }, [
      !isFolder ? h('button', {
        class: 'btn btn-sm btn-icon btn-icon-open', type: 'button', title: 'Open in browser',
        onclick: (e) => { e.stopPropagation(); api.app.openExternal(node.url); },
      }, '↗') : null,
      h('button', {
        class: 'btn btn-sm btn-icon btn-icon-edit', type: 'button', title: isFolder ? 'Rename' : 'Edit',
        onclick: (e) => { e.stopPropagation(); isFolder ? openRenameModal(node) : openEditBookmarkModal(node); },
      }, '✎'),
      h('button', { class: 'btn btn-sm btn-icon', type: 'button', title: 'More', onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); openBookmarkContextMenu(node, r.left, r.bottom + 4); } }, '⋯'),
    ]),
  ]);
  wireDragAndDrop(row, node, isFolder);
  wrap.appendChild(row);
  if (isFolder && expanded) {
    const kids = h('div', { class: 'tree-children' });
    if (!(node.children || []).length) kids.appendChild(h('div', { class: 'tree-empty' }, 'Empty'));
    (node.children || []).forEach((c) => kids.appendChild(renderTreeNode(c, depth + 1)));
    wrap.appendChild(kids);
  }
  return wrap;
}

function toggleFolder(id) {
  if (state.expandedFolders.has(id)) state.expandedFolders.delete(id); else state.expandedFolders.add(id);
  renderBookmarkTree();
}

let dragNodeId = null;
function wireDragAndDrop(row, node, isFolder) {
  row.addEventListener('dragstart', (e) => { dragNodeId = node.id; e.dataTransfer.effectAllowed = 'move'; });
  if (!isFolder) return;
  row.addEventListener('dragover', (e) => { if (dragNodeId && dragNodeId !== node.id) { e.preventDefault(); row.classList.add('drag-over'); } });
  row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
  row.addEventListener('drop', async (e) => {
    e.preventDefault();
    row.classList.remove('drag-over');
    const draggedId = dragNodeId; dragNodeId = null;
    if (!draggedId || draggedId === node.id) return;
    await doBookmarkOp(() => api.bookmarks.move(activeProfile().id, { id: draggedId, newParentId: node.id }), { silent: true });
  });
}

async function doBookmarkOp(callFn, opts) {
  opts = opts || {};
  try {
    const { tree } = await callFn();
    state.bm.tree = tree;
    state.bm.dirty = true;
    renderBookmarkTree();
    renderStatusLine();
  } catch (e) { showError(e, 'That change could not be applied.'); }
}

function openBookmarkContextMenu(node, x, y) {
  const isFolder = node.type === 'folder';
  const isFixedRoot = node.id === BAR_ID || node.id === OTHER_ID;
  const items = [];
  if (isFolder) {
    items.push({ label: 'New bookmark here…', onClick: () => openAddBookmarkModal(node.id) });
    items.push({ label: 'New folder here…', onClick: () => openAddFolderModal(node.id) });
    items.push('-');
  } else {
    items.push({ label: 'Open in browser', onClick: () => api.app.openExternal(node.url) });
    items.push({ label: 'Edit…', onClick: () => openEditBookmarkModal(node) });
  }
  if (!isFixedRoot) {
    items.push({ label: 'Rename…', onClick: () => openRenameModal(node) });
    items.push({ label: 'Move up', onClick: () => doBookmarkOp(() => api.bookmarks.moveWithinParent(activeProfile().id, { id: node.id, direction: -1 })) });
    items.push({ label: 'Move down', onClick: () => doBookmarkOp(() => api.bookmarks.moveWithinParent(activeProfile().id, { id: node.id, direction: 1 })) });
  }
  items.push('-');
  items.push({ label: 'Copy to folder…', onClick: () => openMoveCopyBookmarkModal(node, 'copy', 'same') });
  items.push({ label: 'Move to folder…', disabled: isFixedRoot, onClick: () => openMoveCopyBookmarkModal(node, 'move', 'same') });
  items.push({ label: 'Copy to another profile…', onClick: () => openMoveCopyBookmarkModal(node, 'copy', 'cross') });
  items.push({ label: 'Move to another profile…', disabled: isFixedRoot, onClick: () => openMoveCopyBookmarkModal(node, 'move', 'cross') });
  if (!isFixedRoot) {
    items.push('-');
    items.push({ label: 'Delete…', danger: true, onClick: () => deleteBookmarkNode(node) });
  }
  openContextMenu(x, y, items);
}

async function deleteBookmarkNode(node) {
  const isFolder = node.type === 'folder';
  const count = isFolder ? countNodes(node) - 1 : 0;
  const ok = await confirmDialog({
    title: `Delete ${isFolder ? 'folder' : 'bookmark'}`,
    message: isFolder
      ? `Delete "${node.title || 'this folder'}" and everything inside it${count ? ` (${count} item${count === 1 ? '' : 's'})` : ''}?`
      : `Delete "${node.title || node.url}"?`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  await doBookmarkOp(() => api.bookmarks.remove(activeProfile().id, { id: node.id }));
}
function countNodes(node) {
  let n = 1;
  (node.children || []).forEach((c) => { n += countNodes(c); });
  return n;
}

function openAddBookmarkModal(parentId) {
  const titleInput = h('input', { type: 'text', placeholder: '(optional — defaults to the URL)' });
  const urlInput = h('input', { type: 'url', placeholder: 'https://example.com' });
  const m = openModal({
    title: 'New bookmark',
    body: h('div', {}, [
      h('div', { class: 'field' }, [h('label', {}, 'URL'), urlInput]),
      h('div', { class: 'field' }, [h('label', {}, 'Title'), titleInput]),
    ]),
    footer: [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        if (!urlInput.value.trim()) return showToast('A URL is required.', 'warning');
        m.close();
        await doBookmarkOp(() => api.bookmarks.addBookmark(activeProfile().id, { parentId, url: urlInput.value.trim(), title: titleInput.value.trim() }));
      } }, 'Add'),
    ],
  });
  urlInput.focus();
}

function openAddFolderModal(parentId) {
  const titleInput = h('input', { type: 'text', placeholder: 'Folder name' });
  const m = openModal({
    title: 'New folder',
    body: h('div', { class: 'field' }, [h('label', {}, 'Name'), titleInput]),
    footer: [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        m.close();
        await doBookmarkOp(() => api.bookmarks.addFolder(activeProfile().id, { parentId, title: titleInput.value.trim() || 'New folder' }));
      } }, 'Add'),
    ],
  });
  titleInput.focus();
}

function openEditBookmarkModal(node) {
  const titleInput = h('input', { type: 'text', value: node.title || '' });
  const urlInput = h('input', { type: 'url', value: node.url || '' });
  const m = openModal({
    title: 'Edit bookmark',
    body: h('div', {}, [
      h('div', { class: 'field' }, [h('label', {}, 'URL'), urlInput]),
      h('div', { class: 'field' }, [h('label', {}, 'Title'), titleInput]),
    ]),
    footer: [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        m.close();
        if (titleInput.value !== node.title) await doBookmarkOp(() => api.bookmarks.rename(activeProfile().id, { id: node.id, title: titleInput.value }));
        if (urlInput.value.trim() !== node.url) await doBookmarkOp(() => api.bookmarks.editUrl(activeProfile().id, { id: node.id, url: urlInput.value.trim() }));
      } }, 'Save'),
    ],
  });
}

function openRenameModal(node) {
  const input = h('input', { type: 'text', value: node.title || '' });
  const m = openModal({
    title: 'Rename',
    body: h('div', { class: 'field' }, [h('label', {}, 'Name'), input]),
    footer: [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { m.close(); await doBookmarkOp(() => api.bookmarks.rename(activeProfile().id, { id: node.id, title: input.value })); } }, 'Save'),
    ],
  });
  input.focus(); input.select();
}

function listFoldersClientSide(tree) {
  const out = [];
  (function visit(node, depth) {
    if (node.type !== 'folder') return;
    if (node.id !== 'root') out.push({ id: node.id, title: node.title || (node.id === BAR_ID ? 'Bookmarks bar' : node.id === OTHER_ID ? 'Other bookmarks' : '(untitled folder)'), depth });
    (node.children || []).forEach((c) => visit(c, node.id === 'root' ? depth : depth + 1));
  })(tree, 0);
  return out;
}

async function openMoveCopyBookmarkModal(node, mode, scope) {
  const verb = mode === 'copy' ? 'Copy' : 'Move';
  const others = state.profiles.filter((p) => p.id !== state.activeId);
  if (scope === 'cross' && !others.length) return showToast('There are no other profiles to copy/move to yet.', 'warning');

  let targetProfileId = scope === 'cross' ? (others[0] && others[0].id) : state.activeId;
  const profileSelect = h('select', {}, (scope === 'cross' ? others : state.profiles.filter((p) => p.id === state.activeId)).map((p) => h('option', { value: p.id }, p.label)));
  const folderSelect = h('select', {});

  async function populateFolders() {
    clearNode(folderSelect);
    let folders;
    if (targetProfileId === state.activeId && state.bm.tree) {
      folders = listFoldersClientSide(state.bm.tree);
    } else {
      const { tree } = await api.bookmarks.load(targetProfileId, { force: false });
      folders = listFoldersClientSide(tree);
    }
    folders.forEach((f) => folderSelect.appendChild(h('option', { value: f.id }, `${'　'.repeat(f.depth)}${f.title}`)));
  }
  await populateFolders();
  if (scope === 'cross') profileSelect.addEventListener('change', async () => { targetProfileId = profileSelect.value; await populateFolders(); });

  const body = h('div', {}, [
    scope === 'cross' ? h('div', { class: 'field' }, [h('label', {}, 'Target profile'), profileSelect]) : null,
    h('div', { class: 'field' }, [h('label', {}, 'Destination folder'), folderSelect]),
  ]);

  const m = openModal({
    title: `${verb} "${node.title || node.url}"`,
    body,
    footer: [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        m.close();
        const destFolderId = folderSelect.value;
        try {
          if (scope === 'same') {
            const fn = mode === 'copy' ? api.bookmarks.copy : api.bookmarks.move;
            await doBookmarkOp(() => fn(activeProfile().id, { id: node.id, newParentId: destFolderId }));
          } else {
            const fn = mode === 'copy' ? api.bookmarks.copyToProfile : api.bookmarks.moveToProfile;
            await fn(state.activeId, node.id, targetProfileId, destFolderId);
            // moveToProfile already saved the source-side removal remotely
            // (see sessions.js) — reload rather than doBookmarkOp so the
            // dirty flag reflects that nothing is actually unsaved here.
            if (mode === 'move') await loadBookmarks(true);
            showToast(`${verb === 'Copy' ? 'Copied' : 'Moved'} to ${state.profiles.find((p) => p.id === targetProfileId).label}.`, 'success');
          }
        } catch (e) { showError(e, `Could not ${mode} this item.`); }
      } }, verb),
    ],
  });
}

$('#bm-add-bookmark').addEventListener('click', () => { const p = activeProfile(); if (p) openAddBookmarkModal(OTHER_ID); });
$('#bm-add-folder').addEventListener('click', () => { const p = activeProfile(); if (p) openAddFolderModal(OTHER_ID); });
$('#bm-refresh').addEventListener('click', async () => {
  if (state.bm.dirty && !(await confirmDialog({ title: 'Discard changes?', message: 'Refreshing re-loads from the server and discards unsaved local edits. Continue?', confirmLabel: 'Discard and refresh', danger: true }))) return;
  await loadBookmarks(true);
});
$('#bm-save').addEventListener('click', () => saveBookmarks(false));
$('#bm-export').addEventListener('click', async () => {
  const p = activeProfile(); if (!p || !state.bm.tree) return;
  try {
    const r = await api.bookmarks.exportHtml(p.id, state.bm.tree);
    if (r.saved) showToast(`Exported to ${r.filePath}`, 'success');
  } catch (e) { showError(e, 'Could not export bookmarks.'); }
});
$('#bm-import').addEventListener('click', async () => {
  const p = activeProfile(); if (!p) return;
  try {
    const r = await api.bookmarks.importHtml(p.id, { destParentId: OTHER_ID });
    if (r.imported) {
      state.bm.tree = r.tree; state.bm.dirty = true;
      renderBookmarkTree(); renderStatusLine();
      showToast(`Imported ${r.imported} top-level item${r.imported === 1 ? '' : 's'} into Other bookmarks.`, 'success');
    }
  } catch (e) { showError(e, 'Could not import that file.'); }
});

async function saveBookmarks(allowLargeDeletion) {
  const p = activeProfile(); if (!p) return;
  const btn = $('#bm-save'); btn.disabled = true;
  try {
    const { tree, stats } = await api.bookmarks.save(p.id, { allowLargeDeletion });
    state.bm.tree = tree; state.bm.dirty = false;
    setEngineStatus(p.id, 'bookmarks', 'ok');
    renderBookmarkTree(); renderStatusLine();
    showToast(`Saved — ${stats.bookmarks} bookmark${stats.bookmarks === 1 ? '' : 's'} in ${stats.folders} folder${stats.folders === 1 ? '' : 's'}.`, 'success');
  } catch (e) {
    if (e.code === 'LARGE_DELETION') {
      // Refused by the safety brake, not a connection problem — the fetch
      // that produced this answer already succeeded.
      setEngineStatus(p.id, 'bookmarks', 'ok');
      const ok = await confirmDialog({
        title: 'This looks like a big deletion',
        message: e.message,
        confirmLabel: 'Save anyway',
        danger: true,
      });
      if (ok) return saveBookmarks(true);
    } else {
      setEngineStatus(p.id, 'bookmarks', 'error');
      showError(e, 'Could not save bookmarks.');
    }
  } finally { btn.disabled = false; }
}

// ---------------------------------------------------------------------------
// SAVED TABS panel
// ---------------------------------------------------------------------------

async function loadTabs(force) {
  const p = activeProfile(); if (!p) return;
  state.tb.status = 'loading…';
  renderStatusLine();
  try {
    const { state: s, dirty } = await api.tabs.load(p.id, { force });
    state.tb.state = s;
    state.tb.dirty = dirty;
    state.tb.status = 'loaded';
    setEngineStatus(p.id, 'tabs', 'ok');
    renderTabLists();
  } catch (e) {
    state.tb.status = 'error';
    setEngineStatus(p.id, 'tabs', 'error');
    showError(e, 'Could not load saved tabs for this profile.');
  }
  renderStatusLine();
}

function renderTabLists() {
  const root = $('#tb-list');
  clearNode(root);
  if (!state.tb.state) return;
  const groups = state.tb.state.groups || [];
  if (!groups.length) { root.appendChild(h('div', { class: 'tab-list-empty' }, 'No saved tab lists yet.')); return; }
  groups.forEach((g) => root.appendChild(renderGroup(g)));
}

function renderGroup(g) {
  const expanded = state.expandedGroups.has(g.id);
  const card = h('div', { class: 'tab-group', dataset: { id: g.id } });
  const header = h('div', {
    class: 'tab-group-header',
    draggable: 'true',
    onclick: () => { toggleGroup(g.id); },
    oncontextmenu: (e) => { e.preventDefault(); openGroupContextMenu(g, e.clientX, e.clientY); },
  }, [
    h('span', { class: 'twisty' }, expanded ? '▾' : '▸'),
    h('span', { class: 'g-flags' }, [g.pinned ? '📌' : '', g.locked ? '🔒' : '']),
    h('span', { class: 'g-name' }, g.name || 'Untitled list'),
    h('span', { class: 'g-count' }, `${g.tabs.length} tab${g.tabs.length === 1 ? '' : 's'}`),
    h('button', { class: 'btn btn-sm btn-icon btn-icon-open', type: 'button', title: 'Open all in browser…', onclick: (e) => { e.stopPropagation(); openTabsBulk(g); } }, '↗'),
    h('button', { class: 'btn btn-sm btn-icon', type: 'button', onclick: (e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); openGroupContextMenu(g, r.left, r.bottom + 4); } }, '⋯'),
  ]);
  // Drag this list's header onto another list's header to reorder — the
  // header specifically (not the whole card), so "which half am I over"
  // stays based on one compact row instead of a tall expanded card.
  // Move up/down in the context menu still does the same thing, for anyone
  // who hasn't noticed dragging works.
  wireListReorderDrag(header, g.id, () => state.tb.state.groups.map((x) => x.id), reorderGroupsTo);
  wireGroupDrop(card, g);
  card.appendChild(header);
  if (expanded) {
    const body = h('div', { class: 'tab-list-body' });
    if (!g.tabs.length) body.appendChild(h('div', { class: 'tab-list-empty' }, 'No tabs in this list.'));
    g.tabs.forEach((t, idx) => body.appendChild(renderTabRow(g, t, idx)));
    const addBtn = h('div', { class: 'tab-group-actions' }, [
      h('button', { class: 'btn btn-sm', type: 'button', onclick: () => openAddTabModal(g.id) }, '+ Add tab'),
    ]);
    card.appendChild(body);
    card.appendChild(addBtn);
  }
  return card;
}

function toggleGroup(id) {
  if (state.expandedGroups.has(id)) state.expandedGroups.delete(id); else state.expandedGroups.add(id);
  renderTabLists();
}

let dragTab = null;
function wireGroupDrop(card, g) {
  card.addEventListener('dragover', (e) => { if (dragTab && dragTab.groupId !== g.id) { e.preventDefault(); card.classList.add('drag-over'); } });
  card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
  card.addEventListener('drop', async (e) => {
    e.preventDefault();
    card.classList.remove('drag-over');
    const d = dragTab; dragTab = null;
    if (!d || d.groupId === g.id) return;
    await doTabsOp(() => api.tabs.moveTab(activeProfile().id, { fromGroupId: d.groupId, fromIndex: d.index, toGroupId: g.id }));
  });
}

function renderTabRow(g, t, idx) {
  const row = h('div', {
    class: 'tab-row',
    draggable: 'true',
    // Same reasoning as the bookmark tree: double-click opens, matching
    // what double-clicking a link/tab does everywhere else.
    ondblclick: () => api.app.openExternal(t.url),
    oncontextmenu: (e) => { e.preventDefault(); openTabContextMenu(g, t, idx, e.clientX, e.clientY); },
  }, [
    h('span', { class: 't-title' }, t.title || t.url),
    h('span', { class: 't-url' }, t.url),
    h('div', { class: 'row-actions' }, [
      h('button', { class: 'btn btn-sm btn-icon btn-icon-open', type: 'button', title: 'Open in browser', onclick: () => api.app.openExternal(t.url) }, '↗'),
      h('button', { class: 'btn btn-sm btn-icon btn-icon-edit', type: 'button', title: 'Edit', onclick: () => openEditTabModal(g, t, idx) }, '✎'),
      h('button', { class: 'btn btn-sm btn-icon', type: 'button', title: 'More', onclick: (e2) => { const r = e2.currentTarget.getBoundingClientRect(); openTabContextMenu(g, t, idx, r.left, r.bottom + 4); } }, '⋯'),
    ]),
  ]);
  row.addEventListener('dragstart', () => { dragTab = { groupId: g.id, index: idx }; });
  return row;
}

function openEditTabModal(g, t, idx) {
  const urlInput = h('input', { type: 'url', value: t.url || '' });
  const titleInput = h('input', { type: 'text', value: t.title || '' });
  const m = openModal({
    title: 'Edit tab',
    body: h('div', {}, [
      h('div', { class: 'field' }, [h('label', {}, 'URL'), urlInput]),
      h('div', { class: 'field' }, [h('label', {}, 'Title'), titleInput]),
    ]),
    footer: [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        m.close();
        await doTabsOp(() => api.tabs.editTab(activeProfile().id, { groupId: g.id, index: idx, url: urlInput.value.trim(), title: titleInput.value.trim() }));
      } }, 'Save'),
    ],
  });
}

async function doTabsOp(callFn) {
  try {
    const { state: s } = await callFn();
    state.tb.state = s;
    state.tb.dirty = true;
    renderTabLists();
    renderStatusLine();
  } catch (e) { showError(e, 'That change could not be applied.'); }
}

// ---------------------------------------------------------------------------
// Bulk-opening a whole list — mirrors the browser extension's own tabs/
// tablist.js ceiling protection exactly (same constants, same "ask, then
// batch, then let the user stop" shape). Opening a saved list of a few
// hundred tabs would otherwise hand the OS a few hundred "launch the
// browser" requests back to back, which is enough to make even a capable
// PC crawl — reported against the extension itself before this existed
// there.
//
// One thing this can't do that the extension's own "restore as a tab
// group" can: put the opened tabs into a browser tab group. Creating or
// naming a tab group is chrome.tabs.group()/chrome.tabGroups.update() — a
// privileged API a browser only grants to its own installed extensions.
// This app opens tabs the same way any other desktop program does — by
// asking Windows to hand each URL to your default browser — and that
// surface has no concept of tab groups at all. So this opens every chosen
// tab into your browser, same as the extension, just not grouped.
// ---------------------------------------------------------------------------

const BULK_WARN_AT = 15;   // open up to this many without asking
const BULK_FIRST_N = 25;   // what "just some of them" means
const BATCH_SIZE = 5;      // tabs opened per tick
const BATCH_PAUSE = 140;   // ms between ticks — keeps things responsive

/** Resolves with how many to open (a number), or null for "don't". Skips the question entirely at or under BULK_WARN_AT. */
function askHowMany(total, listName) {
  if (total <= BULK_WARN_AT) return Promise.resolve(total);
  return new Promise((resolve) => {
    const some = Math.min(BULK_FIRST_N, total);
    const overlay = h('div', { class: 'bulk-overlay' });
    function done(value) { overlay.remove(); resolve(value); }
    overlay.appendChild(h('div', { class: 'bulk-box' }, [
      h('div', { class: 'bulk-title' }, `Open ${total} tabs?`),
      h('div', { class: 'bulk-msg' }, `Opening "${listName}" would open ${total} tabs at once in your browser. That's enough to make most browsers crawl, and can run your machine out of memory. Nothing is removed from your list either way.`),
      h('div', { class: 'bulk-choices' }, [
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => done(some) }, `Open the first ${some}`),
        h('button', { class: 'btn', type: 'button', onclick: () => done(total) }, `Open all ${total}`),
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => done(null) }, 'Cancel'),
      ]),
    ]));
    // Deliberately no backdrop-click / Escape dismissal here (unlike openModal) —
    // this is a decision with real consequences (could open dozens of tabs),
    // so it only ever closes via one of the three buttons above.
    document.body.appendChild(overlay);
  });
}

/** Opens urls a few at a time. Resolves with { opened, stopped }. Shows a stoppable progress overlay only above BULK_WARN_AT, matching askHowMany's own threshold for staying silent on small lists. */
function runBulkOpen(urls) {
  return new Promise((resolve) => {
    let i = 0;
    let stopped = false;
    let countEl = null;
    let overlay = null;
    if (urls.length > BULK_WARN_AT) {
      const stopBtn = h('button', { class: 'btn btn-danger', type: 'button', onclick: () => { stopped = true; } }, 'Stop');
      countEl = h('div', { class: 'bulk-msg' }, `Opened 0 of ${urls.length}…`);
      overlay = h('div', { class: 'bulk-overlay' }, [
        h('div', { class: 'bulk-box' }, [
          h('div', { class: 'bulk-title' }, 'Opening tabs…'),
          countEl,
          h('div', { class: 'bulk-choices' }, [stopBtn]),
        ]),
      ]);
      document.body.appendChild(overlay);
    }
    (function tick() {
      if (stopped || i >= urls.length) {
        if (overlay) overlay.remove();
        resolve({ opened: i, stopped });
        return;
      }
      const end = Math.min(i + BATCH_SIZE, urls.length);
      for (; i < end; i++) {
        api.app.openExternal(urls[i]).catch(() => {}); // one bad URL shouldn't stop the rest
      }
      if (countEl) countEl.textContent = `Opened ${i} of ${urls.length}…`;
      setTimeout(tick, BATCH_PAUSE);
    })();
  });
}

async function openTabsBulk(g) {
  const urls = g.tabs.map((t) => t.url).filter(Boolean);
  if (!urls.length) { showToast('This list has no tabs.', 'warning'); return; }
  const limit = await askHowMany(urls.length, g.name || 'Untitled list');
  if (limit == null) return;
  const { opened, stopped } = await runBulkOpen(urls.slice(0, limit));
  showToast(
    stopped ? `Stopped after opening ${opened} of ${limit}.` : `Opened ${opened} tab${opened === 1 ? '' : 's'}.`,
    stopped ? 'warning' : 'success',
  );
}

function openGroupContextMenu(g, x, y) {
  openContextMenu(x, y, [
    { label: 'Open all in browser…', icon: '↗', iconClass: 'icon-open', disabled: !g.tabs.length, onClick: () => openTabsBulk(g) },
    '-',
    { label: 'Rename…', icon: '✎', iconClass: 'icon-edit', onClick: () => openRenameListModal(g) },
    { label: g.pinned ? 'Unpin' : 'Pin', onClick: () => doTabsOp(() => api.tabs.setPinned(activeProfile().id, { id: g.id, pinned: !g.pinned })) },
    { label: g.locked ? 'Unlock' : 'Lock', onClick: () => doTabsOp(() => api.tabs.setLocked(activeProfile().id, { id: g.id, locked: !g.locked })) },
    { label: 'Duplicate', onClick: () => doTabsOp(() => api.tabs.duplicateList(activeProfile().id, { id: g.id })) },
    // Drag the list's header to reorder (see wireListReorderDrag) — these
    // stay for anyone who hasn't noticed dragging works, same reasoning as
    // keeping them on the profile list's own menu.
    { label: 'Move up', onClick: () => reorderGroup(g.id, -1) },
    { label: 'Move down', onClick: () => reorderGroup(g.id, 1) },
    '-',
    { label: 'Copy to another profile…', onClick: () => openMoveCopyListModal(g, 'copy') },
    { label: 'Move to another profile…', disabled: g.locked, onClick: () => openMoveCopyListModal(g, 'move') },
    '-',
    { label: 'Delete list…', danger: true, disabled: g.locked, onClick: () => deleteList(g) },
  ]);
}

async function reorderGroup(id, dir) {
  const ids = state.tb.state.groups.map((g) => g.id);
  const idx = ids.indexOf(id);
  const target = idx + dir;
  if (target < 0 || target >= ids.length) return;
  [ids[idx], ids[target]] = [ids[target], ids[idx]];
  await doTabsOp(() => api.tabs.reorderLists(activeProfile().id, { orderedIds: ids }));
}

/** Drag-and-drop's landing spot: applies whatever order wireListReorderDrag worked out. */
async function reorderGroupsTo(orderedIds) {
  await doTabsOp(() => api.tabs.reorderLists(activeProfile().id, { orderedIds }));
}

function openRenameListModal(g) {
  const input = h('input', { type: 'text', value: g.name || '' });
  const m = openModal({
    title: 'Rename list',
    body: h('div', { class: 'field' }, [h('label', {}, 'Name'), input]),
    footer: [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { m.close(); await doTabsOp(() => api.tabs.renameList(activeProfile().id, { id: g.id, name: input.value })); } }, 'Save'),
    ],
  });
  input.focus(); input.select();
}

async function deleteList(g) {
  const ok = await confirmDialog({
    title: 'Delete list',
    message: `Delete "${g.name || 'Untitled list'}" (${g.tabs.length} tab${g.tabs.length === 1 ? '' : 's'})? It moves to Recently deleted for 30 days.`,
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  await doTabsOp(() => api.tabs.removeList(activeProfile().id, { id: g.id }));
}

function openAddListModal() {
  const input = h('input', { type: 'text', placeholder: 'List name (optional)' });
  const m = openModal({
    title: 'New saved-tabs list',
    body: h('div', { class: 'field' }, [h('label', {}, 'Name'), input]),
    footer: [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => { m.close(); await doTabsOp(() => api.tabs.addList(activeProfile().id, { name: input.value.trim() })); } }, 'Add'),
    ],
  });
  input.focus();
}

function openAddTabModal(groupId) {
  const urlInput = h('input', { type: 'url', placeholder: 'https://example.com' });
  const titleInput = h('input', { type: 'text', placeholder: '(optional — defaults to the URL)' });
  const m = openModal({
    title: 'Add tab',
    body: h('div', {}, [
      h('div', { class: 'field' }, [h('label', {}, 'URL'), urlInput]),
      h('div', { class: 'field' }, [h('label', {}, 'Title'), titleInput]),
    ]),
    footer: [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        if (!urlInput.value.trim()) return showToast('A URL is required.', 'warning');
        m.close();
        state.expandedGroups.add(groupId);
        await doTabsOp(() => api.tabs.addTab(activeProfile().id, { groupId, url: urlInput.value.trim(), title: titleInput.value.trim() }));
      } }, 'Add'),
    ],
  });
  urlInput.focus();
}

function openTabContextMenu(g, t, idx, x, y) {
  openContextMenu(x, y, [
    { label: 'Open in browser', onClick: () => api.app.openExternal(t.url) },
    { label: 'Move to list…', onClick: () => openMoveCopyTabModal(g, t, idx, 'move', 'same') },
    { label: 'Copy to list…', onClick: () => openMoveCopyTabModal(g, t, idx, 'copy', 'same') },
    { label: 'Move to another profile…', onClick: () => openMoveCopyTabModal(g, t, idx, 'move', 'cross') },
    { label: 'Copy to another profile…', onClick: () => openMoveCopyTabModal(g, t, idx, 'copy', 'cross') },
    '-',
    { label: 'Remove', danger: true, onClick: () => doTabsOp(() => api.tabs.removeTab(activeProfile().id, { groupId: g.id, index: idx })) },
  ]);
}

async function openMoveCopyListModal(g, mode) {
  const others = state.profiles.filter((p) => p.id !== state.activeId);
  if (!others.length) return showToast('There are no other profiles to copy/move to yet.', 'warning');
  const select = h('select', {}, others.map((p) => h('option', { value: p.id }, p.label)));
  const m = openModal({
    title: `${mode === 'copy' ? 'Copy' : 'Move'} "${g.name || 'Untitled list'}"`,
    body: h('div', { class: 'field' }, [h('label', {}, 'Target profile'), select]),
    footer: [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        m.close();
        try {
          const fn = mode === 'copy' ? api.tabs.copyListToProfile : api.tabs.moveListToProfile;
          await fn(state.activeId, g.id, select.value);
          if (mode === 'move') await loadTabs(true);
          showToast(`${mode === 'copy' ? 'Copied' : 'Moved'} to ${others.find((p) => p.id === select.value).label}.`, 'success');
        } catch (e) { showError(e, `Could not ${mode} this list.`); }
      } }, mode === 'copy' ? 'Copy' : 'Move'),
    ],
  });
}

async function openMoveCopyTabModal(g, t, idx, mode, scope) {
  const others = state.profiles.filter((p) => p.id !== state.activeId);
  if (scope === 'cross' && !others.length) return showToast('There are no other profiles to copy/move to yet.', 'warning');
  let targetProfileId = scope === 'cross' ? others[0].id : state.activeId;
  const profileSelect = h('select', {}, others.map((p) => h('option', { value: p.id }, p.label)));
  const listSelect = h('select', {});
  const newListInput = h('input', { type: 'text', placeholder: 'New list name', hidden: true });

  async function populateLists() {
    clearNode(listSelect);
    let groups;
    if (targetProfileId === state.activeId) {
      // "Move/copy to list…" only makes sense targeting a DIFFERENT list —
      // this branch only runs for scope:'same' (scope:'cross' never lets
      // targetProfileId equal the active profile, see `others` above).
      groups = state.tb.state.groups.filter((x) => x.id !== g.id);
    } else {
      const { state: s } = await api.tabs.load(targetProfileId, { force: false });
      groups = s.groups;
    }
    groups.forEach((x) => listSelect.appendChild(h('option', { value: x.id }, x.name || 'Untitled list')));
    listSelect.appendChild(h('option', { value: '' }, '➕ New list…'));
    listSelect.addEventListener('change', () => { newListInput.hidden = listSelect.value !== ''; });
  }
  await populateLists();
  if (scope === 'cross') profileSelect.addEventListener('change', async () => { targetProfileId = profileSelect.value; await populateLists(); });

  const m = openModal({
    title: `${mode === 'copy' ? 'Copy' : 'Move'} tab`,
    body: h('div', {}, [
      scope === 'cross' ? h('div', { class: 'field' }, [h('label', {}, 'Target profile'), profileSelect]) : null,
      h('div', { class: 'field' }, [h('label', {}, 'Target list'), listSelect]),
      h('div', { class: 'field' }, [h('label', {}, 'New list name'), newListInput]),
    ]),
    footer: [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn btn-primary', type: 'button', onclick: async () => {
        m.close();
        try {
          if (scope === 'same') {
            const toGroupId = listSelect.value || (await ensureNewList(newListInput.value));
            const fn = mode === 'copy' ? api.tabs.copyTab : api.tabs.moveTab;
            await doTabsOp(() => fn(activeProfile().id, { fromGroupId: g.id, fromIndex: idx, toGroupId }));
          } else {
            const fn = mode === 'copy' ? api.tabs.copyTabToProfile : api.tabs.moveTabToProfile;
            await fn(state.activeId, g.id, idx, targetProfileId, listSelect.value || null, newListInput.value.trim() || 'From another profile');
            if (mode === 'move') await loadTabs(true);
            showToast(`${mode === 'copy' ? 'Copied' : 'Moved'} to ${others.find((p) => p.id === targetProfileId).label}.`, 'success');
          }
        } catch (e) { showError(e, `Could not ${mode} this tab.`); }
      } }, mode === 'copy' ? 'Copy' : 'Move'),
    ],
  });

  async function ensureNewList(name) {
    const r = await api.tabs.addList(activeProfile().id, { name: name.trim() });
    state.tb.state = r.state; state.tb.dirty = true;
    return r.id;
  }
}

$('#tb-add-list').addEventListener('click', () => { if (activeProfile()) openAddListModal(); });
$('#tb-refresh').addEventListener('click', async () => {
  if (state.tb.dirty && !(await confirmDialog({ title: 'Discard changes?', message: 'Refreshing re-loads from the server and discards unsaved local edits. Continue?', confirmLabel: 'Discard and refresh', danger: true }))) return;
  await loadTabs(true);
});
$('#tb-save').addEventListener('click', saveTabs);
$('#tb-trash').addEventListener('click', openTrashModal);

async function saveTabs() {
  const p = activeProfile(); if (!p) return;
  const btn = $('#tb-save'); btn.disabled = true;
  try {
    const { state: s } = await api.tabs.save(p.id);
    state.tb.state = s; state.tb.dirty = false;
    setEngineStatus(p.id, 'tabs', 'ok');
    renderTabLists(); renderStatusLine();
    showToast('Saved tabs synced.', 'success');
  } catch (e) { setEngineStatus(p.id, 'tabs', 'error'); showError(e, 'Could not save saved tabs.'); }
  finally { btn.disabled = false; }
}

function openTrashModal() {
  if (!state.tb.state) return;
  const trash = state.tb.state.trash || [];
  const body = h('div', {});
  if (!trash.length) body.appendChild(h('p', {}, 'Nothing in Recently deleted.'));
  trash.forEach((e) => {
    body.appendChild(h('div', { class: 'tab-row', style: '' }, [
      h('span', { class: 't-title' }, `${e.name || 'Untitled list'} — ${(e.tabs || []).length} tab(s), deleted ${fmtWhen(e.deletedAt)}`),
      h('button', { class: 'btn btn-sm', type: 'button', onclick: async () => { m.close(); await doTabsOp(() => api.tabs.restoreFromTrash(activeProfile().id, { tid: e.tid })); openTrashModal(); } }, 'Restore'),
    ]));
  });
  const m = openModal({
    title: 'Recently deleted',
    body,
    wide: true,
    footer: [
      trash.length ? h('button', { class: 'btn btn-danger', type: 'button', onclick: async () => { m.close(); await doTabsOp(() => api.tabs.emptyTrash(activeProfile().id)); } }, 'Empty trash') : null,
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Close'),
    ],
  });
}

// ---------------------------------------------------------------------------
// keyboard shortcuts + init
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (!activeProfile()) return;
    if (state.panel === 'bookmarks') saveBookmarks(false); else saveTabs();
  }
});

window.addEventListener('beforeunload', (e) => {
  if (state.bm.dirty || state.tb.dirty) {
    e.preventDefault();
    e.returnValue = '';
  }
});

async function init() {
  try {
    const info = await api.app.info();
    $('#secrets-warning').hidden = info.secretsAvailable;
    $('#app-version').textContent = `v${info.version}`;
  } catch (e) { console.error(e); }

  let settings = null;
  try {
    settings = await api.settings.get();
    $('#theme-select').value = settings.theme;
  } catch (e) { console.error(e); }

  await refreshProfiles();

  const last = settings && settings.reopenLastProfile && settings.lastActiveProfileId
    && state.profiles.find((p) => p.id === settings.lastActiveProfileId);
  if (last) await selectProfile(last.id);
  else showEmptyState();

  api.app.onOpenOptions(() => openOptionsModal());
  api.app.onOpenPrivacy(() => openPrivacyModal());
}

$('#theme-select').addEventListener('change', (e) => {
  api.settings.update({ theme: e.target.value }).catch((err) => showError(err, 'Could not save the theme.'));
});
$('#btn-options').addEventListener('click', () => openOptionsModal());

async function openOptionsModal() {
  let settings;
  try { settings = await api.settings.get(); }
  catch (e) { return showError(e, 'Could not load options.'); }

  const startWithWindows = h('input', { type: 'checkbox', id: 'opt-start-with-windows', checked: settings.startWithWindows });
  const startMinimized = h('input', { type: 'checkbox', id: 'opt-start-minimized', checked: settings.startMinimized });
  const reopenLastProfile = h('input', { type: 'checkbox', id: 'opt-reopen-last-profile', checked: settings.reopenLastProfile });
  const closeBehavior = h('select', { id: 'opt-close-behavior' }, [
    h('option', { value: 'ask' }, 'Ask me each time'),
    h('option', { value: 'minimize' }, 'Minimize to the tray'),
    h('option', { value: 'quit' }, 'Quit the app'),
  ]);
  closeBehavior.value = settings.closeBehavior;

  function bindCheckbox(input, key) {
    input.addEventListener('change', () => {
      api.settings.update({ [key]: input.checked }).catch((e) => showError(e, 'Could not save that option.'));
    });
  }
  bindCheckbox(startWithWindows, 'startWithWindows');
  bindCheckbox(startMinimized, 'startMinimized');
  bindCheckbox(reopenLastProfile, 'reopenLastProfile');
  closeBehavior.addEventListener('change', () => {
    api.settings.update({ closeBehavior: closeBehavior.value }).catch((e) => showError(e, 'Could not save that option.'));
  });

  const m = openModal({
    title: 'Options',
    body: h('div', {}, [
      h('div', { class: 'checkbox-field' }, [startWithWindows, h('label', { for: 'opt-start-with-windows' }, 'Start TabbySync Control Panel when Windows starts')]),
      h('div', { class: 'checkbox-field' }, [startMinimized, h('label', { for: 'opt-start-minimized' }, 'Start minimized to the tray')]),
      h('div', { class: 'checkbox-field' }, [reopenLastProfile, h('label', { for: 'opt-reopen-last-profile' }, 'Reopen the last profile you had open on startup')]),
      h('div', { class: 'field' }, [h('label', { for: 'opt-close-behavior' }, 'When closing the window (✕)'), closeBehavior]),
      h('p', {}, "This app doesn't sync in the background — minimizing to the tray just keeps the window a click away, nothing more."),
    ]),
    footer: [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => m.close() }, 'Close')],
  });
}

/** An inline text link that opens externally — this app never uses a raw <a href> (see the ↗ open-in-browser buttons), so this is a button styled to read like one. */
function extLink(text, url) {
  return h('button', { class: 'link-btn', type: 'button', onclick: () => api.app.openExternal(url) }, text);
}

function openPrivacyModal() {
  const body = h('div', { class: 'privacy-body' }, [
    h('p', { class: 'updated' }, 'Last updated: September 6, 2026'),

    h('div', { class: 'callout' }, [
      'This covers the ', h('strong', {}, 'Control Panel desktop app'), ' specifically. If you also use the ',
      'TabbySync browser extension, it has its own, similar-but-not-identical policy — for one, this app can hold ',
      'several sync profiles side by side, where the extension has just one active provider at a time. See ',
      extLink('tabbysync.com/privacy.html', 'https://tabbysync.com/privacy.html'), ' for the extension.',
    ]),

    h('p', {}, [
      'TabbySync Control Panel is a Windows desktop app for managing one or more TabbySync sync profiles — ',
      'bookmarks and saved tab lists — side by side, each pointed at a destination ', h('strong', {}, 'you choose and control'),
      ': your own self-hosted server, a private GitHub Gist, or a JSONBin.io bin.',
    ]),
    h('div', { class: 'callout' }, [
      h('strong', {}, 'The short version: '),
      'this app has no server of its own and no analytics. Everything it stores lives on your own PC. Each ',
      'profile\'s data is sent — directly from your machine — only to that profile\'s own configured destination. ',
      'The developer never receives, stores, or has access to it.',
    ]),

    h('h4', {}, 'What the Control Panel stores on your PC'),
    h('ul', {}, [
      h('li', {}, [h('code', {}, 'profiles.json'), ' — normally under ', h('code', {}, '%APPDATA%\\TabbySync Control Panel\\'), '. Holds every profile you\'ve added: its name, provider type, server address / Gist id / JSONBin bin ids, and its access token and optional sync passphrase.']),
      h('li', {}, [h('code', {}, 'settings.json'), ' in the same folder — app preferences: theme, whether the app starts with Windows, starts minimized, what the close (✕) button does, and (if turned on) which profile to reopen automatically.']),
    ]),
    h('p', {}, 'Neither file is sent anywhere by the Control Panel itself — they just sit on your disk like any other application\'s settings.'),

    h('h4', {}, 'How saved tokens and passphrases are protected'),
    h('p', {}, [
      'Before writing a profile\'s access token or sync passphrase to ', h('code', {}, 'profiles.json'), ', the Control Panel ',
      'encrypts it using Windows\' own Data Protection API (via Electron\'s ', h('code', {}, 'safeStorage'), ') — tied to your ',
      'Windows user account and this PC. Nobody else logging into Windows, and no copy of the file taken off this machine, ',
      'can decrypt it. If that protection isn\'t available for some reason, the app says so rather than claiming a ',
      'protection it doesn\'t have — in that case, tokens are stored as plain text.',
    ]),

    h('h4', {}, 'Encryption of your synced data (optional)'),
    h('p', {}, [
      'The optional passphrase you can set on a profile works exactly like the browser extension\'s own: your bookmark/tab ',
      'data is encrypted on your device with AES-256-GCM before it is ever sent to that profile\'s destination, so a ',
      'self-hosted server, GitHub, or JSONBin.io only ever sees ciphertext. The passphrase itself is never transmitted, ',
      'and is stored only on this PC (protected as above). If you forget it, that profile\'s encrypted data cannot be recovered.',
    ]),

    h('h4', {}, 'Where each profile\'s data goes'),
    h('ul', {}, [
      h('li', {}, [h('em', {}, 'Self-hosted'), ' — a server you set up and control. The Control Panel requires an ', h('code', {}, 'https://'), ' address (the only exception is ', h('code', {}, 'localhost'), '/', h('code', {}, '127.0.0.1'), ', which never leaves this PC) — the access token rides in a header on every request, so a plain ', h('code', {}, 'http://'), ' address would expose it to anyone on the network path.']),
      h('li', {}, [h('em', {}, 'GitHub Gist'), ' — stored in a private gist in your own GitHub account. Governed by ', extLink("GitHub's own Privacy Statement", 'https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement'), '.']),
      h('li', {}, [h('em', {}, 'JSONBin.io'), ' — stored in a bin under your own JSONBin.io account. Governed by ', extLink("JSONBin.io's own Privacy Policy", 'https://jsonbin.io/privacy-policy'), '.']),
    ]),
    h('p', {}, 'Moving or copying a bookmark or a saved tab list between two profiles works the same way: the Control Panel reads it from the source profile\'s destination and writes it to the target profile\'s destination, using the credentials saved for each. It is never relayed anywhere else in between.'),

    h('h4', {}, 'Opening bookmarks and tabs'),
    h('p', {}, 'Double-clicking a bookmark or a tab, or using the ↗ button, hands that one address to Windows\' own default-browser setting — the same as clicking a link anywhere else on your PC. The Control Panel has no browser of its own and does not load or inspect the pages you open. Opening a whole list at once asks first and opens tabs in small batches, the same ceiling protection the browser extension uses, so it can\'t be used to accidentally open hundreds of tabs at once.'),

    h('h4', {}, 'Starting with Windows / staying in the tray'),
    h('p', {}, 'If turned on in Options, "Start with Windows" and "Start minimized" register the Control Panel as a normal Windows startup item — the same mechanism any desktop app uses — and minimizing to the tray just keeps the window a click away. Neither one starts any background syncing; nothing syncs unless the window is open and you ask it to.'),

    h('h4', {}, "What TabbySync's developer does — and does not — do"),
    h('ul', {}, [
      h('li', {}, 'No server that receives, stores, or processes your bookmarks or tabs.'),
      h('li', {}, 'No analytics, telemetry, or usage tracking of any kind — not even whether the app was opened.'),
      h('li', {}, 'No selling, renting, or sharing your data, and no use of it for advertising.'),
      h('li', {}, 'No visibility into your self-hosted server, your GitHub Gist, or your JSONBin.io bin.'),
    ]),

    h('h4', {}, 'Deleting your data'),
    h('ul', {}, [
      h('li', {}, 'Removing a profile from the sidebar only removes it from profiles.json on this PC — it does not touch that profile\'s remote data, and does not affect any other profile.'),
      h('li', {}, '"Delete synced data" (per profile) sends an explicit delete request to that profile\'s destination, gated behind typing DELETE and a second confirmation — the same discipline as the browser extension. TabbySync can only ask the destination to delete; what happens after is up to that provider.'),
      h('li', {}, 'Uninstalling the Control Panel removes the application itself but, like most Windows apps, leaves the profiles/settings folder in place — delete it by hand, or use "Delete synced data" from within the app first, if you want the saved profiles gone too.'),
    ]),

    h('h4', {}, "Children's privacy"),
    h('p', {}, 'The Control Panel is not directed at children and does not knowingly collect data from children.'),

    h('h4', {}, 'Changes to this policy'),
    h('p', {}, 'If this policy changes, the "Last updated" date at the top will be revised, and material changes will be noted in the app\'s release notes.'),

    h('h4', {}, 'Who is responsible for this'),
    h('p', {}, 'TabbySync Control Panel is developed and published by Ryan Gulliver, an individual developer, who is responsible for this policy. There is no company, no team, and no third party with access to anything it stores.'),

    h('h4', {}, 'Contact'),
    h('p', {}, ['Questions about this policy or your data go to ', extLink('contact@tabbysync.com', 'mailto:contact@tabbysync.com'), '.']),
  ]);

  const m = openModal({
    title: 'Privacy Policy',
    wide: true,
    body,
    footer: [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => m.close() }, 'Close')],
  });
}

init();
