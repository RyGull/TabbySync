<?php
declare(strict_types=1);
require_once __DIR__ . '/../config.php';

/**
 * downloads.php — the three-up download row: Chromium, Firefox, Windows.
 *
 * Rendered in the hero and again in the Install section, from this one file,
 * because two hand-maintained copies of a set of download buttons is how a
 * site ends up advertising a version on one screen and a different one two
 * scrolls down.
 *
 * Every card is a real link in the delivered HTML. assets/js/main.js promotes
 * whichever one matches the browser in front of the visitor — it adds a class
 * and unhides a badge, and that is all it does. It never hides a card and
 * never invents a URL: user agents are freely spoofed and detection is
 * allowed to be wrong, so being wrong has to cost nothing more than the wrong
 * card being highlighted. A visitor with no JavaScript sees all three, styled
 * identically, every one of them correct.
 *
 * A card whose store switch is off in config.php is simply not rendered,
 * rather than rendered as a dead or "coming soon" button.
 */
?>
<div class="download-row" data-download-row>
<?php if (CHROME_STORE_LIVE): ?>
  <a class="dl-card" data-dl="chrome" href="<?= e(CHROME_STORE_URL) ?>" target="_blank" rel="noopener">
    <span class="dl-badge" data-dl-badge hidden>Your browser</span>
    <span class="dl-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.25"/><circle cx="12" cy="12" r="3.55"/><path d="M12.1 8.45h9.05M8.95 13.75 4.35 5.9M15.05 13.8l-4.55 7.85"/></svg>
    </span>
    <span class="dl-text">
      <strong>Add to Chrome</strong>
      <span class="dl-sub">Chrome, Edge, Brave, Vivaldi, Opera</span>
    </span>
  </a>
<?php endif; ?>
<?php if (FIREFOX_STORE_LIVE): ?>
  <a class="dl-card" data-dl="firefox" href="<?= e(FIREFOX_STORE_URL) ?>" target="_blank" rel="noopener">
    <span class="dl-badge" data-dl-badge hidden>Your browser</span>
    <span class="dl-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M12 21.6a7.1 7.1 0 0 0 7.1-7.1c0-3.1-1.7-5.4-3.4-6.9-.4 1.2-1.1 2-1.9 2.5.3-2-.5-4.4-2.5-6-.6 2.2-2.1 3-3.4 4.2A7.6 7.6 0 0 0 4.9 14.5a7.1 7.1 0 0 0 7.1 7.1Z"/><path d="M12 21.6a3.5 3.5 0 0 0 3.5-3.5c0-1.9-1.7-3-2.4-4.3-.7 1.2-1.4 1.5-2.2 2.2a3.7 3.7 0 0 0-2.4 2.1A3.5 3.5 0 0 0 12 21.6Z"/></svg>
    </span>
    <span class="dl-text">
      <strong>Add to Firefox</strong>
      <span class="dl-sub">Firefox <?= e(FIREFOX_MIN_VERSION) ?>+ · addons.mozilla.org</span>
    </span>
  </a>
<?php endif; ?>
<?php if (CONTROL_PANEL_LIVE): ?>
  <a class="dl-card dl-card-app" data-dl="windows" href="<?= e(CONTROL_PANEL_URL) ?>">
    <span class="dl-badge" data-dl-badge hidden>Your system</span>
    <span class="dl-icon dl-icon-solid" aria-hidden="true">
      <svg viewBox="0 0 24 24"><path d="M3 5.6l7.6-1.06v7.21H3Zm8.8-1.23L21 3.1v8.65h-9.2ZM3 12.95h7.6v7.16L3 19.05Zm8.8 0H21v8.61l-9.2-1.28Z"/></svg>
    </span>
    <span class="dl-text">
      <strong>Download for Windows</strong>
      <span class="dl-sub">Control Panel <?= e(CONTROL_PANEL_VERSION) ?> · desktop app</span>
    </span>
  </a>
<?php endif; ?>
</div>
<p class="hero-note" data-install-note hidden></p>
