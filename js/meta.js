// Meta progress across runs: Reputation, perks, tutorial flag. Pure maths plus
// a guarded localStorage load/save.
import { PERKS, REPUTATION } from './config.js';

const KEY = 'funded.meta.v1';

export function defaultMeta() {
  return { rep: 0, owned: [], tutorialDone: false, runs: 0, passes: 0, mandates: [], stats: defaultStats() };
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

/** The most-taken edge: { id, n }, or null. Ties go to the edge taken first. */
export function favouriteEdge(stats) {
  let top = null;
  for (const [id, n] of Object.entries(stats.edgePicks)) if (!top || n > top.n) top = { id, n };
  return top;
}

export function loadMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) || 'null');
    return m && typeof m.rep === 'number' ? { ...defaultMeta(), ...m, stats: statsOf(m) } : defaultMeta();
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
