<?php
declare(strict_types=1);

session_start();

require_once __DIR__ . '/config.php';

/**
 * The URL this page is being served from, used both as the form's action and
 * as the handler's redirect target. Posting a form back to the exact URL that
 * just rendered it is the one action guaranteed not to hit a host-level
 * redirect — and a 301 in front of the old separate handler was turning
 * submissions into bodyless GETs, which is what "fill in every field" really
 * meant. Anything that isn't a plain path falls back to the canonical name.
 */
$contact_form_url = strtok((string) ($_SERVER['REQUEST_URI'] ?? ''), '?');
if ($contact_form_url === false || !preg_match('#^/[A-Za-z0-9._~!$&\'()*+,;=:@%/-]*$#', $contact_form_url)) {
    $contact_form_url = '/contact.php';
}

// Handle our own submission. The handler always ends in a redirect, so
// nothing below runs on a POST — that's the usual post/redirect/get, which
// keeps a browser refresh from re-sending the message.
if (($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    require __DIR__ . '/includes/contact-handler.php';
}

$status = $_GET['status'] ?? null;
$notice = null;

if ($status === 'ok') {
    $notice = ['type' => 'success', 'text' => "Thanks — your message is on its way. We'll get back to you soon."];
} elseif ($status === 'invalid') {
    $notice = ['type' => 'error', 'text' => 'We couldn\'t send that yet — see the note under each field below.'];
} elseif ($status === 'notsent') {
    // The handler ran without a submission attached to it. Not the visitor's
    // fault, so don't tell them to go fill fields in. The `why` detail says
    // which way it went missing, which is the difference between a redirect
    // in front of the form and a proxy stripping the request body.
    $notice = ['type' => 'error', 'text' => "Your message didn't reach us — the form data went missing on the way. Please try sending it again, or email us directly."];
    $why = $_GET['why'] ?? null;
    if ($why === 'method') {
        $notice['detail'] = 'Technical detail: the submission reached the server as a GET with no data, not a POST — something is redirecting it.';
    } elseif ($why === 'empty') {
        $notice['detail'] = 'Technical detail: the submission reached the server as a POST, but with none of the form fields in it.';
    }
} elseif ($status === 'error') {
    $notice = ['type' => 'error', 'text' => "Something went wrong on our end and your message wasn't sent. Please try again, or email us directly."];
}

// Re-populate the form after a validation error, without persisting anything.
$old = $_SESSION['contact_old'] ?? [];
$errors = $_SESSION['contact_errors'] ?? [];
unset($_SESSION['contact_old'], $_SESSION['contact_errors']);

/** Renders the complaint about one field, if there was one. */
function field_error(array $errors, string $field): void
{
    if (isset($errors[$field])) {
        echo '<p class="field-error" id="' . $field . '-error">';
        e($errors[$field]);
        echo '</p>';
    }
}

/** Marks a field as rejected for screen readers, and points it at its note. */
function field_invalid_attrs(array $errors, string $field): void
{
    if (isset($errors[$field])) {
        echo ' aria-invalid="true" aria-describedby="' . $field . '-error"';
    }
}

$page_title       = 'Contact — ' . SITE_NAME;
$page_description = 'Get in touch with ' . SITE_NAME . ' — questions, feedback, and bug reports all welcome.';
require __DIR__ . '/includes/header.php';
?>

<section class="page-hero">
  <div class="wrap">
    <span class="eyebrow">Contact</span>
    <h1>Get in touch</h1>
    <p class="page-lede">
      Questions, feedback, and bug reports are all welcome — pick whichever
      fits below and tell us what's up. We read every message.
    </p>
  </div>
</section>

<section class="contact-section">
  <div class="wrap content-narrow">

    <?php if ($notice): ?>
      <div class="notice <?= e($notice['type']) ?>">
        <?= e($notice['text']) ?>
        <?php if (isset($notice['detail'])): ?>
          <span class="notice-detail"><?= e($notice['detail']) ?></span>
        <?php endif; ?>
      </div>
    <?php endif; ?>

    <form class="form-grid" action="<?= e($contact_form_url) ?>" method="post">
      <div class="form-row two-col">
        <div class="form-row">
          <label for="name">Name</label>
          <input type="text" id="name" name="name" required maxlength="120"
            value="<?= e($old['name'] ?? '') ?>"<?php field_invalid_attrs($errors, 'name'); ?>>
          <?php field_error($errors, 'name'); ?>
        </div>
        <div class="form-row">
          <label for="email">Email</label>
          <input type="email" id="email" name="email" required maxlength="254"
            value="<?= e($old['email'] ?? '') ?>"<?php field_invalid_attrs($errors, 'email'); ?>>
          <?php field_error($errors, 'email'); ?>
        </div>
      </div>

      <div class="form-row">
        <label for="reason">What's this about?</label>
        <select id="reason" name="reason" required<?php field_invalid_attrs($errors, 'reason'); ?>>
          <?php foreach (CONTACT_REASONS as $value => $label): ?>
            <option value="<?= e($value) ?>" <?= ($old['reason'] ?? '') === $value ? 'selected' : '' ?>><?= e($label) ?></option>
          <?php endforeach; ?>
        </select>
        <?php field_error($errors, 'reason'); ?>
      </div>

      <div class="form-row">
        <label for="message">Message</label>
        <textarea id="message" name="message" required maxlength="5000"
          placeholder="Tell us what's on your mind. For a bug report, include what you expected, what happened instead, and your browser/OS if relevant."<?php field_invalid_attrs($errors, 'message'); ?>><?= e($old['message'] ?? '') ?></textarea>
        <?php field_error($errors, 'message'); ?>
      </div>

      <!-- Honeypot, kept empty by real visitors. The name is deliberately
           meaningless: a field called "website" gets filled in by browser
           autofill and password managers, which silently binned real
           messages as spam. -->
      <input type="text" name="tsc_hp" class="honeypot" tabindex="-1"
        autocomplete="off" aria-hidden="true">

      <button type="submit" class="btn btn-primary">Send message</button>
    </form>

    <p class="contact-alt">
      Prefer email? Reach us directly at
      <a href="mailto:<?php echo_obfuscated(contact_address()); ?>"><?php echo_obfuscated(contact_address()); ?></a>.
    </p>
  </div>
</section>

<?php require __DIR__ . '/includes/footer.php'; ?>
