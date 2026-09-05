// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// website.test.js — holds the marketing site's SEO and security claims to
// account, the same way privacy-policy.test.js holds the privacy policy to the
// extension's actual code.
//
// Everything here is a claim that is easy to make once and lose quietly later:
// a canonical link that stops matching the domain, a Content-Security-Policy
// that a single inline <script> would silently break, a sitemap that lists a
// URL nobody serves. None of it can be checked by reading the page in a
// browser after the fact — by then it has already been wrong for a while.
//
// These are static checks on the source. They cannot verify what a deployed
// host actually sends; the .htaccess notes cover the parts only a deploy can
// get right.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');

const config = read('website/config.php');
const header = read('website/includes/header.php');
const htaccess = read('website/.htaccess');
const robots = read('website/robots.txt');

const SITE_URL = config.match(/const SITE_URL\s*=\s*'([^']+)'/)?.[1];

/** Every file the marketing site is made of, by extension. */
function siteFiles(exts) {
  const out = [];
  (function walk(dir) {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (exts.some((e) => name.endsWith(e))) {
        out.push(full);
      }
    }
  })(join(root, 'website'));
  return out;
}

// ---------------------------------------------------------------------------
// One origin, spelled the same way everywhere
// ---------------------------------------------------------------------------

test('SITE_URL is an absolute https origin with no trailing slash', () => {
  assert.ok(SITE_URL, 'SITE_URL not found in website/config.php');
  assert.match(SITE_URL, /^https:\/\/[a-z0-9.-]+$/,
    'SITE_URL must be an https origin — canonical links and og:url are built from it');
  assert.doesNotMatch(SITE_URL, /\/$/,
    'SITE_URL must not end in a slash; abs_url() adds one');
});

test('robots.txt points at a sitemap on this site', () => {
  const sitemap = robots.match(/^Sitemap:\s*(\S+)$/m)?.[1];
  assert.ok(sitemap, 'robots.txt has no Sitemap line');
  assert.equal(sitemap, SITE_URL + '/sitemap.xml',
    'the Sitemap line and SITE_URL disagree — one of them is pointing at a domain that is not this site');
});

test('the sitemap lists exactly the indexable pages, and nothing else', () => {
  const sitemap = read('website/sitemap.php');
  // The generator names paths by constant, so compare against the constants.
  assert.match(sitemap, /\['\/',\s*'index\.php'/, 'the home page is missing from the sitemap');
  assert.match(sitemap, /PRIVACY_PATH,\s*'privacy\.html'/, '/privacy is missing from the sitemap');
  assert.match(sitemap, /CONTACT_PATH,\s*'contact\.php'/, '/contact is missing from the sitemap');
  const listed = [...sitemap.matchAll(/^\s*\[(.+?),\s*'[^']+',\s*'[\d.]+'\],?$/gm)].map((m) => m[1]);
  assert.equal(listed.length, 3, 'the sitemap lists something other than the three real pages');
  assert.ok(!listed.some((l) => /404/.test(l)), 'the 404 page must never be in the sitemap');
  assert.match(sitemap, /X-Robots-Tag:\s*noindex/, 'the sitemap itself should not be indexed as a page');
});

// ---------------------------------------------------------------------------
// Metadata every page carries
// ---------------------------------------------------------------------------

test('the shared header emits the metadata a search result and a link preview need', () => {
  const required = [
    ['<title>', 'a title'],
    ['name="description"', 'a meta description'],
    ['rel="canonical"', 'a canonical link'],
    ['name="robots"', 'a robots directive'],
    ['property="og:title"', 'an Open Graph title'],
    ['property="og:description"', 'an Open Graph description'],
    ['property="og:url"', 'an Open Graph URL'],
    ['property="og:image"', 'an Open Graph image'],
    ['property="og:image:width"', 'Open Graph image dimensions'],
    ['name="twitter:card"', 'a Twitter card type'],
    ['application/ld+json', 'structured data'],
  ];
  for (const [needle, what] of required) {
    assert.ok(header.includes(needle), `the site header is missing ${what} (${needle})`);
  }
});

test('every page sets its own title and description', () => {
  for (const page of ['website/index.php', 'website/privacy.php', 'website/contact.php', 'website/404.php']) {
    const src = read(page);
    assert.match(src, /\$page_title\s*=/, `${page} does not set $page_title`);
    assert.match(src, /\$page_description\s*=/, `${page} does not set $page_description`);
  }
});

test('the 404 page answers 404 and asks not to be indexed', () => {
  const src = read('website/404.php');
  assert.match(src, /http_response_code\(404\)/,
    'a 404 page that answers 200 is a soft 404 — search engines index it and keep crawling it');
  assert.match(src, /\$page_noindex\s*=\s*true/, 'the 404 page must be noindex');
  assert.match(src, /\$page_canonical\s*=\s*''/,
    'the 404 page must not claim a canonical URL of its own');
  assert.match(htaccess, /ErrorDocument\s+404\s+\/404\.php/, 'nothing points Apache at the 404 page');
});

test('the structured data claims nothing that cannot be checked', () => {
  // An invented rating or install count is the fastest way to have a site's
  // structured data distrusted wholesale, and this project's whole pitch is
  // that its claims are verifiable.
  for (const banned of ['aggregateRating', 'ratingValue', 'reviewCount', 'interactionCount']) {
    assert.ok(!header.includes(banned),
      `the structured data contains ${banned}, which nothing on this site can substantiate`);
  }
});

// ---------------------------------------------------------------------------
// The Content-Security-Policy has to stay deservable
// ---------------------------------------------------------------------------

test('the security headers cover the things a static site can actually be attacked through', () => {
  const required = [
    'Content-Security-Policy',
    'X-Content-Type-Options',
    'Referrer-Policy',
    'Permissions-Policy',
    'X-Frame-Options',
    'Cross-Origin-Opener-Policy',
    'Strict-Transport-Security',
  ];
  for (const h of required) {
    assert.ok(config.includes(h), `send_security_headers() no longer sends ${h}`);
  }
  assert.match(config, /header_remove\('X-Powered-By'\)/,
    'the PHP version is being advertised in every response header');
});

test('the CSP allows no inline code and no third-party origin', () => {
  // From the header() call itself — the docblock above it discusses
  // 'unsafe-inline' in prose, and a test that reads prose proves nothing.
  const call = config.match(/header\("Content-Security-Policy: "([\s\S]*?)\);/);
  assert.ok(call, 'no Content-Security-Policy header() call found in config.php');
  const csp = call[1];
  for (const forbidden of ["'unsafe-inline'", "'unsafe-eval'", 'http:', 'https:', '*']) {
    assert.ok(!csp.includes(forbidden),
      `the CSP contains ${forbidden}, which gives away most of what it was protecting`);
  }
  for (const directive of ['default-src', 'base-uri', 'form-action', 'frame-ancestors', 'object-src', 'script-src', 'style-src']) {
    assert.ok(csp.includes(directive), `the CSP no longer sets ${directive}`);
  }
});

test('no page contains inline script or style, which that CSP would block', () => {
  // This is the test that keeps the policy above honest: the day someone adds
  // a one-line inline <script> "just for this", the page silently stops
  // working in every browser rather than in the one they tested in.
  for (const file of siteFiles(['.php', '.html'])) {
    const rel = file.slice(root.length);
    // Only the markup a request actually receives: strip every PHP block, so
    // a docblock that *mentions* an inline <script> isn't mistaken for one.
    const src = readFileSync(file, 'utf8')
      .replace(/<\?php[\s\S]*?(\?>|$)/g, '')
      .replace(/<\?=[\s\S]*?\?>/g, '');

    // privacy.html is the extension's own page, read as data by privacy.php
    // and never served — only the body between the "Last updated" line and
    // the footer is rendered, which is why its own <style>/<script> tags are
    // not a problem. .htaccess denies it to the outside world.
    if (rel.endsWith('website/privacy.html')) continue;

    const inlineScript = /<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>/i;
    assert.ok(!inlineScript.test(src), `${rel} has an inline <script>; the CSP blocks it`);
    assert.ok(!/<style[\s>]/i.test(src), `${rel} has an inline <style>; the CSP blocks it`);
    assert.ok(!/\sstyle="/i.test(src), `${rel} has a style="" attribute; the CSP blocks it`);
    assert.ok(!/\son[a-z]+="/i.test(src.replace(/\son[a-z]+="[^"]*"/g, (m) =>
      // aria-* and data-* are not event handlers; neither is anything that is
      // not literally on<event>=.
      /^\s(on(click|load|error|submit|change|input|focus|blur|mouseover|keydown|keyup))=/i.test(m) ? m : '')),
      `${rel} has an inline event handler attribute; the CSP blocks it`);
  }
});

// ---------------------------------------------------------------------------
// The bits only the server can enforce
// ---------------------------------------------------------------------------

test('.htaccess keeps the non-pages out of reach', () => {
  assert.match(htaccess, /Options\s+-Indexes/, 'directory listing is not disabled');
  assert.match(htaccess, /<Files "privacy\.html">[\s\S]*?Require all denied/,
    'privacy.html is servable, which puts an unstyled duplicate of the policy in the index');
  assert.match(htaccess, /RewriteRule \^includes\/ - \[F,L\]/, 'the includes/ directory is reachable');
  assert.match(robots, /Disallow: \/includes\//, 'robots.txt does not disallow /includes/');
  assert.match(robots, /Disallow: \/privacy\.html/, 'robots.txt does not disallow the raw policy file');
});

test('.htaccess and PHP do not both set the same security header', () => {
  // Two sources for one header is how a site ends up serving two different
  // policies and enforcing whatever the intersection happens to be.
  for (const h of ['Content-Security-Policy', 'Strict-Transport-Security', 'X-Frame-Options', 'Permissions-Policy']) {
    assert.ok(!new RegExp(`Header[^\\n]*\\b${h}\\b`).test(htaccess),
      `${h} is set in .htaccess as well as in send_security_headers()`);
  }
});

// ---------------------------------------------------------------------------
// The contact form
// ---------------------------------------------------------------------------

test('the contact form is CSRF-protected end to end', () => {
  assert.match(read('website/contact.php'), /csrf_field\(\)/, 'the form does not carry a CSRF token');
  assert.match(read('website/includes/contact-handler.php'), /csrf_valid\(/,
    'the handler does not check the CSRF token — any site could post mail in a visitor\'s name');
  assert.match(config, /hash_equals\(/, 'the token comparison is not constant-time');
  assert.match(config, /'samesite'\s*=>\s*'Lax'/, 'the session cookie is not SameSite');
  assert.match(config, /'httponly'\s*=>\s*true/, 'the session cookie is readable by script');
});

test('the social card the metadata points at actually exists', () => {
  assert.ok(existsSync(join(root, 'website/assets/img/og-image.png')),
    'og:image points at /assets/img/og-image.png — run `npm run screenshots` to generate it');
});
