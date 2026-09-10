<?php
declare(strict_types=1);
require_once __DIR__ . '/config.php';

// The home page's own title and description, rather than the header's
// fallbacks. Both are written for a search result: the title names the thing
// and what it does inside ~60 characters, and the description says who it is
// for and what makes it different inside ~155, because past that Google
// truncates and the rest is written for nobody.
$page_title       = SITE_NAME . ' — self-hosted bookmark and tab sync for Chrome, Firefox & Windows';
$page_description = 'Sync your bookmarks and open tabs to a server you control — or a private '
    . 'GitHub Gist — with optional end-to-end encryption. Chrome, Firefox and a Windows desktop '
    . 'app. No account, no analytics, no tracking.';
require __DIR__ . '/includes/header.php';
?>

<!-- ============================== HERO =============================== -->
<section class="hero">
  <div class="hero-bg" aria-hidden="true"></div>
  <div class="wrap hero-inner">
    <span class="eyebrow">Chrome · Firefox · Windows</span>
    <h1>Sync your bookmarks and your open tabs — <span class="accent">without handing them to anyone</span>.</h1>
    <p class="hero-lede">
      One Manifest&nbsp;V3 extension for <strong>Chromium browsers and Firefox</strong>,
      plus a <strong>Windows desktop app</strong> for managing every sync profile in one
      place. All of it talks to <strong>one sync destination, one token and one sync
      name</strong> — a server you control, or a free no-server alternative if you
      don't have one.
    </p>
    <?php require __DIR__ . '/includes/downloads.php'; ?>
    <p class="hero-note">Free. No account. No ads. No analytics — <a href="#privacy">verified below</a>.
      <a href="<?= e(GITHUB_URL) ?>" target="_blank" rel="noopener">View the source</a>.</p>
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
        <h3>Tabs — close them, keep them</h3>
        <p>Closes the tabs you're done with and saves them as a list, freeing the memory they
          were holding. Reopen one link, one list, or everything — as ordinary tabs or as a
          browser tab group.</p>
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
          password lock is recommended for either.</p>
      </article>

      <article class="feature-card">
        <div class="feature-icon">
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="4.5" width="19" height="13" rx="2"/><path d="M8 20.5h8M12 17.5v3"/></svg>
        </div>
        <h3>Same everywhere you work</h3>
        <p>The identical extension runs on Chromium browsers and on Firefox — one
          codebase, one manifest, two builds — and the Windows Control Panel manages
          every profile from the desktop. Whatever you sync from, the file on your
          server is the same file.</p>
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
          time. One click saves every tab in the window; another opens your lists.</p>
        <p class="shot-note">Shown: syncing to your own website, with the password lock on.</p>
      </div>
      <figure class="shot-figure shot-figure-narrow">
        <img class="shot-light" src="/assets/img/screenshots/popup-light.png" width="480" height="788"
             alt="TabbySync popup in light mode, showing the Bookmarks and Tabs cards with their sync status." loading="lazy" decoding="async">
        <img class="shot-dark" src="/assets/img/screenshots/popup-dark.png" width="480" height="788"
             alt="The same TabbySync popup in dark mode." loading="lazy" decoding="async">
      </figure>
    </div>

    <div class="shot-block">
      <div class="shot-copy">
        <h3>Never set it up before? There's a wizard for that</h3>
        <p>On a fresh install, the popup shows the same two cards blurred behind two buttons:
          <strong>Walk me through it</strong>, or set it up yourself. The guided path is the same
          four questions below, one at a time, with Back and Next — not a second, simplified setup
          to keep in step with the real one.</p>
        <p class="shot-note">Shown: step 1, before anything has been chosen yet.</p>
      </div>
      <figure class="shot-figure">
        <img class="shot-light" src="/assets/img/screenshots/wizard-light.png" width="1280" height="800"
             alt="TabbySync's guided setup wizard in light mode, showing step 1 of 4 with a Back and Next bar." loading="lazy" decoding="async">
        <img class="shot-dark" src="/assets/img/screenshots/wizard-dark.png" width="1280" height="800"
             alt="The same guided setup wizard in dark mode." loading="lazy" decoding="async">
      </figure>
    </div>

    <div class="shot-block">
      <div class="shot-copy">
        <h3>The saved-tabs page — lists you can actually manage</h3>
        <p>Name a list, pin it to the top, lock it against accidental deletion, search across every
          title and URL, drag links between lists, then reopen one link, one list, or everything — as
          ordinary tabs or a browser tab group. Reopening a lot of tabs asks first and opens them in
          batches you can stop. Anything you delete waits 30 days in “Recently deleted”, and syncs
          there too.</p>
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
        <p>Separate sync intervals, duplicate handling, reopening behaviour and backups — bookmarks
          and tabs are configured independently, each behind “More options”, and either one can be
          turned off entirely.</p>
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
    <p class="section-lede">The four steps below, in order — or open the popup on a fresh install
      and click <strong>Walk me through it</strong> for the same four, one at a time.</p>
    <ol class="steps">
      <li>
        <span class="step-num">1</span>
        <div>
          <h3>Install the extension</h3>
          <p>Add it from the <a href="<?= e(CHROME_STORE_URL) ?>" target="_blank" rel="noopener">Chrome
            Web Store</a> or <a href="<?= e(FIREFOX_STORE_URL) ?>" target="_blank" rel="noopener">Firefox
            Add-ons</a>, or load the source unpacked (see <a href="#install">Install</a>).</p>
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
        <li>Your access code and password lock can never enter an uploaded payload</li>
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
      One click on the Chrome Web Store (Chrome, Edge, Brave, Vivaldi, Opera) or on
      Firefox Add-ons. The Windows app is optional and separate — take it if you juggle
      more than one sync profile.
    </p>
    <?php require __DIR__ . '/includes/downloads.php'; ?>
    <ol class="install-steps">
      <li>Add the extension from the store your browser uses.</li>
      <li>Click the <?= e(SITE_NAME) ?> icon. On a fresh install it offers two ways in:
        <strong>Walk me through it</strong> for a step-by-step guided setup, or set it up
        yourself from Settings.</li>
      <li>Either way, you're choosing the same thing: a destination — your own server, a
        private GitHub Gist, or JSONBin.io.</li>
    </ol>
    <div class="hero-actions">
      <a class="btn btn-ghost" href="<?= e(GITHUB_URL) ?>" target="_blank" rel="noopener">Get the source on GitHub</a>
    </div>
    <details class="install-alt">
      <summary>Prefer to load it unpacked from source?</summary>
      <ol class="install-steps">
        <li>Clone or download the <a href="<?= e(GITHUB_URL) ?>" target="_blank" rel="noopener">source</a>.</li>
        <li><strong>Chromium:</strong> open <code>chrome://extensions</code>, turn on
          <strong>Developer mode</strong>, then <strong>Load unpacked</strong> → the folder
          containing <code>manifest.json</code>.</li>
        <li><strong>Firefox:</strong> run <code>npm run dev:firefox</code> to build
          <code>dist/firefox/</code> — Firefox needs its own manifest, because the one in the
          repository declares a service worker Firefox will not run. Then
          <code>about:debugging</code> → <strong>This Firefox</strong> →
          <strong>Load Temporary Add-on…</strong> → pick that folder's
          <code>manifest.json</code>.</li>
      </ol>
      <p class="shot-note">An unpacked copy never auto-updates — you pull the repo yourself when a
        new version lands. A temporary add-on in Firefox also goes away when Firefox restarts.</p>
    </details>
  </div>
</section>

<!-- ======================= DESKTOP CONTROL PANEL ======================== -->
<?php if (CONTROL_PANEL_LIVE): ?>
<section class="install" id="control-panel">
  <div class="wrap install-inner">
    <h2 class="section-title">Managing more than one sync profile?</h2>
    <p class="section-lede">
      <strong>TabbySync Control Panel</strong> is the companion Windows desktop app —
      add, remove, move and copy bookmarks and saved-tab lists across every sync
      profile you have (work, personal, a home server…) from one place, without a
      browser. Same self-hosted / GitHub Gist / JSONBin destinations, the same merge
      and encryption as the extension. It updates itself once installed.
    </p>
    <div class="hero-actions">
      <a class="btn btn-primary" href="<?= e(CONTROL_PANEL_URL) ?>">Download <?= e(SITE_NAME) ?> Control Panel <?= e(CONTROL_PANEL_VERSION) ?></a>
      <a class="btn btn-ghost" href="<?= e(CONTROL_PANEL_RELEASE_URL) ?>" target="_blank" rel="noopener">Release notes &amp; portable build</a>
    </div>
    <p class="shot-note">Windows 10/11, 64-bit. Free and source-available under the same license as
      the extension, and entirely optional — the extension works fully on its own without it.
      Prefer not to run an installer? The release page above also carries a portable
      <code>.exe</code>.</p>
  </div>
</section>
<?php endif; ?>

<?php require __DIR__ . '/includes/footer.php'; ?>
