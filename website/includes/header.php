<?php
declare(strict_types=1);
require_once __DIR__ . '/../config.php';

/** Per-page overrides. A page may set these before including this file. */
$page_title       = $page_title       ?? SITE_NAME . ' — ' . TAGLINE;
$page_description = $page_description ?? TAGLINE . ' No servers of ours involved — self-host it, or use a free no-server backend, your choice.';
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
<meta name="theme-color" content="#2563eb">

<!-- Open Graph / social preview -->
<meta property="og:title" content="<?= e(SITE_NAME) ?>">
<meta property="og:description" content="<?= e($page_description) ?>">
<meta property="og:type" content="website">
<meta property="og:image" content="/assets/img/icon-256.png">

<link rel="icon" href="/assets/img/icon-32.png" sizes="32x32">
<link rel="icon" href="/assets/img/icon-256.png" sizes="256x256">
<link rel="stylesheet" href="/assets/css/style.css">
</head>
<body>

<a class="skip-link" href="#main">Skip to content</a>

<header class="site-header" id="siteHeader">
  <div class="wrap header-inner">
    <a class="brand" href="/">
      <img class="brand-logo logo-light" src="/assets/img/logo-light.png" alt="<?= e(SITE_NAME) ?>">
      <img class="brand-logo logo-dark"  src="/assets/img/logo-dark.png"  alt="<?= e(SITE_NAME) ?>">
    </a>

    <nav class="site-nav" id="siteNav" aria-label="Primary">
      <a href="/#features">Features</a>
      <a href="/#how-it-works">How it works</a>
      <a href="/#privacy">Privacy</a>
      <a href="/#install">Install</a>
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
