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
 * anything. That objection still stands for the extension, which contacts no
 * third party at all — but this form is on the website, it is the one place a
 * stranger can make this project send mail, and unattended spam is what it is.
 * So: a CSRF token, a honeypot and a per-session rate limit, all of which cost
 * no third-party request, plus reCAPTCHA v3 when it is configured, which does
 * — and which /contact and /privacy both say so outright, on the page.
 *
 * The keys live in website/config.local.php, which is git-ignored. With no
 * keys present every check except reCAPTCHA still runs, and the form works.
 */

declare(strict_types=1);

if (!defined('SITE_NAME')) {
    require_once __DIR__ . '/../config.php';
}
start_session();

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
// The submission has to have come from our own form
// ---------------------------------------------------------------------------

// Without this, any page anywhere could POST here in a visitor's name and the
// mailbox on the other end would fill with messages nobody wrote. The
// honeypot and the rate limit below don't cover that: a cross-site submission
// is otherwise perfectly well formed. SameSite=Lax on the session cookie
// stops the same attack a layer earlier; this is the layer that doesn't
// depend on the browser being recent.
//
// What was typed is kept, because the overwhelmingly likely cause is a form
// left open until its session expired — not an attack — and losing a long
// message to a security check is its own kind of failure.
if (!csrf_valid(isset($_POST['csrf']) && is_string($_POST['csrf']) ? $_POST['csrf'] : null)) {
    $_SESSION['contact_old'] = [
        'name'    => trim((string) ($_POST['name'] ?? '')),
        'email'   => trim((string) ($_POST['email'] ?? '')),
        'reason'  => (string) ($_POST['reason'] ?? ''),
        'message' => trim((string) ($_POST['message'] ?? '')),
    ];
    contact_redirect($contact_form_url, ['status' => 'expired']);
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
// reCAPTCHA v3
// ---------------------------------------------------------------------------

// Runs after the cheap local checks and before validation, so a submission
// that was never going to be sent doesn't cost an outbound request to Google,
// and one that fails the check doesn't get a field-by-field critique it has no
// use for.
//
// Skipped entirely when no keys are configured (a local checkout, a fork):
// the CSRF token, honeypot and rate limit above are then the whole defence,
// exactly as they were before this existed.
if (recaptcha_enabled()) {
    $token = (string) ($_POST['recaptcha_token'] ?? '');
    $keep = [
        'name'    => trim((string) ($_POST['name'] ?? '')),
        'email'   => trim((string) ($_POST['email'] ?? '')),
        'reason'  => (string) ($_POST['reason'] ?? ''),
        'message' => trim((string) ($_POST['message'] ?? '')),
    ];

    if ($token === '') {
        // No token means the script never ran: JavaScript off, an extension
        // blocking google.com, or a bot that didn't bother. All three are
        // answered the same way — keep what was typed, and point at the email
        // address, which needs no script at all.
        $_SESSION['contact_old'] = $keep;
        contact_redirect($contact_form_url, ['status' => 'nojs']);
    }

    $check = recaptcha_verify($token);

    // An unreachable Google is not the visitor's problem. Letting these
    // through loses nothing that matters: the token was still present, and
    // the honeypot, the CSRF check and the rate limit all held.
    if (!$check['reachable']) {
        error_log('TabbySync contact form: reCAPTCHA verification unreachable; submission allowed through.');
    } elseif (!$check['ok']) {
        $_SESSION['contact_old'] = $keep;
        contact_redirect($contact_form_url, ['status' => 'spam']);
    }
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
