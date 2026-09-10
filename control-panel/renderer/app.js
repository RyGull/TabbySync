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

/** onClose (optional): called exactly once, however the modal ends up closing — the ✕, the backdrop, Escape, or m.close() itself — not just one of those paths. So it means "this modal is gone", NOT "the user cancelled": a caller that closes the modal itself on a success path gets this call too, and must not treat it as a dismissal (see askBackupPassphrase, where doing exactly that silently swallowed every encrypted import). Used by the About modal to unsubscribe its onUpdateStatus listener, and by askBackupPassphrase as its one cancelled path. */
function openModal({ title, body, footer, wide, onClose }) {
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
    if (onClose) onClose();
  }
  modalStack.push(entry);
  return entry;
}
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && modalStack.length) modalStack[modalStack.length - 1].close();
});

/** Everything open, shut. Used when the app locks: a modal is a window onto the data the lock screen is there to cover. */
function closeAllModals() {
  for (const m of modalStack.slice()) m.close();
}

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
// Belt-and-suspenders cleanup: if a drag ends without a clean drop on a
// wired target (dropped outside any row, cancelled with Escape, dragged
// out the window and released there), that target's last drag-over-top/
// bottom highlight has no other event guaranteed to clear it — dragleave
// doesn't fire for every way a drag can end. A stuck highlight would be
// its own "hard to tell what's happening" bug, so this sweeps the whole
// document on every dragend, not just the element the drag started on.
document.addEventListener('dragend', () => {
  document.querySelectorAll('.drag-over-top, .drag-over-bottom, .dragging-source').forEach((el) => {
    el.classList.remove('drag-over-top', 'drag-over-bottom', 'dragging-source');
  });
});

function wireListReorderDrag(el, id, getOrder, onReorder) {
  el.addEventListener('dragstart', (e) => {
    dragListItem = id;
    e.dataTransfer.effectAllowed = 'move';
    // Applied next frame, not immediately: some browsers snapshot the drag
    // ghost image synchronously from the element's current appearance, so
    // dimming it in this same tick can dim the ghost too, defeating the
    // point (nothing left to contrast the "where would it land" line
    // against). One frame later, the ghost's already been captured.
    requestAnimationFrame(() => el.classList.add('dragging-source'));
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
  el.addEventListener('dragend', () => { dragListItem = null; el.classList.remove('drag-over-top', 'drag-over-bottom', 'dragging-source'); });
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
  // Which lists this profile had open last time, before anything renders.
  hydrateExpandedGroups(id);
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
$('#btn-about').addEventListener('click', () => openAboutModal());
// Its own dedicated popup, not About — opens straight into the live
// check/progress UI and fires a check immediately.
$('#btn-check-updates').addEventListener('click', () => openUpdateModal(true));

/**
 * The live "check for updates" UI — status text, progress bar, Check/
 * Restart/Copy-link buttons — built once here and used by the Update
 * popup (openUpdateModal) alone, so there's exactly one place this exists
 * rather than one to remember to keep in sync with another. Sized and
 * coloured to stand out (not the small, muted text/buttons this started
 * as) since checking is the entire reason someone opens this popup.
 *
 * @param {{version: string, latestReleaseUrl: string}} info
 * @returns {{root: HTMLElement, cleanup: () => void, runCheck: () => Promise<void>}}
 *   cleanup MUST be called when the surrounding modal closes (wire it to
 *   openModal's onClose) or the onUpdateStatus subscription leaks.
 */
function buildUpdateStatusUI(info) {
  const updateLine = h('p', { class: 'update-status' }, '');
  const progressBar = h('div', { class: 'update-progress', hidden: true }, [h('div', { class: 'update-progress-fill' })]);
  const checkBtn = h('button', { class: 'btn', type: 'button' }, 'Check for updates');
  const restartBtn = h('button', { class: 'btn btn-primary', type: 'button', hidden: true }, 'Restart and install');
  const copyLinkBtn = h('button', { class: 'btn', type: 'button' }, 'Copy download link');

  function renderStatus(status) {
    updateLine.textContent = describeUpdateStatus(status, info.version);
    updateLine.className = `update-status ${updateStatusClass(status)}`;
    const showBar = !!(status && status.state === 'downloading' && typeof status.percent === 'number');
    progressBar.hidden = !showBar;
    if (showBar) progressBar.querySelector('.update-progress-fill').style.width = `${Math.min(100, Math.round(status.percent))}%`;
    restartBtn.hidden = !(status && status.state === 'downloaded');
  }

  async function runCheck() {
    checkBtn.disabled = true;
    progressBar.hidden = true;
    updateLine.className = 'update-status';
    updateLine.textContent = 'Checking…';
    try {
      renderStatus(await api.app.checkForUpdates());
    } catch (e) {
      updateLine.className = 'update-status warning';
      updateLine.textContent = 'Could not check for updates.';
      console.error(e);
    } finally {
      checkBtn.disabled = false;
    }
  }
  checkBtn.addEventListener('click', runCheck);
  restartBtn.addEventListener('click', () => api.app.installUpdate().catch((e) => showError(e, 'Could not start the install.')));
  copyLinkBtn.addEventListener('click', async () => {
    try {
      await api.app.copyToClipboard(info.latestReleaseUrl);
      const original = copyLinkBtn.textContent;
      copyLinkBtn.textContent = 'Copied!';
      copyLinkBtn.disabled = true;
      setTimeout(() => { copyLinkBtn.textContent = original; copyLinkBtn.disabled = false; }, 1500);
    } catch (e) { showError(e, 'Could not copy the link.'); }
  });

  // Live updates for as long as whichever modal holds this stays open — a
  // download's progress ticking up, or it finishing after the initial
  // check already returned. That gap is the whole reason this exists:
  // checkForUpdates() only ever resolves once electron-updater knows an
  // update EXISTS, well before a download started from it actually
  // finishes — nothing used to be listening for how it turned out.
  const cleanup = api.app.onUpdateStatus(renderStatus);

  // Show whatever's already true right now, before the caller decides
  // whether to also kick off a fresh check — reopening mid-download should
  // show the download in progress immediately, not a blank slate.
  api.app.getUpdateStatus().then(renderStatus).catch((e) => console.error(e));

  const root = h('div', { class: 'update-section' }, [
    updateLine,
    progressBar,
    h('div', { class: 'update-actions' }, [checkBtn, restartBtn, copyLinkBtn]),
  ]);
  return { root, cleanup, runCheck };
}

/** Turns main.cjs's update-status shape (app:checkForUpdates / app:getUpdateStatus / the updater:status push) into one line of human text. */
function describeUpdateStatus(status, currentVersion) {
  switch (status && status.state) {
    case 'checking': return 'Checking…';
    case 'not-available': return status.reason || `You're up to date (${currentVersion}).`;
    case 'downloading':
      return typeof status.percent === 'number'
        ? `Downloading version ${status.version}… ${Math.round(status.percent)}%`
        : `Found version ${status.version} — starting the download…`;
    case 'downloaded': return `Version ${status.version} is downloaded and ready.`;
    case 'error': return `Couldn't check for updates: ${status.message || 'unknown error'}`;
    default: return 'Updates download automatically in the background and ask before installing.';
  }
}

/** Colour-codes buildUpdateStatusUI's status line so something worth noticing (a download, an error) doesn't read as identical grey text to "nothing new". */
function updateStatusClass(status) {
  switch (status && status.state) {
    case 'downloading': return 'active';
    case 'downloaded': return 'success';
    case 'error': return 'warning';
    default: return '';
  }
}

/** Purely informational — version, where things are stored, what's protected. Update checking lives in its own popup (openUpdateModal) now, opened from the sidebar's "Updates" button or Options, not from here. */
async function openAboutModal() {
  const info = await api.app.info();

  const m = openModal({
    title: 'About TabbySync Control Panel',
    body: h('div', {}, [
      h('p', {}, `Version ${info.version}`),
      h('p', {}, `Profiles are stored at: ${info.profilesFile}`),
      h('p', {}, info.secretsAvailable
        ? 'Tokens and passphrases are encrypted at rest using your operating system’s secure storage.'
        : '⚠️ Your OS secure storage is not available — tokens and passphrases are stored in plain text in the file above.'),
      h('p', {}, 'A companion desktop app for TabbySync: manages the same self-hosted / GitHub Gist / JSONBin sync destinations your browser extension uses, so you can add, remove, move and copy bookmarks and saved tabs across every profile from one place.'),
    ]),
    footer: [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => m.close() }, 'Close')],
  });
}

/** The dedicated "Check for Updates" popup — opened from the sidebar's "Updates" button and from Options' Updates section, both the same way. @param {boolean} [autoCheck] runs a check as soon as the modal opens instead of waiting for its own button; both current callers pass true. */
async function openUpdateModal(autoCheck) {
  const info = await api.app.info();
  const updateUI = buildUpdateStatusUI(info);

  const m = openModal({
    title: 'Check for Updates',
    body: h('div', {}, [
      h('p', {}, `You're running version ${info.version}.`),
      updateUI.root,
    ]),
    footer: [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => m.close() }, 'Close')],
    onClose: updateUI.cleanup,
  });

  if (autoCheck) updateUI.runCheck();
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
  syncFoldAllButton();
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
  persistExpandedGroups();
  renderTabLists();
}

// ---- remembering which lists are open --------------------------------------
// Folded/open is a per-machine view preference, so it rides in the app's own
// settings.json rather than in the tab state that syncs to the server —
// otherwise every twisty click would be a remote write, and one machine's
// tidying would refold everyone else's lists. Keyed by profile because a list
// id only means anything inside its own profile.

/** Last settings snapshot for this key, so a write for one profile never drops another profile's entry. */
let expandedTabGroupsByProfile = {};

function hydrateExpandedGroups(profileId) {
  const ids = expandedTabGroupsByProfile[profileId];
  state.expandedGroups = new Set(Array.isArray(ids) ? ids : []);
}

function persistExpandedGroups() {
  const p = activeProfile(); if (!p) return;
  // Prune ids for lists that no longer exist — without this the key would
  // remember the fold state of every list ever deleted.
  const live = new Set((state.tb.state && state.tb.state.groups ? state.tb.state.groups : []).map((g) => g.id));
  const ids = [...state.expandedGroups].filter((id) => live.has(id));
  const next = { ...expandedTabGroupsByProfile };
  if (ids.length) next[p.id] = ids; else delete next[p.id];
  expandedTabGroupsByProfile = next;
  api.settings.update({ expandedTabGroups: next }).catch((e) => console.error(e));
}

/** True when every list is already open — what the toolbar button reads off to decide what it says. */
function allGroupsExpanded() {
  const groups = (state.tb.state && state.tb.state.groups) || [];
  return groups.length > 0 && groups.every((g) => state.expandedGroups.has(g.id));
}

function syncFoldAllButton() {
  const btn = $('#tb-fold-all');
  if (!btn) return;
  const groups = (state.tb.state && state.tb.state.groups) || [];
  btn.disabled = !groups.length;
  const expand = !allGroupsExpanded();
  btn.textContent = expand ? 'Expand all' : 'Collapse all';
  btn.title = expand ? 'Open every list' : 'Fold every list up so you can see them all at once';
}

function setAllGroupsExpanded(on) {
  const groups = (state.tb.state && state.tb.state.groups) || [];
  state.expandedGroups = new Set(on ? groups.map((g) => g.id) : []);
  persistExpandedGroups();
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
        persistExpandedGroups();
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
$('#tb-fold-all').addEventListener('click', () => setAllGroupsExpanded(!allGroupsExpanded()));

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

// ---------------------------------------------------------------------------
// The PIN gate, renderer half
//
// Everything below draws and drives the lock screen. It does NOT enforce the
// lock — main.cjs does that, by refusing every IPC channel while locked (see
// its handle()). That split is deliberate: this code lives in a window with a
// DevTools console, so anything it alone decided would be one console line
// away from being decided differently. Here we ask main what the state is,
// draw it, and pass PINs through.
// ---------------------------------------------------------------------------

const lockUi = {
  screen: null,
  msg: null,
  started: false,        // has the app proper been booted once this document?
  helloOffered: false,   // is the Windows Hello button currently on screen?
  helloAutoTried: false, // has Hello fired by itself for THIS lock, already?
  helloBusy: false,      // a Hello prompt is on screen right now
};

function showLockMessage(text, ok) {
  lockUi.msg.textContent = text || '';
  lockUi.msg.classList.toggle('ok', !!ok);
}

/**
 * Shows or hides the Windows Hello button.
 *
 * `offer` is main's answer, not ours: it is already the AND of "the user
 * turned it on", "a PIN exists behind it" and "this machine can do it right
 * now" (see main.cjs's pin:status). The renderer must not second-guess it —
 * drawing this button on a hunch would be a button that does nothing.
 */
function setHelloOffer(offer) {
  lockUi.helloOffered = !!offer;
  $('#lock-hello').hidden = !offer;
  $('#lock-hello-or').hidden = !offer;
}

function showLockScreen(mode) {
  $('#app').hidden = true;
  lockUi.screen.hidden = false;
  // A new lock is a new chance to offer Hello without being asked.
  lockUi.helloAutoTried = false;
  $('#lock-unlock').hidden = mode !== 'unlock';
  $('#lock-setup').hidden = mode !== 'setup';
  // Never on the first-run setup screen: there is no PIN yet, so there is
  // nothing for Hello to be an alternative to.
  if (mode !== 'unlock') setHelloOffer(false);
  showLockMessage('');
  const field = mode === 'setup' ? $('#setup-pin') : $('#lock-pin');
  field.value = '';
  if (mode === 'unlock') $('#lock-pin').value = '';
  else { $('#setup-pin').value = ''; $('#setup-pin2').value = ''; }
  // A window that isn't focused yet (launched minimized, restored from the
  // tray) still gets the caret in the right place the moment it is.
  setTimeout(() => field.focus(), 0);
}

async function hideLockScreenAndStart() {
  lockUi.screen.hidden = true;
  $('#app').hidden = false;
  if (lockUi.started) return;
  lockUi.started = true;
  await startApp();
}

/** Renders a throttle as a countdown the person can actually plan around. */
function throttleMessage(ms) {
  const secs = Math.ceil(ms / 1000);
  if (secs >= 60) {
    const mins = Math.ceil(secs / 60);
    return `Too many wrong PINs. Try again in about ${mins} minute${mins === 1 ? '' : 's'}.`;
  }
  return `Too many wrong PINs. Try again in ${secs} second${secs === 1 ? '' : 's'}.`;
}

async function submitUnlock(e) {
  e.preventDefault();
  const btn = $('#lock-submit');
  const pin = $('#lock-pin').value;
  btn.disabled = true;
  try {
    const r = await api.pin.unlock(pin);
    if (r.ok) { showLockMessage(''); await hideLockScreenAndStart(); return; }
    $('#lock-pin').value = '';
    $('#lock-pin').focus();
    showLockMessage(r.throttledForMs > 0 ? throttleMessage(r.throttledForMs) : 'That PIN is not right.');
  } catch (err) {
    // PIN_THROTTLED arrives as a thrown error because it is not an answer to
    // "is this the PIN" at all — nothing was even checked.
    showLockMessage(err.code === 'PIN_THROTTLED' && err.waitMs ? throttleMessage(err.waitMs) : err.message);
  } finally { btn.disabled = false; }
}

/**
 * Unlock with Windows Hello.
 *
 * Failure is never fatal and never blocking: whatever Windows says, the PIN
 * field is still sitting right there, and the only job here is to say why
 * Hello did not work so the fallback does not look like a bug. A state that
 * cannot succeed again (no sensor, policy) also withdraws the button, so it
 * stops offering something this PC will not do.
 */
async function unlockWithHello() {
  if (lockUi.helloBusy) return;
  lockUi.helloBusy = true;
  const btn = $('#lock-hello');
  btn.disabled = true;
  showLockMessage('Waiting for Windows Hello…', true);
  try {
    const r = await api.hello.unlock();
    if (r.ok) { showLockMessage(''); await hideLockScreenAndStart(); return; }
    if (!r.retryable) setHelloOffer(false);
    // Cancelling is a decision, not an error — say nothing and let them type.
    showLockMessage(r.message || (r.state === 'Canceled' ? '' : 'Windows Hello did not unlock. Enter your PIN.'));
  } catch (err) {
    setHelloOffer(false);
    showLockMessage('Windows Hello is not working. Enter your PIN.');
    console.error(err);
  } finally {
    lockUi.helloBusy = false;
    btn.disabled = false;
    // The PIN box gets the caret whatever happened, so a failed or dismissed
    // prompt leaves you able to just type.
    $('#lock-pin').focus();
  }
}

/**
 * Fires Hello without being asked — but only when the person is plausibly
 * trying to get IN, which is not the same moment as the app locking.
 *
 * The rules, and each exists because the obvious version is wrong:
 *
 *   * only while the lock screen is up and Hello is actually on offer;
 *   * only once per lock. A prompt that reappears the instant you dismiss it
 *     is not a convenience, it is a trap with no way to reach the PIN box;
 *   * only when this window has focus. The app can start minimized to the
 *     tray or relock while you are in another program, and a Hello dialog
 *     appearing out of nowhere over somebody else's work is worse than no
 *     Hello at all;
 *   * never twice at once.
 *
 * Note what is NOT here: any call from the relock path. Clicking "Lock now"
 * and being asked to unlock half a second later would be absurd, and it needs
 * no special case to avoid — locking deliberately involves no change of
 * focus, so nothing below fires. Walk away, come back, and the focus handler
 * picks it up. Launching straight into a locked app is the one case that
 * fires immediately, which is the case that matters most.
 */
function maybeAutoUnlockWithHello() {
  if (lockUi.screen.hidden || !lockUi.helloOffered) return;
  if (lockUi.helloAutoTried || lockUi.helloBusy) return;
  if (!document.hasFocus()) return;
  lockUi.helloAutoTried = true;
  unlockWithHello();
}

async function submitSetup(e) {
  e.preventDefault();
  const pin = $('#setup-pin').value;
  const again = $('#setup-pin2').value;
  if (pin !== again) {
    showLockMessage('Those two PINs are not the same.');
    $('#setup-pin2').value = '';
    $('#setup-pin2').focus();
    return;
  }
  const btn = $('#setup-submit');
  btn.disabled = true;
  try {
    await api.pin.setup(pin);
    await hideLockScreenAndStart();
  } catch (err) {
    showLockMessage(err.message);
    $('#setup-pin').value = ''; $('#setup-pin2').value = '';
    $('#setup-pin').focus();
  } finally { btn.disabled = false; }
}

async function skipSetup() {
  try { await api.pin.skipSetup(); } catch (e) { console.error(e); }
  await hideLockScreenAndStart();
}

// Bumped while someone is using the app so the idle timer doesn't fire under
// them. Throttled hard — the main process only needs to know "still here",
// and a per-mousemove IPC call would be thousands of round trips a minute.
const ACTIVITY_PING_MS = 20 * 1000;
let lastActivityPing = 0;
function noteActivity() {
  const now = Date.now();
  if (now - lastActivityPing < ACTIVITY_PING_MS) return;
  lastActivityPing = now;
  api.pin.activity().catch(() => {});
}

function wireLockScreen() {
  lockUi.screen = $('#lock-screen');
  lockUi.msg = $('#lock-msg');
  $('#lock-unlock').addEventListener('submit', submitUnlock);
  $('#lock-setup').addEventListener('submit', submitSetup);
  $('#setup-skip').addEventListener('click', skipSetup);
  $('#lock-hello').addEventListener('click', unlockWithHello);

  // Coming back to a locked window is the other moment someone is trying to
  // get in — returning from another program, or opening it from the tray.
  // Launch is handled in init(); this covers every arrival after that.
  window.addEventListener('focus', () => { maybeAutoUnlockWithHello(); });

  for (const evt of ['pointerdown', 'keydown', 'wheel']) {
    window.addEventListener(evt, () => { if (!lockUi.screen.hidden) return; noteActivity(); }, { passive: true });
  }

  // Idle timeout, "Lock now" from the tray or File menu — main decides, we
  // draw it. Nothing is torn down: the app stays loaded behind the screen and
  // simply cannot talk to main until a PIN goes back through.
  api.pin.onChanged((state) => {
    if (state.locked) {
      closeAllModals();
      showLockScreen('unlock');
      showLockMessage('Locked. Enter your PIN to carry on.', true);
      // Re-asked rather than remembered: a sensor can be unplugged, or policy
      // applied, between launch and this relock.
      api.pin.status()
        .then((s) => setHelloOffer(s.hello && s.hello.offer))
        .catch(() => setHelloOffer(false));
    } else {
      hideLockScreenAndStart().catch((e) => console.error(e));
    }
  });
}

/** Decides what the first frame is: the app, a PIN prompt, or the first-run offer. */
async function init() {
  wireLockScreen();
  let status;
  try {
    status = await api.pin.status();
  } catch (e) {
    // If we can't even ask, stay locked and say why. Failing open here would
    // mean a broken IPC channel is a way past the lock.
    console.error(e);
    showLockScreen('unlock');
    showLockMessage('Could not check the lock. Restart the app.');
    return;
  }

  if (status.unrecoverable) {
    showLockScreen('unlock');
    $('#lock-unlock').hidden = true;
    showLockMessage('The PIN file is damaged, so the app stays locked.');
    const recovery = $('#lock-recovery');
    recovery.hidden = false;
    recovery.textContent =
      `Delete this file to clear the PIN and start over — your profiles and settings are separate files and are not affected: ${status.securityFile}`;
    return;
  }

  if (status.isSet && status.locked) {
    showLockScreen('unlock');
    setHelloOffer(status.hello && status.hello.offer);
    // Opening the app is unambiguous: you want in. Ask Windows straight away
    // rather than making the first thing you do a click.
    maybeAutoUnlockWithHello();
    return;
  }
  if (!status.isSet && !status.setupSeen) { showLockScreen('setup'); return; }
  await hideLockScreenAndStart();
}

async function startApp() {
  try {
    const info = await api.app.info();
    $('#secrets-warning').hidden = info.secretsAvailable;
    $('#app-version').textContent = `v${info.version}`;
  } catch (e) { console.error(e); }

  let settings = null;
  try {
    settings = await api.settings.get();
    $('#theme-select').value = settings.theme;
    expandedTabGroupsByProfile = settings.expandedTabGroups || {};
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

  const updateFrequency = h('select', { id: 'opt-update-frequency' }, [
    h('option', { value: 'startup' }, 'Every time the app starts'),
    h('option', { value: 'daily' }, 'Once a day'),
    h('option', { value: 'weekly' }, 'Once a week'),
    h('option', { value: 'monthly' }, 'Once a month'),
    h('option', { value: 'never' }, 'Never (I\'ll check manually)'),
  ]);
  updateFrequency.value = settings.updateCheckFrequency;
  const lastCheckedHint = h('div', { class: 'hint' },
    settings.lastUpdateCheckAt ? `Last checked ${fmtWhen(settings.lastUpdateCheckAt)}.` : 'Never checked yet.');
  const openUpdatePopupBtn = h('button', { class: 'btn', type: 'button' }, 'Check for updates…');
  openUpdatePopupBtn.addEventListener('click', () => openUpdateModal(true));

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
  updateFrequency.addEventListener('change', () => {
    api.settings.update({ updateCheckFrequency: updateFrequency.value }).catch((e) => showError(e, 'Could not save that option.'));
  });

  const m = openModal({
    title: 'Options',
    body: h('div', {}, [
      h('div', { class: 'checkbox-field' }, [startWithWindows, h('label', { for: 'opt-start-with-windows' }, 'Start TabbySync Control Panel when Windows starts')]),
      h('div', { class: 'checkbox-field' }, [startMinimized, h('label', { for: 'opt-start-minimized' }, 'Start minimized to the tray')]),
      h('div', { class: 'checkbox-field' }, [reopenLastProfile, h('label', { for: 'opt-reopen-last-profile' }, 'Reopen the last profile you had open on startup')]),
      h('div', { class: 'field' }, [h('label', { for: 'opt-close-behavior' }, 'When closing the window (✕)'), closeBehavior]),
      h('p', {}, "This app doesn't sync in the background — minimizing to the tray just keeps the window a click away, nothing more."),
      h('div', { class: 'options-section' }, [
        h('h3', { class: 'options-section-title' }, 'Updates'),
        h('div', { class: 'field' }, [
          h('label', { for: 'opt-update-frequency' }, 'Check automatically'),
          updateFrequency,
          lastCheckedHint,
        ]),
        h('p', { class: 'hint' }, 'A found update always downloads in the background and asks before installing, regardless of how often it looks for one — this only controls how often it looks.'),
        openUpdatePopupBtn,
      ]),
      securitySection(settings),
      backupSection(),
    ]),
    footer: [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => m.close() }, 'Close')],
  });
}

// ---------------------------------------------------------------------------
// Options → Security (the PIN)
// ---------------------------------------------------------------------------

/**
 * Windows Hello, inside the Security section and only ever under a PIN that
 * is already set — which is why it is appended in the status.isSet branch
 * below and nowhere else.
 *
 * The copy here is deliberate about what Hello is and is not. It is a faster
 * way through the same lock, over data that Windows already protects at rest
 * with your account. It is not encryption and it is not a stronger boundary,
 * and telling someone otherwise would be selling them a lock that does less
 * than they think.
 */
function helloRow(status, redraw) {
  const hello = status.hello || {};

  if (!hello.available && !hello.enabled) {
    // Nothing to offer and nothing turned on: say why, once, and stop.
    return h('p', { class: 'hint' },
      hello.message || 'Windows Hello is not available on this PC.');
  }

  if (hello.enabled) {
    return h('div', {}, [
      h('p', { class: 'hint' }, hello.available
        ? 'Windows Hello is on. The lock screen offers it first, and your PIN still works if it ever does not.'
        : `Windows Hello is on but not working right now — ${hello.message || 'this PC cannot use it.'} The lock screen falls back to your PIN.`),
      h('button', {
        class: 'btn btn-block', type: 'button',
        onclick: () => {
          api.hello.disable()
            .then(redraw)
            .catch((e) => showError(e, 'Could not turn Windows Hello off.'));
        },
      }, 'Stop using Windows Hello'),
    ]);
  }

  return h('div', {}, [
    h('p', { class: 'hint' }, 'Unlock with your fingerprint, face or Windows Hello PIN instead of typing this app’s PIN. Your PIN stays set either way — it is what you fall back to if Hello ever stops working, so this is about typing less, not about stronger protection.'),
    h('button', {
      class: 'btn btn-block', type: 'button',
      onclick: () => openEnableHelloModal(redraw),
    }, 'Use Windows Hello…'),
  ]);
}

/**
 * Turning Hello on asks for the current PIN and then runs a live Hello check.
 * Both on purpose: the PIN proves the app is yours, and the live check proves
 * this machine will actually do it — enabling it on a PC where it silently
 * fails would mean finding out at the next lock screen.
 */
function openEnableHelloModal(redraw) {
  const pin = h('input', { type: 'password', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', maxlength: '12' });
  const msg = h('p', { class: 'lock-msg' });
  const go = h('button', { class: 'btn btn-primary', type: 'button' }, 'Turn it on');
  const m = openModal({
    title: 'Use Windows Hello',
    body: h('div', {}, [
      h('p', { class: 'hint' }, 'Enter this app’s PIN, then confirm with Windows Hello. Your PIN is not replaced — it stays as the way in if Hello is ever unavailable.'),
      h('div', { class: 'field' }, [h('label', {}, 'Current PIN'), pin]),
      msg,
    ]),
    footer: [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'), go],
  });
  async function attempt() {
    go.disabled = true; msg.textContent = 'Waiting for Windows Hello…';
    try {
      const r = await api.hello.enable({ currentPin: pin.value });
      if (!r.ok) { msg.textContent = r.message || 'Windows Hello did not confirm it was you.'; return; }
      m.close();
      showToast('Windows Hello is on. Your PIN still works.', 'success');
      redraw();
    } catch (e) {
      msg.textContent = e.message;
      pin.value = ''; pin.focus();
    } finally { go.disabled = false; }
  }
  go.addEventListener('click', attempt);
  pin.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); attempt(); } });
  setTimeout(() => pin.focus(), 0);
}

function securitySection(settings) {
  const body = h('div', { class: 'options-section' }, [
    h('h3', { class: 'options-section-title' }, 'Security'),
    h('div', { class: 'hint', id: 'opt-pin-state' }, 'Checking…'),
  ]);
  renderSecuritySection(body, settings).catch((e) => showError(e, 'Could not read the lock settings.'));
  return body;
}

async function renderSecuritySection(container, settings) {
  const status = await api.pin.status();
  clearNode(container);
  container.appendChild(h('h3', { class: 'options-section-title' }, 'Security'));

  const idle = h('input', {
    type: 'number', id: 'opt-pin-idle', min: '1', max: '480', step: '1',
    value: String(status.idleMinutes || settings.pinIdleMinutes),
  });
  idle.addEventListener('change', () => {
    api.settings.update({ pinIdleMinutes: Number(idle.value) })
      .then((next) => { idle.value = String(next.pinIdleMinutes); })
      .catch((e) => showError(e, 'Could not save that option.'));
  });

  const redraw = () => renderSecuritySection(container, settings).catch((e) => console.error(e));

  if (status.isSet) {
    container.appendChild(h('p', { class: 'hint' }, 'A PIN is set. The app asks for it every time it starts, and after it has been sitting idle.'));
    container.appendChild(h('div', { class: 'field' }, [
      h('label', { for: 'opt-pin-idle' }, 'Lock again after this many minutes idle'),
      idle,
      h('div', { class: 'hint' }, 'Restarting or reloading the app always locks it again, whatever this says.'),
    ]));
    container.appendChild(h('div', { class: 'two-col-row' }, [
      h('button', { class: 'btn', type: 'button', onclick: () => openChangePinModal(redraw) }, 'Change PIN…'),
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => { api.pin.lock().catch((e) => showError(e)); } }, 'Lock now'),
    ]));
    container.appendChild(helloRow(status, redraw));
    container.appendChild(h('button', { class: 'btn btn-danger btn-block', type: 'button', onclick: () => openRemovePinModal(redraw) }, 'Turn the PIN off…'));
  } else {
    container.appendChild(h('p', { class: 'hint' }, 'No PIN is set — the app opens straight into your profiles.'));
    container.appendChild(h('button', { class: 'btn btn-primary btn-block', type: 'button', onclick: () => openSetPinModal(redraw) }, 'Set a PIN…'));
  }

  // Said in Options too, not only on the first-run screen, because this is
  // where someone decides how much to rely on it.
  container.appendChild(h('p', { class: 'hint' },
    'The PIN locks this window. It does not encrypt anything on disk: your profiles are stored in your Windows account’s app data either way, and anyone signed in as you can read them with the app closed. It is a lock on the door, not a safe.'));
}

/** One shape for all three PIN dialogs — they differ only in which fields they ask for and what they call when submitted. */
function pinDialog({ title, intro, fields, confirmLabel, danger, onSubmit }) {
  const inputs = fields.map(() => h('input', {
    type: 'password', inputmode: 'numeric', autocomplete: 'off', spellcheck: 'false', maxlength: '12',
    class: 'lock-pin',
  }));
  const msg = h('p', { class: 'lock-msg' });
  const body = h('div', {}, [
    intro ? h('p', { class: 'hint' }, intro) : null,
    ...fields.map((f, i) => h('div', { class: 'field' }, [h('label', {}, f), inputs[i]])),
    msg,
  ]);
  const submit = h('button', { class: danger ? 'btn btn-danger' : 'btn btn-primary', type: 'button' }, confirmLabel);
  const m = openModal({
    title,
    body,
    footer: [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'), submit],
  });
  async function go() {
    submit.disabled = true;
    msg.textContent = '';
    try {
      await onSubmit(inputs.map((i) => i.value));
      m.close();
    } catch (e) {
      msg.textContent = e.code === 'PIN_THROTTLED' && e.waitMs ? throttleMessage(e.waitMs) : e.message;
      for (const i of inputs) i.value = '';
      inputs[0].focus();
    } finally { submit.disabled = false; }
  }
  submit.addEventListener('click', go);
  for (const i of inputs) {
    i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  }
  setTimeout(() => inputs[0].focus(), 0);
  return m;
}

function openSetPinModal(done) {
  pinDialog({
    title: 'Set a PIN',
    intro: '4 to 12 digits. You will be asked for it every time the app starts.',
    fields: ['Choose a PIN', 'Type it again'],
    confirmLabel: 'Set PIN',
    onSubmit: async ([pin, again]) => {
      if (pin !== again) throw new Error('Those two PINs are not the same.');
      await api.pin.setup(pin);
      showToast('PIN set.', 'success');
      done();
    },
  });
}

function openChangePinModal(done) {
  pinDialog({
    title: 'Change PIN',
    fields: ['Current PIN', 'New PIN', 'Type the new one again'],
    confirmLabel: 'Change PIN',
    onSubmit: async ([current, next, again]) => {
      if (next !== again) throw new Error('The two new PINs are not the same.');
      await api.pin.change({ currentPin: current, newPin: next });
      showToast('PIN changed.', 'success');
      done();
    },
  });
}

function openRemovePinModal(done) {
  pinDialog({
    title: 'Turn the PIN off',
    intro: 'The app will open straight into your profiles from now on, with nothing asked.',
    fields: ['Current PIN'],
    confirmLabel: 'Turn it off',
    danger: true,
    onSubmit: async ([current]) => {
      await api.pin.disable({ currentPin: current });
      showToast('PIN turned off.', 'success');
      done();
    },
  });
}

// ---------------------------------------------------------------------------
// Options → Backup: everything this app knows, as one file
// ---------------------------------------------------------------------------

function backupSection() {
  return h('div', { class: 'options-section' }, [
    h('h3', { class: 'options-section-title' }, 'Backup'),
    h('p', { class: 'hint' }, 'Every profile and every setting in this app, as one file — for moving to a new PC, or keeping a copy before you change something.'),
    h('div', { class: 'two-col-row' }, [
      h('button', { class: 'btn', type: 'button', onclick: () => openExportModal() }, 'Export…'),
      h('button', { class: 'btn', type: 'button', onclick: () => openImportModal() }, 'Import…'),
    ]),
  ]);
}

function openExportModal() {
  const plainExport = h('input', { type: 'radio', name: 'exp-scope', id: 'exp-plain', checked: true });
  const fullExport = h('input', { type: 'radio', name: 'exp-scope', id: 'exp-full' });
  const pass1 = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', disabled: true });
  const pass2 = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false', disabled: true });
  const msg = h('p', { class: 'lock-msg' });

  const sync = () => {
    const full = fullExport.checked;
    pass1.disabled = !full;
    pass2.disabled = !full;
    if (!full) { pass1.value = ''; pass2.value = ''; }
  };
  plainExport.addEventListener('change', sync);
  fullExport.addEventListener('change', sync);

  const go = h('button', { class: 'btn btn-primary', type: 'button' }, 'Choose where to save…');
  const m = openModal({
    title: 'Export settings and profiles',
    body: h('div', {}, [
      h('div', { class: 'checkbox-field' }, [plainExport, h('label', { for: 'exp-plain' }, 'Settings and profiles, without credentials')]),
      h('p', { class: 'hint' }, 'Server addresses, sync names and every app option, but no tokens and no sync passphrases. Safe to email yourself or keep in cloud storage. You re-enter each credential after restoring.'),
      h('div', { class: 'checkbox-field' }, [fullExport, h('label', { for: 'exp-full' }, 'Everything, including credentials (encrypted)')]),
      h('p', { class: 'hint' }, 'Restores as a working setup with nothing to re-type. Because it carries live credentials it is always sealed with a passphrase — there is no plaintext version of this option, and there is no way to recover the file if you forget the passphrase.'),
      h('div', { class: 'field' }, [h('label', {}, 'Passphrase'), pass1]),
      h('div', { class: 'field' }, [h('label', {}, 'Type it again'), pass2]),
      msg,
    ]),
    footer: [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'), go],
  });

  go.addEventListener('click', async () => {
    const includeSecrets = fullExport.checked;
    if (includeSecrets) {
      if (pass1.value.length < 8) { msg.textContent = 'Use a passphrase of at least 8 characters — this file holds live credentials.'; return; }
      if (pass1.value !== pass2.value) { msg.textContent = 'Those two passphrases are not the same.'; return; }
    }
    go.disabled = true;
    try {
      const r = await api.backup.export({ includeSecrets, passphrase: includeSecrets ? pass1.value : '' });
      m.close();
      if (!r.saved) return;
      showToast(`Exported ${r.profileCount} profile${r.profileCount === 1 ? '' : 's'}${r.includesSecrets ? ' (encrypted)' : ' (no credentials)'}.`, 'success');
    } catch (e) {
      msg.textContent = e.message;
    } finally { go.disabled = false; }
  });
}

async function openImportModal() {
  let picked;
  try {
    picked = await api.backup.read({});
  } catch (e) { return showError(e, 'That file could not be read as a backup.'); }
  if (!picked.picked) return;

  if (picked.needsPassphrase) {
    const opened = await askBackupPassphrase(picked.filePath);
    if (!opened) return;
    picked = opened;
  }
  showImportChoices(picked);
}

/** A sealed backup needs its passphrase before we can even say what is in it.
 *
 * Resolves the read result on success, or null if the dialog was dismissed.
 *
 * The settle-once guard is load-bearing, not defensive padding. openModal's
 * onClose fires however the modal ends up closing -- including the m.close()
 * on the success path below, which is not a dismissal. Resolving straight
 * from onClose therefore resolved null over the result attempt() had just
 * obtained, and openImportModal's `if (!opened) return` turned that into
 * "entered the right passphrase, dialog shut, nothing imported". Only
 * encrypted backups went through here, which is why plaintext ones always
 * worked. */
function askBackupPassphrase(filePath) {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => { if (settled) return; settled = true; resolve(value); };
    const pass = h('input', { type: 'password', autocomplete: 'off', spellcheck: 'false' });
    const msg = h('p', { class: 'lock-msg' });
    const go = h('button', { class: 'btn btn-primary', type: 'button' }, 'Open');
    const m = openModal({
      title: 'This backup is protected',
      body: h('div', {}, [
        h('p', { class: 'hint' }, 'It was exported with credentials, so it is encrypted. Enter the passphrase you set when you exported it.'),
        h('div', { class: 'field' }, [h('label', {}, 'Passphrase'), pass]),
        msg,
      ]),
      footer: [h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'), go],
      // Every way of dismissing this -- Cancel, the X, Escape, the backdrop --
      // arrives here, so this is the single "no passphrase given" path.
      onClose: () => settle(null),
    });
    async function attempt() {
      go.disabled = true; msg.textContent = '';
      try {
        const r = await api.backup.read({ filePath, passphrase: pass.value });
        // Settle BEFORE closing: closing calls onClose above, and whichever
        // of the two runs first is the one that wins.
        settle({ ...r, passphrase: pass.value });
        m.close();
      } catch (e) {
        msg.textContent = e.message;
        pass.value = ''; pass.focus();
      } finally { go.disabled = false; }
    }
    go.addEventListener('click', attempt);
    pass.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); attempt(); } });
    setTimeout(() => pass.focus(), 0);
  });
}

/** What is in the file, then merge-or-replace. Nothing has been written at this point. */
function showImportChoices(picked) {
  const s = picked.summary;
  const list = s.labels.slice(0, 12);
  const m = openModal({
    title: 'Import settings and profiles',
    body: h('div', {}, [
      h('p', {}, [
        h('strong', {}, `${s.profileCount} profile${s.profileCount === 1 ? '' : 's'}`),
        s.createdAt ? `, exported ${fmtWhen(s.createdAt)}` : '',
        s.appVersion ? ` by version ${s.appVersion}` : '',
        '.',
      ]),
      h('ul', { class: 'plain-list' }, list.map((l) => h('li', {}, l))),
      s.labels.length > list.length ? h('p', { class: 'hint' }, `…and ${s.labels.length - list.length} more.`) : null,
      h('p', { class: 'hint' }, s.includesSecrets
        ? 'This backup carries the sync credentials, so the restored profiles will be ready to use.'
        : 'This backup has no credentials in it — you will need to re-enter each profile’s token and sync passphrase afterwards.'),
      h('p', { class: 'hint' }, h('strong', {}, 'Add'), ' keeps everything you already have and brings these in alongside it, as new profiles. ',
        h('strong', {}, 'Replace'), ' deletes every profile you currently have and restores this file exactly, settings included.'),
    ]),
    footer: [
      h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => m.close() }, 'Cancel'),
      h('button', { class: 'btn', type: 'button', onclick: () => { m.close(); runImport(picked, 'merge'); } }, 'Add to what I have'),
      h('button', { class: 'btn btn-danger', type: 'button', onclick: () => { m.close(); confirmReplace(picked); } }, 'Replace everything'),
    ],
  });
}

async function confirmReplace(picked) {
  const existing = state.profiles.length;
  const ok = await confirmDialog({
    title: 'Replace everything?',
    message: `This deletes ${existing} profile${existing === 1 ? '' : 's'} currently in this app and restores the ${picked.summary.profileCount} in the backup, along with its settings. Nothing on your sync servers is touched — only this app's own copy. There is no undo.`,
    confirmLabel: 'Delete mine and restore',
    danger: true,
  });
  if (ok) runImport(picked, 'replace');
}

async function runImport(picked, mode) {
  try {
    const r = await api.backup.apply({ filePath: picked.filePath, passphrase: picked.passphrase || '', mode });
    // A replace changed the profile list out from under everything on screen,
    // so go back to the empty state and let the user pick from what is there
    // now rather than leaving a panel open on a profile that no longer exists.
    state.activeId = null;
    state.bm = { tree: null, dirty: false, status: 'not loaded' };
    state.tb = { state: null, dirty: false, status: 'not loaded' };
    await refreshProfiles();
    showEmptyState();
    try {
      const settings = await api.settings.get();
      $('#theme-select').value = settings.theme;
      expandedTabGroupsByProfile = settings.expandedTabGroups || {};
    } catch (e) { console.error(e); }
    showToast(r.replaced
      ? `Restored ${r.added} profile${r.added === 1 ? '' : 's'}.`
      : `Added ${r.added} profile${r.added === 1 ? '' : 's'}.`, 'success');
  } catch (e) {
    showError(e, 'That backup could not be imported.');
  }
}

/** The published copy of the BROWSER EXTENSION's privacy policy — a different
 *  document from this app's own, which is built into openPrivacyModal below.
 *
 *  GitHub Pages, not tabbysync.com, and that is the point rather than a
 *  preference: "TabbySync contacts no server operated by its developer" is
 *  the strongest claim either policy makes, and test/privacy-policy.test.js
 *  enforces it by refusing any reference to that domain in shipped code. This
 *  is only ever opened in the user's own browser when they click it, but a
 *  claim with a "well, except this one" attached is not worth making. */
const EXTENSION_PRIVACY_URL = 'https://rygull.github.io/TabbySync/privacy.html';

/** The contact address, assembled at runtime rather than written out.
 *
 *  Same reasoning as the extension's shared/contact.js: this ships as readable
 *  JS in a public repository, and address harvesting is overwhelmingly regex
 *  scrapers looking for name@domain in source. A split string defeats those
 *  and nothing else — anyone reading this file has it in seconds. The address
 *  is public and disposable; point it at an alias you can rotate. */
function contactAddress() {
  return 'contact' + String.fromCharCode(64) + 'tabbysync.com';
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
      extLink('the extension\u2019s privacy policy', EXTENSION_PRIVACY_URL), ' for the extension.',
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
      h('li', {}, [h('code', {}, 'settings.json'), ' in the same folder — app preferences: theme, whether the app starts with Windows, starts minimized, what the close (✕) button does, which profile to reopen automatically (if turned on), which saved-tab lists you had open, and how many idle minutes before the PIN lock closes again.']),
      h('li', {}, [h('code', {}, 'security.json'), ' in the same folder, only once you set a PIN — a random salt and a scrypt hash of your PIN, plus a count of recent wrong attempts. Your PIN itself is not in it and cannot be worked back out of it.']),
    ]),
    h('p', {}, 'None of these files is sent anywhere by the Control Panel itself — they just sit on your disk like any other application\'s settings.'),

    h('h4', {}, 'The PIN lock'),
    h('p', {}, 'The PIN locks this app\'s window: it is asked for at every start, after the app has been idle for as long as you set, and whenever you choose Lock now. It is checked in the app\'s main process, so a locked app will not answer any request for your profiles, credentials, bookmarks or saved tabs.'),
    h('p', {}, 'It does not encrypt anything, and it is worth being clear about that. The files above sit in your Windows account\'s app data whether or not a PIN is set, and the protection on the credentials inside them is tied to your Windows account rather than to the PIN — so anyone already signed in as you can read them with the app closed. The PIN stops someone walking up to your unlocked screen. It is not a defence against someone who has your Windows login.'),

    h('h4', {}, 'Exporting your settings and profiles'),
    h('p', {}, 'Options → Backup writes your profiles and app settings to a file you choose, on your PC. Nothing is uploaded and no copy is kept anywhere else. You pick one of two shapes: without credentials, which leaves every token and sync passphrase out of the file entirely, or everything including credentials, which is always encrypted with a passphrase you set (AES-256-GCM, the same scheme the browser extension uses for its own backups). There is no option that writes a working credential to a file in the clear.'),
    h('p', {}, 'Once a backup file exists it is an ordinary file on your disk: what happens to it is up to you. An encrypted one cannot be opened without its passphrase, and there is no way to recover it if you forget it.'),

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
    h('p', {}, ['Questions about this policy or your data go to ', extLink(contactAddress(), `mailto:${contactAddress()}`), '.']),
  ]);

  const m = openModal({
    title: 'Privacy Policy',
    wide: true,
    body,
    footer: [h('button', { class: 'btn btn-primary', type: 'button', onclick: () => m.close() }, 'Close')],
  });
}

// Failing loudly, because the alternative was this bug. When wireLockScreen()
// threw partway through, init() rejected with nobody listening: the unlock
// form was already wired so a PIN still started the app, and the only symptom
// was that "Lock now" silently drew nothing. An app that half-starts and says
// nothing is worse than one that refuses to start and says why.
//
// Fails CLOSED: the lock screen is what index.html shows before any of this
// runs, so leaving it up is both the safe direction and the honest one — the
// app behind it is not wired.
init().catch((e) => {
  console.error('[TabbySync] startup failed:', e);
  try {
    document.getElementById('app').hidden = true;
    document.getElementById('lock-screen').hidden = false;
    const msg = document.getElementById('lock-msg');
    msg.textContent = 'Something went wrong starting the app. Close it and open it again.';
    msg.classList.remove('ok');
  } catch { /* the document is not what we thought; the console line stands */ }
});
