// Meta progress across runs: Reputation, perks, tutorial flag. Pure maths plus
// a guarded localStorage load/save.
import { PERKS, REPUTATION } from './config.js';

const KEY = 'funded.meta.v1';

export function defaultMeta() {
  return { rep: 0, owned: [], tutorialDone: false, runs: 0, passes: 0, mandates: [] };
}

export function loadMeta() {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) || 'null');
    return m && typeof m.rep === 'number' ? { ...defaultMeta(), ...m } : defaultMeta();
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
