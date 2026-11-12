// Firm rules and account maths. Pure: no DOM, no timers.
import { TIER1, PERKS } from './config.js';

export const RULE_TEXT = {
  dailyLoss: { name: 'Daily loss limit', detail: (r) => `You lost $${r.dailyLossLimit.toLocaleString('en-US')} in one day, counting open P&L.` },
  drawdown: { name: 'Trailing max drawdown', detail: () => 'Your equity touched the drawdown floor.' },
  flatAtBell: { name: 'Flat at the bell', detail: () => 'You were still holding a position when the market closed.' },
  target: { name: 'Profit target not reached', detail: (r) => `The eval ended after ${r.evalDays} days without reaching the target.` },
  minDays: { name: 'Minimum trading days', detail: (r) => `You need at least ${r.minTradingDays} days with a trade.` },
};

/** Tier rules with the run's perks applied (Thick Skin widens the daily loss limit). */
export function effectiveRules(perks = [], rules = TIER1) {
  const out = { ...rules };
  const thick = PERKS.find((p) => p.id === 'thickSkin');
  if (perks.includes('thickSkin')) out.dailyLossLimit = Math.round(rules.dailyLossLimit * (1 + thick.lossBuffer));
  return out;
}

export function newRun(rules = TIER1, seed = (Math.random() * 2 ** 32) >>> 0, perks = []) {
  const mull = PERKS.find((p) => p.id === 'mulligan');
  return {
    seed,
    tier: rules.id || 'tier1',
    perks: [...perks],       // snapshot at run start
    mulligans: perks.includes('mulligan') ? mull.uses : 0,
    day: 1,                  // 1-based day number
    balance: rules.startBalance,
    highEod: rules.startBalance,
    floor: Math.min(rules.startBalance - rules.trailingDrawdown, rules.floorLocksAt),
    daysCounted: 0,
    history: [],             // per-day results
  };
}

export function newDay(run, rules = TIER1) {
  const futures = !!rules.contract;
  return {
    startBalance: run.balance,
    buyingPower: futures ? 0 : Math.round(run.balance * rules.buyingPowerMultiplier),
    maxContracts: futures ? rules.maxContracts : null, // futures: whole-contract cap
    mult: futures ? rules.contract.pointValue : 1,      // $ per 1.00 price move per unit
    qty: 0,                  // signed net units (shares or contracts): + long, - short
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
export function applyFill(qty, avg, delta, price, mult = 1) {
  if (delta === 0) return { qty, avg, realized: 0 };
  const next = qty + delta;
  // Opening or adding in the same direction.
  if (qty === 0 || Math.sign(qty) === Math.sign(delta)) {
    const newAvg = (Math.abs(qty) * avg + Math.abs(delta) * price) / Math.abs(next);
    return { qty: next, avg: newAvg, realized: 0 };
  }
  // Reducing, closing or reversing.
  const closed = Math.min(Math.abs(delta), Math.abs(qty));
  const realized = closed * (price - avg) * Math.sign(qty) * mult;
  if (next === 0) return { qty: 0, avg: 0, realized };
  if (Math.sign(next) === Math.sign(qty)) return { qty: next, avg, realized };
  return { qty: next, avg: price, realized }; // reversed: remainder opens at price
}

/** Max whole units (shares, or contracts for futures) the net position may hold at this price. */
export function maxShares(day, price) {
  if (day.maxContracts) return day.maxContracts;
  return Math.floor(day.buyingPower / price);
}

/**
 * Signed share delta for a BUY (side=+1) or SELL (side=-1) press at a size share.
 * Never lets the net position exceed buying power; a press that would go over
 * fills only up to the cap.
 */
export function orderDelta(day, side, size, price) {
  const cap = maxShares(day, price);
  // `size` is a share of buying power (number or {share}), or {contracts} for futures.
  const share = typeof size === 'number' ? size : size.share;
  const want = size.contracts ?? (day.maxContracts ? Math.floor(share * cap) : Math.floor((share * day.buyingPower) / price));
  const room = side > 0 ? cap - day.qty : cap + day.qty;
  return side * Math.max(0, Math.min(want, room));
}

export function openPnl(day, price) {
  return day.qty === 0 ? 0 : day.qty * (price - day.avg) * (day.mult ?? 1);
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

/**
 * Mulligan: forgive one rule break. The caller flattens the position and locks
 * the desk for the rest of the day. If equity sits at or below the drawdown
 * floor, the floor drops to leave `floorRoom` below the balance (and the
 * high-water mark follows, so the floor doesn't snap back at the close).
 */
export function applyMulligan(run, balance, rules = TIER1) {
  const room = PERKS.find((p) => p.id === 'mulligan').floorRoomDailyLimits * rules.dailyLossLimit;
  const next = { ...run, mulligans: run.mulligans - 1 };
  if (balance <= run.floor) {
    next.floor = balance - room;
    next.highEod = next.floor + rules.trailingDrawdown;
  }
  return next;
}
