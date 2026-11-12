// Shared bot for tools/balance.mjs and tools/levers.mjs: a news-trading bot that
// plays whole evals. It measures relative strength only (a person plays differently).
const R = new URL('../js/', import.meta.url).href;
const { generateDay, hashSeed } = await import(R + 'engine.js');
const { newRun, newDay, applyFill, orderDelta, snapshot, closeDay, effectiveRules, openPnl } = await import(R + 'rules.js');
const { careerOf, repMultiplier } = await import(R + 'edges.js');
const { reputationFor } = await import(R + 'meta.js');
const { TIERS, SESSION, EDGES } = await import(R + 'config.js');
const N_TICKS = SESSION.candles * SESSION.ticksPerCandle;
const TPC = SESSION.ticksPerCandle;
const TICK_S = SESSION.realSeconds / N_TICKS;

// strategy: idle except news. Enter at size in news direction one tick after jump (or before, with tape reader), hold `hold` candles, flatten.
// also a "noise" trade: random entries to add risk like a human. Style param.
function playDay(run, tier, opts, rng) {
  const base = TIERS[tier];
  const career = careerOf(run);
  const rules = effectiveRules(run.perks, base, career);
  const dayData = generateDay({ seed: hashSeed(run.seed, run.day), dayStartBalance: run.balance, rules });
  const day = newDay(run, rules);
  const sizeIx = rules.sizes.length === 1 ? 0 : opts.sizeIx;
  const size = rules.sizes[Math.min(sizeIx, rules.sizes.length - 1)];
  const hasStop = career.edges.includes('stopDiscipline');
  const tapeTicks = career.edges.includes('tapeReader') ? 1 : 0;
  const coffee = rules.clockScale || 1;
  let exitAt = -1;
  const plan = new Map(); // tick -> side
  for (const n of dayData.news) {
    // human reaction: needs ~reactS seconds after headline; tape reader lets them pre-position
    const reactS = opts.reactS * (0.7 + 1.0 * rng()); // phone reaction: 0.7x..1.7x
    const react = Math.round(reactS / coffee / TICK_S);
    const lead = Math.round(EDGES.find((e) => e.id === 'tapeReader').leadSeconds / coffee / TICK_S);
    const t = tapeTicks && rng() < opts.tapeUse ? n.tick - lead + react : n.tick + react;
    // human may misread direction with some probability
    const side = rng() < opts.misread ? -n.dir : n.dir;
    plan.set(t, { side, hold: n.tick + TPC * opts.holdCandles });
  }
  // random discretionary trades
  for (let k = 0; k < opts.randomTrades; k++) {
    const t = 30 + Math.floor(rng() * (N_TICKS - 200));
    if (!plan.has(t)) plan.set(t, { side: rng() < 0.5 ? 1 : -1, hold: t + TPC * opts.holdCandles });
  }
  for (let i = 0; i < N_TICKS; i++) {
    const p = dayData.ticks[i];
    const pl = plan.get(i);
    if (pl && day.qty === 0) {
      const d = orderDelta(day, pl.side, size, p);
      const f = applyFill(day.qty, day.avg, d, p, day.mult);
      Object.assign(day, { qty: f.qty, avg: f.avg }); day.realized += f.realized; day.trades++;
      exitAt = pl.hold;
    }
    const flat = () => { const f = applyFill(day.qty, day.avg, -day.qty, p, day.mult); day.realized += f.realized; day.qty = 0; day.avg = 0; day.trades++; };
    if (day.qty && hasStop && openPnl(day, p) <= -0.6 * rules.dailyLossLimit) flat();
    // human stop: cut at opts.stop share of limit (if set)
    if (day.qty && opts.stop && openPnl(day, p) <= -opts.stop * rules.dailyLossLimit) flat();
    if (day.qty && i >= exitAt) flat();
    if (day.qty && i >= N_TICKS - 5) flat();
    const s = snapshot(run, day, p, rules);
    if (s.breach) return { fired: true };
  }
  return { fired: false, run: closeDay(run, day, rules) };
}

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function evalRun(tier, seed, edges, mandates, opts) {
  let run = newRun(TIERS[tier], seed, [], { edges, mandates });
  const rng = mulberry(seed ^ 0x9e37);
  for (;;) {
    const r = playDay(run, tier, opts, rng);
    if (r.fired) return { pass: false, fired: true, rep: reputationFor(run.history, false, undefined, repMultiplier(run)).total, days: run.history.length };
    run = r.run.run;
    if (r.run.outcome !== 'next') { const pass = r.run.outcome === 'pass'; return { pass, fired: false, rep: reputationFor(run.history, pass, undefined, repMultiplier(run)).total, days: run.history.length }; }
  }
}

// careful: 50% size and a stop at half the daily limit. aggressive: MAX, no stop.
// Coffee, Whisper and Blind News are about reading the screen in time, which
// the bot only roughly models (reaction time).
export const STYLES = {
  careful: { sizeIx: 1, reactS: 1.2, misread: 0.15, holdCandles: 3, randomTrades: 1, tapeUse: 0.8, stop: 0.5 },
  aggressive: { sizeIx: 2, reactS: 1.0, misread: 0.15, holdCandles: 3, randomTrades: 2, tapeUse: 0.8, stop: 0 },
};
