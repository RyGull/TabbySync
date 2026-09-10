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
import { execFileSync } from 'node:child_process';
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

test('the CSP allows no inline code, and only the two documented Google origins', () => {
  // From the header() call itself — the docblock above it discusses
  // 'unsafe-inline' in prose, and a test that reads prose proves nothing.
  const call = config.match(/header\("Content-Security-Policy: "([\s\S]*?)\);/);
  assert.ok(call, 'no Content-Security-Policy header() call found in config.php');
  // Strip the PHP comments interleaved between the concatenated parts — one
  // of them explains why 'unsafe-inline' is not there, and a test that reads
  // an explanation as if it were policy is worse than no test.
  const csp = call[1].replace(/^\s*\/\/.*$/gm, '');

  for (const forbidden of ["'unsafe-inline'", "'unsafe-eval'", "http:", "'self' *", 'https:;', "https: "]) {
    assert.ok(!csp.includes(forbidden),
      `the CSP contains ${forbidden}, which gives away most of what it was protecting`);
  }
  for (const directive of ['default-src', 'base-uri', 'form-action', 'frame-ancestors', 'object-src', 'script-src', 'style-src', 'frame-src']) {
    assert.ok(csp.includes(directive), `the CSP no longer sets ${directive}`);
  }

  // Every off-origin host the policy names, anywhere in it. reCAPTCHA needs
  // exactly two; anything else appearing here is a third party nobody
  // decided to add on purpose.
  const hosts = [...csp.matchAll(/https:\/\/([a-z0-9.-]+)/g)].map((m) => m[1]);
  const allowed = new Set(['www.google.com', 'www.gstatic.com']);
  for (const host of hosts) {
    assert.ok(allowed.has(host), `the CSP allows ${host}, which is not one of the reCAPTCHA origins`);
  }

  // Those origins are gated behind the flag, so they apply on /contact only.
  assert.match(config, /function send_security_headers\(bool \$recaptcha = false\)/,
    'the reCAPTCHA CSP exception is no longer opt-in per page');
  assert.match(config, /\$g = \$recaptcha \?/,
    'the Google origins are no longer conditional on the reCAPTCHA flag');
});

// ---------------------------------------------------------------------------
// reCAPTCHA: the keys, and the promises the pages make about it
// ---------------------------------------------------------------------------

test('no reCAPTCHA key is committed anywhere in the repository', () => {
  // The one rule that matters here. A key in a public commit is public
  // permanently: deleting it later leaves it in the history, in every clone
  // and in every fork. Site keys are public by design and secret keys are
  // not, but neither belongs in a commit, so this looks for the shape of
  // both.
  const keyShaped = /6L[A-Za-z0-9_-]{20,}/;

  // Files git actually tracks — not the working directory. A real deployment
  // has config.local.php sitting right there with both keys in it, and that
  // is the whole point: what matters is whether git can see it.
  //
  // Lockfiles (package-lock.json) are excluded on purpose: they're packed
  // with hundreds of long, random-looking sha512 integrity hashes, and it
  // takes only one of those to happen to contain the letters this regex
  // looks for, followed by 20+ base64 characters, for this check to misfire
  // on a file nobody hand-edits and no key would ever meaningfully end up
  // in. Confirmed false positive, not a loosened check — verified by hand
  // against control-panel/package-lock.json's actual integrity hashes; not
  // quoted here, since doing so would itself match this very regex.
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter((f) => f && /\.(php|js|html|css|txt|md|json|yml|sh|mjs)$/.test(f))
    .filter((f) => !/(^|\/)package-lock\.json$/.test(f));
  assert.ok(tracked.length > 20, 'the tracked-file listing came back suspiciously short');

  for (const file of tracked) {
    assert.ok(!keyShaped.test(read(file)),
      `${file} is tracked by git and contains something shaped like a reCAPTCHA key`);
  }
});

test('the local key file is git-ignored and has a committed template', () => {
  const ignore = read('.gitignore');
  assert.match(ignore, /^website\/config\.local\.php$/m,
    'website/config.local.php is not git-ignored — the keys would be committed');
  assert.ok(existsSync(join(root, 'website/config.local.example.php')),
    'there is no template to copy from, so the key file has to be invented from scratch on the server');
  const example = read('website/config.local.example.php');
  assert.match(example, /'recaptcha_site_key'\s*=>\s*''/, 'the template ships a non-empty site key');
  assert.match(example, /'recaptcha_secret_key'\s*=>\s*''/, 'the template ships a non-empty secret key');
});

test('the site works with no keys configured', () => {
  // A fork, a fresh clone, or a deploy done before the keys are in place must
  // not 500 and must not quietly accept unverified mail while implying it
  // checked something.
  assert.match(config, /is_readable\(\$site_local\) \? \(array\) \(require \$site_local\) : \[\]/,
    'a missing config.local.php is no longer handled');
  assert.match(config, /function recaptcha_enabled\(\): bool/, 'nothing tells the pages whether reCAPTCHA is configured');
  assert.match(read('website/includes/contact-handler.php'), /if \(recaptcha_enabled\(\)\) \{/,
    'the handler runs the reCAPTCHA branch unconditionally');
  assert.match(read('website/contact.php'), /\$page_recaptcha = recaptcha_enabled\(\)/,
    'the contact page loads Google unconditionally');
});

test('the secret key is never exposed to the browser', () => {
  const contact = read('website/contact.php');
  assert.ok(!contact.includes('RECAPTCHA_SECRET_KEY'),
    'the contact page references the secret key — it must never reach the HTML');
  assert.ok(!read('website/assets/js/recaptcha.js').includes('RECAPTCHA'),
    'the client script names a key constant; it reads the site key from a data- attribute instead');
  assert.match(config, /'secret'\s*=>\s*RECAPTCHA_SECRET_KEY/,
    'the secret key is not being sent to the verification endpoint');
});

test('reCAPTCHA is disclosed where a visitor can actually see it', () => {
  // Google's terms require the badge or this notice; more to the point, a
  // site whose whole pitch is "no third-party requests" owes the exception a
  // plain statement on the page that makes it, not a line in a policy.
  const contact = read('website/contact.php');
  assert.match(contact, /policies\.google\.com\/privacy/, 'the contact page does not link Google\'s privacy policy');
  assert.match(contact, /policies\.google\.com\/terms/, 'the contact page does not link Google\'s terms');
  assert.match(read('website/privacy.php'), /reCAPTCHA/,
    'the privacy page does not mention reCAPTCHA at all');
  assert.match(read('website/assets/css/style.css'), /\.grecaptcha-badge \{ visibility: hidden; \}/,
    'the badge is visible, in which case the standalone notice is redundant — or it is hidden with no notice, which the terms do not allow');
});

test('a submission with no token is rejected rather than silently accepted', () => {
  const handler = read('website/includes/contact-handler.php');
  assert.match(handler, /if \(\$token === ''\) \{[\s\S]*?'status' => 'nojs'/,
    'a submission with no reCAPTCHA token is not rejected');
  assert.match(handler, /'status' => 'spam'/, 'a low-scoring submission is not rejected');
  assert.match(handler, /if \(!\$check\['reachable'\]\)/,
    'an unreachable Google would lose real messages instead of letting them through');
  // Both rejections have to hand the text back; losing a long message to a
  // spam check is its own kind of failure.
  assert.equal((handler.match(/\$_SESSION\['contact_old'\] = \$keep;/g) || []).length, 2,
    'one of the reCAPTCHA rejections drops what the visitor typed');
  const contact = read('website/contact.php');
  for (const status of ['nojs', 'spam']) {
    assert.ok(contact.includes(`$status === '${status}'`), `/contact has no message for the ${status} outcome`);
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
      .replace(/<\?=[\s\S]*?\?>/g, '')
      // A comment explaining that Google injects a <style> element is not a
      // <style> element, and nothing inside a comment runs.
      .replace(/<!--[\s\S]*?-->/g, '');

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

// ---------------------------------------------------------------------------
// The download row: three real links, one of them highlighted
// ---------------------------------------------------------------------------
//
// The page ships a card per target — Chromium, Firefox, Windows — and main.js
// only *promotes* whichever matches the visitor. That split is the thing worth
// pinning: the moment the script starts rewriting hrefs or hiding cards again,
// a visitor with JavaScript off, or one whose user agent is spoofed (which is
// free to do), loses options that were correct for them.
//
// Every Chromium browser says "Chrome" in its user agent, so the order of the
// checks in detectBrowser() is the entire mechanism. This runs the real
// function out of main.js against real user agent strings rather than reading
// the source and hoping.

const cta = read('website/assets/js/main.js');
const downloads = read('website/includes/downloads.php');

function detectWith(ua, brands) {
  const from = cta.indexOf('var EDGE_NOTE');
  const to = cta.indexOf('function promote(');
  assert.ok(from > 0 && to > from, 'the browser detection is no longer where the test expects it');
  // Everything from the per-browser notes through detectBrowser(), lifted out
  // and run as-is — the notes are declared above hasBrand and the function
  // closes over them.
  const body = cta.slice(from, to) + '; return detectBrowser();';
  const nav = { userAgent: ua };
  if (brands) nav.userAgentData = { brands: brands.map((brand) => ({ brand })) };
  return new Function('navigator', body)(nav);
}

/** Run detectWindows() out of main.js against a real navigator shape. */
function windowsWith(ua, platform) {
  const from = cta.indexOf('function detectWindows(');
  const to = cta.indexOf('var detected = detectBrowser();');
  assert.ok(from > 0 && to > from, 'detectWindows() is no longer where the test expects it');
  const body = cta.slice(from, to) + '; return detectWindows();';
  const nav = { userAgent: ua };
  if (platform !== undefined) nav.userAgentData = { platform };
  return new Function('navigator', body)(nav);
}

const CHROMIUM = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

test('each Chromium browser is named, not called Chrome', () => {
  const cases = [
    [CHROMIUM, 'Chrome'],
    [CHROMIUM + ' Edg/140.0.0.0', 'Edge'],
    [CHROMIUM + ' OPR/125.0.0.0', 'Opera'],
    [CHROMIUM + ' Vivaldi/7.5', 'Vivaldi'],
    ['Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/140.0.0.0 Mobile Safari/537.36', 'Samsung Internet'],
  ];
  for (const [ua, expected] of cases) {
    const got = detectWith(ua);
    assert.equal(got.name, expected, `${expected} was detected as ${got && got.name}`);
    // They all install from the same place: there is no Edge or Opera store
    // listing to send anyone to, and inventing one would be a dead link.
    assert.equal(got.store, 'chrome', `${expected} must still be sent to the Chrome Web Store`);
  }
});

test('Brave is found by its own API, since its user agent is Chrome’s', () => {
  assert.equal(detectWith(CHROMIUM).name, 'Chrome', 'a plain Chromium UA is Chrome until proven otherwise');
  assert.equal(detectWith(CHROMIUM, ['Chromium', 'Brave']).name, 'Brave');
  assert.match(cta, /navigator\.brave\.isBrave\(\)/,
    'nothing calls the one API that identifies Brave, whose user agent is identical to Chrome’s');
});

test('Firefox is sent to its own listing, never to the Chrome Web Store', () => {
  const ff = detectWith('Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0');
  assert.equal(ff.name, 'Firefox');
  assert.equal(ff.store, 'firefox', 'Gecko cannot install from the Chrome Web Store');
});

test('Windows is detected from the OS, not from the browser', () => {
  // The Windows app is orthogonal to the browser: Chrome on Windows should
  // light up both cards, and Chrome on macOS only the one.
  assert.equal(windowsWith(CHROMIUM), true, 'a Windows user agent was not recognised');
  assert.equal(windowsWith('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'),
    false, 'a Mac was offered the Windows installer as "your system"');
  // userAgentData.platform is exact where it exists and must win over the
  // string, which browsers freeze and lie in.
  assert.equal(windowsWith(CHROMIUM, 'macOS'), false,
    'userAgentData.platform must be preferred over the user agent string');
  assert.equal(windowsWith('Mozilla/5.0 (X11; Linux x86_64)', 'Windows'), true);
  // Windows Phone's old UA says "Windows Phone", never "Windows NT".
  assert.equal(windowsWith('Mozilla/5.0 (compatible; MSIE 10.0; Windows Phone 8.0; Trident/6.0)'), false,
    'Windows Phone was offered a desktop .exe');
});

test('Safari and unknown browsers are handled without a wrong promise', () => {
  const safari = detectWith('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15');
  assert.equal(safari.name, 'Safari');
  assert.equal(safari.store, null, 'there is no Safari build, so no store to point at');
  assert.match(safari.note, /no Safari version/,
    'Safari is told nothing, so the visitor is left to work out why no card is highlighted');

  assert.equal(detectWith('Mozilla/5.0 (X11; Linux x86_64) KHTML/6.0 Konqueror/24.08'), null,
    'an unrecognised browser must leave the page as rendered rather than guess');
});

test('all three downloads are real links in the delivered HTML', () => {
  // The whole point of the row: no JavaScript, no detection, still three
  // correct destinations. A card built by script would be an empty hero for
  // anyone the script does not run for.
  for (const [attr, constant] of [
    ['chrome', 'CHROME_STORE_URL'],
    ['firefox', 'FIREFOX_STORE_URL'],
    ['windows', 'CONTROL_PANEL_URL'],
  ]) {
    const card = new RegExp(`data-dl="${attr}"[^>]*href="<\\?= e\\(${constant}\\) \\?>"`);
    assert.match(downloads, card,
      `the ${attr} card is missing, or its href is not read from ${constant} in config.php`);
  }
  // config.php is the only place a store URL may live — in the markup as well
  // as in the script. Checked as "no absolute URL at all", rather than by
  // listing the hosts: the card sub-labels legitimately *name* a store in
  // prose ("addons.mozilla.org"), and a hostname in visible copy is not a
  // link. What must never appear is something clickable that config.php does
  // not control.
  assert.ok(!/https?:\/\//.test(downloads),
    'downloads.php hardcodes an absolute URL instead of reading it from config.php');
  assert.ok(!/chromewebstore|addons\.mozilla/.test(cta),
    'main.js hardcodes a store URL instead of reading it from the markup');
});

test('the home page renders the row rather than restating it', () => {
  const index = read('website/index.php');
  const includes = [...index.matchAll(/includes\/downloads\.php/g)];
  assert.equal(includes.length, 2,
    'the hero and the Install section must both render the shared partial — two hand-maintained copies drift');
  assert.ok(!/data-dl="/.test(index),
    'index.php spells out a download card of its own instead of including the partial');
});

test('detection only highlights — it never rewrites a link or hides a card', () => {
  // The failure this guards against is subtle: detection is allowed to be
  // wrong (user agents are spoofed, and a rewritten label is how the old
  // single-button version could send a Firefox user to a Chrome-only link).
  // Highlighting a card that is already correct cannot be wrong in that way.
  assert.ok(!/setAttribute\(\s*["']href["']/.test(cta),
    'main.js writes an href — a wrong guess now changes where a visitor lands, not just what is highlighted');
  assert.ok(!/removeAttribute\(\s*["']href["']/.test(cta),
    'main.js strips an href, leaving a card that looks clickable and is not');
  assert.ok(!/\.hidden\s*=\s*true/.test(cta),
    'main.js hides something; every download must stay reachable however detection goes');
  // What it is allowed to do, and must keep doing.
  assert.match(cta, /classList\.add\("is-detected"\)/, 'nothing marks the matching card');
  assert.match(downloads, /data-dl-badge hidden/,
    'the badge must ship hidden, or every card claims to be the visitor\'s browser');
});

test('the data-dl values are exactly what the script looks for', () => {
  // A rename on either side silently stops promoting anything, and nothing
  // about the page looks broken — it just quietly stops helping.
  const inMarkup = new Set([...downloads.matchAll(/data-dl="([a-z]+)"/g)].map((m) => m[1]));
  assert.deepEqual([...inMarkup].sort(), ['chrome', 'firefox', 'windows']);

  const stores = new Set([...cta.matchAll(/store:\s*"([a-z]+)"/g)].map((m) => m[1]));
  for (const store of stores) {
    assert.ok(inMarkup.has(store), `detectBrowser() returns store "${store}", which no card carries`);
  }
  assert.match(cta, /promote\("windows"/, 'nothing ever promotes the Windows card');
});

// ---------------------------------------------------------------------------
// The versions and floors the download cards state out loud
// ---------------------------------------------------------------------------
//
// Each of these is a number shown to a visitor that is decided somewhere else
// in the repository. Stated once and then left behind is exactly how a
// download button ends up advertising a version that was never released.

test('the Firefox floor on the site is the one the add-on actually declares', () => {
  const min = config.match(/const FIREFOX_MIN_VERSION\s*=\s*'([^']+)'/)?.[1];
  assert.ok(min, 'FIREFOX_MIN_VERSION not found in website/config.php');
  const gecko = read('scripts/make-manifest.mjs')
    .match(/GECKO_MIN_VERSION\s*=\s*'([^']+)'/)?.[1];
  assert.ok(gecko, 'GECKO_MIN_VERSION not found in scripts/make-manifest.mjs');
  assert.equal(min, gecko.split('.')[0],
    'the site advertises a different minimum Firefox than the uploaded manifest requires');
});

test('the Windows download points at the app’s own release, not "latest"', () => {
  // /releases/latest was wrong here: the extension (v*) and the app
  // (control-panel-v*) both cut releases in this one repository, so the first
  // extension release after an app release pointed "Download for Windows" at a
  // release containing nothing but store zips.
  assert.ok(!/CONTROL_PANEL_URL\s*=.*releases\/latest/.test(config),
    'the Windows download is back on /releases/latest, which the next extension release will break');
  assert.match(config, /releases\/download\/'\s*\.\s*CONTROL_PANEL_TAG/,
    'the Windows download does not point at the control-panel-v tag it was built from');
  assert.match(config, /const CONTROL_PANEL_TAG\s*=\s*'control-panel-v'/,
    'the release tag is no longer built from the app version');
});

test('the Windows version and filename match what the app actually builds', () => {
  const shown = config.match(/const CONTROL_PANEL_VERSION\s*=\s*'([^']+)'/)?.[1];
  assert.ok(shown, 'CONTROL_PANEL_VERSION not found in website/config.php');

  const pkg = JSON.parse(read('control-panel/package.json'));
  // A prerelease version in package.json (1.7.1-beta.1) means a test build is
  // being cut. Those are published as GitHub pre-releases and are only ever
  // installed by someone who opted into the beta channel in the app's own
  // Options — so the SITE must keep pointing at the last stable version, and
  // demanding the two match here would force the download button onto a beta
  // installer. What must hold in that case is the weaker, still-useful claim:
  // the site never advertises a prerelease.
  if (pkg.version.includes('-')) {
    assert.ok(!shown.includes('-'),
      'the website is advertising a prerelease build — the download button should stay on the last stable version');
  } else {
    assert.equal(shown, pkg.version,
      'the site advertises a Control Panel version that control-panel/package.json does not build');
  }

  // The installer filename is not a guess — electron-builder is told exactly
  // what to call it, and the download URL is built from that same shape.
  const artifact = pkg.build?.nsis?.artifactName;
  assert.equal(artifact, 'TabbySync-Control-Panel-Setup-${version}.${ext}',
    'the NSIS artifact name changed; the download URL in config.php now 404s');
  assert.match(config, /TabbySync-Control-Panel-Setup-'\s*\.\s*CONTROL_PANEL_VERSION\s*\.\s*'\.exe/,
    'the download URL no longer matches build.nsis.artifactName');
});

test('the extension version on the site matches the manifest it describes', () => {
  const shown = config.match(/const CURRENT_VERSION\s*=\s*'([^']+)'/)?.[1];
  assert.ok(shown, 'CURRENT_VERSION not found in website/config.php');
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(shown, manifest.version,
    'the site footer states a version the extension does not ship');
});

// ---------------------------------------------------------------------------
// One URL per page — the rewrite rules, in the order they have to be in
// ---------------------------------------------------------------------------
//
// These were verified against a real Apache serving this .htaccess, which CI
// has no way to run, so what is pinned here is the ordering that made those
// results come out right. Every one of these rules is order-dependent: the
// generic ".php -> clean URL" rule matches everything, so anything with a
// different destination has to be written above it or it never fires.

const at = (needle) => {
  const i = htaccess.indexOf(needle);
  assert.ok(i >= 0, `.htaccess no longer contains ${needle}`);
  return i;
};

test('the sitemap has exactly one URL, and it is the one robots.txt advertises', () => {
  // Submitting /sitemap.php to Search Console got "couldn't read it": the
  // generic rule sent it to /sitemap, so a crawler asking for a sitemap was
  // answered with a redirect somewhere else.
  const canonical = at('RewriteRule ^ /sitemap.xml [R=301,L]');
  assert.ok(canonical < at('RewriteRule ^ /%1 [R=301,L]'),
    'the generic .php rule runs first, so /sitemap.php goes to /sitemap again');
  assert.ok(at('RewriteRule ^sitemap\\.xml$ sitemap.php [L]') < canonical,
    '/sitemap.xml must be served before the redirect rule can see it');
  // The redirect matches the original request line, not the rewritten path.
  // Matching the path would send the internal rewrite of /sitemap.xml back to
  // /sitemap.xml, forever.
  const sitemapCond = htaccess.slice(0, canonical).split(/\n\s*\n/).pop();
  assert.match(sitemapCond, /THE_REQUEST/,
    'the sitemap redirect matches the rewritten path rather than the original request, which loops');
  assert.match(sitemapCond, /sitemap/, 'the condition above the sitemap redirect does not mention the sitemap');
});

test('the home page is only at /', () => {
  // index.php used to reach the generic rule first and redirect to /index,
  // which answered 200: the home page with a second address.
  assert.ok(at('RewriteCond %{THE_REQUEST} "\\s/+index(\\.php)?[\\s?]" [NC]') < at('RewriteRule ^ /%1 [R=301,L]'),
    'index.php redirects to /index instead of / because the generic rule wins');
});

test('no redirect can swallow a form submission', () => {
  // Every rule that redirects a page URL is preceded by a POST exclusion, or
  // the contact form posts into a 301 and the message is lost.
  for (const rule of ['RewriteRule ^ / [R=301,L]', 'RewriteRule ^ /%1 [R=301,L]']) {
    const preceding = htaccess.slice(0, at(rule)).split(/\n\s*\n/).pop();
    assert.match(preceding, /REQUEST_METHOD\} !=POST/, `${rule} does not exclude POST`);
  }
});
