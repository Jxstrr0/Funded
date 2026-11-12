// Option pricing for the options tier. Pure: no DOM, no timers.
// One strike a day, expiring at the 16:00 bell, priced with Black-Scholes
// (no interest, no dividends) so time decay and volatility crush fall out of
// the maths instead of being scripted.
import { SESSION } from './config.js';

const TRADING_MINUTES_PER_YEAR = 252 * 390;

// Abramowitz & Stegun 7.1.26, good to about 1e-7.
function erf(x) {
  const s = Math.sign(x);
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-a * a);
  return s * y;
}
const ncdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));

/** Call and put value for spot S, strike K, T years left, annual implied vol iv. */
export function bs(S, K, T, iv) {
  if (T <= 0 || iv <= 0) return { call: Math.max(S - K, 0), put: Math.max(K - S, 0) };
  const v = iv * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (v * v) / 2) / v;
  const call = S * ncdf(d1) - K * ncdf(d1 - v);
  return { call, put: call - S + K }; // put-call parity
}

/** Implied vol at a tick: pumped toward the earnings release, crushed after it. */
export function ivAt(market, tick, rules) {
  const o = rules.option;
  const e = market.earningsTick;
  if (e == null) return market.baseIV;
  if (tick >= e) return market.baseIV * o.ivCrush;
  const x = tick / e;
  return market.baseIV * (o.ivPumpAtOpen + (o.ivEarningsPump - o.ivPumpAtOpen) * x);
}

const cents = (x) => Math.max(0.01, Math.round(x * 100) / 100);

/** Premiums at a tick: {call, put, iv, minutesLeft}. */
export function quoteAt(market, tick, rules, session = SESSION) {
  const n = session.candles * session.ticksPerCandle;
  const i = Math.max(0, Math.min(tick, n - 1));
  const minutesLeft = Math.max(rules.option.minMinutesLeft, session.marketMinutes * (1 - i / n));
  const iv = ivAt(market, i, rules);
  const p = bs(market.ticks[i], market.strike, minutesLeft / TRADING_MINUTES_PER_YEAR, iv);
  return { call: cents(p.call), put: cents(p.put), iv, minutesLeft };
}
