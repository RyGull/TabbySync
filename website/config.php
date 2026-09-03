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
const CURRENT_VERSION = '1.3.4'; // keep in step with manifest.json in the extension repo
const GITHUB_URL     = 'https://github.com/RyGull/TabbySync';
const LICENSE_URL    = GITHUB_URL . '/blob/main/LICENSE';
const PRIVACY_URL    = GITHUB_URL . '/blob/main/privacy.html';
const CHANGELOG_URL  = GITHUB_URL . '/blob/main/CHANGELOG.md';
const PAYPAL_URL     = 'https://www.paypal.com/ncp/payment/B25W7V9VRGQG4';

// No Chrome Web Store listing exists yet. Flip this on and set the URL the
// day the extension is actually published there — until then the install
// button correctly points at the GitHub source instead of a dead link.
const CHROME_STORE_LIVE = false;
const CHROME_STORE_URL  = '';

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
