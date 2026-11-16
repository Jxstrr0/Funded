// localStorage wrapper. Every access is guarded: private mode or blocked
// storage just means no saving, never a crash.
const KEY = 'funded.run.v1';
// A Daily Challenge in progress saves separately, so it never overwrites a career.
export const DAILY_KEY = 'funded.daily.v1';

export function loadRun(key = KEY) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data && data.v === 1 && data.run ? data : null;
  } catch {
    return null;
  }
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
