// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// options.js — TabbySync's unified options page (module).
//
// The shared "Server & sync" card writes the shared config (self.TabbySyncConfig).
// The Bookmarks and Tabs cards write their own slice of that config and drive
// each engine's import/export. Bookmark import/export uses the bookmarks libs
// (imported below); tab import/export uses the global TabbySync (storage.js).

import { buildHtml, parseNetscape } from './bookmarks/lib/bookmarks-io.js';
import { encryptJSON, decryptJSON, isEncrypted } from './bookmarks/lib/crypto.js';
import { readLiveModel, importTopLevel } from './bookmarks/lib/import-merge.js';

const SL = self.TabbySyncConfig;
const SF = self.TabbySyncServerFiles;
const SP = self.TabbySyncProviders;
const $ = (id) => document.getElementById(id);

function send(msg) {
  return new Promise((resolve) => {
    try { chrome.runtime.sendMessage(msg, resolve); } catch { resolve(null); }
  });
}
function status(id, msg, cls) {
  const el = $(id); el.textContent = msg || ''; el.className = 'status' + (cls ? ' ' + cls : '');
}
function flash(id, msg, cls) {
  status(id, msg, cls);
  const el = $(id);
  setTimeout(() => { if (el.textContent === msg) el.textContent = ''; }, 5000);
}
function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function pickFile(inputEl) {
  return new Promise((resolve) => {
    inputEl.value = '';
    inputEl.onchange = () => resolve(inputEl.files && inputEl.files[0]);
    inputEl.click();
  });
}
function todayStamp() {
  const d = new Date(); const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function slug(name) {
  return (name || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'profile';
}
function safeOrigin(u) { try { return new URL(u).origin + '/*'; } catch { return ''; } }

// A self-hosted destination must use HTTPS. The bearer token rides in an
// Authorization header on every single request — outside the encryption
// envelope, which only ever covers the file's body — so a plain http://
// endpoint hands a long-lived credential to anyone on the path, and lets
// them replay an older (still validly encrypted) file back at you.
//
// Loopback is the one exception: it never leaves the machine, and browsers
// already treat it as a secure context. This list must stay in step with
// "optional_host_permissions" in manifest.json — an origin that isn't
// covered there can't be granted, so allowing one here would only produce a
// saved config that never syncs. test/privacy-policy.test.js pins the pair
// together.
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1'];
function serverUrlProblem(url) {
  let u;
  try { u = new URL(url); } catch {
    return 'Server URL must be a full address, e.g. https://example.com/tabbysync/tabbysync.php';
  }
  if (u.protocol === 'https:') return '';
  if (u.protocol === 'http:' && LOOPBACK_HOSTS.includes(u.hostname)) return '';
  if (u.protocol === 'http:') {
    return 'Server URL must use https:// — your token is sent on every request and would ' +
           'cross the network in the clear. http:// is accepted only for localhost.';
  }
  return `Server URL must use https:// (this one uses "${u.protocol}").`;
}
function requestOrigin(url) {
  const o = safeOrigin(url);
  if (!o) return Promise.resolve(true);
  return new Promise((resolve) => chrome.permissions.request({ origins: [o] }, (g) => resolve(g)));
}
function fileUrl(base, name) {
  base = (base || '').replace(/\/+$/, '');
  if (!base) return '';
  const f = encodeURIComponent(name);
  return /\.php$/i.test(base) ? `${base}?name=${f}` : `${base}/${f}`;
}

// ---------------------------------------------------------------------------
// Load everything from the shared config
// ---------------------------------------------------------------------------
function updateCardsDisabled() {
  $('bmCard').classList.toggle('off', !$('bm-enable').checked);
  $('tabCard').classList.toggle('off', !$('tab-enable').checked);
}

// ---- the status band -------------------------------------------------------
// This page used to be the one place that never said whether any of this was
// working — you set six fields and then went to the popup to find out. Both
// engines already answer a status message for the popup; this asks the same
// two questions and puts the answer at the top, in a sentence.
const DEST_NAME = { custom: 'your own website', gist: 'your GitHub account', jsonbin: 'the free storage service' };

function fmtWhen(ts) {
  if (!ts) return 'never';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
function setBand(kind, mark, line1, line2) {
  $('statusBand').className = 'band' + (kind ? ' ' + kind : '');
  $('bandMark').textContent = mark;
  $('bandLine1').textContent = line1;
  $('bandLine2').textContent = line2 || '';
}

async function refreshBand() {
  const [cfg, bm, tb] = await Promise.all([
    SL.getConfig(), send({ type: 'getStatus' }), send({ type: 'sl-tab-status' }),
  ]);
  const configured = SP.isConfigured({ ...cfg, baseUrl: cfg.serverUrl });
  const anyOn = cfg.bookmarks.enabled || cfg.tabs.enabled;
  const where = DEST_NAME[cfg.provider] || DEST_NAME.custom;
  const shared = cfg.syncName ? ` · shared as “${cfg.syncName}”` : '';

  // Per-engine one-liners, reused under each switch below.
  if (bm) {
    $('bm-summary').textContent = cfg.bookmarks.enabled
      ? `${bm.bookmarks} bookmark${bm.bookmarks === 1 ? '' : 's'} in ${bm.folders} folder${bm.folders === 1 ? '' : 's'}`
      : 'off';
  }
  if (tb) {
    $('tab-summary').textContent = cfg.tabs.enabled
      ? `${tb.links} link${tb.links === 1 ? '' : 's'} in ${tb.groups} list${tb.groups === 1 ? '' : 's'}`
      : 'off';
  }

  if (!configured) {
    setBand('setup', '!', 'Not set up yet — about two minutes to finish.',
      'Answer step 1 below and TabbySync starts keeping your computers in step.');
    return;
  }
  if (!anyOn) {
    setBand('setup', '!', 'Connected, but nothing is being synced.',
      'Turn on Bookmarks, Tabs, or both in step 4.');
    return;
  }

  // Surface a real failure over a cheerful "all good" — a red dot in the
  // popup and a green band here would be the page lying to you.
  const bmBad = cfg.bookmarks.enabled && bm && bm.lastStatus === 'error';
  const tbBad = cfg.tabs.enabled && tb && tb.lastStatus === 'error';
  if (bmBad || tbBad) {
    const why = (bmBad && bm.lastError) || (tbBad && tb.lastError) || 'the last sync did not finish';
    setBand('bad', '!', "Last sync didn't work.", String(why));
    return;
  }

  const last = Math.max(bm && bm.lastSync ? bm.lastSync : 0, tb && tb.lastAt ? tb.lastAt : 0);
  setBand('ok', '✓', 'Everything is syncing.',
    `Saved to ${where}${shared} · last checked ${fmtWhen(last)}`);
}

function currentProvider() { return $('sync-provider').value || 'custom'; }

// Cache of the last config we read/saved, so switching the "Sync method"
// dropdown can restore that provider's OWN remembered token/sync name
// (see fieldsForProvider below) without a fresh storage read on every
// change event.
let lastConfig = null;

// Each provider keeps its own token/sync name/passphrase (shared/config.js),
// so switching providers here should show what's actually saved for the one
// just selected — not whatever text is still sitting in the field from
// the provider you were previously looking at.
function fieldsForProvider(cfg, provider) {
  if (!cfg) return { token: '', syncName: '', passphrase: '' };
  if (provider === 'gist') return { token: cfg.gistToken || '', syncName: cfg.gistSyncName || '', passphrase: cfg.gistPassphrase || '' };
  if (provider === 'jsonbin') return { token: cfg.jsonbinToken || '', syncName: '', passphrase: cfg.jsonbinPassphrase || '' };
  return { token: cfg.customToken || '', syncName: cfg.customSyncName || '', passphrase: cfg.customPassphrase || '' };
}

// Populate the provider <select> once from the shared metadata.
function populateProviderSelect() {
  const sel = $('sync-provider');
  sel.innerHTML = '';
  Object.keys(SP.PROVIDERS).forEach((id) => {
    const opt = document.createElement('option');
    opt.value = id; opt.textContent = SP.PROVIDERS[id].label;
    sel.appendChild(opt);
  });
}

// Show/hide + relabel fields for whichever sync method is selected, and swap
// in that provider's setup hint + security disclaimer.
function updateProviderUI() {
  const meta = SP.providerMeta(currentProvider());
  $('srv-url-label').style.display = meta.needsUrl ? '' : 'none';
  $('srv-url').style.display = meta.needsUrl ? '' : 'none';
  $('srv-url-hint').style.display = meta.needsUrl ? '' : 'none';

  $('srv-name-label').style.display = meta.needsSyncName ? '' : 'none';
  $('srv-name').style.display = meta.needsSyncName ? '' : 'none';
  $('srv-name-hint').style.display = meta.needsSyncName ? '' : 'none';

  // Swap in THIS provider's own remembered token/sync name/passphrase, so
  // switching methods shows what's actually saved for it instead of
  // leftover text from whichever provider you were just editing.
  const f = fieldsForProvider(lastConfig, currentProvider());
  $('srv-token').value = f.token;
  $('srv-name').value = f.syncName;
  $('enc-pass').value = f.passphrase;

  // Only offer the cosmetic profile label when the provider has no
  // functional name of its own to tell profiles apart (currently JSONBin).
  $('srv-profile-label-label').style.display = meta.needsSyncName ? 'none' : '';
  $('srv-profile-label').style.display = meta.needsSyncName ? 'none' : '';
  $('srv-profile-label-hint').style.display = meta.needsSyncName ? 'none' : '';

  // Plain-language names for the credential each destination wants. The
  // provider metadata still carries the technical name (shared/providers.js);
  // it belongs in the hint, where someone hunting for the right field on
  // GitHub's own settings page can find it, rather than in the label.
  const CRED = {
    custom: {
      label: 'Access code',
      hint: 'The long code inside the file you uploaded. Stored on this computer only, and sent to your ' +
            'own server with every request.',
    },
    gist: {
      label: 'GitHub access token',
      hint: 'Create one at github.com → Settings → Developer settings → Personal access tokens, with the ' +
            '“Gists” permission set to read and write. Stored on this computer only — treat it like a password.',
    },
    jsonbin: {
      label: 'JSONBin API key',
      hint: 'From your JSONBin account menu → API Keys (it calls this the X-Master-Key). Stored on this ' +
            'computer only — treat it like a password.',
    },
  };
  const cred = CRED[currentProvider()] || CRED.custom;
  $('srv-token-label').textContent = cred.label;
  $('srv-token').placeholder = meta.tokenPlaceholder;
  $('srv-token-hint').textContent = cred.hint;

  // The provider metadata's setupHint is a dense block with a nested list —
  // exactly the wall of text this page is trying not to be. Self-hosting keeps
  // its one-liner; the two account-based destinations get a short summary and
  // a button to the full walk-through in the dialog at the bottom of the page.
  const SUMMARY = {
    gist: 'Needs a free GitHub account and one access token, which takes about two minutes to create. ' +
          'TabbySync makes the private file for you the first time it saves.',
    jsonbin: 'Needs a free JSONBin.io account and one API key. TabbySync creates the storage for you the ' +
             'first time it saves — there is nothing to upload.',
  };
  const summary = SUMMARY[currentProvider()];
  $('provider-hint').innerHTML = summary || meta.setupHint || '';
  $('guide-row').hidden = !summary;
  const disc = $('provider-disclaimer');
  if (meta.disclaimer) { disc.textContent = meta.disclaimer; disc.hidden = false; }
  else { disc.textContent = ''; disc.hidden = true; }

  $('selfhostCard').hidden = currentProvider() !== 'custom';
  syncChoiceCards();
  renumberSteps();
  // Each provider remembers its own passphrase (shared/config.js), and the
  // lines above just swapped one in — so the lock switch follows it.
  updateEncryptionUI();
  preview();
}
$('sync-provider').addEventListener('change', updateProviderUI);

// The three destination cards are a friendlier way to set the <select> above,
// not a second source of truth: they write its value and fire the same change
// event a dropdown would, so every save, test and lookup downstream reads the
// value it always read. The select stays in the DOM (visually hidden) for
// exactly that reason.
// Step 2 (making the self-hosted file) only exists for one of the three
// destinations, so the numbers are assigned to whatever is actually on screen
// rather than baked into the markup — otherwise choosing GitHub leaves the
// page counting 1, 3, 4.
function renumberSteps() {
  let n = 0;
  document.querySelectorAll('.wrap > section.card').forEach((card) => {
    const badge = card.querySelector('.step-n');
    if (!badge) return;
    if (card.hidden || card.offsetParent === null && card.id === 'selfhostCard') return;
    badge.textContent = String(++n);
  });
}

function syncChoiceCards() {
  const active = currentProvider();
  document.querySelectorAll('#providerChoices .choice').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.provider === active));
  });
}
document.querySelectorAll('#providerChoices .choice').forEach((btn) => {
  btn.addEventListener('click', () => {
    $('sync-provider').value = btn.dataset.provider;
    $('sync-provider').dispatchEvent(new Event('change'));
  });
});

function preview() {
  const provider = currentProvider();
  // Preview the name as it'll actually be used (sanitized), without
  // rewriting the input itself while the user is still typing.
  const name = SL.sanitizeSyncName($('srv-name').value);
  if (provider === 'custom') {
    const base = $('srv-url').value.trim();
    if (!base || !name) { $('srv-preview').textContent = 'Fill in the boxes above to see where your files will go.'; return; }
    $('srv-preview').innerHTML =
      `<b>Bookmarks →</b> ${fileUrl(base, 'bookmarks-' + name + '.json')}<br>` +
      `<b>Tabs →</b> ${fileUrl(base, 'tabs-' + name + '.json')}`;
  } else if (provider === 'gist') {
    const suffix = name ? `-${name}` : '';
    $('srv-preview').innerHTML =
      `<b>Bookmarks →</b> a file named <code>bookmarks${suffix}.json</code> in your private gist<br>` +
      `<b>Tabs →</b> a file named <code>tabs${suffix}.json</code> in the same gist ` +
      `<span class="hint">(created automatically on first save)</span>`;
  } else if (provider === 'jsonbin') {
    $('srv-preview').innerHTML =
      `<b>Bookmarks</b> and <b>Tabs</b> each get their own JSONBin bin ` +
      `<span class="hint">(created automatically on first save — one profile per API key)</span>`;
  }
}

async function load() {
  const c = await SL.getConfig();
  lastConfig = c;
  populateProviderSelect();
  $('sync-provider').value = c.provider;
  $('srv-url').value = c.serverUrl;
  // srv-token/srv-name/enc-pass are populated by updateProviderUI() below,
  // from lastConfig, per the currently selected provider.
  $('srv-profile-label').value = c.profileLabel;

  $('bm-enable').checked = c.bookmarks.enabled;
  $('bm-interval').value = c.bookmarks.intervalMin;
  $('bm-autosync').checked = c.bookmarks.autoSync;
  $('bm-deletewins').checked = c.bookmarks.deleteWins;

  $('tab-enable').checked = c.tabs.enabled;
  $('tab-interval').value = c.tabs.intervalMin;
  // Duplicate handling used to be a required dropdown with no default, so
  // setup could not finish until you ruled on a question you had no basis to
  // answer yet. "Skip duplicates within the same send" is the answer almost
  // everyone wants; it is written down here rather than left blank, so the UI
  // and the stored setting always agree.
  if (c.tabs.dedupe) {
    $('tab-dedupe').value = c.tabs.dedupe;
  } else {
    $('tab-dedupe').value = 'group';
    await SL.setConfig({ tabs: { dedupe: 'group' } });
  }
  $('tab-restore-group').checked = c.tabs.restoreAsGroup;
  $('tab-remove-restore').checked = c.tabs.removeOnRestore;
  $('tab-pin-list').checked = c.tabs.pinList;
  $('tab-backup-pass').value = c.tabs.backupPass;

  let gt = c.genToken;
  if (!gt) { gt = SF.randomToken(); await SL.setConfig({ genToken: gt }); }
  $('gen-token').value = gt;

  updateCardsDisabled();
  updateProviderUI();   // fills enc-pass for the active provider…
  updateEncryptionUI(); // …so the lock switch has something to read
  refreshBand();
}

// ---------------------------------------------------------------------------
// Shared server card
// ---------------------------------------------------------------------------
['srv-url', 'srv-name'].forEach((id) => $(id).addEventListener('input', preview));

// The host permission a provider actually needs — self-hosted is whatever
// URL the user typed, Gist/JSONBin are fixed third-party API hosts.
function grantAccess(provider, serverUrl) {
  if (provider === 'gist') {
    return new Promise((resolve) => chrome.permissions.request({ origins: ['https://api.github.com/*'] }, resolve));
  }
  if (provider === 'jsonbin') {
    return new Promise((resolve) => chrome.permissions.request({ origins: ['https://api.jsonbin.io/*'] }, resolve));
  }
  return requestOrigin(serverUrl);
}

$('srv-save').addEventListener('click', async () => {
  const provider = currentProvider();
  const meta = SP.providerMeta(provider);
  const serverUrl = $('srv-url').value.trim().replace(/\/+$/, '');
  const token = $('srv-token').value;
  // Letters/numbers/dots/dashes/underscores only, capped at SYNC_NAME_MAX —
  // it ends up embedded in remote filenames and shown throughout the UI.
  // Reflect the cleaned-up value back into the field so what's saved is
  // exactly what's visible, rather than silently rewriting behind the input.
  const syncName = SL.sanitizeSyncName($('srv-name').value);
  $('srv-name').value = syncName;
  const profileLabel = $('srv-profile-label').value.trim();

  if (meta.needsUrl && !serverUrl) { status('srv-status', 'Server URL is required.', 'bad'); return; }
  if (meta.needsUrl) {
    const problem = serverUrlProblem(serverUrl);
    if (problem) { status('srv-status', problem, 'bad'); return; }
  }
  if (!token) { status('srv-status', `${meta.tokenLabel} is required.`, 'bad'); return; }
  if (provider === 'custom' && !syncName) {
    status('srv-status', 'Sync name is required (letters, numbers, dots, dashes and underscores).', 'bad');
    return;
  }

  // Renaming an in-use profile doesn't move its data — it starts a new,
  // separate (empty) file/gist-entry under the new name and leaves the old
  // one exactly where it was, on the same destination, unmerged. That's
  // fine when it's deliberate, but it should never happen silently — a
  // silent version of exactly this (a sanitizer changing an existing name's
  // case) previously wiped someone's synced bookmarks. Only warn when the
  // destination itself (provider, and server URL for self-hosted) is
  // otherwise unchanged, so switching providers/servers doesn't also
  // trigger it.
  if (meta.needsSyncName) {
    const prior = await SL.getConfig();
    const sameDestination = prior.provider === provider &&
      (provider !== 'custom' || prior.serverUrl === serverUrl);
    if (sameDestination && prior.syncName && syncName && prior.syncName !== syncName) {
      const ok = confirm(
        `This renames your profile from "${prior.syncName}" to "${syncName}".\n\n` +
        `That starts a separate, empty profile under the new name — your existing data stays ` +
        `right where it is under "${prior.syncName}", not moved or merged. If you meant to switch ` +
        `back to an existing profile instead, make sure the name matches exactly, including ` +
        `capitalization.\n\nContinue with "${syncName}"?`
      );
      if (!ok) { status('srv-status', 'Not saved — sync name left unchanged.', ''); return; }
    }
  }

  status('srv-status', 'Saving…');
  await SL.setConfig({ provider, serverUrl, token, syncName, profileLabel });
  // Refresh the cache so switching providers afterward (without reloading
  // the page) restores what was just saved, not stale pre-save values.
  lastConfig = await SL.getConfig();
  const granted = await grantAccess(provider, serverUrl);
  await send({ type: 'tabbysync-reschedule' });
  // Nudge both engines (they also auto-sync from the config change).
  send({ type: 'syncNow' });
  send({ type: 'tabbysync-sync' });
  preview();
  status('srv-status', granted
    ? 'Saved — syncing the enabled tools now.'
    : "Saved, but access wasn't granted — sync will fail until you allow it.",
    granted ? 'ok' : 'bad');
});

$('srv-test').addEventListener('click', async () => {
  const provider = currentProvider();
  const meta = SP.providerMeta(provider);
  const serverUrl = $('srv-url').value.trim().replace(/\/+$/, '');
  const token = $('srv-token').value;
  const syncName = SL.sanitizeSyncName($('srv-name').value);
  $('srv-name').value = syncName;

  if (meta.needsUrl && !serverUrl) { status('srv-status', 'Fill in the Server URL first.', 'bad'); return; }
  if (meta.needsUrl) {
    const problem = serverUrlProblem(serverUrl);
    if (problem) { status('srv-status', problem, 'bad'); return; }
  }
  if (!token) { status('srv-status', `Fill in the ${meta.tokenLabel} first.`, 'bad'); return; }

  status('srv-status', 'Testing…');
  await grantAccess(provider, serverUrl);

  if (provider === 'custom') {
    try {
      const res = await fetch(fileUrl(serverUrl, 'bookmarks-' + syncName + '.json'),
        { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
      if (res.status === 404) status('srv-status', "Reachable — no data stored yet for this sync name (that's expected).", 'ok');
      else if (res.status === 401 || res.status === 403) status('srv-status', 'Reached the server but the token was rejected (auth failed).', 'bad');
      else if (res.ok) status('srv-status', 'Connected — existing data found for this sync name.', 'ok');
      else status('srv-status', `Server responded HTTP ${res.status}.`, 'bad');
    } catch (e) {
      status('srv-status', `Could not reach server: ${e.message} (check URL, token, and that you granted access).`, 'bad');
    }
  } else if (provider === 'gist') {
    try {
      const res = await fetch('https://api.github.com/gists?per_page=1',
        { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
      if (res.status === 401 || res.status === 403) status('srv-status', 'GitHub rejected the token — check it has the “Gists” scope.', 'bad');
      else if (res.ok) status('srv-status', 'Token works. Save to create (or reuse) your TabbySync gist.', 'ok');
      else status('srv-status', `GitHub responded HTTP ${res.status}.`, 'bad');
    } catch (e) {
      status('srv-status', `Could not reach GitHub: ${e.message}`, 'bad');
    }
  } else if (provider === 'jsonbin') {
    // JSONBin has no side-effect-free "check this key" endpoint — the key is
    // actually verified the first time you Save (which creates the bins).
    status('srv-status', 'Nothing to verify yet — click “Save & grant access”; the key is checked when your bins are created.', 'ok');
  }
});

// ---- shared encryption passphrase -----------------------------------------
// Safe transition for every enabled+configured engine:
//   1) sync with the CURRENT passphrase (so we hold the latest data)
//   2) set the new passphrase
//   3) overwrite the server file in the new encryption state
async function applyPassphrase(newPass) {
  const c = await SL.getConfig();
  const configured = SP.isConfigured({ ...c, baseUrl: c.serverUrl });
  if (configured && c.bookmarks.enabled) await send({ type: 'syncNow' });
  if (configured && c.tabs.enabled) await send({ type: 'tabbysync-sync' });

  // Passphrase is per-provider (like the token/sync name) — include the
  // active provider so it lands in THIS provider's own slot.
  await SL.setConfig({ passphrase: newPass, provider: c.provider });
  lastConfig = await SL.getConfig();

  if (configured && c.bookmarks.enabled) await send({ type: 'bmOverwrite' });
  if (configured && c.tabs.enabled) {
    try { await self.TabbySync.pushLocalOverwrite(); } catch { /* nothing to push yet */ }
  }
}

// The switch is the visible state; the passphrase field and its two buttons
// are what actually do the work. Turning it ON just opens the field (there is
// nothing to save until a password is typed); turning it OFF runs the same
// confirm-and-clear path the "Turn the lock off" button always ran.
function updateEncryptionUI() {
  const on = !!($('enc-pass').value);
  $('enc-switch').checked = on;
  $('enc-state').textContent = on ? 'Password lock is on' : 'Password lock is off';
  $('enc-body').hidden = false;
  // Nothing to turn off when it is already off — an always-visible "Turn the
  // lock off" next to a lock that is off reads as if something is wrong.
  $('enc-clear').hidden = !on;
}

$('enc-switch').addEventListener('change', async () => {
  if ($('enc-switch').checked) {
    // Nothing to turn on yet — show where to type it, and let Save do the work.
    $('enc-state').textContent = 'Type a password, then save it';
    $('enc-pass').focus();
    return;
  }
  if (!$('enc-pass').value) { updateEncryptionUI(); return; }
  await turnEncryptionOff();
});

async function turnEncryptionOff() {
  if (!confirm('Turn the password lock off? Your data will be stored where you chose as readable text again.')) {
    updateEncryptionUI();
    return;
  }
  status('enc-status', 'Turning the lock off and re-uploading as plain text…');
  $('enc-pass').value = '';
  try {
    await applyPassphrase('');
    status('enc-status', 'Password lock is off.', 'ok');
  } catch (e) { status('enc-status', 'Error: ' + e.message, 'bad'); }
  updateEncryptionUI();
}

$('enc-save').addEventListener('click', async () => {
  const p = $('enc-pass').value;
  if (!p) { status('enc-status', 'Type a password first, or use “Turn the lock off”.', 'bad'); return; }
  status('enc-status', 'Saving, and locking the copies already sent…');
  try {
    await applyPassphrase(p);
    status('enc-status', 'Password lock is on. Type the same password on your other computers.', 'ok');
  } catch (e) { status('enc-status', 'Error: ' + e.message, 'bad'); }
  updateEncryptionUI();
});
$('enc-clear').addEventListener('click', turnEncryptionOff);

// ---- the step-by-step setup guides ----------------------------------------
// GitHub and JSONBin both need an account and a key fetched from someone
// else's website, which is several screens of clicking that has to be
// described somewhere. A dialog keeps it one click away from the field it is
// about, instead of either a wall of text on the page or a link that sends
// people off to hunt through documentation.
const GUIDE_TITLES = {
  gist: 'Setting up GitHub sync',
  jsonbin: 'Setting up JSONBin.io sync',
  custom: 'Setting up your own website',
};

function openGuide(provider) {
  document.querySelectorAll('.guide-sec').forEach((sec) => {
    sec.hidden = sec.dataset.guide !== provider;
  });
  $('guide-title').textContent = GUIDE_TITLES[provider] || 'Setting this up';
  const dlg = $('guideDialog');
  dlg.querySelector('.guide-body').scrollTop = 0;
  // showModal gives focus trapping and Escape-to-close for free; show() is the
  // fallback for anything that doesn't have the dialog element.
  if (typeof dlg.showModal === 'function') dlg.showModal();
  else dlg.setAttribute('open', '');
}
$('guide-open').addEventListener('click', () => openGuide(currentProvider()));
$('guide-close').addEventListener('click', () => {
  const dlg = $('guideDialog');
  if (typeof dlg.close === 'function') dlg.close();
  else dlg.removeAttribute('open');
});
// Clicking the backdrop closes it, the way every other dialog on the web does.
$('guideDialog').addEventListener('click', (e) => {
  if (e.target === $('guideDialog')) $('guideDialog').close();
});

// ---- self-hosting generator -----------------------------------------------
$('gen-regen').addEventListener('click', async () => {
  const t = SF.randomToken();
  $('gen-token').value = t;
  await SL.setConfig({ genToken: t });
  flash('gen-status', 'New token generated. Re-download the bundle and upload it, then click “Use this token above”.', 'ok');
});
$('gen-download').addEventListener('click', async () => {
  try {
    const token = $('gen-token').value.trim() || SF.randomToken();
    $('gen-token').value = token;
    await SL.setConfig({ genToken: token });
    const blob = SF.buildServerZip(token);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'tabbysync-server.zip';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    flash('gen-status', 'Downloaded tabbysync-server.zip — upload its contents to your server, then click “Use this token above”.', 'ok');
  } catch (e) { flash('gen-status', 'Could not build the bundle: ' + e.message, 'bad'); }
});

$('gen-use').addEventListener('click', async () => {
  const t = $('gen-token').value.trim();
  if (!t) { flash('gen-status', 'Generate a token first.', 'bad'); return; }
  $('srv-token').value = t;
  flash('gen-status', 'Token applied above. Now set the Server URL + sync name and click “Save & grant access”.', 'ok');
});

// ---------------------------------------------------------------------------
// Bookmarks card
// ---------------------------------------------------------------------------
async function saveBookmarks() {
  await SL.setConfig({ bookmarks: {
    enabled: $('bm-enable').checked,
    intervalMin: Math.max(1, parseInt($('bm-interval').value, 10) || 5),
    autoSync: $('bm-autosync').checked,
    deleteWins: $('bm-deletewins').checked,
  } });
  updateCardsDisabled();
}
['bm-enable', 'bm-interval', 'bm-autosync', 'bm-deletewins'].forEach((id) =>
  $(id).addEventListener('change', saveBookmarks));

async function bmSlug() {
  const n = ($('srv-name').value || '').trim() || (await SL.getConfig()).syncName;
  return slug(n);
}
async function bmSyncAfterImport() { try { await send({ type: 'syncNow' }); } catch { /* ignore */ } }

$('bm-exp-html').addEventListener('click', async () => {
  try {
    const model = await readLiveModel();
    download(`tabbysync-bookmarks-${await bmSlug()}-${todayStamp()}.html`, buildHtml(model), 'text/html');
    flash('bm-io-status', 'Exported bookmarks as HTML.', 'ok');
  } catch (e) { status('bm-io-status', 'Export failed: ' + e.message, 'bad'); }
});
$('bm-imp-html').addEventListener('click', async () => {
  const file = await pickFile($('bm-file-html'));
  if (!file) return;
  if (!confirm(`Import bookmarks from "${file.name}"? They'll be merged into your current bookmarks (no duplicates) and synced.`)) return;
  try {
    status('bm-io-status', 'Importing…');
    const roots = parseNetscape(await file.text());
    const added = await importTopLevel(roots);
    await bmSyncAfterImport();
    flash('bm-io-status', `Imported — added ${added} new bookmark${added === 1 ? '' : 's'} and synced.`, 'ok');
  } catch (e) { status('bm-io-status', 'Import failed: ' + e.message, 'bad'); }
});
$('bm-exp-enc').addEventListener('click', async () => {
  const pass = $('bm-backup-pass').value;
  if (!pass) { status('bm-io-status', 'Enter a backup passphrase first.', 'bad'); return; }
  try {
    const env = await encryptJSON(await readLiveModel(), pass);
    download(`tabbysync-bookmarks-${await bmSlug()}-backup-${todayStamp()}.enc.json`, JSON.stringify(env), 'application/json');
    flash('bm-io-status', 'Exported encrypted bookmark backup.', 'ok');
  } catch (e) { status('bm-io-status', 'Backup failed: ' + e.message, 'bad'); }
});
$('bm-imp-enc').addEventListener('click', async () => {
  const pass = $('bm-backup-pass').value;
  if (!pass) { status('bm-io-status', 'Enter the backup passphrase first.', 'bad'); return; }
  const file = await pickFile($('bm-file-enc'));
  if (!file) return;
  if (!confirm(`Restore from "${file.name}"? It'll be merged into your current bookmarks (no duplicates) and synced.`)) return;
  try {
    status('bm-io-status', 'Decrypting…');
    const payload = JSON.parse(await file.text());
    const model = isEncrypted(payload) ? await decryptJSON(payload, pass) : payload;
    const added = await importTopLevel(model.children || model);
    await bmSyncAfterImport();
    flash('bm-io-status', `Restored — added ${added} new bookmark${added === 1 ? '' : 's'} and synced.`, 'ok');
  } catch (e) { status('bm-io-status', 'Restore failed: ' + (e.message || e), 'bad'); }
});

// ---------------------------------------------------------------------------
// Tabs card (uses the global TabbySync)
// ---------------------------------------------------------------------------
const TabbySync = self.TabbySync;

async function saveTabs() {
  await SL.setConfig({ tabs: {
    enabled: $('tab-enable').checked,
    intervalMin: parseInt($('tab-interval').value, 10) || 0,
    dedupe: $('tab-dedupe').value,
    restoreAsGroup: $('tab-restore-group').checked,
    removeOnRestore: $('tab-remove-restore').checked,
    pinList: $('tab-pin-list').checked,
  } });
  updateCardsDisabled();
  await send({ type: 'tabbysync-reschedule' });
}
['tab-enable', 'tab-interval', 'tab-dedupe', 'tab-restore-group',
 'tab-remove-restore', 'tab-pin-list'].forEach((id) =>
  $(id).addEventListener('change', saveTabs));
$('tab-backup-pass').addEventListener('change', () =>
  SL.setConfig({ tabs: { backupPass: $('tab-backup-pass').value } }));

$('tab-dedupe-now').addEventListener('click', async () => {
  try {
    const state = await TabbySync.getState();
    let before = 0; state.groups.forEach((g) => before += g.tabs.length);
    TabbySync.removeDuplicates(state);
    let after = 0; state.groups.forEach((g) => after += g.tabs.length);
    await TabbySync.saveState(state);
    const removed = before - after;
    flash('tab-dedupe-status', removed
      ? `Removed ${removed} duplicate tab${removed === 1 ? '' : 's'}.`
      : 'No duplicates found.', 'ok');
  } catch (e) { status('tab-dedupe-status', 'Error: ' + e.message, 'bad'); }
});

async function tabExport(encrypted) {
  const [settings, state] = await Promise.all([TabbySync.getSettings(), TabbySync.getState()]);
  const name = TabbySync.slugify(settings.syncKey) || 'list';
  const plaintext = TabbySync.exportJSON(settings, state);
  if (encrypted) {
    const pass = $('tab-backup-pass').value;
    if (!pass) { status('tab-io-status', 'Enter a backup passphrase first.', 'bad'); return; }
    const env = await TabbySync.encryptString(pass, plaintext);
    download(`tabbysync-tabs-${name}-backup-${todayStamp()}.enc.json`, JSON.stringify(env, null, 2), 'application/json');
    flash('tab-io-status', 'Exported encrypted tab backup.', 'ok');
  } else {
    download(`tabbysync-tabs-${name}-${todayStamp()}.json`, plaintext, 'application/json');
    flash('tab-io-status', 'Exported tabs as JSON.', 'ok');
  }
}
$('tab-exp').addEventListener('click', () => tabExport(false));
$('tab-exp-enc').addEventListener('click', () => tabExport(true));

let tabImportEnc = false;
$('tab-imp').addEventListener('click', () => { tabImportEnc = false; $('tab-file').click(); });
$('tab-imp-enc').addEventListener('click', () => {
  if (!$('tab-backup-pass').value) { status('tab-io-status', 'Enter the backup passphrase before importing an encrypted backup.', 'bad'); return; }
  tabImportEnc = true; $('tab-file').click();
});
$('tab-file').addEventListener('change', async () => {
  const file = $('tab-file').files[0];
  if (!file) return;
  const useEnc = tabImportEnc;
  try {
    const text = await file.text();
    const state = await TabbySync.getState();
    const pass = useEnc ? $('tab-backup-pass').value : '';
    const res = await TabbySync.importBackupMerge(state, text, pass);
    await TabbySync.saveState(state);
    flash('tab-io-status',
      `Imported ${res.added} link${res.added === 1 ? '' : 's'} into ${res.groups} list${res.groups === 1 ? '' : 's'}` +
      (res.skipped ? ` · skipped ${res.skipped} duplicate${res.skipped === 1 ? '' : 's'}` : '') + '.', 'ok');
  } catch (e) { status('tab-io-status', 'Import failed: ' + e.message, 'bad'); }
  $('tab-file').value = '';
});

// ---------------------------------------------------------------------------
// Danger zone — delete synced data
// ---------------------------------------------------------------------------
const DANGER_LABELS = { custom: 'Self-Hosted', gist: 'GitHub Gist', jsonbin: 'JSONBin.io' };
const dangerButtons = () => [$('danger-custom'), $('danger-gist'), $('danger-jsonbin'), $('danger-wipe-all')];

// Buttons stay disabled until the exact phrase is typed — a stray click on
// this section can't do anything by itself. Each button still confirms
// again before actually deleting anything.
$('danger-unlock').addEventListener('input', () => {
  const unlocked = $('danger-unlock').value.trim().toUpperCase() === 'DELETE';
  dangerButtons().forEach((b) => { b.disabled = !unlocked; });
});
function relockDanger() {
  $('danger-unlock').value = '';
  dangerButtons().forEach((b) => { b.disabled = true; });
}

// Clears what THIS provider has saved locally (credentials + any
// auto-created gist/bin IDs), without touching any other provider's saved
// values or which sync method is currently selected.
async function clearProviderLocal(providerId) {
  const patch = { routeProvider: providerId, token: '', syncName: '', passphrase: '' };
  if (providerId === 'gist') patch.gistId = '';
  if (providerId === 'jsonbin') { patch.jsonbinTabsId = ''; patch.jsonbinBookmarksId = ''; patch.profileLabel = ''; }
  if (providerId === 'custom') patch.serverUrl = '';
  await SL.setConfig(patch);
}

// Puts back exactly what clearProviderLocal cleared, from a config snapshot
// taken beforehand — used when the remote delete itself fails, so a failed
// attempt doesn't leave a still-working provider looking disconnected.
async function restoreProviderLocal(providerId, cfg) {
  const patch = { routeProvider: providerId };
  if (providerId === 'custom') {
    Object.assign(patch, { serverUrl: cfg.serverUrl, token: cfg.customToken, syncName: cfg.customSyncName, passphrase: cfg.customPassphrase });
  } else if (providerId === 'gist') {
    Object.assign(patch, { token: cfg.gistToken, syncName: cfg.gistSyncName, passphrase: cfg.gistPassphrase, gistId: cfg.gistId });
  } else if (providerId === 'jsonbin') {
    Object.assign(patch, {
      token: cfg.jsonbinToken, passphrase: cfg.jsonbinPassphrase,
      jsonbinTabsId: cfg.jsonbinTabsId, jsonbinBookmarksId: cfg.jsonbinBookmarksId, profileLabel: cfg.profileLabel,
    });
  }
  await SL.setConfig(patch);
}

async function deleteOneProvider(providerId) {
  const label = DANGER_LABELS[providerId];
  const sure = confirm(
    `Permanently delete your ${label} data?\n\n` +
    `This removes the synced file(s) from ${label} itself and clears the credentials TabbySync has saved ` +
    `for it here. Any other device sharing this profile will lose access to that data. Your bookmarks and ` +
    `open tabs in THIS browser are not touched — only the remote copy.\n\n` +
    `This can't be undone. Continue?`
  );
  if (!sure) return;
  status('danger-status', `Deleting ${label} data…`);
  const cfg = await SL.getConfig();
  try {
    // Clear local credentials FIRST, before the remote delete even starts.
    // A remote delete is a real network round-trip — if this provider is
    // also the one actively syncing and a background sync (periodic timer,
    // a bookmark edit, a focus switch) fires while the delete is still in
    // flight, it would otherwise run with still-valid credentials against a
    // remote that's mid-delete: it can read that back as "the data was
    // deleted elsewhere" and propagate that deletion onto your ACTUAL
    // local bookmarks, then push the emptied result back up. Clearing
    // first makes this provider read as unconfigured immediately, so any
    // sync attempt during the window below safely does nothing instead.
    await clearProviderLocal(providerId);
    const had = await SP.deleteProviderData(cfg, providerId);
    await load();
    status('danger-status', had
      ? `Deleted — ${label}'s remote data is gone, and its saved credentials here were cleared.`
      : `Nothing was saved for ${label} — nothing to delete.`, 'ok');
  } catch (e) {
    // The delete failed — put back what we cleared so a failed attempt
    // doesn't silently disconnect you from a provider that's still fine.
    await restoreProviderLocal(providerId, cfg);
    await load();
    status('danger-status', `Delete failed — nothing was changed: ${e.message}`, 'bad');
  } finally {
    relockDanger();
  }
}
$('danger-custom').addEventListener('click', () => deleteOneProvider('custom'));
$('danger-gist').addEventListener('click', () => deleteOneProvider('gist'));
$('danger-jsonbin').addEventListener('click', () => deleteOneProvider('jsonbin'));

$('danger-wipe-all').addEventListener('click', async () => {
  const sure1 = confirm(
    'Wipe EVERYTHING?\n\n' +
    'This attempts to delete your remote data on every sync method you have ever saved credentials for here ' +
    '(Self-Hosted, GitHub Gist, JSONBin.io — whichever apply), then erases every TabbySync setting stored in ' +
    'this browser and starts over as if freshly installed.\n\n' +
    "This does NOT uninstall the extension, and does not touch your actual bookmarks or open tabs in this " +
    'browser — only TabbySync\'s own settings and whatever it synced remotely.\n\n' +
    'This cannot be undone. Continue?'
  );
  if (!sure1) return;
  // The single most destructive action in the app gets one more, more
  // deliberate confirmation on top of the usual one.
  const sure2 = confirm('Really wipe everything? There is no undo.');
  if (!sure2) { relockDanger(); return; }

  const cfg = await SL.getConfig();
  // Clear local storage FIRST, before attempting any remote deletes — a
  // remote delete is a real network round-trip per provider, and while
  // credentials are still valid locally a background sync could race one
  // of them: read a remote that's mid-delete as "deleted elsewhere", and
  // propagate that onto your ACTUAL local bookmarks (then push the emptied
  // result back up). Clearing first means every provider reads as
  // unconfigured immediately, so nothing can sync during the window below.
  status('danger-wipe-status', 'Clearing local settings…');
  await chrome.storage.local.clear();

  status('danger-wipe-status', 'Deleting remote data on every configured provider…');
  const order = ['custom', 'gist', 'jsonbin'];
  const results = await Promise.allSettled(order.map((p) => SP.deleteProviderData(cfg, p)));
  const failures = results
    .map((r, i) => ({ r, name: DANGER_LABELS[order[i]] }))
    .filter((x) => x.r.status === 'rejected');

  if (failures.length) {
    alert(
      'Local settings are cleared, but some remote deletes failed — you may need to remove these manually:\n\n' +
      failures.map((f) => `• ${f.name}: ${f.r.reason && f.r.reason.message ? f.r.reason.message : f.r.reason}`).join('\n')
    );
  }
  status('danger-wipe-status', failures.length
    ? 'Local settings cleared, with some remote deletes failed (see the popup). Reloading…'
    : 'Done — everything deleted and reset. Reloading…', failures.length ? 'bad' : 'ok');
  setTimeout(() => location.reload(), 1200);
});

load();
