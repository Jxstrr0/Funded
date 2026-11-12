// Balance check: a news-trading bot plays thousands of Tier 1 and Tier 2 evals
// with each edge or mandate and prints pass rate, firing rate and average Rep.
// It measures relative strength only (a person plays differently).
// Run: node tools/balance.mjs [evals per case, default 3000]
import { evalRun, STYLES } from './sim.mjs';

const CASES = [
  ['baseline', [], []],
  ['hotHand', ['hotHand'], []],
  ['stopDiscipline', ['stopDiscipline'], []],
  ['tapeReader', ['tapeReader'], []],
  ['riskFriend', ['riskFriend'], []],
  ['shortWeek', ['shortWeek'], []],
  ['coffee', ['coffee'], []],
  ['M:tightLeash', [], ['tightLeash']],
  ['M:maxOnly', [], ['maxOnly']],
];
const N = +process.argv[2] || 3000;
for (const tier of ['tier1', 'tier2']) for (const [sn, st] of Object.entries(STYLES)) {
  console.log(`\n== ${tier} ${sn} (n=${N})`);
  for (const [name, edges, mand] of CASES) {
    let pass = 0, fired = 0, rep = 0;
    for (let k = 0; k < N; k++) { const r = evalRun(tier, 1000 + k, edges, mand, st); pass += r.pass; fired += r.fired; rep += r.rep; }
    console.log(name.padEnd(16), `pass ${(100 * pass / N).toFixed(1).padStart(5)}%  fired ${(100 * fired / N).toFixed(1).padStart(5)}%  rep ${(rep / N).toFixed(1)}`);
  }
}
