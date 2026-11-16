// Shared bot for tools/balance.mjs and tools/levers.mjs: a news-trading bot that
// plays whole evals. It measures relative strength only (a person plays differently).
const R = new URL('../js/', import.meta.url).href;
const { generateDay, hashSeed, haltAt } = await import(R + 'engine.js');
const { newRun, newDay, applyFill, orderDelta, optionOrder, snapshot, closeDay, effectiveRules, openPnl } = await import(R + 'rules.js');
const { quoteAt } = await import(R + 'options.js');
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
    // Trading halts (halt days): no orders until it reopens; a planned entry waits.
    if (haltAt(dayData, i)) { if (pl && !plan.has(i + 1)) plan.set(i + 1, pl); continue; }
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
    if (s.breach) return { fired: true, cause: s.breach };
  }
  return { fired: false, run: closeDay(run, day, rules) };
}

// Tier 3 (options), mirroring js/main.js: CALL on up-news, PUT on down-news,
// one side at a time, sized by optionOrder() against the premium budget, marked
// at the held side's premium (quoteAt), rules checked with snapshot() every tick.
// Earnings: with opts.dodgeEarnings the bot closes before the release and skips
// entries that would hold through it; opts.earningsBet is the chance of a blind
// pre-earnings punt (a random side a few candles before the release).
// `stats` collects trades held through the earnings release, for the crush report.
function playDayOptions(run, tier, opts, rng, stats) {
  const base = TIERS[tier];
  const career = careerOf(run);
  const rules = effectiveRules(run.perks, base, career);
  const m = generateDay({ seed: hashSeed(run.seed, run.day), dayStartBalance: run.balance, rules });
  const day = newDay(run, rules);
  const sizeIx = rules.sizes.length === 1 ? 0 : opts.sizeIx;
  const size = rules.sizes[Math.min(sizeIx, rules.sizes.length - 1)];
  const hasStop = career.edges.includes('stopDiscipline');
  const tapeTicks = career.edges.includes('tapeReader') ? 1 : 0;
  const coffee = rules.clockScale || 1;
  const E = m.earningsTick;
  const prem = (right, i) => { const q = quoteAt(m, i, rules); return right === 'C' ? q.call : q.put; };
  const plan = new Map();
  const add = (t, v) => { if (t >= 0 && t < N_TICKS - 6 && !plan.has(t)) plan.set(t, v); };
  for (const n of m.news) {
    const reactS = opts.reactS * (0.7 + 1.0 * rng());
    const react = Math.round(reactS / coffee / TICK_S);
    const lead = Math.round(EDGES.find((e) => e.id === 'tapeReader').leadSeconds / coffee / TICK_S);
    const t = tapeTicks && rng() < opts.tapeUse ? n.tick - lead + react : n.tick + react;
    const side = rng() < opts.misread ? -n.dir : n.dir;
    add(t, { side, hold: n.tick + TPC * opts.holdCandles });
  }
  for (let k = 0; k < opts.randomTrades; k++) {
    const t = 30 + Math.floor(rng() * (N_TICKS - 200));
    add(t, { side: rng() < 0.5 ? 1 : -1, hold: t + TPC * opts.holdCandles });
  }
  if (E != null && rng() < (opts.earningsBet || 0)) {
    const t = E - TPC * (1 + Math.floor(rng() * 3));
    add(t, { side: rng() < 0.5 ? 1 : -1, hold: E + TPC * opts.holdCandles, bet: true });
  }
  let exitAt = -1, entryTick = -1, entryRealized = 0;
  const flat = (i) => {
    const p = prem(day.right, i);
    const f = applyFill(day.qty, day.avg, -day.qty, p, day.mult);
    day.realized += f.realized; day.qty = 0; day.avg = 0; day.right = null; day.trades++;
    if (E != null && entryTick < E && i >= E) { stats.thru++; const pnl = day.realized - entryRealized; stats.thruPnl += pnl; if (pnl < 0) stats.thruLoss++; }
  };
  for (let i = 0; i < N_TICKS; i++) {
    const pl = plan.get(i);
    if (haltAt(m, i)) { if (pl && !plan.has(i + 1)) plan.set(i + 1, pl); continue; } // halted: wait
    if (pl && day.qty === 0) {
      const dodge = opts.dodgeEarnings && !pl.bet && E != null && i < E && pl.hold >= E;
      const right = pl.side > 0 ? 'C' : 'P';
      const p = prem(right, i);
      const n = dodge ? 0 : optionOrder(day, size, p, rules);
      if (n > 0) {
        const f = applyFill(0, 0, n, p, day.mult);
        Object.assign(day, { qty: f.qty, avg: f.avg, right }); day.trades++;
        exitAt = pl.hold; entryTick = i; entryRealized = day.realized;
      }
    }
    // Careful: close one tick before the release rather than eat the crush.
    if (day.qty && opts.dodgeEarnings && E != null && i === E - 1 && entryTick < E) flat(i);
    const mk = day.qty ? prem(day.right, i) : 0;
    if (day.qty && hasStop && openPnl(day, mk) <= -EDGES.find((e) => e.id === 'stopDiscipline').atShareOfLimit * rules.dailyLossLimit) flat(i);
    else if (day.qty && opts.stop && openPnl(day, mk) <= -opts.stop * rules.dailyLossLimit) flat(i);
    else if (day.qty && opts.premStop && mk <= day.avg * (1 - opts.premStop)) flat(i);
    else if (day.qty && i >= exitAt) flat(i);
    else if (day.qty && i >= N_TICKS - 5) flat(i);
    const s = snapshot(run, day, day.qty ? prem(day.right, i) : 0, rules);
    if (s.breach) {
      if (day.qty && E != null && entryTick < E && i >= E) stats.crushFired++;
      return { fired: true, cause: s.breach };
    }
  }
  if (day.qty) return { fired: true, cause: 'flatAtBell' }; // the bot always closes by N_TICKS-5, so this never happens
  return { fired: false, run: closeDay(run, day, rules) };
}

function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Result: {pass, fired, rep, days, outcome}, outcome being the firing rule
// (dailyLoss / drawdown / flatAtBell) or closeDay's outcome (pass / failTarget / failMinDays).
// Tier 3 also returns `opt`: trades held through earnings, their P&L, and
// whether the firing tick had such a trade open.
export function evalRun(tier, seed, edges, mandates, opts) {
  let run = newRun(TIERS[tier], seed, [], { edges, mandates });
  const rng = mulberry(seed ^ 0x9e37);
  const options = !!TIERS[tier].option;
  const stats = { thru: 0, thruLoss: 0, thruPnl: 0, crushFired: 0 };
  const extra = options ? { opt: stats } : {};
  for (;;) {
    const r = options ? playDayOptions(run, tier, opts, rng, stats) : playDay(run, tier, opts, rng);
    if (r.fired) return { pass: false, fired: true, rep: reputationFor(run.history, false, undefined, repMultiplier(run)).total, days: run.history.length, outcome: r.cause, ...extra };
    run = r.run.run;
    if (r.run.outcome !== 'next') { const pass = r.run.outcome === 'pass'; return { pass, fired: false, rep: reputationFor(run.history, pass, undefined, repMultiplier(run)).total, days: run.history.length, outcome: r.run.outcome, ...extra }; }
  }
}

// careful: 50% size and a stop at half the daily limit. aggressive: MAX, no stop.
// Coffee, Whisper and Blind News are about reading the screen in time, which
// the bot only roughly models (reaction time).
export const STYLES = {
  careful: { sizeIx: 1, reactS: 1.2, misread: 0.15, holdCandles: 3, randomTrades: 1, tapeUse: 0.8, stop: 0.5 },
  aggressive: { sizeIx: 2, reactS: 1.0, misread: 0.15, holdCandles: 3, randomTrades: 2, tapeUse: 0.8, stop: 0 },
};
// Tier 3 adds earnings handling: careful closes before the release and won't
// enter a trade that would hold through it; aggressive holds through, and half
// the time takes a blind punt a few candles before the release. The stop knob
// is a share of the daily limit as above (at these sizes it rarely bites, since
// a position can only lose its premium), so careful also cuts at -50% premium.
export const OPTION_STYLES = {
  careful: { ...STYLES.careful, dodgeEarnings: true, earningsBet: 0, premStop: 0.5 },
  aggressive: { ...STYLES.aggressive, dodgeEarnings: false, earningsBet: 0.5, premStop: 0 },
};
