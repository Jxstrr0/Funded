import test from 'node:test';
import assert from 'node:assert/strict';
import { reputationFor, buyPerk, defaultMeta, canBuy } from '../js/meta.js';
import { newRun, newDay, effectiveRules, applyMulligan, closeDay, snapshot } from '../js/rules.js';
import { generateDay, bookAt } from '../js/engine.js';
import { TUTORIAL } from '../js/config.js';

test('reputation: days survived, best green day, pass bonus', () => {
  const h = [{ pnl: 400 }, { pnl: -200 }, { pnl: 820 }];
  assert.equal(reputationFor(h, true).total, 30 + 16 + 50);
  assert.equal(reputationFor([], false).total, 0);
  assert.equal(reputationFor([{ pnl: -300 }], false).total, 10);
});

test('perk shop: buy once, needs enough Rep', () => {
  let m = { ...defaultMeta(), rep: 100 };
  assert.equal(canBuy(m, 'mulligan'), false);
  m = buyPerk(m, 'thickSkin');
  assert.equal(m.rep, 40); assert.deepEqual(m.owned, ['thickSkin']);
  assert.equal(buyPerk(m, 'thickSkin'), m);
});

test('thick skin widens the daily loss limit by 10%', () => {
  assert.equal(effectiveRules(['thickSkin']).dailyLossLimit, 825);
  assert.equal(effectiveRules([]).dailyLossLimit, 750);
});

test('mulligan on a drawdown break leaves room that survives the close', () => {
  let run = newRun(undefined, 1, ['mulligan']);
  assert.equal(run.mulligans, 1);
  const day = newDay(run); day.realized = -1500; day.trades = 1; // balance 23,500 = floor
  run = applyMulligan(run, 23500);
  assert.equal(run.mulligans, 0);
  assert.equal(run.floor, 22750);
  const r = closeDay(run, day);
  assert.equal(r.run.floor, 22750);
  const next = newDay(r.run);
  assert.equal(snapshot(r.run, next, 100).breach, null);
});

test('tutorial day is scripted and gentle', () => {
  const d = generateDay({ seed: TUTORIAL.seed, script: TUTORIAL.script });
  assert.equal(d.ticker, 'NOVA');
  assert.equal(d.news.length, 1);
  assert.equal(d.news[0].candle, 30);
  assert.ok(d.ticks.at(-1) > d.open * 0.99);
});

test('order book stays in range and is deterministic', () => {
  const d = generateDay({ seed: 99 });
  for (let t = 0; t < d.ticks.length; t += 37) {
    const b = bookAt(d, t);
    assert.ok(b.bidPct >= 0.12 && b.bidPct <= 0.88);
    assert.deepEqual(b, bookAt(d, t));
  }
});
