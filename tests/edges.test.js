import test from 'node:test';
import assert from 'node:assert/strict';
import { edgePool, drawEdges, choiceCount, openDraft, draftOffer, rerollDraft, takeEdge, headStart, careerOf, repMultiplier } from '../js/edges.js';
import { newRun, effectiveRules } from '../js/rules.js';
import { reputationFor } from '../js/meta.js';
import { decayed, quoteAt } from '../js/options.js';
import { generateDay, hashSeed } from '../js/engine.js';
import { TIER1, TIER2, TIER3, EDGES, SESSION } from '../js/config.js';

test('edge draws: seeded, distinct, weighted pool by tier', () => {
  const pool = edgePool([], 'tier1');
  assert.ok(!pool.some((e) => e.id === 'thetaShield'), 'Theta Shield is options-only');
  assert.ok(edgePool([], 'tier3').some((e) => e.id === 'thetaShield'));
  assert.ok(!edgePool(['coffee'], 'tier1').some((e) => e.id === 'coffee'), 'held edges are not offered again');
  const a = drawEdges(7, 'k', pool, 3);
  assert.deepEqual(a, drawEdges(7, 'k', pool, 3));
  assert.equal(new Set(a).size, 3);
  assert.equal(drawEdges(7, 'k', pool.slice(0, 2), 3).length, 2);
  // Rare edges show up less often than common ones.
  const seen = {};
  for (let s = 0; s < 3000; s++) for (const id of drawEdges(s, 'x', pool, 1)) seen[id] = (seen[id] || 0) + 1;
  assert.ok(seen.rewind < seen.coffee / 2, JSON.stringify(seen));
});

test('drafts: Analyst shows 4, Reroll changes the offer once, taking an edge closes it', () => {
  let run = openDraft(newRun(TIER1, 11, ['analyst', 'reroll']));
  assert.equal(choiceCount(run.perks), 4);
  const first = draftOffer(run);
  assert.equal(first.length, 4);
  run = rerollDraft(run);
  assert.equal(run.draft.rerolls, 1);
  assert.notDeepEqual(draftOffer(run), first);
  assert.equal(rerollDraft(run), run, 'only one reroll');
  run = takeEdge(run, 'rewind');
  assert.equal(run.draft, null);
  assert.deepEqual(run.edges, ['rewind']);
  assert.equal(run.rewinds, 1);
  assert.deepEqual(draftOffer(run), []);
  assert.equal(headStart(newRun(TIER1, 3, ['headStart'])).edges.length, 1);
  assert.equal(headStart(newRun(TIER1, 3, [])).edges.length, 0);
});

test('edges and mandates change the rules', () => {
  assert.equal(effectiveRules(['thickSkin'], TIER1, { edges: ['riskFriend'] }).dailyLossLimit, 900);
  assert.equal(effectiveRules([], TIER1, { mandates: ['tightLeash'] }).dailyLossLimit, 563);
  assert.equal(effectiveRules([], TIER1, { edges: ['shortWeek'] }).profitTarget, 1320);
  assert.equal(effectiveRules([], TIER1, { edges: ['coffee'] }).clockScale, 1.15);
  assert.equal(effectiveRules([], TIER1, { hot: true }).buyingPowerMultiplier, 4);
  assert.equal(effectiveRules([], TIER2, { hot: true }).maxContracts, 7);
  const o = effectiveRules([], TIER3, { hot: true, edges: ['thetaShield'] });
  assert.equal(o.option.premiumBudget, 2400);
  assert.equal(o.maxContracts, 48);
  assert.ok(o.option.shield);
  assert.equal(TIER3.option.premiumBudget, 2000, 'tier config is never mutated');
  assert.equal(effectiveRules([], TIER1, { edges: ['thetaShield'] }).option, undefined);
  const m = effectiveRules([], TIER1, { mandates: ['maxOnly', 'noFlatten', 'blindNews'] });
  assert.deepEqual(m.sizes.map((s) => s.label), ['MAX']);
  assert.ok(m.noFlatten && m.blindNews);
});

test('Hot Hand only after a green day', () => {
  const run = { ...newRun(TIER1, 1), edges: ['hotHand'] };
  assert.equal(careerOf(run).hot, false);
  assert.equal(careerOf({ ...run, history: [{ pnl: 120 }] }).hot, true);
  assert.equal(careerOf({ ...run, history: [{ pnl: -50 }] }).hot, false);
  const hot = effectiveRules([], TIER1, { edges: ['hotHand'], hot: true });
  assert.equal(hot.dailyLossLimit, 900);
  assert.equal(hot.buyingPowerMultiplier, 4);
  assert.equal(hot.hot, true);
});

test('Rep multiplier: mandates add, Rainmaker multiplies', () => {
  const run = { ...newRun(TIER1, 1), mandates: ['noFlatten', 'tightLeash'] };
  assert.equal(repMultiplier(run), 1.5);
  assert.equal(repMultiplier({ ...run, edges: ['rainmaker'] }), 1.88);
  const r = reputationFor([{ pnl: 500 }, { pnl: -100 }], false, undefined, 1.5);
  assert.equal(r.base, 30);
  assert.equal(r.total, 45);
  assert.equal(r.parts.bonus, 15);
});

test('Theta Shield: half the decay until noon, caught up by the bell', () => {
  const sh = { untilMinute: 720, rate: 0.5 };
  const fn = (720 - SESSION.marketOpenMinute) / SESSION.marketMinutes;
  assert.ok(Math.abs(decayed(fn, sh) - fn / 2) < 1e-12);
  assert.ok(Math.abs(decayed(fn + 1e-9, sh) - fn / 2) < 1e-6, 'continuous at noon');
  assert.ok(Math.abs(decayed(1, sh) - 1) < 1e-12);
  const d = generateDay({ seed: hashSeed(5, 1), rules: TIER3, dayStartBalance: 100000 });
  const flat = { ...d, ticks: new Float64Array(d.ticks.length).fill(d.strike), earningsTick: null };
  const shielded = { ...TIER3, option: { ...TIER3.option, shield: sh } };
  assert.ok(quoteAt(flat, 700, shielded).call > quoteAt(flat, 700, TIER3).call);
  assert.equal(quoteAt(flat, 1871, shielded).call, quoteAt(flat, 1871, TIER3).call);
});

test('every edge has a name, a description and a weight', () => {
  for (const e of EDGES) assert.ok(e.name && e.desc && e.weight > 0, e.id);
});
