<?php
/**
 * config.local.example.php — the template for config.local.php.
 *
 * HOW TO USE THIS FILE
 * --------------------
 *   1. On the web server, copy it:  cp config.local.example.php config.local.php
 *   2. Paste your two reCAPTCHA v3 keys into the copy.
 *   3. Leave THIS file exactly as it is. It is committed; the copy is not.
 *
 * config.local.php is listed in the repository's .gitignore and must stay
 * that way. A secret that reaches a public commit is public permanently —
 * deleting the file in a later commit does not remove it from the history,
 * from anyone's clone, from a fork, or from the caches that indexed it in
 * between. If a key of yours has ever been pushed anywhere public, treat it
 * as burned: generate a new pair at https://www.google.com/recaptcha/admin
 * and delete the old one there, rather than only removing it from the code.
 *
 * The site works without this file. With no keys configured the contact form
 * falls back to what protected it before: a CSRF token, a hidden honeypot
 * field and a per-session rate limit. Nothing errors, and nothing pretends
 * to be verifying submissions that it isn't.
 *
 * Get the keys from https://www.google.com/recaptcha/admin — create a site,
 * choose "reCAPTCHA v3", and add every domain the site answers on (both
 * tabbysync.com and www.tabbysync.com, plus localhost if you test locally).
 */

declare(strict_types=1);

return [
    // The SITE key. Public by nature — it is visible in the page's HTML to
    // anyone who views source. It is kept here anyway so that one file holds
    // both keys and neither can be committed by accident.
    'recaptcha_site_key' => '',

    // The SECRET key. This one is genuinely secret: it is what proves to
    // Google that a verification request came from you. It never leaves the
    // server, never appears in HTML, and must never be pasted into a commit,
    // an issue, a screenshot, or a chat with anyone — including an AI
    // assistant working on this repository.
    'recaptcha_secret_key' => '',
];
