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
- **The Chrome Web Store listing is the primary call-to-action.**
  `CHROME_STORE_LIVE` is `true` and `CHROME_STORE_URL` holds the listing URL in
  `config.php`; the hero button, the install section, the "How it works" first
  step and the footer all read from those two constants. If the listing is ever
  pulled or suspended, flipping `CHROME_STORE_LIVE` back to `false` returns the
  whole site to the "load unpacked from GitHub" path with no other edits.
- **The screenshots are generated, not hand-made.**
  `assets/img/screenshots/` is a copy of `docs/screenshots/web/` in the
  extension repository, produced by `scripts/screenshots.mjs` from the real
  extension UI. Each shot ships a light and a dark file, swapped by the same
  `data-theme` rules the logo uses, so the pictures match the theme the visitor
  is reading in. Re-run that script and re-copy the folder after any UI change —
  nothing here regenerates them for you.
- **The privacy policy isn't duplicated here.** `/privacy` (privacy.php)
  *reads* `website/privacy.html` and renders it inside the site chrome,
  rather than restating it in PHP. That file is generated from the canonical
  `privacy.html` by `scripts/build-pages.sh`, and a test fails if the two
  drift, so uploading a deploy that predates a policy change is caught in CI
  rather than on the live site. Only the short "This website" section at the
  top of `/privacy` is written here, because the contact form and the host's
  access log are the site's business and the extension's policy should not
  claim to cover them. The footer also links to the policy published at
  `https://rygull.github.io/TabbySync/privacy.html` (GitHub Pages, served
  from `docs/` in the extension repository). That page is generated from the
  canonical `privacy.html` by `scripts/build-pages.sh`, and a test fails if
  the two drift apart — so there is still exactly one copy to keep accurate,
  the one that `test/privacy-policy.test.js` checks against the code on every
  push. Duplicating it here would just be a third copy that could drift.
  (It used to link at `/blob/main/privacy.html`, which shows the file as
  escaped HTML source rather than rendering it.)

## The contact form

`/contact` posts to itself and hands off to `includes/contact-handler.php`,
which validates, rate-limits per session, and sends with PHP's `mail()`. There
is no reCAPTCHA and no third-party request of any kind — the spam defence is a
hidden honeypot field plus the rate limit. `contact-send.php` is a shim for
pages cached from before the form posted to itself; it does the same thing.

Two things it depends on that are easy to get wrong on a new host:

- **`.htaccess` must be in place**, because `CONTACT_PATH` is `/contact`
  (extensionless). Without the rewrite, change `CONTACT_PATH` and
  `PRIVACY_PATH` in `config.php` to `/contact.php` and `/privacy.php`.
- **`mail()` must actually deliver.** On cPanel it normally does, but set up
  SPF and DKIM for the domain or messages will land in spam. `From:` is the
  site's own address and the visitor goes in `Reply-To:`, which is what most
  hosts require; putting the visitor's address in `From:` is what usually
  gets contact forms silently dropped.

If a submission ever comes back saying the data went missing, the `why=`
detail on the URL distinguishes a redirect in front of the form (`method`)
from a proxy stripping the body (`empty`).

## Updating it

`CURRENT_VERSION` in `config.php` is the only place the extension's version
number is duplicated (the footer shows it). Nothing here reads
`manifest.json` automatically — this is a static PHP site with no build
step, so keeping that one constant in sync is a manual, five-second step
each release.
