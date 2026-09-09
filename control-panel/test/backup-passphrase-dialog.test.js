// backup-passphrase-dialog.test.js — the ordering rule that makes importing
// an encrypted backup work at all.
//
// The bug this file exists to prevent, in full, because it is invisible from
// the outside: openModal({ onClose }) calls onClose however the modal ends up
// closing — including when the caller closes it itself on a success path.
// askBackupPassphrase used that callback as its "cancelled" signal AND closed
// the modal itself once the passphrase had been accepted:
//
//     const r = await api.backup.read({ filePath, passphrase: pass.value });
//     m.close();                                  // -> onClose -> resolve(null)
//     resolve({ ...r, passphrase: pass.value });  // ignored; already settled
//
// A promise settles once, so the null won. openImportModal's `if (!opened)
// return` then turned that into: type the right passphrase, watch the dialog
// close, and nothing else happens. No error, no toast, nothing in the log.
// Only encrypted backups reach this dialog, so plaintext imports kept working
// and hid it.
//
// Read as text rather than by importing, for the same reason lock-gate.test.js
// does: renderer/app.js is a classic script that touches document at load
// time, and there is no DOM in this runner. The first test below executes the
// real semantics anyway, by rebuilding the two functions' control flow from
// what the source actually says.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const CP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = await readFile(path.join(CP_ROOT, 'renderer/app.js'), 'utf8');

/** The source of one top-level `function name(...) {...}`, brace-matched.
 *
 *  The parameter list has to be stepped over before counting braces, or a
 *  destructured signature like openModal({ title, body }) ends the match on
 *  its own parameters and hands back the signature alone. */
function functionSource(name) {
  const start = app.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name}() not found in renderer/app.js`);

  let parens = 0;
  let i = app.indexOf('(', start);
  for (; i < app.length; i += 1) {
    if (app[i] === '(') parens += 1;
    else if (app[i] === ')' && (parens -= 1) === 0) break;
  }

  let depth = 0;
  for (let j = app.indexOf('{', i); j < app.length; j += 1) {
    if (app[j] === '{') depth += 1;
    else if (app[j] === '}' && (depth -= 1) === 0) return app.slice(start, j + 1);
  }
  throw new Error(`${name}() is not brace-balanced`);
}

const openModalSrc = functionSource('openModal');
const askSrc = functionSource('askBackupPassphrase');

test('openModal calls onClose on every close, including the caller’s own', () => {
  // This is the hazard the rest of the file guards against. If openModal ever
  // starts distinguishing "dismissed" from "closed by the caller", the
  // ordering rule below stops being load-bearing — but until it does, any
  // caller that treats onClose as a cancellation must handle its own close.
  const close = openModalSrc.slice(openModalSrc.indexOf('function close()'));
  assert.match(close, /if \(onClose\) onClose\(\);/,
    'openModal no longer calls onClose unconditionally — re-check every caller that treats it as "cancelled"');
  assert.ok(!/dismiss|reason|byUser/.test(close),
    'close() looks like it now reports how it was closed; askBackupPassphrase should use that instead of a settle guard');
});

test('the passphrase dialog settles exactly once', () => {
  // Without this, onClose's null and the success path's result race, and
  // whichever runs first wins.
  assert.match(askSrc, /let settled = false;/,
    'askBackupPassphrase has no settle-once guard, so onClose can resolve over a real result');
  assert.match(askSrc, /if \(settled\) return;\s*settled = true;/,
    'the guard does not actually stop a second settle');
  assert.ok(!/\bresolve\(/.test(askSrc.replace(/const settle = \([^)]*\) => \{[^}]*\};/, '')),
    'askBackupPassphrase calls resolve() directly somewhere; every path must go through settle()');
});

test('the accepted passphrase is settled BEFORE the dialog is closed', () => {
  // The regression itself. Closing first re-enters onClose, which settles
  // null, and the result that arrives a line later is discarded.
  const settleResult = askSrc.search(/settle\(\{\s*\.\.\.r,/);
  const closeAfter = askSrc.indexOf('m.close()', settleResult);
  assert.ok(settleResult >= 0,
    'nothing settles the read result — an accepted passphrase would import nothing');
  assert.ok(closeAfter > settleResult,
    'the dialog is closed before the result is settled: onClose settles null first, and the import silently does nothing');
});

test('every dismissal routes through onClose, and settles null', () => {
  assert.match(askSrc, /onClose: \(\) => settle\(null\)/,
    'onClose no longer settles null — dismissing the dialog would hang the import promise forever');
  // Cancel must not settle on its own: it closes, and onClose does the rest.
  // Two sources of truth for "cancelled" is how the original bug started.
  const cancel = askSrc.slice(askSrc.indexOf("'Cancel'") - 200, askSrc.indexOf("'Cancel'"));
  assert.ok(!/resolve\(null\)|settle\(null\)/.test(cancel),
    'the Cancel button settles as well as closing; let onClose be the single cancelled path');
});

test('a dialog that is only reached for encrypted files still gates on that', () => {
  // The reason the bug survived: plaintext backups never open this dialog, so
  // the working path and the broken one look identical from the Backup screen.
  const opener = functionSource('openImportModal');
  assert.match(opener, /if \(picked\.needsPassphrase\)/,
    'openImportModal no longer branches on needsPassphrase');
  assert.match(opener, /if \(!opened\) return;/,
    'the cancelled path no longer returns early — a null would flow into showImportChoices');
});
