<?php
declare(strict_types=1);
require_once __DIR__ . '/../config.php';
?>
</main>

<footer class="site-footer">
  <div class="wrap footer-inner">
    <div class="footer-brand">
      <img class="brand-logo logo-light" src="/assets/img/logo-light.png" alt="<?= e(SITE_NAME) ?>">
      <img class="brand-logo logo-dark"  src="/assets/img/logo-dark.png"  alt="<?= e(SITE_NAME) ?>">
      <p>Self-hosted-first bookmark &amp; tab sync. No servers of ours involved.</p>
    </div>

    <div class="footer-col">
      <h3>Project</h3>
      <ul>
        <li><a href="<?= e(GITHUB_URL) ?>" target="_blank" rel="noopener">Source on GitHub</a></li>
        <li><a href="<?= e(LICENSE_URL) ?>" target="_blank" rel="noopener">License</a></li>
        <li><a href="<?= e(CHANGELOG_URL) ?>" target="_blank" rel="noopener">Changelog</a></li>
        <li><a href="<?= e(GITHUB_URL) ?>/issues" target="_blank" rel="noopener">Report a bug</a></li>
      </ul>
    </div>

    <div class="footer-col">
      <h3>Privacy</h3>
      <ul>
        <li><a href="<?= e(PRIVACY_URL) ?>" target="_blank" rel="noopener">Privacy policy</a></li>
        <li><span class="footer-note">No analytics. No telemetry. Verified in CI, not just claimed.</span></li>
      </ul>
    </div>

    <div class="footer-col">
      <h3>Support the project</h3>
      <ul>
        <li>
          <a href="mailto:<?php echo_obfuscated(contact_address()); ?>">
            <?php echo_obfuscated(contact_address()); ?>
          </a>
        </li>
        <li><a href="<?= e(PAYPAL_URL) ?>" target="_blank" rel="noopener">Donate via PayPal</a></li>
      </ul>
    </div>
  </div>

  <div class="wrap footer-legal">
    <p>&copy; <?= date('Y') ?> Ryan Gulliver. <?= e(SITE_NAME) ?> is source-available, not open source —
      see the <a href="<?= e(LICENSE_URL) ?>" target="_blank" rel="noopener">license</a> for what that means.
      Not affiliated with Google, GitHub, PayPal, or JSONBin.io.</p>
    <p class="footer-version">v<?= e(CURRENT_VERSION) ?></p>
  </div>
</footer>

<script src="/assets/js/main.js"></script>
</body>
</html>
