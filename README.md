# SyncLocker

**Self-hosted sync for your bookmarks _and_ your open tabs — two tools in one
extension.** SyncLocker merges the former *BookmarkStash* and *TabStash*
extensions into a single Manifest V3 extension (any Chromium browser) that talks
to **one server, one token and one sync name**. Turn on the bookmark sync, the
tab sync, or both.

- 📑 **Bookmarks** — syncs your whole bookmark tree (bar + other bookmarks) with
  a true three-way merge, so adds/edits/moves/deletes from several devices are
  merged, not overwritten.
- 🗂️ **Tabs** — collapses open tabs into a saved list to free memory, then
  restores them individually or all at once.

Both engines share **one endpoint and one bearer token**. Files never collide
because each engine namespaces its own file on the server:

```
<server>?name=bookmarks-<syncName>.json     # your bookmarks
<server>?name=tabs-<syncName>.json          # your tab lists
```

Same **sync name** on another computer → that computer shares the same data.
Different names stay separate. Nothing ever leaves your own server.

## Install (unpacked)

1. In your browser open `chrome://extensions`, turn on **Developer mode**.
2. **Load unpacked** → select this repo's folder (the one containing `manifest.json`).
3. Click the SyncLocker icon → the popup lets you enable Bookmarks, Tabs, or
   both, and open **Options**.

## Set up your server (once)

You host a tiny endpoint yourself — a single PHP file with a token you choose.

1. SyncLocker → **Options** → **Server & sync** → **Self-hosting**.
2. Click **Download server files (.zip)** — you get `synclocker-server.zip`
   containing a `synclocker/` folder (one `synclocker.php` + two `.htaccess`
   guards) with a fresh random token already baked in.
3. Upload that whole folder to any PHP web host over HTTPS, e.g.
   `https://YOURDOMAIN/synclocker/synclocker.php`.
4. Back in **Server & sync**, set:
   - **Server URL** — `https://YOURDOMAIN/synclocker/synclocker.php`
   - **Bearer token** — click **Use this token above** so it matches the script
   - **Sync name** — e.g. `work` (same name on every computer you want to share)
5. **Save & grant access**, then **Test connection** (a `404` is expected until
   the first sync). Repeat the same URL + token + sync name on your other
   computers.

Prefer your own endpoint? Any server that answers `GET`/`PUT` on
`?name=<file>.json` with `Authorization: Bearer <token>` works; the generated
`synclocker.php` shows the exact contract (it also honours `ETag` / `If-Match`
for safe concurrent writes).

## Encryption (optional, shared)

Options → **Server & sync** → **Encryption**. One passphrase encrypts **both**
tools with AES-256-GCM in your browser before anything is uploaded, so the
stored files are unreadable even to your host. The passphrase never leaves your
device — enter the same one on every computer. **If you forget it, the data
can't be recovered.**

## Everyday use

- **Toolbar popup** — status of both tools, per-tool on/off toggles, **Sync
  now**, **Stash all tabs**, **Open list**.
- **Stash tabs** — the popup button, `Alt`+`Shift`+`O`, or right-click the icon
  (this tab / others / left / right).
- **Bookmarks** — just use your browser's bookmarks; changes sync automatically
  (debounced), on a timer, and on window focus.

## How it's built

The extension lives at the repo root:

| Path | What it is |
|------|-----------|
| `manifest.json` | Single MV3 manifest for both tools |
| `background.js` | Module service worker that loads both engines |
| `popup.html` / `popup.js` | The hub UI (two feature cards) |
| `options.html` / `options.js` / `options.css` | Unified options (shared server + per-tool settings) |
| `shared/config.js` | Single source of truth for the shared config keys |
| `shared/status.js` | One combined toolbar badge |
| `shared/server-files.js` | Generates the `synclocker.php` bundle |
| `bookmarks/` | Bookmark engine (`background-core.js` + `lib/`) |
| `tabs/` | Tab engine (`background-core.js`, `storage.js`, `tablist.*`) |

The two original extensions were kept as self-contained engines under
`bookmarks/` and `tabs/`; the shared layer gives them one config, one endpoint,
one token and one toolbar action. `bookmarkstash.zip` / `tabstash.zip` at the
repo root are the original sources, kept for reference.

## Icons & logo

The brand mark is a lock + sync-arrows glyph. The popup shows the full
wordmark logo in its top-left, swapped by the light/dark toggle (which remembers
your choice per device, else follows the system):

- `icons/logo-light.svg` — wordmark for **light** backgrounds (dark text)
- `icons/logo-dark.svg` — wordmark for **dark** backgrounds (light text)

The toolbar/extension icons (`icons/icon-16.png` … `icon-256.png`) are just the mark on
a transparent background, so they sit cleanly on any toolbar. They were
rasterized from the mark; if you change the logo, regenerate the PNGs at those
four sizes (Chrome requires PNG for toolbar icons — it doesn't accept SVG).

## Versioning

The extension version lives in `manifest.json`. A git hook auto-increments the
**patch** number on every commit, so it never sits stale. Enable it once per
clone:

```
sh scripts/setup-hooks.sh          # or: git config core.hooksPath .githooks
```

- The hook bumps `x.y.Z` (e.g. `1.0.3` → `1.0.4`) and re-stages `manifest.json`.
- **Manual bumps win:** if a commit already changes the version (e.g. you set
  `1.1.0` for a feature or `2.0.0` for a breaking change), the hook leaves it be.
- Skip a bump for one commit with `git commit --no-verify` (or
  `SKIP_VERSION_BUMP=1 git commit …`).

Reloading the unpacked extension on `chrome://extensions` is what makes the
new version show up in the browser.
