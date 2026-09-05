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

Paste from `paste/02-short-description.txt` — 124 of the 132 characters allowed.

### Category

**Workflow & Planning.** (Second choice: Productivity.)

### Language

English (UK/US — the copy uses "colour"-free spellings throughout).

### Detailed description

**Paste from `paste/01-detailed-description.txt`.** It is not repeated here: two
copies of the same 3,500 words is two things to keep in step, and the paste file
is the one that has to be exactly right.

It runs to about 3,500 of the 16,000 characters allowed, uses emoji section
headers, and keeps paragraphs as single long lines so the store reflows them to
the page width instead of leaving them raggedly narrow.

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

Paste from `paste/03-single-purpose.txt`.

### Permission justifications

One box per permission in the dashboard, one file per box:

| Permission | File |
|---|---|
| `bookmarks` | `paste/04-permission-bookmarks.txt` |
| `tabs` | `paste/05-permission-tabs.txt` |
| `tabGroups` | `paste/06-permission-tabGroups.txt` |
| `storage` | `paste/07-permission-storage.txt` |
| `unlimitedStorage` | `paste/08-permission-unlimitedStorage.txt` |
| `contextMenus` | `paste/09-permission-contextMenus.txt` |
| `alarms` | `paste/10-permission-alarms.txt` |
| host permissions (optional) | `paste/11-permission-host.txt` |

Each one is a claim about the manifest — "no host access at install time", "no
content scripts", "tabs read only when you act". They were written by reading
the manifest and the source, and they are what a reviewer compares against it.
If the manifest ever changes, these change with it or the listing becomes a lie.

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

Paste from `paste/12-whats-new.txt`, which covers 1.3.9 through 1.3.12.

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
