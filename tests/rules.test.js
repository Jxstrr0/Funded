import test from 'node:test';
import assert from 'node:assert/strict';
import { applyFill, newRun, newDay, orderDelta, snapshot, closeDay } from '../js/rules.js';
import { TIER1 } from '../js/config.js';

test('fills: add, reduce, reverse', () => {
  let p = applyFill(0, 0, 100, 10);
  assert.deepEqual(p, { qty: 100, avg: 10, realized: 0 });
  p = applyFill(p.qty, p.avg, 100, 12);
  assert.equal(p.avg, 11);
  p = applyFill(p.qty, p.avg, -50, 13);
  assert.equal(p.qty, 150); assert.equal(p.avg, 11); assert.equal(p.realized, 100);
  p = applyFill(150, 11, -200, 10);
  assert.equal(p.qty, -50); assert.equal(p.avg, 10); assert.equal(p.realized, -150);
});

test('buying power is 3.33x and caps the net position', () => {
  const run = newRun(); const day = newDay(run);
  assert.equal(day.buyingPower, 83250);
  assert.equal(orderDelta(day, 1, 1, 100), 832);
  day.qty = 800;
  assert.equal(orderDelta(day, 1, 0.25, 100), 32);  // only up to the cap
  assert.equal(orderDelta(day, -1, 1, 100), -832); // Max sell: long 800 -> short 32
  day.qty = -800;
  assert.equal(orderDelta(day, -1, 1, 100), -32); // short side capped too
});

test('max position: ~0.9% adverse move hits the daily loss limit', () => {
  const run = newRun(); const day = newDay(run);
  const price = 100;
  day.qty = orderDelta(day, 1, 1, price); day.avg = price;
  let p = price;
  while (!snapshot(run, day, p).breach) p -= 0.01;
  const move = (price - p) / price;
  assert.ok(move > 0.0085 && move < 0.0095, `move ${move}`);
  assert.equal(snapshot(run, day, p).breach, 'dailyLoss');
});

test('trailing floor rises at end of day and locks at the start balance', () => {
  let run = newRun();
  assert.equal(run.floor, 23500);
  let day = newDay(run); day.realized = 800; day.trades = 1;
  ({ run } = closeDay(run, day));
  assert.equal(run.floor, 24300);
  day = newDay(run); day.realized = 900; day.trades = 1;
  ({ run } = closeDay(run, day));
  assert.equal(run.floor, 25000); // locked
  day = newDay(run); day.realized = 0; day.trades = 1;
  const r = closeDay(run, day);
  assert.equal(r.outcome, 'pass'); // 26,700 after 3 counted days
});

test('target before day 3 does not pass early', () => {
  let run = newRun();
  const day = newDay(run); day.realized = 2000; day.trades = 1;
  const r = closeDay(run, day);
  assert.equal(r.outcome, 'next');
});

test('day without trades does not count; impossible min days fails', () => {
  let run = newRun();
  for (let i = 0; i < 2; i++) {
    const d = newDay(run);
    const r = closeDay(run, d);
    run = r.run;
    if (i === 1) assert.equal(r.outcome, 'next');
  }
  const d = newDay(run); // day 3, 0 counted, 2 days left after -> impossible
  assert.equal(closeDay(run, d).outcome, 'failMinDays');
});

test('futures: whole contracts, fixed cap, $ per point', async () => {
  const { TIER2 } = await import('../js/config.js');
  const { openPnl, applyMulligan } = await import('../js/rules.js');
  const run = newRun(TIER2); const day = newDay(run, TIER2);
  assert.equal(run.tier, 'tier2');
  assert.equal(run.floor, 47000);
  assert.equal(day.mult, 50);
  assert.equal(orderDelta(day, 1, TIER2.sizes[0], 1000), 1);
  assert.equal(orderDelta(day, 1, TIER2.sizes[2], 1000), 6);
  day.qty = 5; day.avg = 1000;
  assert.equal(orderDelta(day, 1, TIER2.sizes[1], 1000), 1);   // only up to the 6-contract cap
  assert.equal(orderDelta(day, -1, TIER2.sizes[2], 1000), -6);  // MAX sell is a full 6, long 5 -> short 1
  assert.equal(openPnl(day, 1002.5), 5 * 2.5 * 50);             // +2.5 points x 5 contracts
  const f = applyFill(5, 1000, -5, 999.75, 50);
  assert.equal(f.realized, -5 * 0.25 * 50);                     // one tick against = -$12.50 a contract
  // Max size: the daily loss limit goes in about a 0.5% move at 1000.
  day.qty = 6;
  const snap = snapshot(run, day, 1000 - TIER2.dailyLossLimit / (6 * 50), TIER2);
  assert.equal(snap.breach, 'dailyLoss');
  // Mulligan room scales with the tier's daily limit.
  const m = applyMulligan({ ...run, mulligans: 1 }, 46500, TIER2);
  assert.equal(m.floor, 45000);
});
