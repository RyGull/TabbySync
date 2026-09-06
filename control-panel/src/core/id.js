// id.js — ids for things the Control Panel itself creates.
//
// New bookmark/folder nodes need SOME id, but it doesn't need to match any
// browser's id scheme: the merge algorithm (vendor/bookmarks-lib/merge.js)
// unifies independently-created-but-equivalent nodes by semantic key (a
// folder's title, a bookmark's normalized URL), not by id, the first time it
// meets a device that already has them. The "cp-" prefix just keeps these
// visibly distinct from a live browser's own ids (plain numbers on Chromium,
// GUID-like strings on Firefox) in logs/debugging.
'use strict';

export function newId(prefix = 'cp') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
