// Checks, on Deriv's real ticks and live public prices, whether a coarse price quantum creates a positive
// expectancy on Rise/Fall "allow equals" (CALLE/PUTE, 1 tick) and on digit Matches.
// Found 2026-11-09 on Jump 100 (JD100, price ~70, pip 0.01): about 30 % of 1-tick moves are 0, so "higher
// than or equal" wins ~65 % of the time, while Deriv pays 1.953 (break-even 51.2 %). See STRATEGIES/EDGE notes.
// This only measures public data: settlement of such contracts must still be checked on a DEMO account.
//
// Usage: node qa/real/ties-check.cjs [SYMBOL=JD100] [TICKS=20000]
// Exit code 0 = the lower 95 % bound of CALLE's average result is above 0 at the live price; 1 otherwise.
const WS = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');
const SYM = process.argv[2] || 'JD100';
const N = +(process.argv[3] || 20000);
const agent = process.env.HTTPS_PROXY ? new HttpsProxyAgent(process.env.HTTPS_PROXY) : undefined;
let ws, id = 0, last = 0; const pending = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const open = () => new Promise((res, rej) => { ws = new WS('wss://api.derivws.com/trading/v1/options/ws/public', { agent }); ws.on('open', res); ws.on('error', rej);
  ws.on('message', (m) => { const j = JSON.parse(m); const p = pending.get(j.req_id); if (p) { pending.delete(j.req_id); p(j); } }); });
const raw = async (o) => { const w = last + 900 - Date.now(); if (w > 0) await sleep(w); last = Date.now();
  return new Promise((res) => { const r = ++id; pending.set(r, res); ws.send(JSON.stringify({ ...o, req_id: r })); setTimeout(() => { if (pending.has(r)) { pending.delete(r); res({ error: { message: 'timeout' } }); } }, 20000); }); };
const send = async (o) => { let j; for (let a = 0; a < 6; a++) { j = await raw(o); if (!/rate limit/i.test(j.error?.message || '')) return j; await sleep(15000); } return j; };
const ci = (k, n) => { const p = k / n, se = Math.sqrt(p * (1 - p) / n); return [p, p - 1.96 * se, p + 1.96 * se]; };
(async () => {
  await open();
  // Deriv serves about 24 h of ticks: stop paging when a page is not older than the previous one.
  let P = [], T = [], end = 'latest', pip = 2;
  while (P.length < N) {
    const h = await send({ ticks_history: SYM, count: 1000, end, style: 'ticks' });
    if (h.error) { console.log('error', h.error.message); break; }
    pip = h.pip_size ?? pip; const p = h.history.prices, t = h.history.times;
    if (!p.length || (T.length && t[t.length - 1] >= T[0])) break;
    P = p.concat(P); T = t.concat(T); end = t[0] - 1; if (p.length < 100) break;
  }
  const q = P.map((x) => Math.round(x * 10 ** pip));
  const quote = async (contract_type, barrier) => { const r = await send({ proposal: 1, amount: 10, basis: 'stake', currency: 'USD', contract_type, duration: 1, duration_unit: 't', underlying_symbol: SYM, ...(barrier !== undefined ? { barrier } : {}) });
    return r.error ? null : r.proposal.payout / 10; };
  const rCE = await quote('CALLE'), rPE = await quote('PUTE'), rM = await quote('DIGITMATCH', '5');
  ws.close();
  console.log(`${SYM}: ${q.length} ticks, ${new Date(T[0] * 1000).toISOString()} -> ${new Date(T[T.length - 1] * 1000).toISOString()}, price ${Math.min(...P)}-${Math.max(...P)}, pip ${10 ** -pip}`);
  let tie = 0; for (let i = 1; i < q.length; i++) tie += q[i] === q[i - 1];
  console.log(`  1-tick moves equal to 0: ${(100 * tie / (q.length - 1)).toFixed(2)} %`);
  // non-overlapping trades: entry tick i, exit tick i+1, next entry i+3 (about one trade every 3 s on 1 s indices)
  let ce = 0, pe = 0, n = 0; for (let i = 0; i + 1 < q.length; i += 3) { n++; ce += q[i + 1] >= q[i]; pe += q[i + 1] <= q[i]; }
  let okAll = true;
  for (const [name, k, r] of [['CALLE 1t', ce, rCE], ['PUTE 1t', pe, rPE]]) {
    const [p, lo, hi] = ci(k, n);
    const ok = r !== null && r * lo - 1 > 0; if (name === 'CALLE 1t') okAll = ok;
    console.log(`  ${name}: ${n} trades, wins ${(100 * p).toFixed(2)} % [${(100 * lo).toFixed(2)}, ${(100 * hi).toFixed(2)}], live payout ${r ?? 'n/a'} -> average ${r ? (100 * (r * p - 1)).toFixed(1) : '?'} % [${r ? (100 * (r * lo - 1)).toFixed(1) : '?'}, ${r ? (100 * (r * hi - 1)).toFixed(1) : '?'}] per trade${r ? `, x0.945: ${(100 * (r * 0.945 * p - 1)).toFixed(1)} %` : ''}`);
  }
  for (const L of [2, 3]) { let k = 0, m = 0; for (let i = 0; i + L < q.length; i += L + 1) { m++; k += q[i + L] % 10 === q[i] % 10; }
    const [p, lo, hi] = ci(k, m); console.log(`  Matches the last seen digit, settled ${L} ticks later: ${(100 * p).toFixed(2)} % [${(100 * lo).toFixed(2)}, ${(100 * hi).toFixed(2)}], payout ${rM} -> average ${rM ? (100 * (rM * p - 1)).toFixed(1) : '?'} % (needs a known settlement tick)`); }
  console.log(okAll ? 'EDGE PRESENT on public data (CALLE lower bound > 0). Settlement still to be confirmed on a demo account.' : 'No edge: CALLE lower bound <= 0.');
  process.exit(okAll ? 0 : 1);
})();
