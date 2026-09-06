#!/usr/bin/env node
// make-icon.mjs — builds build/icon.ico from the extension's own PNG icon
// set (icons/icon-*.png at the repo root), so the desktop app uses the same
// brand mark as the browser extension instead of a second, drifting copy.
// Windows .ico files bundle multiple sizes in one file; electron-builder's
// NSIS/portable targets both expect one at build/icon.ico.

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';

const here = path.dirname(fileURLToPath(import.meta.url));
const CP_ROOT = path.resolve(here, '..');
const REPO_ROOT = path.resolve(CP_ROOT, '..');
const SIZES = [16, 32, 48, 64, 128, 256];

async function main() {
  const pngs = SIZES.map((s) => path.join(REPO_ROOT, 'icons', `icon-${s}.png`));
  for (const p of pngs) {
    if (!existsSync(p)) throw new Error(`make-icon.mjs: missing ${p} — the extension's icon set must have changed shape.`);
  }
  const buf = await pngToIco(pngs);
  const outDir = path.join(CP_ROOT, 'build');
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, 'icon.ico'), buf);
  console.log(`[make-icon] wrote ${path.join(outDir, 'icon.ico')} from ${pngs.length} sizes`);
}

main().catch((e) => {
  console.error('[make-icon] failed:', e.message);
  process.exit(1);
});
