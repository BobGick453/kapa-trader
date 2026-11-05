import fs from 'fs';
import { classicDecide, applyClassic, freshClassic, CLASSIC_KEYS, setApexRecovery } from './classic.mjs';
const d = JSON.parse(fs.readFileSync(new URL('./real-2026-11-04.json', import.meta.url)));
const PUB = Object.fromEntries(Object.entries(d.quotes.R_100).filter(([x]) => x.endsWith('|10|1')).map(([x, v]) => [x.split('|')[0], (v.payout - v.ask) / v.ask]));
const MARK = Object.fromEntries(Object.entries(PUB).map(([x, r]) => [x, (1 + r) * 0.945 - 1]));
const win = (k, x) => { const [t, b] = k.split(':'); return t === 'DIGITEVEN' ? x % 2 === 0 : t === 'DIGITODD' ? x % 2 === 1 : t === 'DIGITOVER' ? x > +b : x < +b; };
for (const apex of [false, true]) { setApexRecovery(apex);
for (const [TP, SL] of [[5, 50]]) for (const [pn, R] of [['public', PUB], ['yours', MARK]]) for (const k of CLASSIC_KEYS) {
  const s = { stake: 1, takeProfit: TP, stopLoss: SL, maxStake: SL, maxLosses: null };
  let ses = 0, tp = 0, net = 0, worst = 0;
  for (const t of Object.values(d.ticks)) {
    const D = [...t.digits].map(Number); let st = freshClassic();
    for (let i = 0; i < D.length; i++) {
      const dec = classicDecide(k, s, st, R, D.slice(Math.max(0, i - 30), i));
      if (dec.wait) continue;
      if (!dec.trade) { ses++; net += st.pl; worst = Math.min(worst, st.pl); if (dec.stop === 'tp') tp++; st = freshClassic(); i--; continue; }
      const key = dec.trade.barrier === null ? dec.trade.contract_type : `${dec.trade.contract_type}:${dec.trade.barrier}`;
      const a = dec.trade.amount; st = applyClassic(st, a, win(key, D[i]) ? Math.round(a * R[key] * 100) / 100 : -a);
    }
  }
  console.log(`${apex ? 'APEX-rec' : 'own-rec '} TP ${TP} SL ${SL} ${pn.padEnd(6)} ${k.padEnd(12)} target ${(tp / ses * 100).toFixed(1)}% avg/session ${(net / ses).toFixed(2)} worst ${worst.toFixed(0)}`);
}}
