<?php
/**
 * config.php — site-wide constants and small helpers for the TabbySync
 * marketing site. Nothing in this file talks to a database or a network;
 * it exists purely to keep the values below out of every template.
 */

declare(strict_types=1);

// ---- Site-wide facts. Update these when the extension itself changes. ----
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
