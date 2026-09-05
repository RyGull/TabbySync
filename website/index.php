<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';

$page_title = SITE_NAME . ' — ' . TAGLINE;
require __DIR__ . '/includes/header.php';
?>

<!-- ============================== HERO =============================== -->
<section class="hero">
  <div class="hero-bg" aria-hidden="true"></div>
  <div class="wrap hero-inner">
    <span class="eyebrow">Two tools. One extension. Your server.</span>
    <h1>Sync your bookmarks and your open tabs — <span class="accent">without handing them to anyone</span>.</h1>
    <p class="hero-lede">
      <?= e(SITE_NAME) ?> began as two separate extensions, later merged into one
      Manifest&nbsp;V3 extension that talks to <strong>one sync destination, one
      token and one sync name</strong>. Self-hosting is the recommended setup —
      free, no-server alternatives exist for anyone who doesn't have one.
    </p>
    <div class="hero-actions">
      <?php if (CHROME_STORE_LIVE): ?>
        <a class="btn btn-primary" href="<?= e(CHROME_STORE_URL) ?>" target="_blank" rel="noopener">Add to Chrome</a>
      <?php else: ?>
        <a class="btn btn-primary" href="#install">Install it now</a>
      <?php endif; ?>
      <a class="btn btn-ghost" href="<?= e(GITHUB_URL) ?>" target="_blank" rel="noopener">
        <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.7c-2.78.6-3.37-1.34-3.37-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.89 1.53 2.34 1.09 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.56-1.11-4.56-4.95 0-1.09.39-1.99 1.03-2.69-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.03a9.4 9.4 0 0 1 5 0c1.91-1.3 2.75-1.03 2.75-1.03.55 1.37.2 2.39.1 2.64.64.7 1.03 1.6 1.03 2.69 0 3.85-2.34 4.7-4.57 4.95.36.31.68.92.68 1.85v2.74c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"/></svg>
        View source
      </a>
    </div>
    <p class="hero-note">Free. No account. No ads. No analytics — <a href="#privacy">verified below</a>.</p>
  </div>
</section>

<!-- ============================ FEATURES =============================== -->
<section class="features" id="features">
  <div class="wrap">
    <h2 class="section-title">One extension, two engines, sharing everything</h2>
    <p class="section-lede">Turn on the bookmark sync, the tab sync, or both. They share one endpoint and one bearer token, but each engine namespaces its own file, so they never collide.</p>

    <div class="feature-grid">
      <article class="feature-card feature-blue">
        <div class="feature-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/></svg>
        </div>
        <h3>Bookmarks — true three-way merge</h3>
        <p>Syncs your whole bookmark tree (bar + other bookmarks). Adds, edits, moves and
          deletes from several devices are <em>merged</em>, not overwritten — the merge
          engine is covered by a 115-test suite that specifically guards against silent
          data loss.</p>
      </article>

      <article class="feature-card feature-orange">
        <div class="feature-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="7" height="14" rx="1.5"/><rect x="14" y="5" width="7" height="14" rx="1.5"/></svg>
        </div>
        <h3>Tabs — stash and restore</h3>
        <p>Collapses open tabs into a saved list to free memory, then restores them
          individually or all at once — as regular tabs or as a browser tab group.</p>
      </article>

      <article class="feature-card">
        <div class="feature-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
        </div>
        <h3>Your server, your rules</h3>
        <p>Self-hosting is a single PHP file with a token you choose. Any server that
          answers <code>GET</code>/<code>PUT</code> on <code>?name=&lt;file&gt;.json</code>
          works — the generated script also honours <code>ETag</code> /
          <code>If-Match</code> for safe concurrent writes.</p>
      </article>

      <article class="feature-card">
        <div class="feature-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/><circle cx="12" cy="15.5" r="1.4"/></svg>
        </div>
        <h3>Optional end-to-end encryption</h3>
        <p>One passphrase encrypts both tools with AES-256-GCM in your browser before
          anything is uploaded. The passphrase never leaves your device — a host only
          ever sees ciphertext in the file's contents.</p>
      </article>

      <article class="feature-card">
        <div class="feature-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 3 7v6c0 5 4 8 9 9 5-1 9-4 9-9V7l-9-4Z"/></svg>
        </div>
        <h3>No server? Two free alternatives</h3>
        <p>Not realistic to self-host? A private GitHub Gist or a JSONBin.io bin work
          too — both meaningfully less private than self-hosting, which is why the
          encryption passphrase is recommended for either.</p>
      </article>

      <article class="feature-card">
        <div class="feature-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M4 6h16M4 18h10"/></svg>
        </div>
        <h3>Source-available, on purpose</h3>
        <p>Published so it can be audited, not just trusted — a sync tool that touches
          your bookmarks, tabs and credentials should be checkable, not a black box.</p>
      </article>
    </div>
  </div>
</section>

<!-- =========================== SCREENSHOTS ============================== -->
<section class="shots" id="screenshots">
  <div class="wrap">
    <h2 class="section-title">See it before you install it</h2>
    <p class="section-lede">Real screenshots of the extension, not mockups — every one is generated
      from the shipping code by <code>scripts/screenshots.mjs</code>. Light and dark follow whichever
      theme you're reading this page in.</p>

    <div class="shot-row portrait">
      <div class="shot-copy">
        <h3>The popup — both engines at a glance</h3>
        <p>Bookmarks and Tabs each get their own switch, status dot, saved counts and last-sync
          time. One click stashes every tab in the window; another opens the list.</p>
        <p class="shot-note">Shown: a self-hosted profile with the encryption passphrase on.</p>
      </div>
      <figure class="shot-figure shot-figure-narrow">
        <img class="shot-light" src="/assets/img/screenshots/popup-light.png" width="480" height="897"
             alt="TabbySync popup in light mode, showing the Bookmarks and Tabs cards with their sync status." loading="lazy" decoding="async">
        <img class="shot-dark" src="/assets/img/screenshots/popup-dark.png" width="480" height="897"
             alt="The same TabbySync popup in dark mode." loading="lazy" decoding="async">
      </figure>
    </div>

    <div class="shot-block">
      <div class="shot-copy">
        <h3>The tab list — stashed tabs you can actually manage</h3>
        <p>Name a list, pin it to the top, lock it against accidental deletion, search across every
          title and URL, drag links between lists, then restore one link, one list, or everything —
          as plain tabs or a browser tab group. Deleted lists go to Trash for 30 days, and sync there too.</p>
      </div>
      <figure class="shot-figure">
        <img class="shot-light" src="/assets/img/screenshots/tablist-light.png" width="1280" height="800"
             alt="The TabbySync tab list in light mode with a pinned reading list and a locked work list." loading="lazy" decoding="async">
        <img class="shot-dark" src="/assets/img/screenshots/tablist-dark.png" width="1280" height="800"
             alt="The same TabbySync tab list in dark mode." loading="lazy" decoding="async">
      </figure>
    </div>

    <div class="shot-block">
      <div class="shot-copy">
        <h3>Options — one destination, one token, one sync name</h3>
        <p>Pick the sync method, paste the server URL and bearer token once, and both engines use
          them. The self-hosting card generates the PHP file and its <code>.htaccess</code> guards
          with a fresh token already in place.</p>
      </div>
      <figure class="shot-figure">
        <img class="shot-light" src="/assets/img/screenshots/options-light.png" width="1280" height="800"
             alt="TabbySync options in light mode, showing the shared server and sync settings." loading="lazy" decoding="async">
        <img class="shot-dark" src="/assets/img/screenshots/options-dark.png" width="1280" height="800"
             alt="The same TabbySync options page in dark mode." loading="lazy" decoding="async">
      </figure>
    </div>

    <div class="shot-block">
      <div class="shot-copy">
        <h3>…and a switch for everything each engine does</h3>
        <p>Separate auto-sync intervals, duplicate handling when you stash tabs, restore behaviour,
          and plain or encrypted import/export — bookmarks and tabs are configured independently,
          and either one can be turned off entirely.</p>
      </div>
      <figure class="shot-figure">
        <img class="shot-light" src="/assets/img/screenshots/options-engines-light.png" width="1280" height="800"
             alt="The Bookmarks and Tabs cards in TabbySync options, light mode." loading="lazy" decoding="async">
        <img class="shot-dark" src="/assets/img/screenshots/options-engines-dark.png" width="1280" height="800"
             alt="The same Bookmarks and Tabs option cards in dark mode." loading="lazy" decoding="async">
      </figure>
    </div>
  </div>
</section>

<!-- ========================== HOW IT WORKS =============================== -->
<section class="how" id="how-it-works">
  <div class="wrap">
    <h2 class="section-title">Set up once, sync everywhere</h2>
    <ol class="steps">
      <li>
        <span class="step-num">1</span>
        <div>
          <h3>Install the extension</h3>
          <p>Add it from the <a href="<?= e(CHROME_STORE_URL) ?>" target="_blank" rel="noopener">Chrome
            Web Store</a>, or load the source unpacked (see <a href="#install">Install</a>).</p>
        </div>
      </li>
      <li>
        <span class="step-num">2</span>
        <div>
          <h3>Pick a destination</h3>
          <p>Download the self-hosting bundle from Options and upload it to any PHP
            host, or connect a GitHub Gist / JSONBin.io if you don't have a server.</p>
        </div>
      </li>
      <li>
        <span class="step-num">3</span>
        <div>
          <h3>Use the same sync name everywhere</h3>
          <p>Same server URL + token + sync name on every computer you want to share.
            Different names stay completely separate.</p>
        </div>
      </li>
      <li>
        <span class="step-num">4</span>
        <div>
          <h3>Turn on encryption (recommended)</h3>
          <p>One passphrase, entered once per device. If you forget it, encrypted data
            can't be recovered — there's no reset, by design.</p>
        </div>
      </li>
    </ol>
  </div>
</section>

<!-- ============================= PRIVACY =============================== -->
<section class="privacy" id="privacy">
  <div class="wrap privacy-inner">
    <div class="privacy-copy">
      <h2 class="section-title">Privacy claims you don't have to take on faith</h2>
      <p class="section-lede">Every claim below is checked by an automated test that fails the build if the code
        ever stops matching it — not just written down and hoped.</p>
      <ul class="check-list">
        <li>No analytics, telemetry, or usage tracking of any kind</li>
        <li>No <code>history</code>, <code>webRequest</code>, or <code>cookies</code> permission — can't read your browsing</li>
        <li>Never listens for tab navigation — only reads tabs at the moment you act</li>
        <li>Host access requested one origin at a time, never a wildcard</li>
        <li>Contacts <strong>no server operated by the developer</strong>, ever</li>
        <li>Your bearer token and encryption passphrase can never enter an uploaded payload</li>
      </ul>
      <a class="btn btn-ghost" href="<?= e(PRIVACY_URL) ?>" target="_blank" rel="noopener">Read the full privacy policy</a>
    </div>
    <div class="privacy-visual" aria-hidden="true">
      <svg viewBox="0 0 200 200" class="shield-art">
        <path d="M100 12 174 40v56c0 54-38 82-74 92-36-10-74-38-74-92V40Z"/>
        <path class="shield-check" d="M70 102l22 22 40-46"/>
      </svg>
    </div>
  </div>
</section>

<!-- ============================= INSTALL =============================== -->
<section class="install" id="install">
  <div class="wrap install-inner">
    <h2 class="section-title">Install it today</h2>
    <p class="section-lede">
      <?= e(SITE_NAME) ?> is on the Chrome Web Store — one click in any Chromium
      browser (Chrome, Edge, Brave, Vivaldi, Opera):
    </p>
    <ol class="install-steps">
      <li>Add it from the <a href="<?= e(CHROME_STORE_URL) ?>" target="_blank" rel="noopener">Chrome Web Store</a>.</li>
      <li>Click the <?= e(SITE_NAME) ?> icon, choose Bookmarks, Tabs, or both, and open Options.</li>
      <li>Point it at a destination — your own server, a private GitHub Gist, or JSONBin.io.</li>
    </ol>
    <div class="hero-actions">
      <a class="btn btn-primary" href="<?= e(CHROME_STORE_URL) ?>" target="_blank" rel="noopener">Add to Chrome</a>
      <a class="btn btn-ghost" href="<?= e(GITHUB_URL) ?>" target="_blank" rel="noopener">Get the source on GitHub</a>
    </div>
    <details class="install-alt">
      <summary>Prefer to load it unpacked from source?</summary>
      <ol class="install-steps">
        <li>Clone or download the <a href="<?= e(GITHUB_URL) ?>" target="_blank" rel="noopener">source</a>.</li>
        <li>Open <code>chrome://extensions</code>, turn on <strong>Developer mode</strong>.</li>
        <li><strong>Load unpacked</strong> → select the folder containing <code>manifest.json</code>.</li>
      </ol>
      <p class="shot-note">An unpacked copy never auto-updates — you pull the repo yourself when a
        new version lands.</p>
    </details>
  </div>
</section>

<?php require __DIR__ . '/includes/footer.php'; ?>
