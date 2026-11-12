// Firm rules and account maths. Pure: no DOM, no timers.
import { TIER1 } from './config.js';

export const RULE_TEXT = {
  dailyLoss: { name: 'Daily loss limit', detail: (r) => `You lost $${r.dailyLossLimit.toLocaleString('en-US')} in one day, counting open P&L.` },
  drawdown: { name: 'Trailing max drawdown', detail: () => 'Your equity touched the drawdown floor.' },
  flatAtBell: { name: 'Flat at the bell', detail: () => 'You were still holding a position when the market closed.' },
  target: { name: 'Profit target not reached', detail: (r) => `The eval ended after ${r.evalDays} days without reaching the target.` },
  minDays: { name: 'Minimum trading days', detail: (r) => `You need at least ${r.minTradingDays} days with a trade.` },
};

export function newRun(rules = TIER1, seed = (Math.random() * 2 ** 32) >>> 0) {
  return {
    seed,
    day: 1,                  // 1-based day number
    balance: rules.startBalance,
    highEod: rules.startBalance,
    floor: Math.min(rules.startBalance - rules.trailingDrawdown, rules.floorLocksAt),
    daysCounted: 0,
    history: [],             // per-day results
  };
}

export function newDay(run, rules = TIER1) {
  return {
    startBalance: run.balance,
    buyingPower: Math.round(run.balance * rules.buyingPowerMultiplier),
    qty: 0,                  // signed net shares: + long, - short
    avg: 0,
    realized: 0,
    trades: 0,
    tick: -1,                // last processed tick
  };
}

/**
 * Apply a fill of signed `delta` shares at `price`. Returns {qty, avg, realized}
 * where realized is the P&L closed by this fill. Crossing zero reverses.
 */
export function applyFill(qty, avg, delta, price) {
  if (delta === 0) return { qty, avg, realized: 0 };
  const next = qty + delta;
  // Opening or adding in the same direction.
  if (qty === 0 || Math.sign(qty) === Math.sign(delta)) {
    const newAvg = (Math.abs(qty) * avg + Math.abs(delta) * price) / Math.abs(next);
    return { qty: next, avg: newAvg, realized: 0 };
  }
  // Reducing, closing or reversing.
  const closed = Math.min(Math.abs(delta), Math.abs(qty));
  const realized = closed * (price - avg) * Math.sign(qty);
  if (next === 0) return { qty: 0, avg: 0, realized };
  if (Math.sign(next) === Math.sign(qty)) return { qty: next, avg, realized };
  return { qty: next, avg: price, realized }; // reversed: remainder opens at price
}

/** Max whole shares the net position may hold at this price. */
export function maxShares(day, price) {
  return Math.floor(day.buyingPower / price);
}

/**
 * Signed share delta for a BUY (side=+1) or SELL (side=-1) press at a size share.
 * Never lets the net position exceed buying power; a press that would go over
 * fills only up to the cap.
 */
export function orderDelta(day, side, sizeShare, price) {
  const cap = maxShares(day, price);
  const want = Math.floor((sizeShare * day.buyingPower) / price);
  const room = side > 0 ? cap - day.qty : cap + day.qty;
  return side * Math.max(0, Math.min(want, room));
}

export function openPnl(day, price) {
  return day.qty === 0 ? 0 : day.qty * (price - day.avg);
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/** Live account view and rule check at a price. */
export function snapshot(run, day, price, rules = TIER1) {
  const open = openPnl(day, price);
  const balance = day.startBalance + day.realized;
  const equity = balance + open;
  const dayPnl = equity - day.startBalance;
  const lossUsed = clamp01(-dayPnl / rules.dailyLossLimit);
  const ddUsed = clamp01((run.floor + rules.trailingDrawdown - equity) / rules.trailingDrawdown);
  const targetProgress = clamp01((equity - rules.startBalance) / rules.profitTarget);
  let breach = null;
  if (dayPnl <= -rules.dailyLossLimit) breach = 'dailyLoss';
  else if (equity <= run.floor) breach = 'drawdown';
  return { open, balance, equity, dayPnl, lossUsed, ddUsed, targetProgress, breach };
}

/**
 * Close the day after the bell. Assumes the position is flat (else the caller
 * fires the player for flatAtBell). Returns the updated run and an outcome:
 * 'next' | 'pass' | 'failTarget' | 'failMinDays'.
 */
export function closeDay(run, day, rules = TIER1) {
  const balance = day.startBalance + day.realized;
  const counted = day.trades > 0;
  const daysCounted = run.daysCounted + (counted ? 1 : 0);
  const highEod = Math.max(run.highEod, balance);
  const floor = Math.max(run.floor, Math.min(highEod - rules.trailingDrawdown, rules.floorLocksAt));
  const result = { day: run.day, pnl: balance - day.startBalance, balance, counted, trades: day.trades };
  const next = { ...run, balance, highEod, floor, daysCounted, history: [...run.history, result] };

  const hitTarget = balance >= rules.startBalance + rules.profitTarget;
  let outcome = 'next';
  if (hitTarget && daysCounted >= rules.minTradingDays) outcome = 'pass';
  else if (run.day >= rules.evalDays) outcome = hitTarget ? 'failMinDays' : 'failTarget';
  else if (rules.minTradingDays - daysCounted > rules.evalDays - run.day) outcome = 'failMinDays';
  if (outcome === 'next') next.day = run.day + 1;
  return { run: next, outcome, result };
}
