import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const src = readFileSync(new URL('sw.js', root), 'utf8');
const core = JSON.parse('[' + src.match(/const CORE = \[([\s\S]*?)\];/)[1].replace(/'/g, '"').replace(/,\s*$/, '') + ']');

test('offline: every CORE file exists', () => {
  for (const f of core) if (f !== './') assert.ok(existsSync(new URL(f, root)), `sw.js CORE lists a missing file: ${f}`);
});

test('offline: every script in js/ is in CORE', () => {
  for (const f of readdirSync(new URL('js/', root))) if (f.endsWith('.js')) assert.ok(core.includes(`js/${f}`), `add js/${f} to CORE in sw.js`);
});

test('offline: every audio file is in CORE', () => {
  for (const f of readdirSync(new URL('assets/audio/', root))) if (f.endsWith('.mp3')) assert.ok(core.includes(`assets/audio/${f}`), `add assets/audio/${f} to CORE in sw.js`);
});

test('first load: index.html modulepreloads every script in js/', () => {
  const html = readFileSync(new URL('index.html', root), 'utf8');
  for (const f of readdirSync(new URL('js/', root))) if (f.endsWith('.js')) assert.ok(html.includes(`<link rel="modulepreload" href="js/${f}">`), `add a modulepreload for js/${f} to index.html`);
});
