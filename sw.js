// Offline play. The page registers this as sw.js?v=<VERSION> (js/main.js), so
// every release installs a fresh copy and clears the old one.
//
// - The game's code (the page, scripts, styles) comes from the network first,
//   so an update shows up straight away, with the saved copy as the fallback
//   when there's no signal.
// - Art, sound and fonts come from the saved copy first, and are saved the
//   first time they load.
// - CORE is saved at install: everything a first career at Tier 1 needs. The
//   Tier 2 and Tier 3 desks are saved when a career reaches them (the page
//   sends a 'warm' list) or the first time they're shown.
//
// Adding a file the game needs at Tier 1? Add it to CORE as well
// (tests/sw.test.js checks every file listed here exists, and that every
// script in js/ is listed).

const VERSION = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE = `funded-${VERSION}`;
const CODE_TIMEOUT_MS = 4000; // a weak signal falls back to the saved copy after this

const CORE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'favicon.ico',
  'css/style.css',
  'js/main.js', 'js/config.js', 'js/engine.js', 'js/rules.js', 'js/ui.js', 'js/chart.js',
  'js/audio.js', 'js/fx.js', 'js/clicker.js', 'js/edges.js', 'js/meta.js', 'js/save.js',
  'js/tutorial.js', 'js/options.js', 'js/daily.js',
  'assets/fonts/space-grotesk-latin.woff2', 'assets/fonts/space-grotesk-latin-ext.woff2',
  'assets/icons/favicon-32.png', 'assets/icons/apple-touch-icon.png',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png',
  'assets/wide.jpg', 'assets/intro.mp4',
  'assets/desk.jpg', 'assets/desk-am.jpg', 'assets/desk-pm.jpg',
  'assets/desk-rain.jpg', 'assets/desk-funded.jpg', 'assets/desk-fired.jpg',
  'assets/pointer.svg', 'assets/rain-streaks.svg',
  'assets/mouse/tier1-mouse.webp', 'assets/mouse/tier1-plate.webp',
  'assets/mouse/tier1-mouse-am.webp', 'assets/mouse/tier1-plate-am.webp',
  'assets/mouse/tier1-mouse-pm.webp', 'assets/mouse/tier1-plate-pm.webp',
  'assets/mouse/tier1-mouse-rain.webp', 'assets/mouse/tier1-plate-rain.webp',
  'assets/cards/coffee.webp', 'assets/cards/hotHand.webp', 'assets/cards/rainmaker.webp',
  'assets/cards/rewind.webp', 'assets/cards/riskFriend.webp', 'assets/cards/shortWeek.webp',
  'assets/cards/stopDiscipline.webp', 'assets/cards/tapeReader.webp',
  'assets/cards/thetaShield.webp', 'assets/cards/whisper.webp',
  'assets/props/tier1/coffee.webp', 'assets/props/tier1/hotHand.webp',
  'assets/props/tier1/rainmaker.webp', 'assets/props/tier1/rewind.webp',
  'assets/props/tier1/riskFriend.webp', 'assets/props/tier1/shortWeek.webp',
  'assets/props/tier1/stopDiscipline.webp', 'assets/props/tier1/tapeReader.webp',
  'assets/props/tier1/thetaShield.webp', 'assets/props/tier1/whisper.webp',
  'assets/audio/buy.mp3', 'assets/audio/sell.mp3', 'assets/audio/flatten.mp3',
  'assets/audio/denied.mp3', 'assets/audio/news.mp3', 'assets/audio/tick.mp3',
  'assets/audio/bell.mp3', 'assets/audio/fired.mp3', 'assets/audio/pass.mp3',
  'assets/audio/mulligan.mp3', 'assets/audio/rep.mp3', 'assets/audio/deal.mp3',
  'assets/audio/pick.mp3', 'assets/audio/rare.mp3', 'assets/audio/reroll.mp3',
  'assets/audio/stamp.mp3', 'assets/audio/purchase.mp3', 'assets/audio/music.mp3',
  'assets/audio/ambience.mp3', 'assets/audio/day-music.mp3', 'assets/audio/rain.mp3',
];

/** Save each URL that isn't saved yet. A missing file is skipped, never fatal. */
async function store(urls) {
  const cache = await caches.open(CACHE);
  await Promise.allSettled(urls.map(async (u) => {
    const url = new URL(u, self.registration.scope);
    if (url.origin !== self.location.origin || await cache.match(url)) return;
    const res = await fetch(url);
    if (res.ok && res.status === 200) await cache.put(url, res);
  }));
}

self.addEventListener('install', (e) => {
  e.waitUntil(store(CORE).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('funded-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim(); // the open page uses it straight away (code still comes from the network first)
  })());
});

self.addEventListener('message', (e) => {
  const urls = e.data && Array.isArray(e.data.warm) ? e.data.warm.filter((u) => typeof u === 'string') : [];
  if (urls.length) e.waitUntil(store(urls.slice(0, 80)));
});

const isCode = (req, url) => req.mode === 'navigate' || /\.(html|js|css|webmanifest)$/.test(url.pathname) || url.pathname.endsWith('/');

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.endsWith('/sw.js')) return;
  if (req.headers.has('range')) { e.respondWith(ranged(req, url)); return; }
  e.respondWith(isCode(req, url) ? codeFirst(req, url) : savedFirst(req, url));
});

/** The page and its scripts: network first, the saved copy if it fails or stalls. */
async function codeFirst(req, url) {
  const cache = await caches.open(CACHE);
  const key = req.mode === 'navigate' ? new URL('./', self.registration.scope) : url;
  const saved = cache.match(key, { ignoreSearch: req.mode === 'navigate' });
  const net = fetch(req).then((res) => {
    if (res.ok && res.status === 200 && res.type === 'basic') cache.put(key, res.clone());
    return res;
  });
  net.catch(() => {}); // handled below; this only quiets a late failure
  const timeout = new Promise((ok) => setTimeout(ok, CODE_TIMEOUT_MS));
  try {
    const first = await Promise.race([net, timeout.then(() => saved)]);
    if (first) return first;
    return await net; // nothing saved yet: keep waiting for the network
  } catch {
    return (await saved) || Response.error();
  }
}

/** Art, sound, fonts: the saved copy first, else fetch and save it. */
async function savedFirst(req, url) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(url, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.status === 200 && res.type === 'basic') cache.put(url, res.clone());
  return res;
}

/** Video asks for byte ranges (Safari always does): answer from the saved copy. */
async function ranged(req, url) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(url, { ignoreSearch: true });
  if (!hit) return fetch(req);
  const buf = await hit.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') || '');
  let start = m && m[1] ? +m[1] : 0;
  let end = m && m[2] ? +m[2] : buf.byteLength - 1;
  if (m && !m[1] && m[2]) { start = Math.max(0, buf.byteLength - +m[2]); end = buf.byteLength - 1; } // bytes=-N: the last N
  end = Math.min(end, buf.byteLength - 1);
  if (start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${buf.byteLength}` } });
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': hit.headers.get('Content-Type') || 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}
