import fs from 'fs';
import * as k from '../../server/strategy.js';
const d = JSON.parse(fs.readFileSync(new URL('./real-2026-11-04.json', import.meta.url)));
const ratios = Object.fromEntries(Object.entries(d.quotes.R_100).filter(([x]) => x.endsWith('|10|1')).map(([x, v]) => [x.split('|')[0], (v.payout - v.ask) / v.ask]));
for (const [TP, SL, cap] of [[10, 50, 392], [5, 50, 392], [20, 100, 1000]]) {
  const strat = k.labStrategies(k.DEFAULT_PRESETS, { stake: 1, takeProfit: TP, stopLoss: SL, capital: cap });
  console.log(`\nKapa engine on 300,000 real ticks · take-profit ${TP}, stop-loss ${SL} (reference bot: all of ${cap} on Over 1)`);
  for (const [name, s] of Object.entries(strat)) {
    const tot = { sessions: 0, tp: 0, net: 0, worst: 0, staked: 0 };
    for (const t of Object.values(d.ticks)) { const r = k.backtest(s, [...t.digits].map(Number), ratios); tot.sessions += r.sessions; tot.tp += r.tp; tot.net += r.net; tot.staked += r.staked; tot.worst = Math.min(tot.worst, r.worst); }
    console.log(`${name.padEnd(11)} sessions ${String(tot.sessions).padStart(7)}  target ${(tot.tp / tot.sessions * 100).toFixed(1).padStart(5)}%  avg/session ${(tot.net / tot.sessions).toFixed(3).padStart(8)}  worst ${tot.worst.toFixed(0).padStart(5)}  cost per 100 staked ${(-tot.net / tot.staked * 100).toFixed(2)}`);
  }
}
