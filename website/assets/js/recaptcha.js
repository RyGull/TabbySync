// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// recaptcha.js — gets a reCAPTCHA v3 token for the contact form.
//
// A separate file rather than an inline <script>, because the site's
// Content-Security-Policy allows no inline code and a test fails if any
// appears. It reads the site key from a data- attribute on the form instead
// of having one compiled into it, so no key is ever written into a file that
// git tracks.
//
// The token is fetched at submit time, not at page load. A v3 token expires
// two minutes after it is issued, and people take longer than two minutes to
// write a bug report — fetching it up front is how a form starts rejecting
// exactly the longest, most considered messages it receives.
(function () {
  "use strict";

  var form = document.getElementById("contactForm");
  if (!form) return;

  var siteKey = form.getAttribute("data-recaptcha-key");
  var field = document.getElementById("recaptchaToken");
  var warning = document.getElementById("recaptchaWarning");
  if (!siteKey || !field) return; // not configured on this deploy — nothing to do

  var submitting = false;

  /** Google's script failed to load (blocked, offline, DNS). Say so before
   *  anyone writes a long message that the server is going to refuse. */
  function showUnavailable() {
    if (warning) warning.hidden = false;
  }

  // grecaptcha.ready fires only once the API is up. If it never arrives, the
  // visitor gets told rather than left to find out on submit.
  var waited = 0;
  var poll = setInterval(function () {
    if (window.grecaptcha && window.grecaptcha.execute) {
      clearInterval(poll);
      return;
    }
    waited += 250;
    if (waited >= 6000) {
      clearInterval(poll);
      showUnavailable();
    }
  }, 250);

  form.addEventListener("submit", function (event) {
    if (submitting) return; // the real submit, after the token came back

    if (!window.grecaptcha || !window.grecaptcha.execute) {
      // Let it through to the server, which answers with the "spam check
      // couldn't run" page and the direct email address. Better than
      // swallowing the submission in JavaScript and leaving the visitor
      // clicking a button that does nothing.
      showUnavailable();
      return;
    }

    event.preventDefault();
    window.grecaptcha.ready(function () {
      window.grecaptcha
        .execute(siteKey, { action: "contact" })
        .then(function (token) {
          field.value = token;
          submitting = true;
          form.submit();
        })
        .catch(function () {
          showUnavailable();
          submitting = true;
          form.submit(); // same reasoning: the server explains, not this file
        });
    });
  });
})();
