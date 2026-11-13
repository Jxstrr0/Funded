// Renders the home-screen icons, favicon and link-preview image from the
// game's own wordmark ("F." in Space Grotesk) and the wide desk render.
// Run from the repo root:  node tools/icons.mjs
// Needs Playwright (preinstalled in the session container) and Pillow
// (python3) for favicon.ico. Writes assets/icons/*.png, assets/og.jpg and
// favicon.ico.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const root = resolve('.');
// Pages are served from a made-up host through a Playwright route, so the
// font and the desk render load the same way they do on the site.
const HOST = 'http://icons.local';
const url = (p) => `${HOST}/${p}`;

const font = `@font-face { font-family: 'SG'; font-weight: 300 700;
  src: url('${url('assets/fonts/space-grotesk-latin.woff2')}') format('woff2'); }
  html, body { margin: 0; background: #141413; }
  body { font-family: 'SG', sans-serif; }`;

// Square icon: ivory F and a clay dot on near-black, kept inside the middle
// 70% so a maskable crop (circle, squircle) never cuts it.
const icon = (size) => `<style>${font}
  .i { width: ${size}px; height: ${size}px; display: flex; align-items: center; justify-content: center;
       color: #FAF9F5; font-weight: 700; font-size: ${size * 0.62}px; letter-spacing: -0.04em; line-height: 1; }
  .i span { color: #D97757; }
</style><div class="i"><div style="transform: translate(${size * 0.035}px, -${size * 0.02}px)">F<span>.</span></div></div>`;

// Link preview, 1200x630: the wide desk render on the right, the title card's
// type on the left.
const og = `<style>${font}
  .o { position: relative; width: 1200px; height: 630px; overflow: hidden; background: #141413; color: #FAF9F5; }
  .o img { position: absolute; right: 0; top: 0; width: 760px; height: 630px; object-fit: cover; object-position: 50% 52%; }
  .o .fade { position: absolute; inset: 0; background: linear-gradient(90deg, #141413 36%, rgba(20,20,19,0.75) 52%, rgba(20,20,19,0) 75%); }
  .o .t { position: absolute; left: 80px; top: 50%; transform: translateY(-50%); }
  .eb { font-size: 26px; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(250,249,245,0.6); font-weight: 600; }
  h1 { margin: 14px 0 18px; font-size: 150px; line-height: 1; letter-spacing: -0.02em; font-weight: 700; }
  h1 span { color: #D97757; }
  p { margin: 0; font-size: 34px; line-height: 1.3; color: rgba(250,249,245,0.85); max-width: 520px; }
</style><div class="o"><img src="${url('assets/wide.jpg')}"><div class="fade"></div>
  <div class="t"><div class="eb">Longlight Interactive</div><h1>Funded<span>.</span></h1>
  <p>A roguelike prop-firm trading game. Pass the eval. Don't get fired.</p></div></div>`;

const shots = [
  ['assets/icons/icon-512.png', icon(512), 512, 512],
  ['assets/icons/icon-192.png', icon(192), 192, 192],
  ['assets/icons/apple-touch-icon.png', icon(180), 180, 180],
  ['assets/icons/favicon-32.png', icon(32), 32, 32],
  ['assets/icons/favicon-48.png', icon(48), 48, 48],
  ['assets/og.jpg', og, 1200, 630],
];

mkdirSync(resolve(root, 'assets/icons'), { recursive: true });
const browser = await chromium.launch();
for (const [out, html, w, h] of shots) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  await page.route(`${HOST}/**`, (route) => {
    const path = new URL(route.request().url()).pathname.slice(1);
    return path === 'page' ? route.fulfill({ contentType: 'text/html', body: html }) : route.fulfill({ path: resolve(root, path) });
  });
  await page.goto(url('page'), { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(root, out), type: out.endsWith('.jpg') ? 'jpeg' : 'png', quality: out.endsWith('.jpg') ? 85 : undefined });
  await page.close();
  console.log('wrote', out);
}
await browser.close();

execFileSync('python3', ['-c', `
from PIL import Image
Image.open('assets/icons/favicon-48.png').save('favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
print('wrote favicon.ico')`], { cwd: root, stdio: 'inherit' });
