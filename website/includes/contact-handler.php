<?php
/**
 * contact-handler.php — validates and sends one contact-form submission.
 *
 * Included by contact.php on a POST, and by the contact-send.php shim for
 * pages cached from before the form started posting to itself. It never
 * returns: every path ends in a redirect, so a browser refresh cannot
 * re-send the message (post/redirect/get).
 *
 * The caller must define $contact_form_url — the path to send the visitor
 * back to. contact.php derives it from the URL that served the page, which
 * is the one path guaranteed not to hit a host-level redirect.
 *
 * Deliberately dependency-free, and deliberately without reCAPTCHA: the
 * changelog records that reCAPTCHA was removed from this project because
 * merely rendering it contacted Google before the visitor had typed
 * anything. The spam defence here is a honeypot plus a per-session rate
 * limit, which costs the visitor no third-party request at all.
 */

declare(strict_types=1);

if (!defined('SITE_NAME')) {
    require_once __DIR__ . '/../config.php';
}
if (session_status() !== PHP_SESSION_ACTIVE) {
    session_start();
}

/** Where to send the visitor back to. The caller normally sets this. */
$contact_form_url = $contact_form_url ?? '/contact';

/** Ends the request, handing the outcome back to the form page. */
function contact_redirect(string $url, array $params): never
{
    header('Location: ' . $url . '?' . http_build_query($params), true, 303);
    exit;
}

/**
 * Strips anything that could start a new header line. A name or address
 * containing CR/LF would otherwise let a submission inject its own To: or
 * Bcc: and turn this form into an open relay.
 */
function contact_header_safe(string $value): string
{
    return trim(str_replace(["\r", "\n", "\0"], ' ', $value));
}

// ---------------------------------------------------------------------------
// The submission has to have actually arrived
// ---------------------------------------------------------------------------

// A redirect in front of the form turns a POST into a bodyless GET, and some
// proxies drop the body outright. Both look like "the visitor left everything
// blank" unless they are told apart, and telling the visitor to go fill in
// fields they already filled in is the worst possible answer.
if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    contact_redirect($contact_form_url, ['status' => 'notsent', 'why' => 'method']);
}
if ($_POST === []) {
    contact_redirect($contact_form_url, ['status' => 'notsent', 'why' => 'empty']);
}

// ---------------------------------------------------------------------------
// Spam: a honeypot, then a rate limit
// ---------------------------------------------------------------------------

// Real visitors never see this field (CSS hides it) and so never fill it in.
// Report success rather than an error: a bot that is told it failed retries,
// and a human who somehow tripped it has already had their message discarded
// either way -- there is nothing useful to tell them.
if (trim((string) ($_POST['tsc_hp'] ?? '')) !== '') {
    contact_redirect($contact_form_url, ['status' => 'ok']);
}

// Per-session, so it slows a script reusing one session rather than blocking a
// person who genuinely has a second thing to say. It is a speed bump, not a
// wall; anything determined will just drop the cookie.
const CONTACT_MIN_SECONDS_BETWEEN = 20;
const CONTACT_MAX_PER_SESSION     = 8;

$now  = time();
$sent = $_SESSION['contact_sent'] ?? [];
$sent = array_values(array_filter($sent, static fn ($t) => $t > $now - 3600));

if ($sent !== [] && $now - max($sent) < CONTACT_MIN_SECONDS_BETWEEN) {
    contact_redirect($contact_form_url, ['status' => 'toofast']);
}
if (count($sent) >= CONTACT_MAX_PER_SESSION) {
    contact_redirect($contact_form_url, ['status' => 'toomany']);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

$name    = trim((string) ($_POST['name'] ?? ''));
$email   = trim((string) ($_POST['email'] ?? ''));
$reason  = (string) ($_POST['reason'] ?? '');
$message = trim((string) ($_POST['message'] ?? ''));

$errors = [];

if ($name === '') {
    $errors['name'] = 'Please tell us what to call you.';
} elseif (mb_strlen($name) > 120) {
    $errors['name'] = 'That name is longer than 120 characters.';
}

if ($email === '') {
    $errors['email'] = 'We need an address to reply to.';
} elseif (mb_strlen($email) > 254 || !filter_var($email, FILTER_VALIDATE_EMAIL)) {
    $errors['email'] = "That doesn't look like an email address.";
}

// Compared against the keys of CONTACT_REASONS rather than trusted, so the
// label that ends up in the subject line is always one of ours.
if ($reason === '' || !array_key_exists($reason, CONTACT_REASONS)) {
    $errors['reason'] = 'Please pick what this is about.';
}

if ($message === '') {
    $errors['message'] = 'The message is empty.';
} elseif (mb_strlen($message) < 10) {
    $errors['message'] = 'Please say a little more than that.';
} elseif (mb_strlen($message) > 5000) {
    $errors['message'] = 'That message is over the 5,000 character limit.';
}

if ($errors !== []) {
    // Hand back what was typed so the form can be refilled. The honeypot is
    // not echoed back, and nothing is persisted beyond this one redirect.
    $_SESSION['contact_old'] = compact('name', 'email', 'reason', 'message');
    $_SESSION['contact_errors'] = $errors;
    contact_redirect($contact_form_url, ['status' => 'invalid']);
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

$to      = contact_address();
$label   = CONTACT_REASONS[$reason];
$subject = '[' . SITE_NAME . '] ' . $label . ' — from ' . contact_header_safe($name);

// From: is on our own domain so SPF/DKIM can pass; the visitor's address goes
// in Reply-To, where hitting reply still does the right thing. Putting their
// address in From: is what gets contact forms silently dropped.
$headers = [
    'From'         => SITE_NAME . ' website <' . $to . '>',
    'Reply-To'     => contact_header_safe($name) . ' <' . contact_header_safe($email) . '>',
    'MIME-Version' => '1.0',
    'Content-Type' => 'text/plain; charset=UTF-8',
];

// No IP address and no user agent. The privacy policy's whole claim is that
// this project collects as little as it can get away with, and neither is
// needed to answer a message. The web server's own access log is a separate
// matter, and /privacy says so.
$body = "Name:    {$name}\n"
      . "Email:   {$email}\n"
      . "About:   {$label}\n"
      . 'Sent:    ' . gmdate('Y-m-d H:i:s') . " UTC\n"
      . "\n"
      . str_repeat('-', 60) . "\n\n"
      . $message . "\n";

$headerLines = [];
foreach ($headers as $key => $value) {
    $headerLines[] = $key . ': ' . contact_header_safe($value);
}

$sentOk = @mail(
    contact_header_safe($to),
    contact_header_safe($subject),
    $body,
    implode("\r\n", $headerLines),
    '-f' . $to,
);

if (!$sentOk) {
    // Keep what they typed, so "try again" does not mean "type it all again".
    $_SESSION['contact_old'] = compact('name', 'email', 'reason', 'message');
    contact_redirect($contact_form_url, ['status' => 'error']);
}

$sent[] = $now;
$_SESSION['contact_sent'] = $sent;

contact_redirect($contact_form_url, ['status' => 'ok']);
