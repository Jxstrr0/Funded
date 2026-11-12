// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateDay, candlesUpTo, hashSeed, shockCapPct } from '../js/engine.js';
import { SESSION, TIER1 } from '../js/config.js';

test('same seed gives the same day', () => {
  const a = generateDay({ seed: 42 });
  const b = generateDay({ seed: 42 });
  assert.deepEqual(Array.from(a.ticks), Array.from(b.ticks));
  assert.equal(a.ticker, b.ticker);
  assert.deepEqual(a.news, b.news);
});

test('day shape: 1,872 ticks, 78 candles, 1-3 news events', () => {
  for (let s = 0; s < 200; s++) {
    const d = generateDay({ seed: hashSeed('t', s) });
    assert.equal(d.ticks.length, SESSION.candles * SESSION.ticksPerCandle);
    assert.equal(candlesUpTo(d, d.ticks.length - 1).length, SESSION.candles);
    assert.ok(d.news.length >= 1 && d.news.length <= 3);
    assert.ok(d.open >= 20 && d.open <= 200);
  }
});

test('news jump is capped against the daily loss limit for a Max position', () => {
  const cap = shockCapPct(TIER1.startBalance);
  const bp = TIER1.startBalance * TIER1.buyingPowerMultiplier;
  for (let s = 0; s < 300; s++) {
    const d = generateDay({ seed: hashSeed('cap', s) });
    for (const ev of d.news) {
      const before = ev.tick === 0 ? d.open : d.ticks[ev.tick - 1];
      const shares = Math.floor(bp / before);
      const loss = Math.abs(d.ticks[ev.tick] - before) * shares;
      // allow a cent of rounding per share
      assert.ok(loss <= 0.6 * TIER1.dailyLossLimit + shares * 0.01, `loss ${loss}`);
      assert.ok(Math.abs(ev.jump) <= cap + 1e-12);
    }
  }
});

test('partial candle derives from ticks so far', () => {
  const d = generateDay({ seed: 7 });
  const cs = candlesUpTo(d, 30);
  assert.equal(cs.length, 2);
  assert.equal(cs[1].c, d.ticks[30]);
  assert.equal(cs[1].o, d.ticks[23]);
});
