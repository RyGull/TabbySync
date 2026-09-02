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

**Fixes.**

- `providers.put` and `storage.pushRemote` reported a missing configuration by
  throwing synchronously while every other error in those modules arrived as a
  rejected promise. Both now reject. No current caller was affected — both were
  already inside `try`/`await` or `.then()` — but a caller using `.catch()`
  would have missed the error entirely.
- Added `.gitattributes` so `merge.js`, which uses NUL characters as key
  delimiters, produces readable diffs instead of being detected as binary.
