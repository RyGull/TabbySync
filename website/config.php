<?php
/**
 * config.php — site-wide constants and small helpers for the TabbySync
 * marketing site. Nothing in this file talks to a database or a network;
 * it exists purely to keep the values below out of every template.
 */

declare(strict_types=1);

// ---- Site-wide facts. Update these when the extension itself changes. ----
// The origin this site is served from, with no trailing slash. Everything
// that has to be absolute — canonical links, Open Graph URLs, the sitemap —
// is built from this one constant, so a move to another domain (or a staging
// host) is a single edit rather than a hunt for hard-coded addresses.
const SITE_URL      = 'https://tabbysync.com';
const SITE_NAME     = 'TabbySync';
const TAGLINE        = 'Self-hosted sync for your bookmarks and your open tabs.';
const CURRENT_VERSION = '1.3.8'; // keep in step with manifest.json in the extension repo
const GITHUB_URL     = 'https://github.com/RyGull/TabbySync';
const LICENSE_URL    = GITHUB_URL . '/blob/main/LICENSE';
// GitHub's blob view renders privacy.html as escaped source, not as a page,
// which is no good for a link a visitor (or a Chrome Web Store reviewer) is
// meant to read. Point at the GitHub Pages copy instead; docs/ is generated
// from the same canonical file by scripts/build-pages.sh in the extension
// repository, so there is still exactly one policy to keep accurate.
const PRIVACY_URL    = 'https://rygull.github.io/TabbySync/privacy.html';
const CHANGELOG_URL  = GITHUB_URL . '/blob/main/CHANGELOG.md';

// The site's own interior pages. Extensionless because .htaccess rewrites
// /contact -> contact.php and 301s the other way; keeping the paths here means
// a host without that rule needs one edit, not a hunt through the templates.
const CONTACT_PATH   = '/contact';
const PRIVACY_PATH   = '/privacy';
const PAYPAL_URL     = 'https://www.paypal.com/ncp/payment/B25W7V9VRGQG4';

// The Chrome Web Store listing is live. CHROME_STORE_LIVE stays as a switch
// rather than being edited out: if the listing is ever pulled or suspended,
// flipping it back to false returns every call-to-action on the site to the
// "load unpacked from GitHub" path with no other edits.
const CHROME_STORE_LIVE = true;
const CHROME_STORE_URL  = 'https://chromewebstore.google.com/detail/tabbysync/lfbdjnceepjfamkjclkeahnjhebedfdk';

/**
 * The "What's this about?" options on /contact. The first entry is an empty
 * value on purpose: the <select> is marked required, and a required select
 * only actually stops anything when its initially-selected option submits as
 * empty. Anything not a key of this array is rejected by the handler, so a
 * hand-crafted POST cannot smuggle its own label into the email subject.
 */
// ---------------------------------------------------------------------------
// Secrets — never in this file, never in git
// ---------------------------------------------------------------------------
//
// config.local.php holds the reCAPTCHA keys. It is git-ignored, it is NOT in
// the repository, and it must never be added to it: a key that reaches a
// public commit is public forever, because deleting the file later leaves it
// in the history, in every fork and in every cache that saw it. There is a
// copy-and-fill template beside this file (config.local.example.php) and a
// test that fails if a key-shaped string ever appears in a committed file.
//
// With no config.local.php present — a fresh clone, a local checkout — the
// site runs exactly as it did before reCAPTCHA existed: the contact form
// falls back to its CSRF token, honeypot and rate limit. Nothing 500s and
// nothing silently sends unverified mail while pretending otherwise.
$site_local = __DIR__ . '/config.local.php';
$site_secrets = is_readable($site_local) ? (array) (require $site_local) : [];

define('RECAPTCHA_SITE_KEY', (string) ($site_secrets['recaptcha_site_key'] ?? ''));
define('RECAPTCHA_SECRET_KEY', (string) ($site_secrets['recaptcha_secret_key'] ?? ''));
unset($site_local, $site_secrets);

// v3 scores a request 0.0 (almost certainly a bot) to 1.0 (almost certainly a
// person). 0.5 is Google's own suggested starting point; raise it if spam gets
// through, lower it if real messages are being turned away. It is a judgement
// about a probability, not a fact — which is why a rejected submission keeps
// what was typed and points at the plain email address instead.
const RECAPTCHA_MIN_SCORE = 0.5;

const CONTACT_REASONS = [
    ''         => 'Choose one…',
    'question' => 'A question about ' . SITE_NAME,
    'bug'      => 'A bug report',
    'feature'  => 'Feedback or a feature idea',
    'selfhost' => 'Help with self-hosting',
    'privacy'  => 'A privacy or data question',
    'other'    => 'Something else',
];

/**
 * The contact address, assembled from parts and never written out as a
 * literal string in any file. Mirrors the approach in the extension's own
 * shared/contact.js — this is friction against regex address-harvesters,
 * not real protection; anyone reading this file can reconstruct it. Point
 * it at a forwarding alias you can rotate, not a real mailbox.
 */
function contact_address(): string
{
    $user = 'contact';
    $host = 'tabbysync.com';
    return $user . chr(64) . $host;
}

/**
 * Echoes an email address as numeric HTML character references
 * (&#106;&#111;…), one entity per byte. Every major mail scraper looks for
 * a literal `name@host.tld` string in page source; this never puts one
 * there, while every browser — including with JavaScript disabled — still
 * renders and copies it as plain text. Stronger than a JS-only scheme for
 * exactly that reason: it costs nothing and needs no script to work.
 */
function echo_obfuscated(string $text): void
{
    foreach (str_split($text) as $char) {
        echo '&#' . ord($char) . ';';
    }
}

/** A safe echo for anything that might contain user-influenced text. Nothing
 * on this static site currently takes user input, but every template uses
 * this rather than a bare echo so that stays true by construction. */
function e(string $text): void
{
    echo htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
}

/** The same escaping as e(), for places that need the string rather than
 * an echo — a meta tag attribute built up in PHP, say. */
function esc(string $text): string
{
    return htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
}

/**
 * Turns a root-relative path into an absolute URL on this site. Canonical
 * links, Open Graph images and the sitemap all have to be absolute, and a
 * search engine treating /assets/img/og-image.png as a URL of its own is
 * exactly the kind of thing that quietly halves a preview card's chances.
 */
function abs_url(string $path = '/'): string
{
    return SITE_URL . '/' . ltrim($path, '/');
}

/**
 * The canonical URL of the page being served: this site's origin plus the
 * request path, with the query string dropped.
 *
 * Dropping the query is the point. /contact renders the same page whether it
 * is reached plainly or as /contact?status=ok&why=method after a submission,
 * and without this every one of those redirect targets would be a separate
 * indexable URL competing with the real one.
 */
function canonical_url(): string
{
    $path = strtok((string) ($_SERVER['REQUEST_URI'] ?? '/'), '?');
    if (!is_string($path) || $path === '') {
        $path = '/';
    }
    // /index.php and /contact.php are the same pages as / and /contact; only
    // one of each should be advertised as canonical.
    $path = preg_replace('#/index\.php$#', '/', $path) ?? $path;
    $path = preg_replace('#\.php$#', '', $path) ?? $path;

    return abs_url($path);
}

/**
 * Response headers that constrain what the browser will do with these pages.
 *
 * Sent from PHP rather than only from .htaccess so they apply on any host,
 * Apache or not — .htaccess covers the static files PHP never sees, and the
 * two deliberately do not overlap, because a header set twice with different
 * values is worse than one set once.
 *
 * The Content-Security-Policy is as tight as it is because this site earns
 * it: every script and stylesheet is a file of its own on this origin, there
 * is not one inline <script>, one style="" attribute or one third-party
 * request anywhere in it, and a test fails if that stops being true. So no
 * 'unsafe-inline', no 'unsafe-eval', and nothing may be loaded, framed,
 * submitted to or connected to off-origin.
 *
 * $recaptcha widens exactly four directives, on exactly one page. /contact
 * loads Google's reCAPTCHA script, which needs to run, to frame its challenge,
 * to talk back to Google and to fetch the badge's images. Nothing else on this
 * site loads it, so nothing else pays for it: every other page keeps the
 * policy above, unaltered. The named origins are Google's two — no wildcards
 * and no scheme-wide `https:`, which would hand back most of what the policy
 * was protecting.
 */
function send_security_headers(bool $recaptcha = false): void
{
    // Both of Google's origins are needed: www.google.com serves the API and
    // the challenge frame, www.gstatic.com the code and images it pulls in.
    $g = $recaptcha ? ' https://www.google.com https://www.gstatic.com' : '';

    if (headers_sent()) {
        return;
    }

    // Nothing gains from announcing the interpreter's exact version to
    // everyone who fetches a page; a scanner looking for hosts running a
    // known-vulnerable PHP is the one thing that does.
    header_remove('X-Powered-By');

    header("Content-Security-Policy: "
        . "default-src 'self'; "
        . "base-uri 'none'; "
        . "form-action 'self'; "
        . "frame-ancestors 'none'; "
        . "object-src 'none'; "
        . "script-src 'self'" . $g . "; "
        // reCAPTCHA injects a <style> element for its badge. Google's script
        // copies a nonce from its own <script> tag onto that element, so the
        // badge stays styled without 'unsafe-inline' — and if a browser ever
        // fails to honour that, the badge is hidden by this site's own
        // stylesheet anyway and the token still works.
        . "style-src 'self'" . ($recaptcha ? " 'nonce-" . csp_nonce() . "'" : '') . "; "
        . "img-src 'self' data:" . $g . "; "
        . "font-src 'self'; "
        . "connect-src 'self'" . $g . "; "
        . ($recaptcha ? "frame-src https://www.google.com; " : "frame-src 'none'; ")
        . "manifest-src 'self'");

    // Never guess a type from content: a .txt that sniffs as HTML is how an
    // upload becomes a script. Nothing here is uploaded, but the header costs
    // nothing and the guarantee is worth having by default.
    header('X-Content-Type-Options: nosniff');
    // Send the full URL only to ourselves; other origins get the bare origin,
    // and an http:// destination gets nothing at all.
    header('Referrer-Policy: strict-origin-when-cross-origin');
    // This site asks for no device capability whatsoever. Say so, so an
    // injected iframe cannot ask on its behalf either.
    header('Permissions-Policy: accelerometer=(), autoplay=(), camera=(), '
        . 'display-capture=(), encrypted-media=(), fullscreen=(), geolocation=(), '
        . 'gyroscope=(), magnetometer=(), microphone=(), midi=(), payment=(), '
        . 'usb=(), xr-spatial-tracking=()');
    // frame-ancestors above already says this; X-Frame-Options is the version
    // older browsers understand, and clickjacking a "download this extension"
    // page is a real thing rather than a theoretical one.
    header('X-Frame-Options: DENY');
    header('Cross-Origin-Opener-Policy: same-origin');
    header('Cross-Origin-Resource-Policy: same-origin');

    // HSTS only over HTTPS: sent on a plain-http response it is ignored by
    // spec, and sent by a host that cannot do HTTPS it would be a promise the
    // host cannot keep. No `preload` — that one is effectively irreversible,
    // and is the deployer's decision to make, not this file's.
    if (site_is_https()) {
        header('Strict-Transport-Security: max-age=31536000; includeSubDomains');
    }
}

/**
 * One random nonce per request, reused wherever it is asked for. It goes on
 * the reCAPTCHA <script> tag so Google's script can stamp the same nonce onto
 * the style element it injects for its badge — which is what lets /contact
 * keep style-src without 'unsafe-inline'.
 */
function csp_nonce(): string
{
    static $nonce = null;
    if ($nonce === null) {
        $nonce = base64_encode(random_bytes(16));
    }
    return $nonce;
}

/**
 * Whether reCAPTCHA is configured at all. Both keys or neither: a site key
 * with no secret would load Google's script on the page and then be unable to
 * check anything it produced, which is the worst of both — a third-party
 * request that buys no protection.
 */
function recaptcha_enabled(): bool
{
    return RECAPTCHA_SITE_KEY !== '' && RECAPTCHA_SECRET_KEY !== '';
}

/**
 * Checks one v3 token with Google. Returns:
 *   ['ok' => bool, 'score' => ?float, 'reachable' => bool]
 *
 * `reachable` is false when the verification request itself failed — a DNS
 * problem, a firewall, Google being down. The caller lets those through
 * rather than losing a real message to an outage: the CSRF token, honeypot
 * and rate limit are all still in force, and a spam wave during a Google
 * outage is a smaller problem than silently binning the mail of anyone who
 * writes during one.
 *
 * The visitor's IP is deliberately NOT sent. `remoteip` is optional, and
 * Google already sees the address from the browser's own request to it;
 * forwarding it a second time from the server would add nothing but another
 * copy of a visitor's address in someone else's logs, which /privacy promises
 * this site does not do.
 */
function recaptcha_verify(string $token): array
{
    $fail = ['ok' => false, 'score' => null, 'reachable' => true];

    if ($token === '' || !recaptcha_enabled()) {
        return $fail;
    }

    $body = http_build_query([
        'secret'   => RECAPTCHA_SECRET_KEY,
        'response' => $token,
    ]);
    $url = 'https://www.google.com/recaptcha/api/siteverify';
    $raw = false;

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_POST           => true,
            CURLOPT_POSTFIELDS     => $body,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 5,
            CURLOPT_CONNECTTIMEOUT => 3,
        ]);
        $raw = curl_exec($ch);
        curl_close($ch);
    } elseif (ini_get('allow_url_fopen')) {
        $raw = @file_get_contents($url, false, stream_context_create([
            'http' => [
                'method'        => 'POST',
                'header'        => "Content-Type: application/x-www-form-urlencoded\r\n",
                'content'       => $body,
                'timeout'       => 5,
                'ignore_errors' => true,
            ],
        ]));
    }

    if (!is_string($raw) || $raw === '') {
        return ['ok' => false, 'score' => null, 'reachable' => false];
    }

    $data = json_decode($raw, true);
    if (!is_array($data)) {
        return ['ok' => false, 'score' => null, 'reachable' => false];
    }

    $score = isset($data['score']) ? (float) $data['score'] : null;

    return [
        'ok'        => ($data['success'] ?? false) === true && $score !== null && $score >= RECAPTCHA_MIN_SCORE,
        'score'     => $score,
        'reachable' => true,
    ];
}

/** Whether this request arrived over HTTPS, honouring a reverse proxy's
 * X-Forwarded-Proto (shared hosting terminates TLS in front of PHP far more
 * often than not). */
function site_is_https(): bool
{
    if (($_SERVER['HTTPS'] ?? '') !== '' && strtolower((string) $_SERVER['HTTPS']) !== 'off') {
        return true;
    }
    if ((int) ($_SERVER['SERVER_PORT'] ?? 0) === 443) {
        return true;
    }
    return strtolower((string) ($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '')) === 'https';
}

/**
 * Starts the session with cookie flags set, rather than whatever php.ini
 * happens to default to. HttpOnly keeps script away from it, SameSite=Lax
 * means it is not sent on a cross-site POST (which is the same attack the
 * CSRF token below covers, stopped one layer earlier), and Secure is set
 * whenever the request itself came over HTTPS.
 */
function start_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    session_set_cookie_params([
        'lifetime' => 0,
        'path'     => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure'   => site_is_https(),
    ]);
    session_start();
}

/**
 * The per-session CSRF token, created on first use.
 *
 * What this actually protects: without it, any page anywhere can POST to the
 * contact form in a visitor's name, and the mailbox on the other end fills up
 * with messages that visitor never wrote. The honeypot and the rate limit in
 * includes/contact-handler.php slow a bot down; neither one notices a
 * cross-site submission that is otherwise perfectly well formed.
 */
function csrf_token(): string
{
    start_session();
    if (!isset($_SESSION['csrf']) || !is_string($_SESSION['csrf']) || $_SESSION['csrf'] === '') {
        $_SESSION['csrf'] = bin2hex(random_bytes(32));
    }
    return $_SESSION['csrf'];
}

/** The hidden input that carries the token through a form. */
function csrf_field(): void
{
    echo '<input type="hidden" name="csrf" value="' . esc(csrf_token()) . '">';
}

/** Whether a submitted token matches this session's. Compared in constant
 * time, so the comparison itself leaks nothing about the real token. */
function csrf_valid(?string $submitted): bool
{
    start_session();
    $known = $_SESSION['csrf'] ?? '';
    return is_string($known) && $known !== ''
        && is_string($submitted) && hash_equals($known, $submitted);
}
