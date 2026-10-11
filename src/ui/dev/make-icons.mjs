// Dev-only: draws the app icon as SVG and rasterises it to the PNGs in public/icons.
// Usage: node src/ui/dev/make-icons.mjs
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const BG = '#0b0b0f';
const ACCENT = '#ff3d57';
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <rect width="512" height="512" fill="${BG}"/>
  <g transform="translate(256 256)">
    <rect x="-82" y="-110" width="164" height="220" rx="28" fill="${ACCENT}" opacity="0.32" transform="translate(-26 8) rotate(-14)"/>
    <rect x="-82" y="-110" width="164" height="220" rx="28" fill="${ACCENT}" transform="translate(10 0) rotate(8)"/>
    <path d="M-20 -42 L50 0 L-20 42 Z" fill="${BG}" transform="translate(10 0) rotate(8)"/>
  </g>
</svg>`;

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', '..', '..', 'public', 'icons');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:${BG}">${svg}</body></html>`);
  await page.screenshot({ path: join(outDir, name), omitBackground: false });
  await page.close();
  console.log('wrote', name);
}
await browser.close();
