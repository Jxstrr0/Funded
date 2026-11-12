import test from 'node:test';
import assert from 'node:assert/strict';
import { bs, quoteAt, ivAt } from '../js/options.js';
import { generateDay, hashSeed } from '../js/engine.js';
import { newRun, newDay, optionOrder, applyFill, snapshot } from '../js/rules.js';
import { TIER1, TIER2, TIER3, TIERS } from '../js/config.js';

const day3 = (s = 7) => generateDay({ seed: hashSeed(s, 1), rules: TIER3, dayStartBalance: TIER3.startBalance });

test('Black-Scholes: put-call parity and intrinsic value at expiry', () => {
  const p = bs(100, 95, 0.01, 0.4);
  assert.ok(Math.abs(p.call - p.put - 5) < 1e-9);
  assert.deepEqual(bs(104, 100, 0, 0.4), { call: 4, put: 0 });
  // At the money is worth about 0.4 x S x vol x sqrt(T).
  const atm = bs(100, 100, 1 / 252, 0.5).call;
  assert.ok(Math.abs(atm - 0.4 * 100 * 0.5 * Math.sqrt(1 / 252)) < 0.03, `atm ${atm}`);
});

test('options day: one earnings release, strike at the open, IV pumped then crushed', () => {
  for (let s = 1; s <= 30; s++) {
    const d = day3(s);
    const earn = d.news.filter((n) => n.earnings);
    assert.equal(earn.length, 1);
    assert.equal(d.earningsTick, earn[0].tick);
    assert.equal(d.strike, Math.round(d.open));
    assert.ok(d.baseIV >= TIER3.option.ivMin && d.baseIV <= TIER3.option.ivMax);
    for (const n of d.news) {
      const [lo, hi] = n.earnings ? TIER3.shocks.earnings : TIER3.shocks.other;
      assert.ok(Math.abs(n.jump) >= lo && Math.abs(n.jump) <= hi, `jump ${n.jump}`);
    }
    const before = ivAt(d, d.earningsTick - 1, TIER3);
    const after = ivAt(d, d.earningsTick, TIER3);
    assert.ok(before > ivAt(d, 0, TIER3) && after < d.baseIV);
  }
});

test('time decay: with the price held still, premium falls through the day', () => {
  const d = day3();
  const flat = { ...d, ticks: new Float64Array(d.ticks.length).fill(d.strike), earningsTick: null };
  const at = (i) => quoteAt(flat, i, TIER3).call;
  assert.ok(at(0) > at(900) && at(900) > at(1700) && at(1700) > at(1871));
});

test('other tiers get the same days as before options existed', () => {
  // Tier 1 and Tier 2 days must not change: they share no random draws with the options stream.
  const a = generateDay({ seed: 42, rules: TIER1 });
  const b = generateDay({ seed: 42, rules: TIER2 });
  assert.equal(a.strike, undefined);
  assert.ok(a.news.every((n) => !n.earnings) && b.news.every((n) => !n.earnings));
  assert.equal(TIER2.next, 'tier3');
  assert.equal(TIERS.tier3, TIER3);
});

test('option orders: sizes buy a share of the premium budget, capped by budget and contracts', () => {
  const run = newRun(TIER3);
  const day = newDay(run, TIER3);
  assert.equal(day.mult, 100);
  const size = (i) => TIER3.sizes[i];
  assert.equal(optionOrder(day, size(0), 1.25, TIER3), 4);    // $500 / $125
  assert.equal(optionOrder(day, size(2), 1.25, TIER3), 16);   // $2,000 / $125
  assert.equal(optionOrder(day, size(2), 0.05, TIER3), 40);   // contract cap
  assert.equal(optionOrder(day, size(0), 25, TIER3), 0);      // one contract costs more than the budget
  day.qty = 12; day.avg = 1.25; day.right = 'C';
  assert.equal(optionOrder(day, size(2), 1.25, TIER3), 4);    // only the budget left
});

test('option P&L: marked at premium, loss limited to what was paid', () => {
  const run = newRun(TIER3);
  const day = newDay(run, TIER3);
  let r = applyFill(0, 0, 16, 1.25, day.mult);
  Object.assign(day, { qty: r.qty, avg: r.avg, right: 'P' });
  assert.equal(snapshot(run, day, 2.0, TIER3).open, 1200);
  assert.equal(snapshot(run, day, 0.01, TIER3).open, -1984);
  assert.equal(snapshot(run, day, 0.01, TIER3).breach, null); // a full position can't break the $3,000 limit alone
  r = applyFill(day.qty, day.avg, -16, 3.1, day.mult);
  assert.equal(Math.round(r.realized), 2960);
});
