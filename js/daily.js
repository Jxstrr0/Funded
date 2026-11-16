// Daily Challenge: one seeded day for everyone with the same date. Pure: no
// DOM, no storage (main.js keeps the results in the meta save).
import { DAILY, DAILY_SKIP_EDGES, TIERS } from './config.js';
import { hashSeed } from './engine.js';
import { edgePool, drawEdges } from './edges.js';

const DAY_MS = 86400000;

/** The player's local calendar date as 'YYYY-MM-DD'. */
export function dateKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const dayIndex = (key) => Math.round(Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10)) / DAY_MS);

/** Challenge number: Daily #1 is DAILY.epoch. */
export function challengeNumber(key, cfg = DAILY) {
  return dayIndex(key) - dayIndex(cfg.epoch) + 1;
}

/** Everything about a date's challenge: number, tier, seed and its fixed edges. */
export function challengeFor(key, cfg = DAILY) {
  const n = challengeNumber(key, cfg);
  const tier = cfg.tiers[((n - 1) % cfg.tiers.length + cfg.tiers.length) % cfg.tiers.length];
  const seed = hashSeed('daily', key);
  // Fixed edges from the whole pool (achievement locks don't apply: everyone gets
  // the same day), minus the multi-day ones and the cursed end-game one.
  const pool = edgePool([], tier).filter((e) => !DAILY_SKIP_EDGES.includes(e.id) && !e.cursed);
  const edges = drawEdges(seed, 'daily', pool, cfg.edges);
  const rules = TIERS[tier];
  const par = Math.round((rules.profitTarget * cfg.parShare) / 50) * 50;
  return { key, n, tier, seed, edges, par };
}

/** Days in a row with a scored try, ending today (or yesterday, if today isn't played yet). */
export function streak(played = {}, key) {
  let i = dayIndex(key);
  if (!played[key]) i -= 1;
  let n = 0;
  const keyAt = (ix) => new Date(ix * DAY_MS).toISOString().slice(0, 10);
  while (played[keyAt(i)]) { n++; i--; }
  return n;
}

/** Rep for a scored try: a flat amount for playing, plus 1 per DAILY.rep.perDollars of green P&L. */
export function dailyRep(pnl, cfg = DAILY) {
  return cfg.rep.played + Math.max(0, Math.floor(pnl / cfg.rep.perDollars));
}

/** Keep the most recent `keep` scored days. */
export function trimPlayed(played, keep = DAILY.keep) {
  const keys = Object.keys(played).sort();
  return Object.fromEntries(keys.slice(-keep).map((k) => [k, played[k]]));
}

const money = (v) => `${v < 0 ? '−' : '+'}$${Math.abs(Math.round(v)).toLocaleString('en-US')}`;

/**
 * The text a player shares: number, tier, result, one square per closed trade
 * (green up, red down), par and streak. No names or anything personal.
 */
export function shareText(r, cfg = DAILY) {
  const sq = (r.trades || []).map((t) => (t > 0 ? '🟩' : t < 0 ? '🟥' : '⬜')).join('') || '⬜ no trades';
  const head = `Funded Daily #${r.n} · ${TIERS[r.tier]?.short || ''}`;
  const res = r.fired ? `💥 Fired · ${r.rule} · ${money(r.pnl)}` : `${r.pnl >= 0 ? '▲' : '▼'} ${money(r.pnl)}${r.pnl >= r.par ? ' · par ✓' : ''}`;
  const lines = [head, res, sq];
  if (r.streak > 1) lines.push(`🔥 ${r.streak}-day streak`);
  lines.push(cfg.url);
  return lines.join('\n');
}
