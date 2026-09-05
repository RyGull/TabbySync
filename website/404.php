<?php
/**
 * 404.php — the not-found page, wired up by .htaccess (ErrorDocument 404).
 *
 * It exists so a mistyped or retired URL lands somewhere that still looks
 * like the site and offers a way onward, rather than on the host's default
 * error page. It answers with a real 404 status and asks not to be indexed:
 * a "soft 404" — an error page returning 200 — is one of the few SEO
 * mistakes that actively costs a site crawl budget.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

http_response_code(404);

$page_title       = 'Page not found — ' . SITE_NAME;
$page_description = 'That page does not exist on ' . SITE_NAME . '.';
$page_noindex     = true;
// No canonical: this response stands in for whatever URL was asked for, and
// that URL is not a page. Pointing it at the home page would tell a crawler
// the two are the same thing, which is the classic soft-404 signal.
$page_canonical   = '';
require __DIR__ . '/includes/header.php';
?>

<section class="page-hero">
  <div class="wrap">
    <span class="eyebrow">404</span>
    <h1>That page isn't here</h1>
    <p class="page-lede">
      The address you followed doesn't match anything on this site. It may have
      been renamed, or the link that brought you here may have a typo in it.
    </p>
  </div>
</section>

<section class="contact-section">
  <div class="wrap content-narrow">
    <ul class="install-steps">
      <li><a href="/">The home page</a> — what <?= e(SITE_NAME) ?> is and how it works</li>
      <li><a href="/#install">Install</a> — the Chrome Web Store listing and the from-source route</li>
      <li><a href="<?= e(PRIVACY_PATH) ?>">Privacy policy</a> — what the extension touches and where it goes</li>
      <li><a href="<?= e(CONTACT_PATH) ?>">Contact</a> — if a link on this site is what sent you here, please say so</li>
    </ul>
  </div>
</section>

<?php require __DIR__ . '/includes/footer.php'; ?>
