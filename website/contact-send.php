<?php
/**
 * Legacy entry point for the contact form.
 *
 * The form now posts back to contact.php's own URL — whatever URL served
 * the page is, by definition, one the host doesn't redirect, and a 301 in
 * front of this file was turning submissions into bodyless GETs. This shim
 * stays so a page cached from before that change still delivers its
 * message instead of losing it.
 */

declare(strict_types=1);

session_start();

require_once __DIR__ . '/config.php';

$contact_form_url = '/contact.php';

require __DIR__ . '/includes/contact-handler.php';
