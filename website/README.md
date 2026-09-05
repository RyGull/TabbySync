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
├── .htaccess            clean URLs, canonical host, 404, static-file headers
│                          — READ ITS HEADER BEFORE DEPLOYING (it forces HTTPS)
├── index.php            the whole landing page
├── privacy.php          /privacy — renders the canonical policy in site chrome
├── contact.php          /contact — the form, and its own POST handler
├── contact-send.php     legacy POST target, kept for pages cached long ago
├── 404.php              ErrorDocument 404, answers a real 404 status
├── sitemap.php          served as /sitemap.xml; <lastmod> from file mtimes
├── robots.txt           crawl rules + the Sitemap line (must match SITE_URL)
├── config.php            site-wide constants — SITE_URL, CURRENT_VERSION when
│                          you cut a release, CHROME_STORE_LIVE/_URL — plus the
│                          security headers, CSRF helpers and session setup
├── includes/
│   ├── header.php        <head>, all SEO metadata, JSON-LD, the nav
│   ├── footer.php
│   └── contact-handler.php
└── assets/
    ├── css/style.css     the entire design system, no framework
    ├── js/main.js        theme toggle, mobile nav, scroll-reveal — no deps
    └── img/               logo/icon assets, the og:image card, screenshots
```

## Before the first deploy

Two things in `.htaccess` assume facts about the host, and both are called out
at the top of that file:

1. **HTTPS is forced,** and `Strict-Transport-Security` (sent by
   `config.php`) tells browsers to remember that for a year. On a host without
   a working certificate, comment the redirect out until there is one.
2. **The host name** in the `www` → apex redirect must match `SITE_URL` in
   `config.php`. Change both together, or search engines and the canonical
   links will disagree about what this site is called.

On **nginx** the `.htaccess` does nothing; the equivalents are
`try_files $uri $uri.php $uri/ =404;`, `error_page 404 /404.php;`, a
`location = /sitemap.xml { rewrite ^ /sitemap.php last; }`, and the
`add_header` lines for static files. The security headers on the pages
themselves need no translation — PHP sends those.

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
- **Every page is built to be found, and says so exactly once.** The shared
  header emits a canonical link, a per-page title and description, Open
  Graph + Twitter card tags, and JSON-LD describing the site, its author and
  the extension. The canonical link drops the query string, so the
  `?status=…` URLs the contact form redirects through don't compete with
  `/contact` for the same page — those variants are `noindex` on top of it.
  The structured data deliberately carries **no rating and no install count**:
  numbers nothing on this site can substantiate are how a site gets its
  structured data distrusted wholesale.
- **The social card is a real 1200x630 image** (`assets/img/og-image.png`),
  generated from the extension's own popup by `scripts/screenshots.mjs` in
  the extension repository. Before it existed, `og:image` pointed at the
  256px app icon, which every link preview letterboxes into a grey square.
- **The 404 page answers 404.** An error page that returns `200` is a "soft
  404" — search engines index it, keep crawling it, and treat every broken
  link as a real page. It is also the one page with no canonical link, since
  the URL it is answering for isn't a page.
- **Security headers come from PHP, not from `.htaccess`.** `config.php`'s
  `send_security_headers()` sends them, so they apply on any host, Apache or
  not; `.htaccess` sets headers only for the static files PHP never sees, and
  the two lists deliberately don't overlap. A header set in both places is how
  a site ends up serving two different policies and enforcing the intersection.
- **The Content-Security-Policy allows no inline anything.** `default-src
  'self'` with no `'unsafe-inline'`, no `'unsafe-eval'`, and nothing loadable,
  framable, submittable or connectable off-origin. The site can afford that
  policy because every script and stylesheet is a file of its own — and a test
  in the extension repository (`test/website.test.js`) fails if a single inline
  `<script>`, `<style>` or `style=""` attribute ever appears, because that is
  the change that would silently break every page in every browser.
- **The contact form carries a CSRF token.** Without one, any page anywhere
  could POST to it in a visitor's name and fill the mailbox with messages
  nobody wrote — the honeypot and the rate limit don't cover that, since a
  cross-site submission is otherwise well formed. The session cookie is
  `HttpOnly`, `SameSite=Lax` and `Secure` over HTTPS, which stops the same
  attack a layer earlier in any recent browser. A token that has expired
  hands the visitor their own text back rather than losing it.
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
which checks the CSRF token, validates, rate-limits per session, and sends with
PHP's `mail()`. There is no reCAPTCHA and no third-party request of any kind —
the spam defence is a CSRF token, a hidden honeypot field and the rate limit.
`contact-send.php` is a shim for pages cached from before the form posted to
itself; it does the same thing, except that a page cached from before the token
existed now comes back as "expired" and is re-sent from a current form.

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
