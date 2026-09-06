// vendor-parity.test.js — most of the Control Panel's core is either an
// unmodified copy of an extension file (see vendor/MANIFEST.json — those need
// no parity check, they're the same bytes) or new code with no extension
// counterpart. Exactly two small pieces were re-typed by hand instead,
// because vendoring their real home would have dragged in unrelated
// chrome.bookmarks-calling code (see the comments in provider-shim.js and
// remote-bookmarks.js). This file is what keeps those two honest against the
// real, non-vendored source if it ever changes.
//
// Reaches outside control-panel/ on purpose (../../bookmarks, ../../shared) —
// fine for a test, which never ships, unlike src/core's vendor/-only imports.

import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeSyncName } from '../src/core/provider-shim.js';
import { deletionLooksWrong, BRAKE_MIN_BOOKMARKS, BRAKE_MIN_KEPT_FRACTION } from '../src/core/remote-bookmarks.js';

// shared/config.js is a classic self-assigning script, same load dance as in
// the extension's own tests (see ../../test/providers.test.js).
globalThis.self = globalThis;
await import('../../shared/config.js');
const realSanitize = globalThis.self.TabbySyncConfig.sanitizeSyncName;

const { deletionLooksWrong: realDeletionLooksWrong, BRAKE_MIN_BOOKMARKS: realMin, BRAKE_MIN_KEPT_FRACTION: realFraction } =
  await import('../../bookmarks/lib/engine.js');

test('sanitizeSyncName matches shared/config.js for a range of inputs', () => {
  const cases = [
    '', 'work', 'Work Laptop', '  spaced  ', 'a.b-c_d', '../../etc/passwd',
    'ünïcode', 'trailing.', '.leading', '-dash-', 'x'.repeat(80),
    'semi;colon', 'slash/es\\here', 'emoji😀name', '...', '---',
  ];
  for (const input of cases) {
    assert.equal(sanitizeSyncName(input), realSanitize(input), `mismatch for input ${JSON.stringify(input)}`);
  }
});

test('the brake constants match bookmarks/lib/engine.js', () => {
  assert.equal(BRAKE_MIN_BOOKMARKS, realMin);
  assert.equal(BRAKE_MIN_KEPT_FRACTION, realFraction);
});

test('deletionLooksWrong matches bookmarks/lib/engine.js across a grid of counts', () => {
  for (let localCount = 0; localCount <= 60; localCount += 3) {
    for (let mergedCount = 0; mergedCount <= 60; mergedCount += 3) {
      assert.equal(
        deletionLooksWrong(localCount, mergedCount),
        realDeletionLooksWrong(localCount, mergedCount),
        `mismatch at local=${localCount} merged=${mergedCount}`
      );
    }
  }
});
