import * as k from '../../server/strategy.js';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const live = { DIGITEVEN: 0.95, DIGITODD: 0.95, 'DIGITOVER:4': 0.94, 'DIGITUNDER:5': 0.96 };
const body = (preset, x = {}) => ({ preset, symbol: 'R_100', stake: 1, takeProfit: 10, stopLoss: 50, maxStake: 50, ...x });
for (const p of ['pegasus', 'martingale', 'recover']) {
  const s = k.validateSettings(body(p)).settings;
  const r = k.simulate(s, 1000, live, 400000);
  console.log(`${p.padEnd(10)} TP ${(r.hit * 100).toFixed(1)}%  stop at loss ${(r.bust * 100).toFixed(1)}%  avg ${r.avg.toFixed(2)}  avg loss when lost ${r.bustAvg.toFixed(2)}  staked ${r.staked.toFixed(1)}  contract ${r.contract}`);
  ok(r.bustAvg >= -50.01, p + ': a session never loses more than the stop-loss');
}
// best-priced contract is chosen
const s = k.validateSettings(body('martingale')).settings;
let d = k.decide(s, k.freshState(), live); ok(d.trade.contract_type === 'DIGITUNDER' && d.trade.barrier === 5, 'picks the best-paid 50% contract (Under 5)');
// poor terms are refused
d = k.decide(s, k.freshState(), { DIGITEVEN: 0.7, DIGITODD: 0.7, 'DIGITOVER:4': 0.7, 'DIGITUNDER:5': 0.7 }); ok(d.stop === 'edge', 'refuses to trade when Deriv pays poorly: ' + d.reason);
// cycles fit the stop-loss: stake 1 ×2.1, SL 50 → 1+2.1+4.41+9.27+19.45 = 36.23 fits, +40.85 doesn't
ok(k.cycleLength(s, 50, live) === 5, 'double: 5-step cycle fits a 50 stop-loss (6th would not): ' + k.cycleLength(s, 50, live));
let st = k.freshState(); let stakes = [];
for (let i = 0; i < 10; i++) { const x = k.decide(s, st, live); if (!x.trade) { d = x; break; } stakes.push(x.trade.amount); st = k.applyResult(s, st, { buy_price: x.trade.amount, profit: -x.trade.amount }); }
ok(d.stop === 'streak' && -st.pl <= 50, `losing run ends at a planned loss ${st.pl} (stakes ${stakes.join(', ')})`);
// pegasus bold play: stake one win needs
const sp = k.validateSettings(body('pegasus')).settings; d = k.decide(sp, k.freshState(), live);
ok(Math.abs(d.trade.amount - 10.42) < 0.02, 'pegasus stakes what one win needs to reach take-profit: ' + d.trade.amount);
st = k.applyResult(sp, k.freshState(), { buy_price: 10.42, profit: -10.42 }); d = k.decide(sp, st, live); ok(Math.abs(d.trade.amount - 21.28) < 0.02, 'after a loss it stakes what reaches the target again: ' + d.trade.amount);
// custom keeps user contracts, no filter
const sc = k.validateSettings({ ...body('custom'), custom: { barrier: 1, recovery: 5, recMode: 'mult', martingale: 2 } }).settings;
d = k.decide(sc, k.freshState(), {}); ok(d.trade.contract_type === 'DIGITOVER' && d.trade.barrier === 1, 'custom uses the user\'s Over 1');
// randomness check: fair digits pass, biased fail
const fair = Array.from({ length: 1000 }, () => Math.floor(Math.random() * 10));
const rc = k.randomnessCheck(fair); ok(rc.uniform_p > 0.001 && rc.serial_p > 0.001, 'random digits look random: ' + JSON.stringify(rc));
const biased = Array.from({ length: 1000 }, (_, i) => (i % 3 ? 2 : Math.floor(Math.random() * 10)));
ok(k.randomnessCheck(biased).uniform_p < 0.01, 'a pattern is detected when there is one');
const alt = Array.from({ length: 1000 }, (_, i) => (i % 2) * 2 + (Math.random() < 0.5 ? 0 : 1) * 4 % 10);
console.log('alternating parity test', JSON.stringify(k.randomnessCheck(Array.from({ length: 1000 }, (_, i) => (i % 2 ? 1 : 2)))));
ok(k.cleanRatios({ DIGITEVEN: 0.9, 'BAD': 1, 'DIGITOVER:9': 1, constructor: 2 }).DIGITEVEN === 0.9 && Object.keys(k.cleanRatios({ 'DIGITOVER:9': 1, __proto__: { x: 1 } })).length === 0, 'ratios are checked contract by contract');
console.log(fails ? fails + ' FAILED' : 'ALL PASSED');
