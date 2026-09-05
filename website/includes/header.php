<?php
declare(strict_types=1);
require_once __DIR__ . '/../config.php';

/** Per-page overrides. A page may set these before including this file. */
$page_title       = $page_title       ?? SITE_NAME . ' — ' . TAGLINE;
$page_description = $page_description ?? TAGLINE . ' No servers of ours involved — self-host it, or use a free no-server backend, your choice.';

/**
 * Pages that should not be indexed set this to true before including the
 * header — the 404 page, and /contact once it carries a ?status= from a
 * submission. The canonical link already points those variants back at the
 * real URL; this is the belt to that pair of braces.
 */
$page_noindex = $page_noindex ?? false;

/**
 * Structured data. Every page carries the site and the software it is about;
 * a page may add its own node (a breadcrumb trail, say) in $page_schema.
 *
 * Nothing here is a claim the page doesn't already make in plain text: no
 * invented ratings, no invented review counts, no install numbers. A rich
 * result built on a number nobody can check is the kind of thing that gets a
 * whole site's structured data ignored.
 */
$schema_graph = [
    [
        '@type' => 'WebSite',
        '@id'   => SITE_URL . '/#website',
        'url'   => SITE_URL . '/',
        'name'  => SITE_NAME,
        'description' => TAGLINE,
        'inLanguage'  => 'en',
        'publisher'   => ['@id' => SITE_URL . '/#author'],
    ],
    [
        '@type' => 'Person',
        '@id'   => SITE_URL . '/#author',
        'name'  => 'Ryan Gulliver',
        'url'   => GITHUB_URL,
    ],
    array_filter([
        '@type' => 'SoftwareApplication',
        '@id'   => SITE_URL . '/#extension',
        'name'  => SITE_NAME,
        'description' => 'Browser extension that syncs your bookmarks and your open tabs to a '
            . 'destination you control — your own server, a private GitHub Gist, or a JSONBin.io '
            . 'bin — with optional end-to-end encryption.',
        'applicationCategory' => 'BrowserApplication',
        'applicationSubCategory' => 'Browser Extension',
        'operatingSystem' => 'Chrome, Edge, Brave, Vivaldi, Opera (Chromium 88+)',
        'softwareVersion' => CURRENT_VERSION,
        'url'         => SITE_URL . '/',
        'downloadUrl' => CHROME_STORE_LIVE ? CHROME_STORE_URL : GITHUB_URL,
        'installUrl'  => CHROME_STORE_LIVE ? CHROME_STORE_URL : null,
        'author'      => ['@id' => SITE_URL . '/#author'],
        'privacyPolicy' => SITE_URL . PRIVACY_PATH,
        'isAccessibleForFree' => true,
        'offers' => [
            '@type' => 'Offer',
            'price' => '0',
            'priceCurrency' => 'USD',
        ],
        'screenshot' => [
            abs_url('/assets/img/screenshots/popup-light.png'),
            abs_url('/assets/img/screenshots/tablist-light.png'),
            abs_url('/assets/img/screenshots/options-light.png'),
        ],
        'featureList' => [
            'Three-way merge sync for the whole bookmark tree',
            'Stash open tabs into named lists and restore them anywhere',
            'Self-hosted endpoint, private GitHub Gist, or JSONBin.io',
            'Optional AES-256-GCM end-to-end encryption',
            'No account, no analytics, no telemetry',
        ],
    ], static fn ($v) => $v !== null),
];
if (isset($page_schema) && is_array($page_schema)) {
    $schema_graph[] = $page_schema;
}

/**
 * The canonical URL, which a page may override — or suppress with '' when
 * there is nothing to be canonical about. /contact?status=ok wants one (it
 * points every post/redirect/get target back at the real page); the 404 page
 * does not, because the URL it is answering for isn't a page at all.
 */
$canonical = $page_canonical ?? canonical_url();
$og_image  = abs_url('/assets/img/og-image.png');

/**
 * Only /contact sets this, and only when reCAPTCHA is actually configured —
 * it widens the CSP for Google's origins, and no page that doesn't load the
 * script should pay that price.
 */
$page_recaptcha = $page_recaptcha ?? false;

send_security_headers($page_recaptcha);
?>
<!DOCTYPE html>
<!-- TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
     Personal, non-commercial use only. No redistribution. See LICENSE. -->
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= e($page_title) ?></title>
<meta name="description" content="<?= e($page_description) ?>">
<?php if ($canonical !== ''): ?>
<link rel="canonical" href="<?= e($canonical) ?>">
<?php endif; ?>
<?php if ($page_noindex): ?>
<meta name="robots" content="noindex, follow">
<?php else: ?>
<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1">
<?php endif; ?>
<meta name="author" content="Ryan Gulliver">
<!-- The palette switches with the visitor's theme, so the browser chrome
     should too — one theme-color per scheme, matching --bg in style.css. -->
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#14171d" media="(prefers-color-scheme: dark)">
<meta name="color-scheme" content="light dark">

<!-- Open Graph / social preview. The image is a real 1200x630 card generated
     from the extension's own UI (scripts/screenshots.mjs), not the 256px app
     icon a preview would otherwise letterbox into a grey square. -->
<meta property="og:site_name" content="<?= e(SITE_NAME) ?>">
<meta property="og:title" content="<?= e($page_title) ?>">
<meta property="og:description" content="<?= e($page_description) ?>">
<meta property="og:type" content="website">
<meta property="og:url" content="<?= e($canonical !== '' ? $canonical : abs_url('/')) ?>">
<meta property="og:locale" content="en_US">
<meta property="og:image" content="<?= e($og_image) ?>">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="<?= e(SITE_NAME . ' — ' . TAGLINE) ?>">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="<?= e($page_title) ?>">
<meta name="twitter:description" content="<?= e($page_description) ?>">
<meta name="twitter:image" content="<?= e($og_image) ?>">
<meta name="twitter:image:alt" content="<?= e(SITE_NAME . ' — ' . TAGLINE) ?>">

<link rel="icon" href="/assets/img/icon-32.png" sizes="32x32">
<link rel="icon" href="/assets/img/icon-256.png" sizes="256x256">
<link rel="apple-touch-icon" href="/assets/img/icon-256.png">
<link rel="stylesheet" href="/assets/css/style.css">

<script type="application/ld+json"><?= json_encode(
    ['@context' => 'https://schema.org', '@graph' => $schema_graph],
    JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
) ?></script>
</head>
<body>

<a class="skip-link" href="#main">Skip to content</a>

<header class="site-header" id="siteHeader">
  <div class="wrap header-inner">
    <a class="brand" href="/">
      <img class="brand-logo logo-light" src="/assets/img/logo-light.png" alt="<?= e(SITE_NAME) ?>" width="1140" height="184">
      <img class="brand-logo logo-dark"  src="/assets/img/logo-dark.png"  alt="<?= e(SITE_NAME) ?>" width="1140" height="184">
    </a>

    <nav class="site-nav" id="siteNav" aria-label="Primary">
      <a href="/#features">Features</a>
      <a href="/#screenshots">Screenshots</a>
      <a href="/#how-it-works">How it works</a>
      <a href="/#privacy">Privacy</a>
      <a href="/#install">Install</a>
      <a href="<?= e(CONTACT_PATH) ?>">Contact</a>
      <a href="<?= e(GITHUB_URL) ?>" target="_blank" rel="noopener">Source</a>
    </nav>

    <div class="header-actions">
      <button class="theme-toggle" id="themeToggle" type="button" aria-label="Toggle color theme">
        <svg class="icon icon-sun" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>
        <svg class="icon icon-moon" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/></svg>
      </button>
      <button class="nav-toggle" id="navToggle" type="button" aria-label="Toggle menu" aria-expanded="false" aria-controls="siteNav">
        <span></span><span></span><span></span>
      </button>
    </div>
  </div>
</header>

<main id="main">
