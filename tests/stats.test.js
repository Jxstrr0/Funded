import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultStats, statsOf, recordDay, recordEdge, recordEval, recordCareer, favouriteEdge } from '../js/meta.js';

test('stats: days, best day and top tier', () => {
  let s = defaultStats();
  s = recordDay(s, 'tier1', 300);
  s = recordDay(s, 'tier1', -120);
  s = recordDay(s, 'tier2', 900);
  assert.equal(s.days, 3);
  assert.equal(s.greenDays, 2);
  assert.deepEqual(s.bestDay, { pnl: 900, tier: 'tier2' });
  assert.equal(s.topTier, 'tier2');
  s = recordDay(s, 'tier1', 50); // a later lower tier doesn't lower the top
  assert.equal(s.topTier, 'tier2');
});

test('stats: evals, careers and favourite edge', () => {
  let s = defaultStats();
  s = recordEval(s, 'tier1', 'pass', 120);
  s = recordEval(s, 'tier2', 'fired', 30);
  s = recordCareer(s, 7);
  s = recordEval(s, 'tier1', 'notFunded', 40);
  s = recordCareer(s, 5);
  assert.deepEqual(s.passed, { tier1: 1, tier2: 0, tier3: 0 });
  assert.equal(s.fired, 1);
  assert.equal(s.notFunded, 1);
  assert.equal(s.careers, 2);
  assert.equal(s.longestCareer, 7);
  assert.equal(s.repEarned, 190);
  assert.equal(favouriteEdge(s), null);
  for (const id of ['coffee', 'hotHand', 'coffee']) s = recordEdge(s, id);
  assert.deepEqual(favouriteEdge(s), { id: 'coffee', n: 2 });
});

test('stats: older saves are filled in and flagged partial', () => {
  const old = statsOf({ rep: 50, runs: 3 });
  assert.equal(old.partial, true);
  assert.equal(old.careers, 0);
  assert.equal(statsOf({ rep: 0, runs: 0 }).partial, false);
  const kept = statsOf({ rep: 0, runs: 1, stats: { careers: 4, passed: { tier1: 2 } } });
  assert.equal(kept.careers, 4);
  assert.deepEqual(kept.passed, { tier1: 2, tier2: 0, tier3: 0 });
  assert.equal(kept.partial, false);
});
