// localStorage wrapper. Every access is guarded: private mode or blocked
// storage just means no saving, never a crash.
import { EDGES, MANDATES, PERKS, SESSION } from './config.js';

const KEY = 'funded.run.v1';
// A Daily Challenge in progress saves separately, so it never overwrites a career.
export const DAILY_KEY = 'funded.daily.v1';

export function loadRun(key = KEY) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && data.v === 1 && data.run && typeof data.run === 'object' ? tidySave(data) : null;
  } catch {
    return null;
  }
}

const N_TICKS = SESSION.candles * SESSION.ticksPerCandle;
const DAY_MS = SESSION.realSeconds * 1000;
// The ids from `list` that the game has, each once.
const known = (list, table) => [...new Set(Array.isArray(list) ? list : [])].filter((id) => table.some((x) => x.id === id));

/**
 * Puts right a save that was damaged or edited by hand, so it can't stop the
 * game. Edges, mandates and perks the game doesn't have are dropped. A day in
 * progress whose clock isn't one the game could have saved is thrown away, so
 * that day restarts from its open: the game catches the clock up one tick at
 * a time, and a tick far below zero kept it busy for good.
 * A save the game wrote itself comes back unchanged.
 */
export function tidySave(data) {
  for (const [key, table] of [['edges', EDGES], ['mandates', MANDATES], ['perks', PERKS]]) {
    if (key in data.run) data.run[key] = known(data.run[key], table);
  }
  const live = data.live;
  if (live) {
    const d = live.day;
    const sound = d && typeof d === 'object'
      && Number.isInteger(d.tick) && d.tick >= -1 && d.tick < N_TICKS // -1 is "no tick yet"
      && Number.isFinite(live.elapsed) && live.elapsed >= 0 && live.elapsed <= DAY_MS
      && Array.isArray(live.revealed);
    if (!sound) data.live = null;
  }
  return data;
}

/**
 * @param {object} run   rules.newRun state
 * @param {object|null} live  day in progress: { day, elapsed, revealed: number[] }, or null between days
 * @param {number} sizeIndex
 */
export function saveRun(run, live, sizeIndex, key = KEY) {
  try {
    localStorage.setItem(key, JSON.stringify({ v: 1, run, live, sizeIndex, savedAt: Date.now() }));
  } catch {
    /* storage full or blocked: play on without saving */
  }
}

export function clearRun(key = KEY) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}
