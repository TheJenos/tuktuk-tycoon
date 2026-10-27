// Renders the brand images in public/brand/ from public/brand/logo.svg with headless Chromium (Playwright):
//   icon-512.png, icon-1024.png   the logo (app stores, the Discord app icon)
//   icon-192.png                  the logo, small (the web app manifest)
//   icon-maskable-512.png         the logo on a full-bleed tile, inside the safe zone (Android's masked icons)
//   apple-touch-icon.png          180x180 full-bleed tile (iOS rounds the corners itself)
//   og-image.png                  1200x630 link preview
//   discord-cover.png             1024x576 Activity Shelf cover art (title + art)
//   discord-background.png        1024x576 Activity background (art at the edges, the centre left clear)
// Run: npm run build:brand
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = (name) => fileURLToPath(new URL(`../public/brand/${name}`, import.meta.url));
const logo = readFileSync(out('logo.svg'), 'utf8');
const sized = (px) => logo.replace('<svg ', `<svg width="${px}" height="${px}" `);
// The logo's tile stretched to the edges and its rounded border dropped, with `pad` units of room
// round the art: launchers and iOS cut their own shape out of a square icon.
const square = (px, pad) =>
  sized(px)
    .replace('viewBox="0 0 512 512"', `viewBox="${-pad} ${-pad} ${512 + 2 * pad} ${512 + 2 * pad}"`)
    .replace(/<rect width="512" height="512" rx="112" fill="url\(#tile\)"\/>/, `<rect x="${-pad}" y="${-pad}" width="${512 + 2 * pad}" height="${512 + 2 * pad}" fill="url(#tile)"/>`)
    .replace(/<rect x="8" y="8"[^>]*\/>/, '');

// The board's colour groups, used as the band of tiles round the background
const BANDS = ['#8b4c2c', '#a9dcf5', '#d6408f', '#f4921f', '#e2232a', '#f9e11e', '#1fa952', '#1c5ba8'];
const FONT = `'Segoe UI Black', 'Arial Black', 'Helvetica Neue', Arial, sans-serif`;

const sky = `radial-gradient(circle at 70% 60%, rgba(255,181,71,0.45), rgba(255,122,61,0.12) 38%, transparent 62%),
  linear-gradient(180deg, #252e40 0%, #121722 100%)`;

function banner({ w, h, title }) {
  return `<div style="width:${w}px;height:${h}px;background:${sky};display:flex;align-items:center;gap:${h * 0.06}px;
    padding:0 ${w * 0.07}px;box-sizing:border-box;font-family:${FONT};color:#f4f1e6;overflow:hidden;position:relative">
    <div style="flex:none">${sized(Math.round(h * 0.62))}</div>
    <div>
      <div style="font-size:${h * 0.15}px;line-height:0.95;letter-spacing:0.01em">TUK-TUK<br><span style="color:#ffb547">TYCOON</span></div>
      ${title ? `<div style="margin-top:${h * 0.05}px;font:600 ${h * 0.05}px/1.3 'Segoe UI', Arial, sans-serif;color:#c9cfdb">${title}</div>` : ''}
    </div>
    <div style="position:absolute;left:0;right:0;bottom:0;height:${h * 0.03}px;display:flex">
      ${BANDS.map((c) => `<div style="flex:1;background:${c}"></div>`).join('')}
    </div>
  </div>`;
}

function background({ w, h }) {
  const tile = 64;
  const cols = Math.ceil(w / tile);
  const rows = Math.ceil(h / tile);
  // Clockwise round the edge, so the colour groups follow each other as on the board
  const cells = [];
  for (let x = 0; x < cols; x++) cells.push([x, 0]);
  for (let y = 1; y < rows; y++) cells.push([cols - 1, y]);
  for (let x = cols - 2; x >= 0; x--) cells.push([x, rows - 1]);
  for (let y = rows - 2; y > 0; y--) cells.push([0, y]);
  const tiles = cells
    .map(([x, y], i) => {
      const band = BANDS[Math.floor(i / 3) % BANDS.length];
      return `<div style="position:absolute;left:${x * tile + 3}px;top:${y * tile + 3}px;width:${tile - 6}px;height:${tile - 6}px;
        border-radius:8px;background:#e9e2cc;box-shadow:inset 0 ${tile * 0.28}px 0 ${band}"></div>`;
    })
    .join('');
  return `<div style="width:${w}px;height:${h}px;position:relative;overflow:hidden;
    background:radial-gradient(ellipse at center, #121722 45%, #252e40 100%)">${tiles}</div>`;
}

const SHOTS = [
  { name: 'icon-512.png', w: 512, h: 512, html: sized(512), transparent: true },
  { name: 'icon-1024.png', w: 1024, h: 1024, html: sized(1024), transparent: true },
  { name: 'icon-192.png', w: 192, h: 192, html: sized(192), transparent: true },
  // The safe zone is the middle 80%: 64 units of tile each side of the 512
  { name: 'icon-maskable-512.png', w: 512, h: 512, html: square(512, 64) },
  { name: 'apple-touch-icon.png', w: 180, h: 180, html: square(180, 24) },
  { name: 'og-image.png', w: 1200, h: 630, html: banner({ w: 1200, h: 630, title: 'A Sri Lankan property-trading board game in 3D' }) },
  { name: 'discord-cover.png', w: 1024, h: 576, html: banner({ w: 1024, h: 576, title: 'Buy, build and bargain your way round Sri Lanka' }) },
  { name: 'discord-background.png', w: 1024, h: 576, html: background({ w: 1024, h: 576 }) },
];

const browser = await chromium.launch();
for (const s of SHOTS) {
  const page = await browser.newPage({ viewport: { width: s.w, height: s.h } });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${s.html}</body></html>`);
  await page.screenshot({ path: out(s.name), omitBackground: !!s.transparent });
  await page.close();
  console.log(`public/brand/${s.name}`);
}
await browser.close();
