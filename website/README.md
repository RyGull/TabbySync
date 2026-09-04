# TabbySync marketing site

The public-facing landing page for TabbySync — **not** part of the browser
extension. This is a separate PHP deployable meant for a web host (the same
one you might run `tabbysync.php` on, or a different one entirely). Nothing
here is loaded by the extension, and nothing in the extension loads this.

## Requirements

Plain PHP 7.4+ with no extensions beyond the defaults. No Composer, no
database, no build step.

## Deploy

Upload the contents of this `website/` folder to your web root (or a
subfolder — every link is root-relative, so a subfolder needs either its own
vhost or the links adjusted). Keep it in a **different** directory from your
self-hosted `tabbysync.php` endpoint; there's no reason for the two to share
a folder, and keeping them apart avoids any risk of one's `.htaccess`
(if you add one) fighting the other's.

```
website/
├── index.php            the whole page
├── config.php            site-wide constants — edit CURRENT_VERSION here
│                          when you cut a release, and CHROME_STORE_LIVE +
│                          CHROME_STORE_URL the day it's actually published
├── includes/
│   ├── header.php
│   └── footer.php
└── assets/
    ├── css/style.css     the entire design system, no framework
    ├── js/main.js        theme toggle, mobile nav, scroll-reveal — no deps
    └── img/               real logo/icon assets, copied from ../icons
```

## Design choices worth knowing about

- **No third-party requests.** No Google Fonts, no icon CDN, no analytics,
  no tracking pixel — system fonts and hand-drawn inline SVG only. A site
  advertising a "no tracking" extension making third-party requests of its
  own would be a bit rich; this one makes none.
- **The contact address is never written out as a literal string.**
  `config.php`'s `contact_address()` builds it from parts, and
  `echo_obfuscated()` renders it as HTML numeric character references
  (`&#106;&#111;…`) rather than plain text. This is friction against
  regex-scraping harvesters, not real protection — anyone reading this file
  can reconstruct the address in seconds. Point it at a forwarding alias you
  can rotate if it starts attracting spam, not a real mailbox.
- **Content is visible without JavaScript.** The scroll-reveal animation
  (`assets/js/main.js`) only *hides* an element if JS successfully runs and
  confirms the element isn't already on screen — nothing in the CSS hides
  content unconditionally. A visitor with JavaScript blocked sees the full
  page, just without the fade-in.
- **No Chrome Web Store link yet**, because there isn't a listing yet. The
  primary call-to-action points at the GitHub source and the "Load unpacked"
  instructions instead of a link that would otherwise go nowhere. Flip
  `CHROME_STORE_LIVE` to `true` and set `CHROME_STORE_URL` in `config.php`
  once that listing exists.
- **The privacy policy isn't duplicated here.** The footer and the privacy
  section both link to the policy published at
  `https://rygull.github.io/TabbySync/privacy.html` (GitHub Pages, served
  from `docs/` in the extension repository). That page is generated from the
  canonical `privacy.html` by `scripts/build-pages.sh`, and a test fails if
  the two drift apart — so there is still exactly one copy to keep accurate,
  the one that `test/privacy-policy.test.js` checks against the code on every
  push. Duplicating it here would just be a third copy that could drift.
  (It used to link at `/blob/main/privacy.html`, which shows the file as
  escaped HTML source rather than rendering it.)

## Updating it

`CURRENT_VERSION` in `config.php` is the only place the extension's version
number is duplicated (the footer shows it). Nothing here reads
`manifest.json` automatically — this is a static PHP site with no build
step, so keeping that one constant in sync is a manual, five-second step
each release.
