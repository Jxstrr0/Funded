// 0.10: day types, halts, Insurance, Iron Stomach, Leverage Loan, the funded
// phase, the Daily Challenge, achievements and edge unlocks.
import test from 'node:test';
import assert from 'node:assert/strict';
import { TIER1, TIER2, TIER3, DAY_TYPES, DAILY, FUNDED, ACHIEVEMENTS, EDGES, DAILY_SKIP_EDGES } from '../js/config.js';
import { generateDay, hashSeed, dayTypeFor, haltAt, shockCapPct } from '../js/engine.js';
import { newRun, newDay, closeDay, effectiveRules, fundedRules, startFunded } from '../js/rules.js';
import { edgePool, unlockedOf, takeEdge } from '../js/edges.js';
import { achievementsFor, grantAchievements, defaultMeta, recordPayout, defaultStats } from '../js/meta.js';
import { challengeFor, challengeNumber, streak, dailyRep, trimPlayed, shareText } from '../js/daily.js';

test('day types: about DAY_TYPES.chance of days, seeded, all four seen', () => {
  const seen = {};
  let typed = 0;
  const N = 4000;
  for (let s = 0; s < N; s++) {
    const t = dayTypeFor(hashSeed('dt', s));
    assert.equal(t, dayTypeFor(hashSeed('dt', s)), 'same seed, same type');
    if (t) { typed++; seen[t] = (seen[t] || 0) + 1; }
  }
  assert.ok(Math.abs(typed / N - DAY_TYPES.chance) < 0.03, `share ${typed / N}`);
  assert.deepEqual(Object.keys(seen).sort(), Object.keys(DAY_TYPES.types).sort());
  assert.equal(generateDay({ seed: 1, script: { regimes: ['chop'], news: [] }, dayType: 'halt' }).type ?? null, null, 'scripted days have no type');
});

test('halt day: the tape freezes, then reopens with a jump; both inside the shock cap', () => {
  for (let s = 0; s < 60; s++) {
    const d = generateDay({ seed: hashSeed('halt', s), dayType: 'halt' });
    assert.equal(d.type, 'halt');
    if (!d.halts.length) continue; // no headline early enough
    const h = d.halts[0];
    assert.equal(h.to - h.from + 1, DAY_TYPES.types.halt.candles * 24);
    for (let i = h.from; i < h.to; i++) {
      assert.equal(d.ticks[i], d.ticks[h.from - 1], 'halted ticks hold the price');
      assert.ok(haltAt(d, i));
    }
    assert.equal(haltAt(d, h.to), null);
    const first = d.news.find((n) => n.halts);
    const reopen = d.news.find((n) => n.reopen);
    assert.ok(first && reopen && reopen.tick === h.to && reopen.haltFrom === h.from);
    assert.ok(Math.abs(first.jump) + Math.abs(reopen.jump) <= shockCapPct(TIER1.startBalance) + 1e-12);
    assert.ok(!d.news.some((n) => n.tick > h.from && n.tick < h.to), 'no other news inside the halt');
  }
});

test('fed day: one headline at 14:00; trend day: fewer headlines; gap day: records the gap', () => {
  for (let s = 0; s < 30; s++) {
    const f = generateDay({ seed: hashSeed('fed', s), dayType: 'fed' });
    assert.equal(f.news.length, 1);
    assert.equal(f.news[0].candle, DAY_TYPES.types.fed.candle);
    assert.ok(f.news[0].fed);
    const t = generateDay({ seed: hashSeed('trend', s), dayType: 'trend' });
    assert.ok(t.news.length >= DAY_TYPES.types.trend.news.min && t.news.length <= DAY_TYPES.types.trend.news.max);
    const g = generateDay({ seed: hashSeed('gap', s), dayType: 'gap' });
    const [lo, hi] = DAY_TYPES.types.gap.gapPct;
    assert.ok(Math.abs(g.gap) >= lo && Math.abs(g.gap) <= hi);
  }
  const o = generateDay({ seed: 3, rules: TIER3, dayStartBalance: TIER3.startBalance, dayType: 'fed' });
  assert.equal(o.news.filter((n) => n.earnings).length, 1, 'options keep their one earnings release');
});

test('Insurance refunds part of a red day, and the day type is kept in history', () => {
  const rules = effectiveRules([], TIER1, { edges: ['insurance'] });
  const run = newRun(TIER1, 1);
  const day = { ...newDay(run, rules), realized: -400, trades: 2, type: 'halt' };
  const { run: next, result } = closeDay(run, day, rules);
  assert.equal(result.refund, 100);
  assert.equal(result.pnl, -300);
  assert.equal(next.balance, TIER1.startBalance - 300);
  assert.equal(result.type, 'halt');
  const green = closeDay(run, { ...day, realized: 200 }, rules);
  assert.equal(green.result.refund, 0);
});

test('Iron Stomach deepens the drawdown; Leverage Loan trades size for a tighter limit', () => {
  const run = newRun(TIER1, 1, [], { edges: ['ironStomach'] });
  assert.equal(run.floor, TIER1.startBalance - TIER1.trailingDrawdown * 1.25);
  const taken = takeEdge(newRun(TIER1, 1), 'ironStomach');
  assert.equal(taken.floor, run.floor, 'taking it mid-career drops the floor the same');
  const L = effectiveRules([], TIER2, { edges: ['leverageLoan'] });
  assert.equal(L.maxContracts, Math.round(TIER2.maxContracts * 1.4));
  assert.equal(L.dailyLossLimit, Math.round(TIER2.dailyLossLimit * 0.85));
  assert.equal(effectiveRules([], TIER2, { edges: ['biggerBook'] }).maxContracts, TIER2.maxContracts + 2);
  assert.equal(effectiveRules([], TIER3, { edges: ['deepPockets'] }).option.premiumBudget, TIER3.option.premiumBudget * 1.25);
  assert.equal(effectiveRules([], TIER1, { edges: ['bellClerk'] }).bellClerk, true);
});

test('funded: no target; week 5 pays the split and resets; a red week pays nothing and carries', () => {
  const rules = fundedRules(TIER3);
  let run = startFunded({ ...newRun(TIER3, 9), edges: ['coffee'] }, TIER3);
  assert.deepEqual(run.funded, { week: 1, paid: 0, weeks: [] });
  assert.deepEqual(run.edges, ['coffee']);
  const close = (pnl) => {
    const r = closeDay(run, { ...newDay(run, rules), realized: pnl, trades: 1 }, rules);
    run = r.run;
    return r;
  };
  for (let i = 0; i < 4; i++) assert.equal(close(1000).outcome, 'next', 'no pass or fail mid-week');
  const w = close(1000);
  assert.equal(w.outcome, 'payout');
  assert.equal(w.week.profit, 5000);
  assert.equal(w.week.paid, Math.round(5000 * FUNDED.bonusSplit), 'a +$5,000 week pays the bonus split');
  assert.equal(run.balance, TIER3.startBalance);
  assert.equal(run.history.length, 0);
  assert.equal(run.funded.week, 2);
  assert.equal(run.funded.paid, w.week.paid);
  for (let i = 0; i < 4; i++) close(-200);
  const red = close(-200);
  assert.equal(red.week.paid, 0);
  assert.equal(run.balance, TIER3.startBalance - 1000, 'a red week carries over');
  assert.equal(run.funded.paid, w.week.paid);
});

test('Daily Challenge: numbered from the epoch, tier rotates, same edges for everyone, par', () => {
  assert.equal(challengeNumber(DAILY.epoch), 1);
  const a = challengeFor('2026-11-16');
  const b = challengeFor('2026-11-17');
  const c = challengeFor('2026-11-18');
  assert.deepEqual([a.tier, b.tier, c.tier], DAILY.tiers);
  assert.deepEqual(challengeFor('2026-11-16'), a, 'seeded by date');
  assert.equal(a.edges.length, DAILY.edges);
  for (let i = 0; i < 60; i++) {
    const key = new Date(Date.UTC(2026, 10, 16 + i)).toISOString().slice(0, 10);
    const ch = challengeFor(key);
    assert.ok(ch.edges.every((id) => !DAILY_SKIP_EDGES.includes(id) && !EDGES.find((e) => e.id === id).cursed));
    assert.equal(ch.par % 50, 0);
  }
  assert.equal(a.par, 500);
});

test('Daily streak, Rep, trimming and share text', () => {
  const played = { '2026-11-14': {}, '2026-11-15': {}, '2026-11-16': {} };
  assert.equal(streak(played, '2026-11-16'), 3);
  assert.equal(streak(played, '2026-11-17'), 3, 'today not played yet keeps yesterday\'s streak');
  assert.equal(streak(played, '2026-11-18'), 0);
  assert.equal(dailyRep(-500), DAILY.rep.played);
  assert.equal(dailyRep(1000), DAILY.rep.played + 20);
  const many = Object.fromEntries(Array.from({ length: 130 }, (_, i) => [new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), {}]));
  const t = trimPlayed(many);
  assert.equal(Object.keys(t).length, DAILY.keep);
  assert.ok(!('2026-01-01' in t));
  const txt = shareText({ n: 4, tier: 'tier2', fired: false, pnl: 620, par: 500, trades: [1, -1, 1], streak: 2 });
  assert.match(txt, /Funded Daily #4/);
  assert.match(txt, /🟩🟥🟩/);
  assert.match(txt, /par ✓/);
  assert.match(txt, /2-day streak/);
  assert.match(shareText({ n: 1, tier: 'tier1', fired: true, rule: 'Daily loss limit', pnl: -760, par: 500, trades: [] }), /💥 Fired/);
});

test('achievements: earned once, and some unlock edges for the draft', () => {
  let meta = defaultMeta();
  assert.deepEqual(edgePool([], 'tier1', unlockedOf(meta)).filter((e) => e.unlock).length, 0, 'locked edges stay out');
  const ids = achievementsFor(meta, { kind: 'pass', tier: 'tier2', history: [{ pnl: 10 }, { pnl: 5 }], mandates: ['a', 'b', 'c'] });
  assert.deepEqual(ids.sort(), ['flawless', 'mandated', 'tier2Pass']);
  meta = grantAchievements(meta, ids, '2026-11-16');
  assert.deepEqual(achievementsFor(meta, { kind: 'pass', tier: 'tier2', history: [{ pnl: 1 }], mandates: [] }), [], 'not twice');
  assert.ok(edgePool([], 'tier1', unlockedOf(meta)).some((e) => e.id === 'bellClerk'));
  assert.ok(edgePool([], 'tier1', null).some((e) => e.id === 'leverageLoan'), 'null = no locks (Daily)');
  assert.deepEqual(achievementsFor(meta, { kind: 'day', type: 'fed', pnl: 50 }), ['fedDay']);
  assert.deepEqual(achievementsFor(meta, { kind: 'day', type: 'fed', pnl: -50 }), []);
  assert.deepEqual(achievementsFor(meta, { kind: 'payout', paid: 4000, careerPaid: 101000 }).sort(), ['bigPayout', 'firstPayout']);
  assert.deepEqual(achievementsFor(meta, { kind: 'daily', played: 5, streak: 7 }).sort(), ['dailyFive', 'dailyStreak']);
  for (const a of ACHIEVEMENTS) if (a.unlocks) assert.ok(EDGES.find((e) => e.id === a.unlocks)?.unlock === a.id, a.id);
  const st = recordPayout(defaultStats(), 4000, 4000);
  assert.equal(st.payouts, 1);
  assert.equal(st.paidTotal, 4000);
  assert.equal(st.bestPaid, 4000);
});
