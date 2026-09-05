# Chrome Web Store listing — TabbySync 1.3.12

Everything the dashboard asks for, written out so it can be pasted in rather
than composed under time pressure at 1am. Each heading below is a field in the
developer dashboard.

Every claim here is one the code actually supports — the permission
justifications in particular are what a reviewer checks against the manifest,
and an inflated one is how a submission gets rejected or, worse, taken down
later.

---

## Store listing

### Name (45 characters max)

```
TabbySync
```

### Short description (132 characters max)

```
Sync bookmarks and tabs to a server you control — your own site, a private GitHub Gist, or JSONBin. No account, no tracking.
```

(124 characters.)

### Category

**Workflow & Planning.** (Second choice: Productivity.)

### Language

English (UK/US — the copy uses "colour"-free spellings throughout).

### Detailed description

```
TabbySync keeps your bookmarks and your open tabs in step across your
computers — and sends them only where you tell it to.

Most sync tools ask you to trust a company with your browsing. TabbySync
has no account, no analytics, and no server of its own. You choose the
destination, and your data goes there and nowhere else.

WHERE YOUR DATA GOES — YOU PICK

• Your own website — upload one small PHP file to your web space.
  TabbySync writes the file for you, with an access code already inside.
  Nobody but you can read your data. This is the recommended setup.
• Your GitHub account — free, no server needed. TabbySync creates a
  private gist and keeps the file there.
• A free storage service (JSONBin.io) — quickest to set up, no account
  with us and no server of yours.

Turn on the password lock and your data is encrypted with AES-256-GCM on
your computer before it is sent, so whoever stores it only ever holds
text they cannot read. The password never leaves your device.

TWO TOOLS, ONE SETUP

• Bookmarks — keeps your whole bookmark tree the same everywhere.
  Changes made on two computers are merged, not overwritten, by a
  three-way merge with a test suite written specifically to catch silent
  data loss.
• Tabs — closes the tabs you are done with and saves them as a named
  list, freeing the memory they were holding. Reopen one link, one list,
  or everything, on any of your computers, as ordinary tabs or as a
  browser tab group.

Use one, use both, or turn either off. They share one destination, one
access code and one name.

BUILT TO BE CHECKED, NOT TRUSTED

• No analytics, no telemetry, no usage tracking of any kind.
• No history, webRequest or cookies permission — it cannot read your
  browsing.
• Contacts no server operated by the developer, ever.
• Requests access to your sync destination one address at a time, when
  you set it up — never a wildcard, and nothing at install time.
• The source is published so it can be audited rather than taken on
  faith: github.com/RyGull/TabbySync

SENSIBLE ABOUT YOUR DATA

• A sync that would delete most of the bookmarks in your browser stops
  and asks you first, rather than doing it and syncing the result.
• Reopening a large list asks before it opens hundreds of tabs, and
  opens them in batches you can stop.
• Deleted tab lists wait 30 days in "Recently deleted" and sync there
  too.
• Backups you can save to your own computer, plain or password-locked.

Free, and free of any of the usual reasons software is free.
```

### Screenshots

Five, in this order, all 1280×800 PNG (in `screenshots/`):

| # | File | Shows |
|---|------|-------|
| 1 | `01-popup.png` | The popup: both tools, their status, one click to save tabs |
| 2 | `02-tab-list.png` | The saved-tabs page: named lists, search, reopen |
| 3 | `03-setup.png` | Settings: the three destinations and the setup it needs |
| 4 | `04-per-tool-options.png` | Bookmarks and Tabs settings, each behind "More options" |
| 5 | `05-popup-dark.png` | The popup in dark mode |

### Promo tiles

* **Small (440×280)** — `promo/small-tile-440x280.png`. Optional but shown
  beside the listing in search results; worth having.
* **Marquee (1400×560)** — `promo/marquee-1400x560.png`. Only used if the
  store features the extension. Harmless to supply.

### Store icon

Already inside the upload zip (`icons/icon-128.png`), referenced by the
manifest. The dashboard picks it up automatically.

### Support and homepage URLs

* Homepage: `https://tabbysync.com`
* Support: `https://github.com/RyGull/TabbySync/issues`
* Privacy policy: `https://rygull.github.io/TabbySync/privacy.html`

---

## Privacy practices tab

This is the part reviewers read most closely. Every answer below is checked
against the manifest and the source.

### Single purpose description

```
TabbySync synchronises the user's bookmarks and saved tab lists between
their own computers, via a storage destination the user chooses and
controls. Everything in the extension serves that one purpose: reading and
writing the browser's bookmarks and tabs, and sending them to (and fetching
them from) that destination.
```

### Permission justifications

**bookmarks**
```
Reads and writes the user's bookmarks. This is the data one half of the
extension synchronises: it reads the bookmark tree to send it to the
user's chosen destination, and applies incoming changes from their other
computers.
```

**tabs**
```
Reads the URL and title of open tabs when the user chooses to save them
to a list, and opens tabs again when the user reopens a saved list. Tabs
are only read at the moment the user acts — the extension never listens
for navigation and has no content scripts.
```

**tabGroups**
```
Optional feature: when reopening a saved list, the user can have it
restored as a native browser tab group rather than as loose tabs. Used
only to create and name that group.
```

**storage / unlimitedStorage**
```
Stores the user's settings, their saved tab lists, and the cached copy of
the bookmark tree that the merge compares against, in chrome.storage.local
on the device. unlimitedStorage is needed because a large bookmark
collection or a long list of saved tabs can exceed the default quota.
```

**contextMenus**
```
Adds right-click entries on the toolbar icon for saving tabs — this tab,
the others, or the ones to the left or right of it.
```

**alarms**
```
Schedules the periodic background sync at the interval the user sets in
settings. Required because a Manifest V3 service worker cannot hold a
timer of its own.
```

**Host permissions (optional, requested at runtime)**
```
The extension requests no host access at install time. When the user
saves a sync destination, it asks for access to that one address —
their own server, api.github.com, or api.jsonbin.io — through the
browser's own permission prompt, which names the site. It is declared
under optional_host_permissions and is limited to https:// (plus
http://localhost for local testing), because the access code travels
with every request.
```

### Remote code

**No.** The extension executes no remote code. Every script it runs is in the
package. There is no `eval`, no remote `<script>` tag, and no code fetched at
runtime — a test in the repository fails the build if any extension page ever
loads a remote script, stylesheet, image or frame.

### Data usage disclosures

Tick these, and nothing else:

| Data type | Collected? | Why |
|---|---|---|
| Personally identifiable information | **No** | |
| Health information | **No** | |
| Financial and payment information | **No** | |
| Authentication information | **No** — see note | The user's own access code/token is stored locally and sent only to the destination they configured. It is never sent to the developer or any third party, and never leaves the device except to the user's own chosen endpoint. |
| Personal communications | **No** | |
| Location | **No** | |
| Web history | **No** | The extension has no `history` permission and never reads browsing history. Bookmarks and saved tab lists are user-created data the user is explicitly syncing, not observed browsing. |
| User activity | **No** | No analytics, telemetry, clicks, or usage monitoring of any kind. |
| Website content | **No** | No content scripts; page content is never read. |

Then certify all three:

* ✅ I do not sell or transfer user data to third parties outside of the
  approved use cases.
* ✅ I do not use or transfer user data for purposes unrelated to my item's
  single purpose.
* ✅ I do not use or transfer user data to determine creditworthiness or for
  lending purposes.

> If a reviewer questions the "Authentication information" answer: nothing is
> collected by the developer. The token is the user's own credential for the
> user's own destination, held in `chrome.storage.local` and attached to
> requests to that destination only. There is no developer-operated endpoint
> anywhere in the codebase, and a test asserts that.

---

## What's new in this version

```
1.3.12 — Reopening a large list of saved tabs now asks first and opens
them in batches you can stop, instead of opening hundreds at once.

1.3.11 — A sync that would delete most of the bookmarks in your browser
now stops and asks which copy is right, instead of applying it.

1.3.10 — Fixes data loss: changing sync method, server address or sync
name could delete the bookmarks in your browser on the next sync. If this
happened to you, your data is almost certainly still on the destination
you started with — set it back and sync.

1.3.9 — Settings rebuilt around four questions instead of forty controls,
with step-by-step guides for GitHub and JSONBin. The popup and the
saved-tabs page now use the same plain wording.
```

---

## Before you hit submit

1. Upload `extension/tabbysync-1.3.12.zip`. Confirm the dashboard shows
   version **1.3.12**.
2. Replace the existing screenshots — the current listing still shows the
   pre-1.3.9 settings page.
3. Paste the description above; it describes the new setup flow, which the
   live listing text does not.
4. Check the privacy policy URL still resolves:
   `https://rygull.github.io/TabbySync/privacy.html`
5. Expect a review delay when permission justifications change. Nothing in
   the manifest changed in this release, which usually keeps it short.
