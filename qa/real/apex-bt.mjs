import fs from 'fs';
import * as k from '../../server/strategy.js';
const d = JSON.parse(fs.readFileSync(new URL('./real-2026-11-04.json', import.meta.url)));
const PUB = Object.fromEntries(Object.entries(d.quotes.R_100).filter(([x]) => x.endsWith('|10|1')).map(([x, v]) => [x.split('|')[0], (v.payout - v.ask) / v.ask]));
const MARK = Object.fromEntries(Object.entries(PUB).map(([x, r]) => [x, (1 + r) * 0.945 - 1]));
for (const [TP, SL] of [[5, 50], [10, 50], [10, 100]]) for (const [pn, R] of [['public', PUB], ['yours', MARK]]) {
  const st = k.labStrategies(k.DEFAULT_PRESETS, { stake: 1, takeProfit: TP, stopLoss: SL, capital: 10000 });
  for (const name of ['apex', 'pegasus']) {
    const s = { ...st[name], minExpected: -0.5 };
    const t0 = Date.now(); const tot = { s: 0, tp: 0, net: 0, worst: 0 }; const used = {};
    for (const t of Object.values(d.ticks)) { const r = k.backtest(s, [...t.digits].map(Number), R); tot.s += r.sessions; tot.tp += r.tp; tot.net += r.net; tot.worst = Math.min(tot.worst, r.worst); }
    const chance = name === 'apex' ? ` (computed best ${(k.apexChance(s, R) * 100).toFixed(1)}%)` : '';
    console.log(`TP ${TP} SL ${SL} ${pn.padEnd(6)} ${name.padEnd(8)} target ${(tot.tp / tot.s * 100).toFixed(1)}%${chance} avg/session ${(tot.net / tot.s).toFixed(3)} worst ${tot.worst.toFixed(0)} sessions ${tot.s} ${Date.now() - t0}ms`);
  }
}
