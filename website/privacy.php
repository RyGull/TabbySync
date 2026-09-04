<?php
declare(strict_types=1);

require_once __DIR__ . '/config.php';

$page_title       = 'Privacy Policy — ' . SITE_NAME;
$page_description = SITE_NAME . "'s privacy policy: what data the browser extension touches, where it goes, and who can see it.";
require __DIR__ . '/includes/header.php';
?>

<section class="page-hero">
  <div class="wrap">
    <span class="eyebrow">Last updated: August 31, 2026</span>
    <h1>Privacy Policy</h1>
    <p class="page-lede">
      What data the <?= e(SITE_NAME) ?> browser extension touches, where it
      goes, and who can see it.
    </p>
  </div>
</section>

<section class="policy-section">
  <div class="wrap content-narrow">

    <div class="github-note">
      <span>📄 This page mirrors the policy shipped with the extension.</span>
      <a href="<?= e(PRIVACY_URL) ?>" target="_blank" rel="noopener">View the source version on GitHub &rarr;</a>
    </div>

    <div class="policy">

      <p><?= e(SITE_NAME) ?> is a browser extension that lets you sync your bookmarks and your
      open-tab lists across your own computers, using a destination <strong>you choose and
      control</strong> — your own self-hosted server, a private GitHub Gist, or a JSONBin.io
      bin. This policy explains what data the extension touches, where it goes, and who
      can see it.</p>

      <div class="callout">
        <strong>The short version:</strong> <?= e(SITE_NAME) ?> has no servers of its own and no
        analytics. Your bookmarks and tabs are stored on your device and sent — directly
        from your browser — only to the sync destination you configure. The developer of
        this extension never receives, stores, or has access to that data.
      </div>

      <h2>What data <?= e(SITE_NAME) ?> accesses</h2>
      <div class="policy-table-wrap">
      <table class="policy-table">
        <tr><th>Permission</th><th>What it's used for</th></tr>
        <tr><td><code>bookmarks</code></td><td>Read and write your browser's bookmark tree, so it can be synced and merged across devices.</td></tr>
        <tr><td><code>tabs</code> / <code>tabGroups</code></td><td>Read open tabs when you choose to "stash" them, and re-open them (optionally as a browser tab group) when you restore a saved list.</td></tr>
        <tr><td><code>storage</code> / <code>unlimitedStorage</code></td><td>Save your bookmarks/tab-list data, settings, and sync state locally in the browser (<code>chrome.storage.local</code>).</td></tr>
        <tr><td><code>contextMenus</code></td><td>Add right-click menu shortcuts (e.g. "Send tabs to <?= e(SITE_NAME) ?>").</td></tr>
        <tr><td><code>alarms</code></td><td>Run the periodic background sync on the schedule you set.</td></tr>
        <tr><td>Host access (<code>http(s)://*/*</code>, requested per-site)</td><td>Only requested for the specific server/API host you configure as your sync destination (e.g. your own domain, <code>api.github.com</code>, or <code>api.jsonbin.io</code>) — used solely to read and write your synced data there.</td></tr>
      </table>
      </div>
      <p><?= e(SITE_NAME) ?> does not read your browsing history, passwords, form data, or the
      content of pages you visit, and does not request permissions beyond what's listed
      above.</p>

      <div class="callout">
        <strong>Why your browser's extension page may say more than this:</strong>
        <code>chrome://extensions</code> (or the equivalent page in any other
        Chromium-based browser — Brave, Edge, Opera, Vivaldi, and so on) shows a
        few things that come from the browser itself, not from <?= e(SITE_NAME) ?>:
        <ul>
          <li>It lists <code>tabs</code> under the scarier label
            <em>"Read your browsing history."</em> That's Chromium's fixed warning
            text for that permission — it describes what the permission would technically
            <em>allow</em>, not what <?= e(SITE_NAME) ?> does with it. <?= e(SITE_NAME) ?> never listens
            for page navigation; it only reads your currently open tabs at the moment
            you act — opening the popup, stashing a window, or restoring a saved
            list.</li>
          <li><strong>"Allow access to file URLs"</strong> and <strong>"Collect
            errors"</strong> are generic per-extension toggles the browser renders for
            every extension, independent of what that extension's manifest requests —
            there's no such thing as a manifest asking for either one. <?= e(SITE_NAME) ?> never
            declares <code>file://</code> access anywhere. "Collect errors" only
            controls whether <em>your own browser</em> shows you a local button with
            any JavaScript errors the extension has thrown — nothing is uploaded, and
            nothing reaches the developer.</li>
          <li><strong>"Site access"</strong> and its "Automatically allow access on
            the following sites" toggle only ever list sites <em>you</em> put there.
            <?= e(SITE_NAME) ?>'s manifest requests zero host access up front — no
            <code>host_permissions</code>, no content scripts on any page. The only
            way a site ends up in that list is Options → picking a sync method and
            hitting "Save &amp; grant access" (or connecting Gist/JSONBin), which
            asks the browser's own native permission prompt, naming that exact site,
            before anything is granted — and it only ever requests the one host
            you just configured (your server's domain, <code>api.github.com</code>,
            or <code>api.jsonbin.io</code>), never a wildcard covering other
            sites.</li>
        </ul>
      </div>

      <h2>Where your data is stored</h2>
      <ul>
        <li><strong>On your device:</strong> your bookmarks/tab-list data and settings are
          stored locally via the browser's extension storage (<code>chrome.storage.local</code>,
          never the browser's own cloud sync). This never leaves your device unless sync is
          turned on. Options → <strong>Import &amp; export</strong> can also write a copy to
          your downloads folder; unless you choose the encrypted-backup option and set a
          passphrase, that file is plain readable JSON on your disk.</li>
        <li><strong>Your sync destination:</strong> if you enable sync, your data is sent
          directly from your browser to the destination you configured:
          <ul>
            <li><em>Self-hosted</em> — a server you set up and control. Nothing passes
              through any server operated by <?= e(SITE_NAME) ?>'s developer. Use an
              <code>https://</code> address: <?= e(SITE_NAME) ?> will accept a plain
              <code>http://</code> endpoint if you configure one, but everything sent to it
              then crosses the network unencrypted, readable by anyone in between. The
              encryption passphrase protects the file's <em>contents</em> even over
              <code>http://</code> — not the fact that you are syncing, or the file names.</li>
            <li><em>GitHub Gist</em> — stored in a private ("secret") gist in your own
              GitHub account, using a personal access token you provide. Governed by
              <a href="https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement" target="_blank" rel="noopener">GitHub's own Privacy Statement</a>.</li>
            <li><em>JSONBin.io</em> — stored in a bin under your own JSONBin.io account,
              using an API key you provide. Governed by
              <a href="https://jsonbin.io/privacy-policy" target="_blank" rel="noopener">JSONBin.io's own Privacy Policy</a>.</li>
          </ul>
        </li>
      </ul>
      <div class="callout callout-warn">
        Self-hosting keeps your data on a server only you control. GitHub Gist and
        JSONBin.io are free, no-server alternatives, but they are third-party services —
        once your data (or its ciphertext, if encryption is on) is stored there, it's
        subject to that provider's own policies and practices, not <?= e(SITE_NAME) ?>'s.
      </div>

      <h2>Deleting your data</h2>
      <p>Options → <strong>Delete data</strong>, at the bottom of the extension's options page,
      removes synced data from the destination you configured. Each button asks you to type
      <code>DELETE</code> to unlock it and then confirm again before anything happens.</p>
      <ul>
        <li>A <strong>per-provider</strong> button sends a delete request to that provider
          for the files <?= e(SITE_NAME) ?> created there — the file(s) on your self-hosted server,
          your secret gist, or your JSONBin bins — and then clears that provider's saved
          URL, token and passphrase from this browser.</li>
        <li>The <strong>reset</strong> button attempts the same for every provider you have
          ever configured, then wipes every <?= e(SITE_NAME) ?> setting in this browser back to a
          fresh install.</li>
      </ul>
      <p>Two limits worth knowing. First, this deletes <?= e(SITE_NAME) ?>'s own remote files and
      local settings — it does not touch the actual bookmarks or open tabs in your browser,
      and it does not uninstall the extension. Second, <?= e(SITE_NAME) ?> can only ask the provider
      to delete; what happens afterwards is up to them. GitHub and JSONBin.io may retain
      backups or logs under their own retention policies, and your own server keeps
      whatever your own backups keep. Deleting from a self-hosted server also requires a
      reasonably recent <code>tabbysync.php</code>; an older copy will refuse the request
      and <?= e(SITE_NAME) ?> will tell you to re-upload the script.</p>

      <h2>Encryption</h2>
      <p>You can set an optional passphrase (Options → Encryption). When set, your data
      is encrypted on your device with AES-256-GCM <em>before</em> it is ever sent to your
      sync destination — so a self-hosted host, GitHub, or JSONBin.io only ever sees
      ciphertext. The passphrase itself is never transmitted anywhere and is stored only
      on your device. If you forget it, encrypted data cannot be recovered — there is no
      reset.</p>

      <h2>What <?= e(SITE_NAME) ?>'s developer does — and does not — do</h2>
      <ul>
        <li>We do not operate a server that receives, stores, or processes your bookmarks
          or tabs.</li>
        <li>We do not collect analytics, telemetry, or usage tracking of any kind.</li>
        <li>We do not sell, rent, or share your data with third parties, and we do not use
          your data for advertising or for any purpose unrelated to the extension's core
          sync functionality.</li>
        <li>We have no visibility into, and no access to, the contents of your self-hosted
          server, your GitHub Gist, or your JSONBin.io bin.</li>
      </ul>

      <h2>Feedback and donations (optional, separate from syncing)</h2>
      <p>The popup has two optional buttons, unrelated to syncing, that do nothing unless
      you click them:</p>
      <ul>
        <li><strong>Feedback</strong> opens your own email program with a blank message
          addressed to <a href="mailto:<?php echo_obfuscated(contact_address()); ?>"><?php echo_obfuscated(contact_address()); ?></a> and a subject line naming the
          <?= e(SITE_NAME) ?> version. Nothing else is filled in: no bookmarks, tabs, settings,
          tokens, sync destination, or identifier of any kind. Whatever you choose to type
          is the entirety of what is sent, and your own mail client sends it — <?= e(SITE_NAME) ?>
          does not transmit it and does not see it leave. Messages are kept only as long
          as needed to answer them; ask in the message, or in a follow-up, to have one
          deleted.</li>
        <li><strong>Donate</strong> opens a PayPal payment page in a new tab. <?= e(SITE_NAME) ?>
          does not process, see, or store any payment information — that's handled
          entirely by PayPal under its own privacy policy.</li>
      </ul>
      <div class="callout">
        <strong><?= e(SITE_NAME) ?> never contacts a server operated by its developer.</strong>
        Not for feedback, not for updates, not for licence checks, not for anything. The
        only servers it ever connects to are the sync destination <em>you</em> configure
        and, if you choose one of the no-server options, GitHub or JSONBin.io. Earlier
        versions embedded a feedback web form inside the popup, which meant opening that
        screen contacted the developer's web host and Google reCAPTCHA before you had
        typed anything. That form has been removed for exactly this reason. The
        <a href="/contact.php">contact form on this site</a> is separate from the
        extension itself — it's a normal web form you're choosing to visit, not something
        the extension opens on its own.
      </div>

      <h2>Children's privacy</h2>
      <p><?= e(SITE_NAME) ?> is not directed at children and does not knowingly collect data from
      children.</p>

      <h2>Changes to this policy</h2>
      <p>If this policy changes, the "Last updated" date at the top of this page will be
      revised. Material changes will also be noted in the extension's release notes. The
      <a href="<?= e(PRIVACY_URL) ?>" target="_blank" rel="noopener">version on GitHub</a>
      is the canonical copy the extension ships with; this page is kept in step with it.</p>

      <h2>Who is responsible for this</h2>
      <p><?= e(SITE_NAME) ?> is developed and published by Ryan Gulliver, an individual developer, who
      is responsible for this policy. There is no company, no team and no third party with
      access to anything <?= e(SITE_NAME) ?> stores. Because <?= e(SITE_NAME) ?> operates no server of any kind,
      the only personal data that ever reaches the developer is an email you choose to send.</p>

      <h2>Contact</h2>
      <p>Questions about this policy or your data — including a request to delete a message
      you have sent — go to
      <a href="mailto:<?php echo_obfuscated(contact_address()); ?>"><?php echo_obfuscated(contact_address()); ?></a>,
      which is also what the <strong>Feedback</strong> button in the popup opens and what
      the <a href="/contact.php">contact form</a> on this site sends to.</p>

    </div>
  </div>
</section>

<?php require __DIR__ . '/includes/footer.php'; ?>
