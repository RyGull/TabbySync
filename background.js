// background.js — SyncLocker's shared service worker (MV3, module type).
//
// It hosts BOTH engines behind one toolbar action and one options page:
//   1. shared config     — single source of truth for the storage keys
//   2. shared status      — one combined toolbar badge
//   3. tabs engine        — storage.js (globals) + its worker logic
//   4. bookmarks engine   — its worker logic (ES modules under ./bookmarks)
//
// Order matters: the shared globals must be installed before the engines run.
import './shared/config.js';       // sets self.SyncLockerConfig
import './shared/status.js';       // sets self.SyncLockerStatus
import './tabs/storage.js';        // sets self.TabStash
import './tabs/background-core.js';
import './bookmarks/background-core.js';
