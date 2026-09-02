# TabbySync

**Self-hosted sync for your bookmarks _and_ your open tabs — two tools in one
extension.** TabbySync began as two separate extensions that were later
merged into a single Manifest V3 extension (any Chromium browser) that talks
to **one sync destination, one token and one sync name**. Turn on the bookmark
sync, the tab sync, or both. Self-hosting your own endpoint is the recommended
setup — free, no-server alternatives (GitHub Gist, JSONBin.io) are also
available for anyone who doesn't have a server, see [below](#no-server-free-alternatives).

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
3. Click the TabbySync icon → the popup lets you enable Bookmarks, Tabs, or
   both, and open **Options**.

## Set up your server (once)

You host a tiny endpoint yourself — a single PHP file with a token you choose.

1. TabbySync → **Options** → **Server & sync** → **Self-hosting**.
2. Click **Download server files (.zip)** — you get `tabbysync-server.zip`
   containing a `tabbysync/` folder (one `tabbysync.php` + two `.htaccess`
   guards) with a fresh random token already baked in.
3. Upload that whole folder to any PHP web host over HTTPS, e.g.
   `https://YOURDOMAIN/tabbysync/tabbysync.php`.
4. Back in **Server & sync**, set:
   - **Server URL** — `https://YOURDOMAIN/tabbysync/tabbysync.php`
   - **Bearer token** — click **Use this token above** so it matches the script
   - **Sync name** — e.g. `work` (same name on every computer you want to share)
5. **Save & grant access**, then **Test connection** (a `404` is expected until
   the first sync). Repeat the same URL + token + sync name on your other
   computers.

Prefer your own endpoint? Any server that answers `GET`/`PUT` on
`?name=<file>.json` with `Authorization: Bearer <token>` works; the generated
`tabbysync.php` shows the exact contract (it also honours `ETag` / `If-Match`
for safe concurrent writes). It also answers `DELETE`, which Options →
**Delete data** uses — that part is optional, only needed if you want to use
that button against your own endpoint.

## No server? Free alternatives

Self-hosting is the recommended way to use TabbySync — your data never
leaves a server you control. If that's not realistic for you, **Server &
sync → Sync method** offers two free, no-server backends instead:

- **GitHub Gist** — TabbySync creates a private ("secret") gist for you and
  stores each engine's file inside it. You just need a GitHub personal access
  token scoped to Gists — create one at
  [github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new)
  (fine-grained token, scoped to just "Gists: Read and write"), or a classic
  token with the `gist` scope.
- **JSONBin.io** — TabbySync creates a bin per engine for you. This one does
  require a free JSONBin.io account: sign up / log in at
  [jsonbin.io](https://jsonbin.io/login), then open **API Keys** from your
  account menu and create a key (the `X-Master-Key`) to paste into TabbySync.

Both are meaningfully **less private than self-hosting**: your data (or its
ciphertext, if you turn on encryption) sits on a third party's servers under
their access and retention policies, not yours. The Options page shows a
disclaimer for each. **If you use either one, turn on the encryption
passphrase above** so that third party only ever sees unreadable ciphertext.

## Encryption (optional, shared)

Options → **Server & sync** → **Encryption**. One passphrase encrypts **both**
tools with AES-256-GCM in your browser before anything is uploaded, so the
stored files are unreadable even to your host. The passphrase never leaves your
device — enter the same one on every computer. **If you forget it, the data
can't be recovered.**

## Deleting your synced data

Options → **Delete data**, at the very bottom of the page. Type `DELETE` to
unlock the buttons (a plain click does nothing on its own), then confirm —
each one still asks you to confirm again before it does anything. Per-provider
buttons remove that provider's remote file(s)/gist/bins and clear its saved
credentials here; the reset button additionally attempts this for every
provider you've ever configured and then wipes every TabbySync setting in this
browser back to a fresh install. None of this touches your actual bookmarks or
open tabs in this browser, or uninstalls the extension — only the remote data
and TabbySync's own local settings.

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
| `shared/providers.js` | Pluggable sync backends: self-hosted, GitHub Gist, JSONBin.io |
| `shared/status.js` | One combined toolbar badge |
| `shared/server-files.js` | Generates the `tabbysync.php` bundle |
| `bookmarks/` | Bookmark engine (`background-core.js` + `lib/`) |
| `tabs/` | Tab engine (`background-core.js`, `storage.js`, `tablist.*`) |

The two original extensions were kept as self-contained engines under
`bookmarks/` and `tabs/`; the shared layer gives them one config, one endpoint,
one token and one toolbar action.

## Icons & logo

The brand mark is a lock + sync-arrows glyph. The popup shows the full
wordmark logo in its top-left, swapped by the light/dark toggle (which remembers
your choice per device, else follows the system):

- `icons/logo-light.png` — wordmark for **light** backgrounds (dark text)
- `icons/logo-dark.png` — wordmark for **dark** backgrounds (light text)

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

## License

**TabbySync is source-available, not open source.**

Copyright © 2026 Ryan Gulliver. All rights reserved. See [LICENSE](LICENSE) for
the full terms.

The source is published so anyone can audit it — TabbySync handles your
bookmarks, your open tabs and your sync credentials, and you shouldn't have to
take my word for what it does with them. That's the point of publishing it. It
is not a grant to redistribute it.

**You may**, free of charge, for your own personal use:

- install and run the extension on as many of your own devices as you like
- run the generated `tabbysync.php` on your own server
- modify your own copy for yourself

**Anyone may read, study and audit the source**, for any purpose. That right
isn't limited — it's why the code is public.

**You may not** use it for any commercial purpose (including inside a company or
as part of your job), redistribute it (modified or not), publish it to the
Chrome Web Store or any other add-on marketplace, sell it, or offer it as a
hosted service.

Want to use it commercially? Ask — separate terms can be arranged.

TabbySync is free and always will be. If it's useful to you, a donation is
appreciated but never required — it buys no extra rights, and nothing in the
extension is gated behind one.

### Contributions

**Not accepted.** Pull requests will be closed without merging. Bug reports and
feature suggestions are very welcome — see [CONTRIBUTING.md](CONTRIBUTING.md)
for why, and for what to include in a report.
