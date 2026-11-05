const WS = require('ws');
const { HttpsProxyAgent } = require('https-proxy-agent');
const fs = require('fs');
const agent = new HttpsProxyAgent(process.env.HTTPS_PROXY);
const SYMS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];
const PER = +(process.argv[2] || 30000);
let ws, id = 0; const pending = new Map();
const open = () => new Promise((res, rej) => { ws = new WS('wss://api.derivws.com/trading/v1/options/ws/public', { agent }); ws.on('open', res); ws.on('error', rej);
  ws.on('message', (m) => { const j = JSON.parse(m); const p = pending.get(j.req_id); if (p) { pending.delete(j.req_id); p(j); } }); });
const send = (o) => new Promise((res) => { const r = ++id; pending.set(r, res); ws.send(JSON.stringify({ ...o, req_id: r })); setTimeout(() => { if (pending.has(r)) { pending.delete(r); res({ error: { message: 'timeout' } }); } }, 20000); });
(async () => {
  await open();
  const out = { at: new Date().toISOString(), ticks: {}, quotes: {} };
  for (const s of SYMS) {
    let prices = [], times = [], end = 'latest', pip = 2;
    while (prices.length < PER) {
      let h; for (let a = 0; a < 10; a++) { await new Promise((r) => setTimeout(r, 700)); h = await send({ ticks_history: s, count: 1000, end, style: 'ticks' }); if (!/rate limit/.test(h.error?.message || '')) break; await new Promise((r) => setTimeout(r, 15000)); }
      if (h.error) { console.log(s, 'error', h.error.message); break; }
      pip = h.pip_size ?? pip;
      const P = h.history.prices, T = h.history.times; if (!P.length) break;
      prices = P.concat(prices); times = T.concat(times); end = T[0] - 1;
      if (P.length < 100) break;
    }
    const digits = prices.map((x) => { const t = Number(x).toFixed(pip); return +t[t.length - 1]; }).join('');
    out.ticks[s] = { pip, n: digits.length, from: times[0], to: times[times.length - 1], digits };
    fs.writeFileSync('real.json', JSON.stringify(out));
    console.log(s, digits.length, new Date(times[0] * 1000).toISOString(), '→', new Date(times[times.length - 1] * 1000).toISOString());
  }
  const keys = ['DIGITEVEN', 'DIGITODD', ...[0,1,2,3,4,5,6,7,8].map((b) => 'DIGITOVER:' + b), ...[1,2,3,4,5,6,7,8,9].map((b) => 'DIGITUNDER:' + b), ...[0,5].map((b) => 'DIGITMATCH:' + b), ...[0,5].map((b) => 'DIGITDIFF:' + b)];
  for (const s of SYMS) {
    out.quotes[s] = {};
    for (const k of keys) for (const amount of (['DIGITEVEN', 'DIGITOVER:1', 'DIGITOVER:4', 'DIGITDIFF:5'].includes(k) && s === 'R_100' ? [1, 10, 100] : [10])) for (const duration of [1]) {
      const [t, b] = k.split(':');
      let q; for (let a = 0; a < 6; a++) { await new Promise((r) => setTimeout(r, 1100)); q = await send({ proposal: 1, amount, basis: 'stake', contract_type: t, currency: 'USD', duration, duration_unit: 't', underlying_symbol: s, ...(b !== undefined ? { barrier: b } : {}) }); if (!/rate limit/.test(q.error?.message || '')) break; await new Promise((r) => setTimeout(r, 5000)); }
      out.quotes[s][`${k}|${amount}|${duration}`] = q.error ? { error: q.error.message } : { ask: +q.proposal.ask_price, payout: +q.proposal.payout };
    }
    console.log('quotes', s, JSON.stringify(out.quotes[s]['DIGITEVEN|10|1']), JSON.stringify(out.quotes[s]['DIGITOVER:1|10|1']));
  }
  fs.writeFileSync('real.json', JSON.stringify(out)); ws.close(); process.exit(0);
})();
