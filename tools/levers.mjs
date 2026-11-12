// What-if check: change one tuning number at a time and see how a careful bot
// (50% size, a stop at half the daily limit) and an aggressive one (MAX, no
// stop) do on Tier 1 and Tier 2, with no edges. Nothing here changes the game.
// Run: node tools/levers.mjs [evals per case, default 2000]
import { evalRun, STYLES } from './sim.mjs';
const { TIERS, ENGINE } = await import(new URL('../js/config.js', import.meta.url).href);

// Each lever returns an undo function.
const set = (obj, patch) => { const old = {}; for (const k in patch) old[k] = obj[k]; Object.assign(obj, patch); return () => Object.assign(obj, old); };
const both = (patch) => () => { const a = set(TIERS.tier1, patch(TIERS.tier1)); const b = set(TIERS.tier2, patch(TIERS.tier2)); return () => { a(); b(); }; };
const LEVERS = {
  'current': () => () => {},
  'target -20%': both((t) => ({ profitTarget: t.profitTarget * 0.8 })),
  'target -33%': both((t) => ({ profitTarget: t.profitTarget * 2 / 3 })),
  '7 eval days': both(() => ({ evalDays: 7 })),
  'more news (2-4)': () => set(ENGINE.news, { min: 2, max: 4, minGapCandles: 8 }),
  'longer follow-through': () => set(ENGINE.news, { followMinShareOfJump: 0.6, followMaxShareOfJump: 1.2 }),
  'bigger jumps': () => set(ENGINE.news, { shockCapShareOfDailyLimit: 0.8 }),
  'more news + follow': () => { const a = set(ENGINE.news, { min: 2, max: 4, minGapCandles: 8 }); const b = set(ENGINE.news, { followMinShareOfJump: 0.6, followMaxShareOfJump: 1.2 }); return () => { b(); a(); }; },
  'follow + target -20%': () => { const a = set(ENGINE.news, { followMinShareOfJump: 0.6, followMaxShareOfJump: 1.2 }); const b = both((t) => ({ profitTarget: t.profitTarget * 0.8 }))(); return () => { b(); a(); }; },
  'more news + target -20%': () => { const a = set(ENGINE.news, { min: 2, max: 4, minGapCandles: 8 }); const b = both((t) => ({ profitTarget: t.profitTarget * 0.8 }))(); return () => { b(); a(); }; },
};
const only = process.argv.slice(3);
const N = +process.argv[2] || 2000;
for (const tier of ['tier1', 'tier2']) {
  console.log(`\n== ${tier} (n=${N})            careful: pass  fired   rep | aggressive: pass  fired   rep`);
  for (const [name, lever] of Object.entries(LEVERS)) {
    if (only.length && !only.includes(name)) continue;
    const undo = lever();
    const cols = [];
    for (const st of [STYLES.careful, STYLES.aggressive]) {
      let pass = 0, fired = 0, rep = 0;
      for (let k = 0; k < N; k++) { const r = evalRun(tier, 1000 + k, [], [], st); pass += r.pass; fired += r.fired; rep += r.rep; }
      cols.push(`${(100 * pass / N).toFixed(1).padStart(5)}% ${(100 * fired / N).toFixed(1).padStart(5)}% ${(rep / N).toFixed(0).padStart(4)}`);
    }
    undo();
    console.log(name.padEnd(26), cols.join('   |   '));
  }
}
