# Changelog

Notable changes to TabbySync. The privacy policy commits to noting material
changes here, so anything affecting what data is touched, where it goes, or who
can see it belongs in this file.

Versions before 1.3.0 predate this changelog; their history is in the git log.

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

**Fixes.**

- `providers.put` and `storage.pushRemote` reported a missing configuration by
  throwing synchronously while every other error in those modules arrived as a
  rejected promise. Both now reject. No current caller was affected — both were
  already inside `try`/`await` or `.then()` — but a caller using `.catch()`
  would have missed the error entirely.
- Added `.gitattributes` so `merge.js`, which uses NUL characters as key
  delimiters, produces readable diffs instead of being detected as binary.
