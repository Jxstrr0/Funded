// Balance check: a news-trading bot plays thousands of Tier 1, Tier 2 and
// Tier 3 evals with each edge or mandate and prints pass rate, firing rate and
// average Rep. Tier 3 also prints why runs ended and how trades held through
// the earnings release (the IV crush) did.
// It measures relative strength only (a person plays differently).
// Run: node tools/balance.mjs [evals per case, default 3000] [tiers, default tier1,tier2,tier3]
import { evalRun, STYLES, OPTION_STYLES } from './sim.mjs';

const CASES = [
  ['baseline', [], []],
  ['hotHand', ['hotHand'], []],
  ['stopDiscipline', ['stopDiscipline'], []],
  ['tapeReader', ['tapeReader'], []],
  ['riskFriend', ['riskFriend'], []],
  ['shortWeek', ['shortWeek'], []],
  ['coffee', ['coffee'], []],
  ['insurance', ['insurance'], []],
  ['ironStomach', ['ironStomach'], []],
  ['leverageLoan', ['leverageLoan'], []],
  ['M:tightLeash', [], ['tightLeash']],
  ['M:maxOnly', [], ['maxOnly']],
];
// Theta Shield is offered on options only.
const OPTION_CASES = [...CASES.slice(0, 10), ['thetaShield', ['thetaShield'], []], ['deepPockets', ['deepPockets'], []], ...CASES.slice(10)];
// Bigger Book is offered on futures only.
const FUTURES_CASES = [...CASES.slice(0, 10), ['biggerBook', ['biggerBook'], []], ...CASES.slice(10)];
const N = +process.argv[2] || 3000;
const TIERS = (process.argv[3] || 'tier1,tier2,tier3').split(',');
const pct = (x) => `${(100 * x / N).toFixed(1).padStart(5)}%`;
for (const tier of TIERS) {
  const options = tier === 'tier3';
  for (const [sn, st] of Object.entries(options ? OPTION_STYLES : STYLES)) {
    console.log(`\n== ${tier} ${sn} (n=${N})`);
    for (const [name, edges, mand] of options ? OPTION_CASES : tier === 'tier2' ? FUTURES_CASES : CASES) {
      let pass = 0, fired = 0, rep = 0;
      const out = {};
      const o = { thru: 0, thruLoss: 0, thruPnl: 0, crushFired: 0 };
      for (let k = 0; k < N; k++) {
        const r = evalRun(tier, 1000 + k, edges, mand, st);
        pass += r.pass; fired += r.fired; rep += r.rep;
        out[r.outcome] = (out[r.outcome] || 0) + 1;
        if (r.opt) for (const key in o) o[key] += r.opt[key];
      }
      let line = `${name.padEnd(16)} pass ${pct(pass)}  fired ${pct(fired)}  rep ${(rep / N).toFixed(1)}`;
      if (options) {
        // Why runs ended, then trades held through the earnings release: per eval, share that lost, average P&L,
        // and how often the firing tick had one open.
        line += `  | daily ${pct(out.dailyLoss || 0)} trail ${pct(out.drawdown || 0)} bell ${pct(out.flatAtBell || 0)} miss ${pct(out.failTarget || 0)}`;
        const avg = o.thru ? Math.round(o.thruPnl / o.thru) : 0;
        line += `  | thru-earn ${(o.thru / N).toFixed(2)}/eval lost ${o.thru ? Math.round(100 * o.thruLoss / o.thru) : 0}% avg ${avg >= 0 ? '+' : ''}${avg} fired-holding ${pct(o.crushFired)}`;
      }
      console.log(line);
    }
  }
}
