// localStorage wrapper. Every access is guarded: private mode or blocked
// storage just means no saving, never a crash.
const KEY = 'funded.run.v1';

export function loadRun() {
  try {
    const raw = localStorage.getItem(KEY);
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
export function saveRun(run, live, sizeIndex) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ v: 1, run, live, sizeIndex, savedAt: Date.now() }));
  } catch {
    /* storage full or blocked: play on without saving */
  }
}

export function clearRun() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
