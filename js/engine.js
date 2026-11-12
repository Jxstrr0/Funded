// Seeded price engine. Pure: inputs in, ticks and candles out. No DOM.
import { SESSION, ENGINE, TIER1, TICKERS, HEADLINES } from './config.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a over the joined parts, so seeds come from (run seed, day number, ...).
export function hashSeed(...parts) {
  let h = 2166136261 >>> 0;
  const s = parts.join('|');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function gauss(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

const pick = (rng, arr) => arr[Math.floor(rng() * arr.length)];
const round2 = (x) => Math.round(x * 100) / 100;

function pickRegime(rng, regimes, exclude) {
  const names = Object.keys(regimes).filter((n) => n !== exclude);
  const total = names.reduce((s, n) => s + regimes[n].weight, 0);
  let r = rng() * total;
  for (const n of names) {
    r -= regimes[n].weight;
    if (r <= 0) return n;
  }
  return names[names.length - 1];
}

// Largest instant jump (as a fraction of price) so that a Max position loses
// at most shockCapShareOfDailyLimit of the daily loss limit.
export function shockCapPct(dayStartBalance, rules = TIER1, engine = ENGINE) {
  const buyingPower = rules.buyingPowerMultiplier * dayStartBalance;
  return (engine.news.shockCapShareOfDailyLimit * rules.dailyLossLimit) / buyingPower;
}

function scheduleNews(rng, session, engine) {
  const n = engine.news;
  const count = n.min + Math.floor(rng() * (n.max - n.min + 1));
  const slots = [];
  let guard = 0;
  while (slots.length < count && guard++ < 500) {
    const c = n.firstCandle + Math.floor(rng() * (n.lastCandle - n.firstCandle + 1));
    if (slots.every((s) => Math.abs(s - c) >= n.minGapCandles)) slots.push(c);
  }
  slots.sort((a, b) => a - b);
  return slots;
}

/**
 * Generate a full trading day up front.
 * @returns {{seed, ticker, open, ticks: Float64Array, news: Array, regimes: string[]}}
 */
export function generateDay({ seed, dayStartBalance = TIER1.startBalance, session = SESSION, engine = ENGINE, rules = TIER1 }) {
  const rng = mulberry32(seed);
  const tpc = session.ticksPerCandle;
  const nTicks = session.candles * tpc;
  const ticker = pick(rng, TICKERS);
  const open = round2(engine.priceMin + rng() * (engine.priceMax - engine.priceMin));

  // News: times known up front, headline/direction revealed when they land.
  const cap = shockCapPct(dayStartBalance, rules, engine);
  const n = engine.news;
  const used = new Set();
  const news = scheduleNews(rng, session, engine).map((candle) => {
    const dir = rng() < 0.5 ? 1 : -1;
    const pool = dir > 0 ? HEADLINES.up : HEADLINES.down;
    let headline = pick(rng, pool);
    for (let i = 0; i < pool.length && used.has(headline); i++) headline = pool[(pool.indexOf(headline) + 1) % pool.length];
    used.add(headline);
    const jump = dir * cap * (n.jumpMinShareOfCap + (1 - n.jumpMinShareOfCap) * rng());
    const followTicks = tpc * (n.followCandlesMin + Math.floor(rng() * (n.followCandlesMax - n.followCandlesMin + 1)));
    const followTotal = Math.abs(jump) * dir * (n.followMinShareOfJump + (n.followMaxShareOfJump - n.followMinShareOfJump) * rng());
    return { candle, tick: candle * tpc, dir, headline, jump, followTicks, followTotal };
  });
  const newsAt = new Map(news.map((e) => [e.tick, e]));

  const sigma = engine.dailyVol / Math.sqrt(nTicks);
  const driftPerTick = engine.trendMovePerCandle / tpc;
  const ticks = new Float64Array(nTicks);
  const regimes = [];
  let regime = pickRegime(rng, engine.regimes);
  let logp = Math.log(open);
  let follow = null; // { left, perTick, total }

  for (let i = 0; i < nTicks; i++) {
    if (i % tpc === 0) {
      if (i > 0 && rng() > engine.regimeStay) regime = pickRegime(rng, engine.regimes, regime);
      regimes.push(regime);
    }
    const R = engine.regimes[regime];
    const x = i / (nTicks - 1);
    const u = engine.uCurveMid + (engine.uCurveEdge - engine.uCurveMid) * (2 * x - 1) ** 2;

    let drift = R.drift * driftPerTick;
    let volMul = 1;
    const ev = newsAt.get(i);
    if (ev) {
      // Instant capped jump, then follow-through. Noise on this tick is suppressed
      // so the jump itself stays within the cap.
      logp += Math.log(1 + ev.jump);
      follow = { left: ev.followTicks, total: ev.followTicks, perTick: Math.log(1 + ev.followTotal) / ev.followTicks };
      ticks[i] = Math.max(1, round2(Math.exp(logp)));
      continue;
    }
    if (follow && follow.left > 0) {
      drift += follow.perTick;
      volMul = 1 + (n.volBoost - 1) * (follow.left / follow.total);
      follow.left--;
    }
    logp += drift + sigma * u * R.vol * volMul * gauss(rng);
    ticks[i] = Math.max(1, round2(Math.exp(logp)));
  }

  return { seed, ticker, open, ticks, news, regimes };
}

/**
 * Derive 5-minute candles from the tick path, up to and including tickIndex.
 * The last candle may be partial. A candle opens at the previous candle's close.
 */
export function candlesUpTo(day, tickIndex, session = SESSION) {
  const tpc = session.ticksPerCandle;
  const out = [];
  if (tickIndex < 0) return out;
  const last = Math.min(tickIndex, day.ticks.length - 1);
  for (let c = 0; c * tpc <= last; c++) {
    const start = c * tpc;
    const end = Math.min(start + tpc - 1, last);
    const o = c === 0 ? day.open : day.ticks[start - 1];
    let h = o, l = o;
    for (let i = start; i <= end; i++) {
      const p = day.ticks[i];
      if (p > h) h = p;
      if (p < l) l = p;
    }
    out.push({ o, h, l, c: day.ticks[end] });
  }
  return out;
}
