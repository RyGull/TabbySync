<?php
/**
 * privacy.php — the privacy policy, inside the site's own chrome.
 *
 * The policy itself is NOT written here. privacy.html is the one canonical
 * copy, the one test/privacy-policy.test.js checks against the extension's
 * actual code on every push, and this page reads it rather than restating
 * it. scripts/build-pages.sh drops that file next to this one at build time
 * (website/privacy.html), so a deploy carries the current text and there is
 * still exactly one policy to keep accurate.
 *
 * What IS written here is the short section about this website — the contact
 * form and the host's access log are the site's business, not the
 * extension's, and the extension's policy should not pretend to cover them.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

/**
 * Pulls the policy body out of privacy.html: everything after the
 * "Last updated" line and before the page's own footer. The surrounding
 * markup is the extension page's shell (its logo, theme toggle and footer),
 * all of which this site supplies itself.
 *
 * Returns [dateText, bodyHtml], or [null, null] if the file is missing or
 * does not look like the policy — the page then falls back to linking the
 * published copy rather than rendering something half-formed.
 */
function policy_parts(): array
{
    $path = __DIR__ . '/privacy.html';
    if (!is_readable($path)) {
        return [null, null];
    }
    $html = (string) file_get_contents($path);

    if (!preg_match('#<p class="updated">Last updated:\s*(.*?)</p>#s', $html, $m)) {
        return [null, null];
    }
    $date = trim($m[1]);

    $start = strpos($html, $m[0]);
    $end   = strpos($html, '<footer>', $start);
    if ($start === false || $end === false) {
        return [null, null];
    }
    $body = substr($html, $start + strlen($m[0]), $end - $start - strlen($m[0]));

    // A policy that came back nearly empty means the file's shape changed and
    // the anchors above no longer bracket the content. Better to show the
    // fallback than a blank page claiming to be a privacy policy.
    return strlen(trim($body)) < 2000 ? [null, null] : [$date, trim($body)];
}

[$policy_date, $policy_body] = policy_parts();

$page_title       = 'Privacy Policy — ' . SITE_NAME;
$page_description = SITE_NAME . "'s privacy policy: what data the browser extension touches, where it goes, and who can see it.";

$page_schema = [
    '@type' => 'BreadcrumbList',
    'itemListElement' => [
        ['@type' => 'ListItem', 'position' => 1, 'name' => 'Home', 'item' => SITE_URL . '/'],
        ['@type' => 'ListItem', 'position' => 2, 'name' => 'Privacy Policy', 'item' => SITE_URL . PRIVACY_PATH],
    ],
];
require __DIR__ . '/includes/header.php';
?>

<section class="page-hero">
  <div class="wrap">
    <?php if ($policy_date !== null): ?>
      <span class="eyebrow">Last updated: <?= e($policy_date) ?></span>
    <?php endif; ?>
    <h1>Privacy Policy</h1>
    <p class="page-lede">
      What data the <?= e(SITE_NAME) ?> browser extension touches, where it
      goes, and who can see it — plus what this website itself does.
    </p>
  </div>
</section>

<section class="policy-section">
  <div class="wrap content-narrow">

    <div class="policy">

      <h2>This website</h2>
      <p>This section covers <strong><?= e(SITE_NAME) ?>.com</strong> — the pages you are
      reading now. It is separate from the extension, and from the policy below it:
      visiting this site is something you chose to do, not something the extension does
      on your behalf. The extension never opens, contacts or loads anything from this
      site.</p>

      <ul>
        <li><strong>No analytics, no tracking, no cookies for measurement.</strong> There
        is no Google Analytics, no tag manager, no pixel, no fingerprinting and no
        advertising network. No font CDN, no icon library, no embedded video. Every
        page but one loads nothing from any third-party domain at all — the exception
        is <a href="<?= e(CONTACT_PATH) ?>">the contact form</a>, described below.</li>

        <li><strong>reCAPTCHA, on the contact page only.</strong>
        <?php if (recaptcha_enabled()): ?>
          <a href="<?= e(CONTACT_PATH) ?>">/contact</a> loads Google reCAPTCHA v3 to check
          submissions for automated abuse, because it is the one place on this site where a
          stranger can make it send mail. Loading it means your browser contacts Google and
          Google receives what any site you visit receives — your IP address, your browser
          and device details, and how you interacted with the page — and may set or read its
          own cookies for that domain. That is Google's collection, under
          <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Google's
          Privacy Policy</a> and
          <a href="https://policies.google.com/terms" target="_blank" rel="noopener">Terms of
          Service</a>, and it is not something this site can promise anything about. What this
          site does control: your IP address is <em>not</em> sent to Google by the server when
          it checks your submission, and no other page here loads reCAPTCHA at all. If you would
          rather not involve Google, email the address on the contact page instead — it goes to
          the same inbox and involves them not at all.
        <?php else: ?>
          Not currently in use: no reCAPTCHA keys are configured on this deployment, so no page
          on this site loads anything from Google. The contact form is protected by a hidden
          honeypot field, a per-session rate limit and a cross-site request token, none of which
          contacts anyone.
        <?php endif; ?>
        </li>

        <li><strong>The contact form</strong> sends exactly what you type — your name,
        your email address, the topic you pick and your message — to
        <span data-contact><?php echo_obfuscated(contact_address()); ?></span> by email,
        and stores nothing. Your IP address and browser are deliberately
        <em>not</em> included in that email. A short-lived session cookie is set while
        you are using the form; it holds only a rate-limit timestamp and, if a field was
        rejected, what you had typed so the form can be handed back to you filled in. It
        is not used to identify or follow you.</li>

        <li><strong>Server logs.</strong> Like any web host, this one records ordinary
        access log entries — IP address, time, the page requested, browser string —
        which are kept for a short period for security and troubleshooting and are not
        combined with anything else or shared.</li>

        <li><strong>Email you send</strong> lives in a normal mailbox and is kept only as
        long as it is useful to answer you. Ask and it will be deleted.</li>
      </ul>

      <div class="callout">
        <strong>Everything below this line is the extension's policy</strong>, reproduced
        verbatim from the copy that ships inside <?= e(SITE_NAME) ?> itself. It is not
        rewritten or summarised for this page — there is one policy, and this is it.
      </div>

      <h2>The <?= e(SITE_NAME) ?> extension</h2>

      <?php if ($policy_body !== null): ?>
        <?= $policy_body /* trusted: our own file, mirrored at build time */ ?>
      <?php else: ?>
        <div class="callout callout-warn">
          <strong>The policy could not be loaded on this page.</strong> Read it here
          instead: <a href="<?= e(PRIVACY_URL) ?>" target="_blank" rel="noopener">the
          published privacy policy</a>.
        </div>
      <?php endif; ?>

    </div>
  </div>
</section>

<?php require __DIR__ . '/includes/footer.php'; ?>
