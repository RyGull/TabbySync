<?php
/**
 * Legacy entry point for the contact form.
 *
 * The form now posts back to contact.php's own URL — whatever URL served
 * the page is, by definition, one the host doesn't redirect, and a 301 in
 * front of this file was turning submissions into bodyless GETs. This shim
 * stays so a page cached from before that change still delivers its
 * message instead of losing it.
 *
 * A page cached from before the CSRF token existed carries no token, so its
 * submission now comes back as "expired" rather than being sent. That is the
 * right trade: the visitor is handed their own text back on a current form
 * and sends it in one more click, and no unauthenticated POST reaches the
 * mailbox in the meantime.
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

start_session();

// CONTACT_PATH, not '/contact.php': .htaccess 301s the .php form of every
// URL to its extensionless one, and redirecting the visitor into a redirect is
// how the status query string gets lost on some hosts -- which would show them
// no confirmation at all after a message that did send.
$contact_form_url = CONTACT_PATH;

require __DIR__ . '/includes/contact-handler.php';
