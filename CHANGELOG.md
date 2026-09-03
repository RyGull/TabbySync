# Changelog

Notable changes to TabbySync. The privacy policy commits to noting material
changes here, so anything affecting what data is touched, where it goes, or who
can see it belongs in this file.

Versions before 1.3.0 predate this changelog; their history is in the git log.

## Unreleased

**Tabs sync.** Fixed a bug, not a behaviour change — no new data is touched.

- The tabs engine (self-hosted provider only) could get stuck showing
  "Error: conflict" after opening the browser, clearing only once you hit
  "Sync now" yourself. Two devices syncing around the same moment (e.g. both
  starting up together) would race on the very first write; a single retry
  often landed them back in conflict with each other, and that retry's
  failure was what actually reached the badge. `doSync` now allows a few
  more attempts, spaced out with jitter, so devices racing at the same
  instant don't just collide again on the retry.
- If it still can't get a clean write in after those retries, the error
  shown is no longer the bare word "conflict" — it now says what happened
  (another device wrote to the list at the same time), kept to one short
  line since it lands in the popup's narrow, non-truncating error row.
- A conflict that survives all of the above no longer just waits for the
  next scheduled sync (which can be minutes away) — the background worker
  now follows up again a minute later, up to 3 times, before falling back
  to the normal interval. Applies to automatic syncs and to a manual
  "Sync now" that still fails (it follows up in the background too, in
  case you don't retry it yourself).

## 1.3.0 — 2026-09-02

**Licensing.** TabbySync now carries an explicit licence, where before it was
unlicensed (and therefore, by default, all rights reserved with no permission
granted to anyone).

- Added `LICENSE`: source-available and proprietary, **not** open source. Free
  for personal, non-commercial use — install it, run it, self-host the server
  it generates, modify your own copy. No redistribution, no publishing to any
  add-on marketplace, no commercial use, no offering it as a hosted service.
  Reading and auditing the source stays open to anyone, for any purpose.
- Added `CONTRIBUTING.md`: code contributions are not accepted. Bug reports,
  feature suggestions and security reports are welcome.
- Added a warranty disclaimer and liability limit (LICENSE sections 7–8), which
  an unlicensed project has no benefit of at all.
- Added trademark and disclaimer notices to the README, and copyright headers
  to each source file.

**Testing.** No behaviour changed; this is a safety net for what was already
there.

- Added a 93-test suite covering the three-way bookmark merge, the tree model,
  the encryption envelope, bookmark import, and the sync providers. No
  dependencies, no browser: `npm test`.
- The merge tests pin down the properties that guard against data loss — a
  first sync unions rather than deletes, a lost base snapshot degrades to
  duplicates rather than deletion, an edited bookmark survives its folder being
  deleted on another device, move cycles are broken by reattaching.
- The provider tests pin down that a `412` is treated as a **conflict**, so a
  concurrent write from another device is re-merged rather than overwritten.
- The crypto tests check the claim the privacy policy makes: the stored
  envelope leaks none of the plaintext, and tampered ciphertext is rejected
  rather than decrypted.
- Added GitHub Actions CI running the suite, plus a `php -l` check on the
  generated `tabbysync.php`.

**Privacy policy.** Audited against the code, then corrected. Seven gaps were
found; none were false claims, all were omissions or overstatements.

- Documented the **Delete data** feature, which shipped without any mention in
  the policy, including its limits: it does not touch your actual bookmarks or
  tabs, and a provider may keep its own backups after honouring a deletion.
- Stated what encryption does **not** hide: the file name contains your sync
  name in plain text, and the file's size and write times remain visible to
  whoever hosts it.
- Disclosed that merely *opening* the Feedback screen loads the page, so the
  developer's host and Google reCAPTCHA see a request (IP, browser, OS) before
  anything is submitted. Nothing about your bookmarks, tabs or settings is sent.
- Warned that a plain `http://` sync endpoint is accepted but travels the
  network unencrypted.
- Disclosed that an unencrypted local export writes readable JSON to disk.
- Named the responsible individual and added a retention/deletion route for
  feedback messages.
- Corrected the stale "Last updated" date.

Added `test/privacy-policy.test.js`, which checks the policy against the code on
every push: the permission table matches the manifest in both directions, every
requested permission is actually used, no history/webRequest/cookies/scripting
API is touched, nothing listens for tab navigation, host access is requested one
origin at a time and never as a wildcard, no host outside the disclosed set is
reachable, no page loads a remote asset, no analytics primitive exists, storage
is local rather than browser cloud sync, and no secret enters an uploaded
payload.

**Removed the embedded feedback form.** It was the only part of TabbySync that
contacted a server operated by the developer, and the only part whose behaviour
could not be verified from this repository.

- The popup's Feedback screen and its iframe are gone. Feedback now opens your
  own email client with a blank message and a subject naming the version.
  Nothing is prefilled — no bookmarks, tabs, settings, tokens or identifiers.
- TabbySync therefore contacts **no server operated by its developer, ever**:
  not for feedback, updates, licence checks or anything else. The only hosts it
  can reach are your configured sync destination and, if you choose one,
  GitHub or JSONBin.io. This is now enforced by a test.
- Google reCAPTCHA is no longer involved anywhere in the product.
- The contact address is assembled at runtime (`shared/contact.js`) rather than
  written out, so it does not sit in the shipped bundle or the published policy
  as something an address harvester's regex will match. This is friction, not
  protection — anyone reading the source can reconstruct it — so the address
  should be a forwarding alias that can be rotated.

**Marketing site.** Added `website/`, a responsive PHP landing page for
tabbysync.com. Separate deployable, not part of the extension bundle and not
loaded by it -- see website/README.md.

- No third-party requests of any kind: system fonts, hand-drawn inline SVG,
  no analytics, no icon CDN. A "no tracking" extension's own website making
  third-party requests would undercut the claim.
- The contact address is assembled from parts at request time and rendered
  as HTML numeric character references rather than a literal string, so it
  isn't a plain match for a scraper's regex -- friction, not protection, the
  same caveat as the extension's own shared/contact.js.
- Content is visible with JavaScript disabled. The scroll-reveal animation
  only hides an element that JS has confirmed both ran and found off-screen;
  nothing is hidden unconditionally in CSS.
- No Chrome Web Store link yet, because there isn't a listing yet -- the
  primary CTA points at the GitHub source instead of a link to nowhere.
- Links straight to privacy.html on GitHub rather than duplicating the
  policy, so there is exactly one copy for test/privacy-policy.test.js to
  keep honest.
- Verified rendered, not just linted: served with PHP's built-in server and
  exercised with Playwright (real viewport emulation, not raw headless-Chrome
  flags, which turned out to misrepresent mobile layout entirely) across
  desktop, mobile and dark mode, with JavaScript disabled, and under both a
  slow real-scroll simulation and a straight jump to the bottom of the page.
  One genuine bug surfaced this way and was fixed before shipping: content
  below the fold was invisible without JavaScript. A second suspected bug
  (a heading that stayed invisible after simulated scrolling) turned out to
  be a test-harness artifact -- CSS `scroll-behavior: smooth` interrupting a
  synthetic scroll loop, confirmed by forcing an instant jump in the test and
  seeing it disappear; real wheel/trackpad input is unaffected by that CSS
  property.
- `test/privacy-policy.test.js`'s file scan explicitly excludes `website/`,
  which is a separate deployable with a different threat model (external
  links are normal on a marketing page).

**Fixes.**

- `providers.put` and `storage.pushRemote` reported a missing configuration by
  throwing synchronously while every other error in those modules arrived as a
  rejected promise. Both now reject. No current caller was affected — both were
  already inside `try`/`await` or `.then()` — but a caller using `.catch()`
  would have missed the error entirely.
- Added `.gitattributes` so `merge.js`, which uses NUL characters as key
  delimiters, produces readable diffs instead of being detected as binary.
