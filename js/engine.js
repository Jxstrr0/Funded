// Seeded price engine. Pure: inputs in, ticks and candles out. No DOM.
import { SESSION, ENGINE, TIER1, TICKERS, HEADLINES, EARNINGS_HEADLINES, DAY_TYPES, FED_HEADLINES, HALT_HEADLINES } from './config.js';

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
const roundTo = (x, step) => Math.round(Math.round(x / step) * step * 100) / 100;

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
// at most shockCapShareOfDailyLimit of the daily loss limit. For futures the
// Max position's value depends on the price, so pass it.
export function shockCapPct(dayStartBalance, rules = TIER1, engine = ENGINE, price = 0) {
  const maxNotional = rules.contract
    ? rules.maxContracts * rules.contract.pointValue * price
    : rules.buyingPowerMultiplier * dayStartBalance;
  return (engine.news.shockCapShareOfDailyLimit * rules.dailyLossLimit) / maxNotional;
}

function scheduleNews(rng, session, n) {
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

/** The day's type (DAY_TYPES), seeded: null on most days, else 'gap' | 'fed' | 'trend' | 'halt'. */
export function dayTypeFor(seed, cfg = DAY_TYPES) {
  const rng = mulberry32(hashSeed(seed, 'daytype'));
  if (rng() >= cfg.chance) return null;
  const names = Object.keys(cfg.types);
  const total = names.reduce((s, k) => s + cfg.types[k].weight, 0);
  let r = rng() * total;
  for (const k of names) if ((r -= cfg.types[k].weight) <= 0) return k;
  return names[names.length - 1];
}

const between = (rng, [lo, hi]) => lo + (hi - lo) * rng();
const intBetween = (rng, [lo, hi]) => lo + Math.floor(rng() * (hi - lo + 1));

/**
 * Generate a full trading day up front. `dayType` forces a type (or null for
 * none); left out, it is seeded (dayTypeFor). Scripted days never get one.
 * @returns {{seed, ticker, open, ticks: Float64Array, news: Array, regimes: string[], type: string|null, halts: Array<{from, to, candle}>, gap?: number}}
 */
export function generateDay({ seed, dayStartBalance = TIER1.startBalance, session = SESSION, engine = ENGINE, rules = TIER1, script = null, dayType, dayTypes = DAY_TYPES }) {
  const rng = mulberry32(seed);
  const type = script ? null : dayType === undefined ? dayTypeFor(seed, dayTypes) : dayType;
  const T = type ? dayTypes.types[type] : null;
  const rx = mulberry32(hashSeed(seed, 'daytype-x')); // the type's own draws
  const typeDir = rx() < 0.5 ? 1 : -1;
  const tpc = session.ticksPerCandle;
  const nTicks = session.candles * tpc;
  // Futures trade one fixed contract; stocks pick a ticker and a price level.
  const c = rules.contract;
  const step = c ? c.tickSize : 0.01;
  let ticker = pick(rng, TICKERS);
  const u0 = rng();
  let open = c
    ? roundTo(c.priceMin + u0 * (c.priceMax - c.priceMin), step)
    : roundTo((rules.priceMin ?? engine.priceMin) + u0 * ((rules.priceMax ?? engine.priceMax) - (rules.priceMin ?? engine.priceMin)), step);
  if (c) ticker = c.symbol;
  if (script?.ticker) ticker = script.ticker;
  if (script?.open) open = script.open;

  // News: times known up front, headline/direction revealed when they land.
  const cap = shockCapPct(dayStartBalance, rules, engine, open);
  // A tier can override the news settings (rules.news), e.g. options keep their own.
  const n0 = rules.news ? { ...engine.news, ...rules.news } : engine.news;
  const n = type === 'trend' ? { ...n0, ...T.news } : n0;
  const used = new Set();
  let news = scheduleNews(rng, session, n).map((candle) => {
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
  if (type === 'fed') {
    // One release at 14:00, at the full cap, with a long follow-through.
    const jump = typeDir * cap * T.jumpShareOfCap;
    const followTicks = tpc * intBetween(rx, T.followCandles);
    news = [{ candle: T.candle, tick: T.candle * tpc, dir: typeDir, headline: pick(rx, FED_HEADLINES[typeDir > 0 ? 'up' : 'down']), jump, followTicks, followTotal: Math.abs(jump) * typeDir * between(rx, T.follow), fed: true }];
  }
  if (script?.news) {
    // Scripted day (tutorial): fixed news, jump as a share of the cap.
    news = script.news.map((e) => {
      const followTicks = tpc * n.followCandlesMin;
      const jump = e.dir * cap * (e.jumpShare ?? 0.8);
      return { candle: e.candle, tick: e.candle * tpc, dir: e.dir, headline: e.headline, jump, followTicks, followTotal: jump * 0.5 };
    });
  }
  // Options tier: one release is the day's earnings, and jumps are a share of
  // the price. A separate stream keeps the other tiers' days unchanged.
  let earningsTick = null;
  if (rules.shocks && !script?.news && news.length) {
    const r2 = mulberry32(hashSeed(seed, 'options'));
    const earn = Math.floor(r2() * news.length);
    news = news.map((e, k) => {
      const isEarn = k === earn;
      const [lo, hi] = isEarn ? (type === 'fed' ? T.optionsJump : rules.shocks.earnings) : rules.shocks.other;
      const jump = e.dir * (lo + (hi - lo) * r2());
      const followTotal = Math.abs(jump) * e.dir * (n.followMinShareOfJump + (n.followMaxShareOfJump - n.followMinShareOfJump) * r2());
      const headline = isEarn ? pick(r2, EARNINGS_HEADLINES[e.dir > 0 ? 'up' : 'down']) : e.headline;
      return { ...e, jump, followTotal, headline, earnings: isEarn };
    });
    earningsTick = news[earn].tick;
  }
  if (type === 'trend') news = news.map((e) => ({ ...e, jump: e.jump * T.newsScale, followTotal: e.followTotal * T.newsScale }));
  // Halt: one headline (early enough to reopen before the bell) freezes the
  // tape for T.candles candles, then it reopens with a second jump. The two
  // jumps together stay inside the first one's size (the shock cap).
  const halts = [];
  if (type === 'halt') {
    const ok = news.filter((e) => e.candle + T.candles <= T.lastCandle);
    if (ok.length) {
      const h = ok[Math.floor(rx() * ok.length)];
      const J = Math.abs(h.jump);
      const reopenDir = rx() < T.reopenWithChance ? h.dir : -h.dir;
      const at = h.candle + T.candles;
      const reopen = {
        candle: at, tick: at * tpc, dir: reopenDir, headline: HALT_HEADLINES[reopenDir > 0 ? 'up' : 'down'],
        jump: reopenDir * J * between(rx, T.reopenShare), followTicks: h.followTicks,
        followTotal: Math.abs(h.followTotal) * reopenDir, reopen: true, haltFrom: h.tick + 1,
      };
      halts.push({ from: h.tick + 1, to: reopen.tick, candle: h.candle });
      news = news
        .filter((e) => e === h || e.candle < h.candle || e.candle > at + 1) // no headlines inside the halt
        .map((e) => (e === h ? { ...e, jump: e.dir * J * T.firstShare, followTicks: 1, followTotal: 0, halts: true } : e));
      news.push(reopen);
      news.sort((a, b) => a.tick - b.tick);
    }
  }
  const halted = (i) => halts.some((h) => i >= h.from && i < h.to);
  const newsAt = new Map(news.map((e) => [e.tick, e]));
  // Gap open: the open is the price after the gap; the first hour runs with it (or fills it).
  const gap = type === 'gap' ? { pct: typeDir * between(rx, T.gapPct), go: rx() < T.followChance ? typeDir : -typeDir } : null;

  const sigma = (engine.dailyVol / Math.sqrt(nTicks)) * (script?.volScale ?? 1) * (c?.volScale ?? 1);
  const driftPerTick = engine.trendMovePerCandle / tpc;
  const ticks = new Float64Array(nTicks);
  const regimes = [];
  let regime = script?.regime ?? (type === 'trend' ? (typeDir > 0 ? 'trend-up' : 'trend-down') : pickRegime(rng, engine.regimes));
  const lockRegime = !!script?.regime || type === 'trend';
  const gapTicks = gap ? T.candles * tpc : 0;
  const fedTick = type === 'fed' ? T.candle * tpc : 0;
  let logp = Math.log(open);
  let follow = null; // { left, perTick, total }

  for (let i = 0; i < nTicks; i++) {
    if (i % tpc === 0) {
      if (i > 0 && !lockRegime && rng() > engine.regimeStay) regime = pickRegime(rng, engine.regimes, regime);
      regimes.push(i < gapTicks ? (gap.go > 0 ? 'trend-up' : 'trend-down') : regime);
    }
    if (halted(i)) { ticks[i] = ticks[i - 1]; continue; } // halted: the tape stands still
    let R = engine.regimes[regime];
    if (i < gapTicks) R = { drift: gap.go * T.drift, vol: T.vol };
    else if (type === 'trend') R = { ...R, drift: R.drift * T.drift };
    else if (type === 'fed' && i < fedTick) R = { ...R, vol: R.vol * T.quietVol };
    const x = i / (nTicks - 1);
    const u = engine.uCurveMid + (engine.uCurveEdge - engine.uCurveMid) * (2 * x - 1) ** 2;

    let drift = R.drift * driftPerTick;
    let volMul = 1;
    const ev = newsAt.get(i);
    if (ev) {
      // Instant capped jump, then follow-through. Noise on this tick is suppressed
      // so the jump itself stays within the cap.
      // Futures: the cap holds in points (dollars per contract), whatever the price has done since the open.
      const jump = c ? (ev.jump * open) / Math.exp(logp) : ev.jump;
      logp += Math.log(1 + jump);
      follow = { left: ev.followTicks, total: ev.followTicks, perTick: Math.log(1 + ev.followTotal) / ev.followTicks };
      ticks[i] = Math.max(1, roundTo(Math.exp(logp), step));
      continue;
    }
    if (follow && follow.left > 0) {
      drift += follow.perTick;
      volMul = 1 + (n.volBoost - 1) * (follow.left / follow.total);
      follow.left--;
    }
    logp += drift + sigma * u * R.vol * volMul * gauss(rng);
    ticks[i] = Math.max(1, roundTo(Math.exp(logp), step));
  }

  const day = { seed, ticker, open, ticks, news, regimes, type, halts };
  if (gap) day.gap = gap.pct;
  if (rules.option) {
    const o = rules.option;
    const r3 = mulberry32(hashSeed(seed, 'iv'));
    day.strike = Math.round(open / o.strikeStep) * o.strikeStep;
    day.baseIV = o.ivMin + (o.ivMax - o.ivMin) * r3();
    day.earningsTick = earningsTick;
  }
  return day;
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

/**
 * Level 2 order book at a tick (the Level 2 perk). Bid/ask pressure leans
 * toward the next candle's move, with seeded noise. It never looks past the
 * next news shock: that's Newswire's job.
 */
export function bookAt(day, tick, session = SESSION) {
  const last = day.ticks.length - 1;
  const i = Math.max(0, Math.min(tick, last));
  const nextNews = day.news.find((e) => e.tick > i);
  const j = Math.min(i + session.ticksPerCandle, last, nextNews ? nextNews.tick - 1 : last);
  const r = Math.log(day.ticks[j] / day.ticks[i]);
  const rng = mulberry32(hashSeed(day.seed, 'l2', Math.floor(i / 6)));
  const noise = (rng() - 0.5) * 0.3;
  const bidPct = Math.max(0.12, Math.min(0.88, 0.5 + Math.tanh(r / 0.003) * 0.3 + noise));
  const depth = 2000 + rng() * 6000;
  return { bid: Math.round(depth * bidPct), ask: Math.round(depth * (1 - bidPct)), bidPct };
}

/** Is trading halted at this tick? */
export function haltAt(day, tick) {
  return (day.halts || []).find((h) => tick >= h.from && tick < h.to) || null;
}
