// Meta progress across runs: Reputation, perks, tutorial flag. Pure maths plus
// a guarded localStorage load/save.
import { PERKS, REPUTATION, ACHIEVEMENTS } from './config.js';

const KEY = 'funded.meta.v1';

export function defaultMeta() {
  // ach: achievement id -> date earned. daily: date -> scored Daily Challenge result. seen: tier explainers shown.
  return { rep: 0, owned: [], tutorialDone: false, runs: 0, passes: 0, mandates: [], stats: defaultStats(), ach: {}, daily: {}, seen: {} };
}

// ---------- career stats (the title's Career stats card) ----------

const TIER_ORDER = ['tier1', 'tier2', 'tier3'];

export function defaultStats() {
  return {
    careers: 0,                      // careers finished (fired, not funded, or top of the ladder)
    passed: { tier1: 0, tier2: 0, tier3: 0 },
    fired: 0,                        // broke a rule
    notFunded: 0,                    // ran out of days short of the target or minimum
    days: 0,                         // trading days closed at the bell
    greenDays: 0,
    bestDay: null,                   // { pnl, tier }
    longestCareer: 0,                // days closed in one career, across promotions
    topTier: null,                   // highest tier reached
    repEarned: 0,
    edgePicks: {},                   // edge id -> times taken
    payouts: 0,                      // funded weeks paid out
    paidTotal: 0,                    // $ paid out, all careers
    bestPaid: 0,                     // most $ paid out in one career
    bestDaily: null,                 // { pnl, n, tier }: best scored Daily Challenge
    partial: false,                  // true when play before stats existed isn't in here
  };
}

/** Stats from a stored meta, filling anything missing (older saves). */
export function statsOf(meta) {
  const d = defaultStats();
  const s = meta.stats && typeof meta.stats === 'object' ? meta.stats : { ...d, partial: (meta.runs || 0) > 0 };
  return { ...d, ...s, passed: { ...d.passed, ...s.passed }, edgePicks: { ...s.edgePicks } };
}

function higherTier(a, b) {
  return TIER_ORDER.indexOf(b) > TIER_ORDER.indexOf(a) ? b : a;
}

/** A day closed at the bell. */
export function recordDay(stats, tier, pnl) {
  const best = !stats.bestDay || pnl > stats.bestDay.pnl ? { pnl, tier } : stats.bestDay;
  return { ...stats, days: stats.days + 1, greenDays: stats.greenDays + (pnl > 0 ? 1 : 0), bestDay: best, topTier: higherTier(stats.topTier, tier) };
}

export function recordEdge(stats, id) {
  return { ...stats, edgePicks: { ...stats.edgePicks, [id]: (stats.edgePicks[id] || 0) + 1 } };
}

/** An eval finished: 'pass', 'fired' or 'notFunded'. */
export function recordEval(stats, tier, outcome, rep = 0) {
  const s = { ...stats, repEarned: stats.repEarned + rep, topTier: higherTier(stats.topTier, tier) };
  if (outcome === 'pass') s.passed = { ...s.passed, [tier]: (s.passed[tier] || 0) + 1 };
  if (outcome === 'fired') s.fired += 1;
  if (outcome === 'notFunded') s.notFunded += 1;
  return s;
}

/** A career ended after `days` closed days in all. */
export function recordCareer(stats, days) {
  return { ...stats, careers: stats.careers + 1, longestCareer: Math.max(stats.longestCareer, days) };
}

/** A funded week paid out `paid`; the career has now been paid `careerPaid` in all. */
export function recordPayout(stats, paid, careerPaid) {
  return { ...stats, payouts: stats.payouts + (paid > 0 ? 1 : 0), paidTotal: stats.paidTotal + paid, bestPaid: Math.max(stats.bestPaid, careerPaid) };
}

/** A scored Daily Challenge. */
export function recordDaily(stats, r) {
  const best = !stats.bestDaily || r.pnl > stats.bestDaily.pnl ? { pnl: r.pnl, n: r.n, tier: r.tier } : stats.bestDaily;
  return { ...stats, bestDaily: best };
}

// ---------- achievements ----------

/**
 * Which achievements an event earns (ids not yet held). Events:
 *  { kind: 'pass', tier, history, mandates }   an eval passed
 *  { kind: 'day', type, pnl }                  a day closed at the bell
 *  { kind: 'payout', paid, careerPaid }        a funded week closed
 *  { kind: 'daily', played, streak }           a Daily Challenge scored (played = count)
 */
export function achievementsFor(meta, ev) {
  const out = [];
  if (ev.kind === 'pass') {
    if (ev.tier === 'tier1') out.push('firstPass');
    if (ev.tier === 'tier2') out.push('tier2Pass');
    if (ev.tier === 'tier3') out.push('funded');
    if (ev.history?.length && ev.history.every((d) => d.pnl > 0)) out.push('flawless');
    if ((ev.mandates || []).length >= 3) out.push('mandated');
  }
  if (ev.kind === 'day' && ev.pnl > 0) {
    if (ev.type === 'fed') out.push('fedDay');
    if (ev.type === 'halt') out.push('haltDay');
  }
  if (ev.kind === 'payout') {
    if (ev.paid > 0) out.push('firstPayout');
    if (ev.careerPaid >= 100000) out.push('bigPayout');
  }
  if (ev.kind === 'daily') {
    if (ev.played >= 5) out.push('dailyFive');
    if (ev.streak >= 7) out.push('dailyStreak');
  }
  const have = meta.ach || {};
  return out.filter((id) => !have[id] && ACHIEVEMENTS.some((a) => a.id === id));
}

/** Mark achievements earned on `date`. */
export function grantAchievements(meta, ids, date) {
  if (!ids.length) return meta;
  const ach = { ...(meta.ach || {}) };
  for (const id of ids) ach[id] = date;
  return { ...meta, ach };
}

/** The most-taken edge: { id, n }, or null. Ties go to the edge taken first. */
export function favouriteEdge(stats) {
  let top = null;
  for (const [id, n] of Object.entries(stats.edgePicks)) if (!top || n > top.n) top = { id, n };
  return top;
}

export function loadMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (!m || typeof m.rep !== 'number') return defaultMeta();
    const obj = (x) => (x && typeof x === 'object' && !Array.isArray(x) ? x : {});
    return { ...defaultMeta(), ...m, stats: statsOf(m), ach: obj(m.ach), daily: obj(m.daily), seen: obj(m.seen) };
  } catch {
    return defaultMeta();
  }
}

export function saveMeta(meta) {
  try { localStorage.setItem(KEY, JSON.stringify(meta)); } catch { /* play on */ }
}

/**
 * Reputation for a finished run. `history` holds the closed days; a firing
 * mid-day doesn't count that day as survived. `mult` is the career's Rep
 * multiplier (mandates, Rainmaker).
 */
export function reputationFor(history, passed, cfg = REPUTATION, mult = 1) {
  const survived = history.length;
  const bestDay = Math.max(0, ...history.map((d) => d.pnl));
  const parts = {
    days: survived * cfg.perDaySurvived,
    bestDay: Math.floor(bestDay / cfg.bestDayDollarsPerRep),
    pass: passed ? cfg.passBonus : 0,
  };
  const base = parts.days + parts.bestDay + parts.pass;
  const total = Math.round(base * mult);
  return { total, base, mult, parts: { ...parts, bonus: total - base } };
}

export function canBuy(meta, id) {
  const p = PERKS.find((x) => x.id === id);
  return !!p && !meta.owned.includes(id) && meta.rep >= p.cost;
}

export function buyPerk(meta, id) {
  if (!canBuy(meta, id)) return meta;
  const p = PERKS.find((x) => x.id === id);
  return { ...meta, rep: meta.rep - p.cost, owned: [...meta.owned, id] };
}
