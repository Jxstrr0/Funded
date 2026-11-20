// A damaged or hand-edited save must never stop the game: tidySave puts it right.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EDGES, MANDATES, PERKS, SESSION, TIERS } from '../js/config.js';
import { newRun, newDay } from '../js/rules.js';
import { loadRun, saveRun, tidySave } from '../js/save.js';
import { loadMeta } from '../js/meta.js';

const N_TICKS = SESSION.candles * SESSION.ticksPerCandle;
const DAY_MS = SESSION.realSeconds * 1000;

// A save as the game writes one mid-day.
function honest() {
  const run = newRun(TIERS.tier1, 1234, [PERKS[0].id], { edges: [EDGES[0].id, EDGES[1].id], mandates: [MANDATES[0].id] });
  const day = { ...newDay(run, TIERS.tier1), tick: 40 };
  return { v: 1, run, live: { day, elapsed: 12345.6, revealed: [0, 1], mv: 3 }, sizeIndex: 1, savedAt: 1 };
}
const copy = (x) => JSON.parse(JSON.stringify(x));

test('a save the game wrote comes back unchanged', () => {
  const save = honest();
  assert.deepEqual(tidySave(copy(save)), save);
  const first = { ...copy(save), live: { ...copy(save.live), day: { ...save.live.day, tick: -1 }, elapsed: 0 } };
  assert.deepEqual(tidySave(copy(first)), first); // a day saved before its first tick
  const between = { ...copy(save), live: null };
  assert.deepEqual(tidySave(copy(between)), between); // saved between days
});

test('a save from before edges existed is left without them', () => {
  const old = copy(honest());
  delete old.run.edges;
  delete old.run.mandates;
  assert.equal('edges' in tidySave(old).run, false);
});

test('a day whose clock the game could not have saved restarts from its open', () => {
  for (const tick of [-1e9, -2, 0.5, N_TICKS, 1e15, 1e308, null, 'soon']) {
    const save = copy(honest());
    save.live.day.tick = tick;
    assert.equal(tidySave(save).live, null, `tick ${tick}`);
  }
  for (const elapsed of [-1, DAY_MS + 1, 1e308, null, 'late']) {
    const save = copy(honest());
    save.live.elapsed = elapsed;
    assert.equal(tidySave(save).live, null, `elapsed ${elapsed}`);
  }
  const noDay = copy(honest());
  noDay.live.day = null;
  assert.equal(tidySave(noDay).live, null);
  const noNews = copy(honest());
  noNews.live.revealed = 7;
  assert.equal(tidySave(noNews).live, null);
});

test('edges, mandates and perks the game does not have are dropped, and none is kept twice', () => {
  const save = copy(honest());
  save.run.edges = [EDGES[0].id, 'moneyPrinter', EDGES[0].id, 7, null];
  save.run.mandates = 'all of them';
  save.run.perks = [PERKS[0].id, 'insiderTip'];
  const back = tidySave(save).run;
  assert.deepEqual(back.edges, [EDGES[0].id]);
  assert.deepEqual(back.mandates, []);
  assert.deepEqual(back.perks, [PERKS[0].id]);
  const long = copy(honest());
  long.run.edges = Array.from({ length: 50000 }, () => EDGES[1].id);
  assert.deepEqual(tidySave(long).run.edges, [EDGES[1].id]);
});

test('loadRun tidies what it reads, and refuses what is not a save', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) };
  try {
    const save = honest();
    saveRun(save.run, save.live, save.sizeIndex, 'funded.test');
    assert.deepEqual(loadRun('funded.test').live, save.live);
    const bad = copy(save);
    bad.live.day.tick = -1e9;
    store.set('funded.test', JSON.stringify(bad));
    assert.equal(loadRun('funded.test').live, null);
    store.set('funded.test', JSON.stringify({ v: 1, run: 'yes' }));
    assert.equal(loadRun('funded.test'), null);
    store.set('funded.test', 'not json');
    assert.equal(loadRun('funded.test'), null);
  } finally {
    delete globalThis.localStorage;
  }
});

test('the career record keeps only perks and mandates the game has', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) };
  try {
    store.set('funded.meta.v1', JSON.stringify({ rep: 40, owned: [PERKS[0].id, 'insiderTip', PERKS[0].id], mandates: [MANDATES[0].id, 'noRules'] }));
    const meta = loadMeta();
    assert.deepEqual(meta.owned, [PERKS[0].id]);
    assert.deepEqual(meta.mandates, [MANDATES[0].id]);
    assert.equal(meta.rep, 40);
    store.set('funded.meta.v1', JSON.stringify({ rep: 5, owned: 'everything' }));
    assert.deepEqual(loadMeta().owned, []);
  } finally {
    delete globalThis.localStorage;
  }
});
