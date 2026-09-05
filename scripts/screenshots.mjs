// TabbySync — Copyright (c) 2026 Ryan Gulliver. All rights reserved.
// Personal, non-commercial use only. No redistribution. See LICENSE.

// screenshots.mjs — regenerate every product screenshot from the real
// extension, in both light and dark mode.
//
//   node scripts/screenshots.mjs          (needs playwright + a Chromium)
//
// Nothing here is a mockup: it loads this working tree as an unpacked
// extension in a throwaway Chromium profile, seeds chrome.storage.local with
// the demo data below, and photographs the actual popup, tab list and options
// pages. Change the UI and re-run this — the pictures follow the code.
//
// The demo profile points at https://sync.example.com/tabbysync.php, which
// obviously doesn't answer, so the background sync that fires when the config
// lands would leave a red "Sync error" in the status line. The seeded state is
// re-stamped once that attempt has settled so the screenshots show an ordinary
// healthy profile rather than the artifact of having no server here.
//
// Three sets are written, all under docs/screenshots/:
//   raw/    2x captures straight out of the browser (git-ignored, regenerate)
//   web/    downscaled PNGs used by the marketing site and the README
//   store/  1280x800 framed images for the Chrome Web Store, which accepts
//           only 1280x800 or 640x400, no alpha
//   og/     the 1200x630 social card the marketing site points every Open
//           Graph and Twitter tag at
import { chromium } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'docs', 'screenshots');
const RAW = path.join(DIR, 'raw');
const WEB = path.join(DIR, 'web');
const STORE = path.join(DIR, 'store');
const OG = path.join(DIR, 'og');
for (const d of [RAW, WEB, STORE, OG]) fs.mkdirSync(d, { recursive: true });

const THEMES = ['light', 'dark'];

// A fixed clock, not Date.now(). Every "last sync" and "3 tabs · <date>" in
// these screenshots is derived from it, so a re-run with no UI change produces
// byte-identical files instead of a fresh set of PNGs whose only difference is
// the minute they were taken — which is the difference between a generator you
// can re-run freely and one that quietly adds a megabyte to the repository
// every time. Move it forward if the dates ever start looking archaeological.
const now = Date.parse('2026-09-05T19:40:00Z');
const min = 60 * 1000;

// ---- the demo profile ------------------------------------------------------
// Plausible, boring, and entirely made up: no real token, no real address, and
// nothing here belongs to anyone. "demo-passphrase" only exists so the UI shows
// its encrypted-profile state.

const groups = [
  {
    id: 'g-research', createdAt: now - 42 * min, updatedAt: now - 8 * min,
    name: 'Reading list', locked: false, pinned: true,
    tabs: [
      { url: 'https://developer.mozilla.org/en-US/docs/Web/API/Storage', title: 'Storage API - Web APIs | MDN', favIconUrl: '' },
      { url: 'https://developer.chrome.com/docs/extensions/reference/api/tabGroups', title: 'chrome.tabGroups | Chrome Extensions', favIconUrl: '' },
      { url: 'https://www.w3.org/TR/webcrypto-2/', title: 'Web Cryptography API Level 2', favIconUrl: '' },
      { url: 'https://caniuse.com/mdn-api_crypto_subtle', title: 'SubtleCrypto | Can I use...', favIconUrl: '' },
    ],
  },
  {
    id: 'g-work', createdAt: now - 3 * 60 * min, updatedAt: now - 55 * min,
    name: 'Work — release 1.3.9', locked: true, pinned: false,
    tabs: [
      { url: 'https://github.com/RyGull/TabbySync', title: 'RyGull/TabbySync: Self-hosted sync for bookmarks and tabs', favIconUrl: '' },
      { url: 'https://github.com/RyGull/TabbySync/blob/main/CHANGELOG.md', title: 'TabbySync — CHANGELOG', favIconUrl: '' },
      { url: 'https://chromewebstore.google.com/', title: 'Chrome Web Store', favIconUrl: '' },
    ],
  },
  {
    id: 'g-home', createdAt: now - 26 * 60 * min, updatedAt: now - 26 * 60 * min,
    name: '', locked: false, pinned: false,
    tabs: [
      { url: 'https://www.raspberrypi.com/documentation/computers/os.html', title: 'Raspberry Pi OS documentation', favIconUrl: '' },
      { url: 'https://www.php.net/manual/en/features.file-upload.php', title: 'PHP: Handling file uploads - Manual', favIconUrl: '' },
      { url: 'https://letsencrypt.org/getting-started/', title: 'Getting Started - Let’s Encrypt', favIconUrl: '' },
      { url: 'https://news.ycombinator.com/', title: 'Hacker News', favIconUrl: '' },
      { url: 'https://old.reddit.com/r/selfhosted/', title: 'r/selfhosted', favIconUrl: '' },
    ],
  },
];

// The popup reports bookmark counts from the engine's cached tree, so seed one
// rather than creating browser bookmarks and waiting for a sync that can't run.
const bm = (id, title, url) => ({ id, type: 'bookmark', title, url, mtime: now - 60 * min });
const folder = (id, title, children) => ({ id, type: 'folder', title, mtime: now - 60 * min, orderRev: 1, children });
const cacheTree = folder('root', '', [
  folder('__bar__', 'Bookmarks bar', [
    folder('f-dev', 'Development', [
      bm('b1', 'MDN Web Docs', 'https://developer.mozilla.org/'),
      bm('b2', 'Chrome Extensions', 'https://developer.chrome.com/docs/extensions/'),
      bm('b3', 'GitHub', 'https://github.com/'),
      bm('b4', 'Stack Overflow', 'https://stackoverflow.com/'),
    ]),
    folder('f-selfhost', 'Self-hosting', [
      bm('b5', 'Let’s Encrypt', 'https://letsencrypt.org/'),
      bm('b6', 'PHP Manual', 'https://www.php.net/manual/en/'),
      bm('b7', 'Raspberry Pi', 'https://www.raspberrypi.com/'),
    ]),
    bm('b8', 'TabbySync', 'https://github.com/RyGull/TabbySync'),
  ]),
  folder('__other__', 'Other bookmarks', [
    folder('f-read', 'Read later', [
      bm('b9', 'Hacker News', 'https://news.ycombinator.com/'),
      bm('b10', 'Lobsters', 'https://lobste.rs/'),
      bm('b11', 'r/selfhosted', 'https://old.reddit.com/r/selfhosted/'),
    ]),
    bm('b12', 'Web Crypto API', 'https://www.w3.org/TR/webcrypto-2/'),
  ]),
]);

const seed = {
  'sl.provider': 'custom',
  'sl.serverUrl': 'https://sync.example.com/tabbysync.php',
  'sl.token': 'demo-token-not-a-real-secret',
  'sl.syncName': 'work-laptop',
  'sl.passphrase': 'demo-passphrase',
  'sl.profileLabel': 'Work laptop',
  'sl.bm.enabled': true,
  'sl.bm.autoSync': true,
  'sl.bm.intervalMin': 15,
  'sl.bm.deleteWins': true,
  'sl.bm.cacheTree': cacheTree,
  'sl.tab.enabled': true,
  'sl.tab.intervalMin': 5,
  'sl.tab.dedupe': 'group',
  'sl.tab.restoreAsGroup': false,
  'sl.tab.removeOnRestore': false,
  'sl.tab.pinList': false,
  'sl.tab.state': { version: 1, groups, deleted: {}, trash: [], trashDeleted: {}, updatedAt: now - 8 * min },
};

// Written after the unreachable-server sync attempt has settled — see the file
// header. These keys are status only; changing them starts no new sync.
const settled = {
  'sl.bm.lastSync': now - 6 * min,
  'sl.bm.lastStatus': 'ok',
  'sl.bm.lastError': '',
  'sl.tab.status': { status: 'ok', error: '', at: now - 4 * min },
};

const PAGES = [
  { name: 'popup', page: 'popup.html', viewport: { width: 460, height: 900 }, fitToBody: true },
  { name: 'tablist', page: 'tabs/tablist.html', viewport: { width: 1280, height: 800 } },
  { name: 'options', page: 'options.html', viewport: { width: 1280, height: 800 } },
  // The bookmarks/tabs cards are below the fold on a 800px-tall options page.
  { name: 'options-engines', page: 'options.html', viewport: { width: 1280, height: 800 }, scrollTo: '#bmCard' },
];

// ---- 1. capture ------------------------------------------------------------

async function capture() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tabbysync-shots-'));
  const ctx = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // MV3 service workers + extension pages want a real browser
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
    args: [
      `--disable-extensions-except=${ROOT}`,
      `--load-extension=${ROOT}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
    ],
  });

  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 30000 });
  const extId = new URL(sw.url()).host;
  const url = (p) => `chrome-extension://${extId}/${p}`;

  const seeder = await ctx.newPage();
  await seeder.goto(url('options.html'));
  await seeder.evaluate(async (data) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set(data);
  }, seed);
  await seeder.waitForTimeout(6000); // let the doomed first sync finish
  await seeder.evaluate(async (d) => { await chrome.storage.local.set(d); }, settled);
  await seeder.close();

  for (const theme of THEMES) {
    for (const s of PAGES) {
      const page = await ctx.newPage();
      await page.setViewportSize(s.viewport);
      await page.emulateMedia({ colorScheme: theme });
      // shared/theme.js reads the choice from localStorage on this origin, so
      // set it there rather than relying on the OS preference alone.
      await page.goto(url('popup.html'));
      await page.evaluate((t) => localStorage.setItem('sl.theme', t), theme);
      await page.goto(url(s.page));
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.evaluate(async (d) => { await chrome.storage.local.set(d); }, settled);
      await page.waitForTimeout(1200);

      if (s.scrollTo) {
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 16, behavior: 'instant' });
        }, s.scrollTo);
        await page.waitForTimeout(400);
      }
      if (s.fitToBody) {
        const box = await page.evaluate(() => ({
          width: Math.ceil(document.body.getBoundingClientRect().width),
          height: Math.ceil(document.body.scrollHeight),
        }));
        await page.setViewportSize(box);
        await page.waitForTimeout(300);
      }

      const file = path.join(RAW, `${s.name}-${theme}.png`);
      await page.screenshot({ path: file });
      console.log('raw   ', path.relative(ROOT, file));
      await page.close();
    }
  }

  await ctx.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

// ---- 2. downscale for the site + README ------------------------------------

const dataUri = (dir, file) =>
  'data:image/png;base64,' + fs.readFileSync(path.join(dir, file)).toString('base64');

// Width and height live at bytes 16..24 of a PNG's IHDR — enough to keep the
// aspect ratio without pulling in an image library.
function pngSize(file) {
  const b = fs.readFileSync(file);
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

const WEB_WIDTHS = { popup: 480, tablist: 1280, options: 1280, 'options-engines': 1280 };

async function downscale(browser) {
  for (const theme of THEMES) {
    for (const s of PAGES) {
      const name = `${s.name}-${theme}.png`;
      const width = WEB_WIDTHS[s.name];
      const src = pngSize(path.join(RAW, name));
      const height = Math.round((src.height / src.width) * width);
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      await page.setContent(
        `<style>html,body{margin:0;padding:0}img{display:block;width:${width}px;height:${height}px}</style>` +
        `<img src="${dataUri(RAW, name)}">`);
      await page.waitForTimeout(200);
      await page.screenshot({ path: path.join(WEB, name), clip: { x: 0, y: 0, width, height } });
      await page.close();
      console.log('web   ', path.relative(ROOT, path.join(WEB, name)), `${width}x${height}`);
    }
  }
}

// ---- 3. frame for the Chrome Web Store -------------------------------------

const COPY = {
  popup: {
    title: 'Two tools, one popup',
    body: 'Bookmarks and open tabs, each with its own on/off switch, live counts and last-sync time — sharing one destination, one token and one sync name.',
  },
  tablist: {
    title: 'Close the tabs, keep the tabs',
    body: 'Saved lists you can name, pin, lock, search and reopen — one link, one list, or everything, on any of your computers. Anything you delete waits 30 days before it is really gone.',
  },
  options: {
    title: 'Setup is four questions long',
    body: 'Where your data lives, how to reach it, what to call this group of computers, and a password to lock it with. Your own website is the most private; GitHub or a free service work if you have no server.',
  },
  'options-engines': {
    title: 'Everything else, one click away',
    body: 'Bookmarks and tabs each get a switch and a sentence. Intervals, duplicate handling, restore behaviour and backups are all still there, folded behind “More options”.',
  },
};

const frameCss = (theme) => {
  const light = theme === 'light';
  return `
    :root{
      --bg1:${light ? '#ffffff' : '#171a21'};
      --bg2:${light ? '#e9eef6' : '#0f1116'};
      --text:${light ? '#131925' : '#f2f4f7'};
      --muted:${light ? '#5a6474' : '#a6aebc'};
      --edge:${light ? 'rgba(19,25,37,.10)' : 'rgba(255,255,255,.12)'};
      --shadow:${light ? '0 24px 60px rgba(19,25,37,.18)' : '0 24px 60px rgba(0,0,0,.55)'};
    }
    *{box-sizing:border-box;margin:0;padding:0;}
    body{width:1280px;height:800px;overflow:hidden;
      background:radial-gradient(1200px 700px at 12% -10%, var(--bg1), var(--bg2));
      color:var(--text);font:400 16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}
    /* the extension's own two-engine split: bookmarks blue, tabs orange */
    .accent{height:6px;background:linear-gradient(90deg,#2563eb 0%,#2563eb 50%,#ea580c 50%,#ea580c 100%);}
    h1{font-size:38px;line-height:1.15;font-weight:800;letter-spacing:-.02em;}
    p.body{font-size:18px;line-height:1.5;color:var(--muted);}
    .shot{border:1px solid var(--edge);border-radius:14px;box-shadow:var(--shadow);
      overflow:hidden;background:${light ? '#fff' : '#1e222a'};}
    .shot img{display:block;width:100%;}
    .wide{padding:34px 44px 0;}
    .wide h1{max-width:1000px;}
    .wide p.body{margin-top:10px;max-width:900px;}
    .wide .shot{margin-top:22px;height:580px;}
    .split{display:flex;align-items:center;gap:56px;padding:0 68px;height:794px;}
    .split .copy{flex:1 1 auto;max-width:600px;}
    .split h1{font-size:42px;}
    .split p.body{margin-top:14px;}
    .split .shot{flex:0 0 auto;width:372px;}
  `;
};

async function frame(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  for (const theme of THEMES) {
    for (const s of PAGES) {
      const c = COPY[s.name];
      const img = dataUri(RAW, `${s.name}-${theme}.png`);
      const wide = s.name !== 'popup';
      const html = `<title>${s.name}</title><style>${frameCss(theme)}</style><div class="accent"></div>` + (wide
        ? `<div class="wide"><h1>${c.title}</h1><p class="body">${c.body}</p>
             <div class="shot"><img src="${img}" alt=""></div></div>`
        : `<div class="split"><div class="copy"><h1>${c.title}</h1><p class="body">${c.body}</p></div>
             <div class="shot"><img src="${img}" alt=""></div></div>`);
      await page.setContent(html);
      await page.waitForTimeout(250);
      const out = path.join(STORE, `${s.name}-${theme}-1280x800.png`);
      await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1280, height: 800 } });
      console.log('store ', path.relative(ROOT, out));
    }
  }
  await page.close();
}

// ---- 4. the social card ----------------------------------------------------

// One 1200x630 image, the size every link preview crops toward. The site
// pointed og:image at the 256px app icon before this existed, which every
// platform letterboxes into a grey square — a card that shows the actual
// product is the whole difference between a link that looks like software and
// a link that looks like nothing.
async function socialCard(browser) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  const logo = 'data:image/png;base64,' +
    fs.readFileSync(path.join(ROOT, 'icons', 'logo-light.png')).toString('base64');
  const shot = dataUri(RAW, 'popup-light.png');
  await page.setContent(`<style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{width:1200px;height:630px;overflow:hidden;color:#131925;
      background:radial-gradient(900px 600px at 8% -20%, #ffffff, #e6ecf6);
      font:400 16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;}
    .accent{height:8px;background:linear-gradient(90deg,#2563eb 0%,#2563eb 50%,#ea580c 50%,#ea580c 100%);}
    .row{display:flex;align-items:center;gap:54px;padding:0 72px;height:622px;}
    .copy{flex:1 1 auto;}
    .logo{height:62px;width:auto;display:block;margin-bottom:26px;}
    h1{font-size:44px;line-height:1.14;font-weight:800;letter-spacing:-.02em;max-width:15ch;}
    p{margin-top:18px;font-size:21px;line-height:1.45;color:#4d5866;max-width:26ch;}
    .tags{margin-top:26px;display:flex;gap:10px;flex-wrap:wrap;}
    .tag{font-size:15px;font-weight:600;padding:7px 13px;border-radius:999px;
      border:1px solid rgba(19,25,37,.14);background:rgba(255,255,255,.75);color:#3b4553;}
    .shot{flex:0 0 auto;width:300px;border:1px solid rgba(19,25,37,.12);border-radius:16px;
      overflow:hidden;box-shadow:0 26px 60px rgba(19,25,37,.22);background:#fff;}
    .shot img{display:block;width:100%;}
  </style>
  <div class="accent"></div>
  <div class="row">
    <div class="copy">
      <img class="logo" src="${logo}" alt="TabbySync">
      <h1>Your bookmarks and tabs, synced to your own server</h1>
      <p>One extension, two engines, one destination you control.</p>
      <div class="tags">
        <span class="tag">Self-hosted</span>
        <span class="tag">End-to-end encryption</span>
        <span class="tag">No account, no tracking</span>
      </div>
    </div>
    <div class="shot"><img src="${shot}" alt=""></div>
  </div>`);
  await page.waitForTimeout(300);
  const out = path.join(OG, 'og-image.png');
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  await page.close();
  console.log('og    ', path.relative(ROOT, out));

  // The site is deployed on its own, so it carries its own copy of anything
  // it serves rather than reaching back into this repository at runtime.
  const sitePath = path.join(ROOT, 'website', 'assets', 'img', 'og-image.png');
  fs.copyFileSync(out, sitePath);
  console.log('og    ', path.relative(ROOT, sitePath));
}

// ---- run -------------------------------------------------------------------

await capture();
const browser = await chromium.launch();
await downscale(browser);
await frame(browser);
await socialCard(browser);
await browser.close();
console.log('\nDone. Store images are exactly 1280x800 with no alpha channel;'
  + ' the social card is 1200x630.');
