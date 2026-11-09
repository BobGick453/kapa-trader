import worker from './worker.mjs';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const store = new Map();
const KV = { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); },
  list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
const ADMIN = 'owner-admin-secret-0123456789';
const env = { KAPA_KV: KV, CINETPAY_APIKEY: 'key', CINETPAY_SITE_ID: '123', ADMIN_SECRET: ADMIN, SESSION_KEY: 'k'.repeat(48), PRICE_XOF: '5000', PLAN_DAYS: '30', CURRENCY: 'XOF', SITE_URL: 'https://bobgick453.github.io/kapa-trader/', ALLOWED_ORIGINS: 'https://bobgick453.github.io', DERIV_API: 'https://api.derivws.com' };
const payments = {};
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.endsWith('/trading/v1/options/accounts')) { const tok = (init.headers.authorization || '').replace('Bearer ', '');
    if (tok === 'alice-token-1234') return new Response(JSON.stringify({ data: [{ account_id: 'DOT1' }, { account_id: 'ROT1' }] }));
    if (tok === 'bob-token-12345') return new Response(JSON.stringify({ data: [{ account_id: 'ROT2' }] }));
    return new Response('{}', { status: 401 }); }
  if (url.endsWith('/v2/payment')) { const b = JSON.parse(init.body); payments[b.transaction_id] = { status: 'PENDING', amount: String(b.amount), currency: 'XOF' }; return new Response(JSON.stringify({ code: '201', data: { payment_url: 'https://checkout.cinetpay.com/payment/abc' } })); }
  if (url.endsWith('/v2/payment/check')) { const p = payments[JSON.parse(init.body).transaction_id]; return new Response(JSON.stringify(p ? { code: '00', data: { status: p.status, amount: p.amount, currency: p.currency, payment_method: 'OM' } } : { code: '627' })); }
  throw new Error('unexpected fetch ' + url);
};
let ipN = 1;
const call = (method, path, { token, body, form, admin, pass, device, ip = '1.1.1.1', origin = 'https://bobgick453.github.io' } = {}) => {
  const headers = { origin, 'cf-connecting-ip': ip }; if (device) headers['x-kapa-device'] = device; if (token) headers.authorization = 'Bearer ' + token; if (admin) headers['x-admin-secret'] = admin; if (pass) headers['x-kapa-pass'] = pass;
  let b; if (body) { b = JSON.stringify(body); headers['content-type'] = 'application/json'; } if (form) b = new URLSearchParams(form);
  return worker.fetch(new Request('https://kapa-premium.example.workers.dev' + path, { method, headers, body: b }), env);
};
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null), headers: r.headers });
const sessBody = { preset: 'pegasus', symbol: 'R_75', stake: 1, takeProfit: 3, stopLoss: 20 };

// --- no code yet ---
let r = await j(await call('POST', '/premium/unlock', { body: { code: 'ANYTHING1' } })); ok(r.status === 503, 'before a code exists, unlocking is unavailable');
r = await j(await call('GET', '/admin/code', { admin: ADMIN })); ok(r.body.set === false && r.body.ready === true, 'admin sees that no code is set');
// --- owner sets the code ---
r = await j(await call('POST', '/admin/code', { admin: ADMIN, body: { code: 'short' } })); ok(r.status === 400, 'a code shorter than 8 characters is refused');
r = await j(await call('POST', '/admin/code', { admin: 'wrong', body: { code: 'KAPA-2026-GOLD' } })); ok(r.status === 401, 'setting the code needs the admin secret');
r = await j(await call('POST', '/admin/code', { admin: ADMIN, body: { code: 'Kapa-2026-Gold' } })); ok(r.status === 200 && r.body.set, 'owner sets the code Kapa-2026-Gold');
ok(![...store.values()].some((v) => /kapa-2026-gold/i.test(v)), 'the code itself is never stored, only a keyed hash');
r = await j(await call('GET', '/admin/code', { admin: ADMIN })); ok(r.body.set && r.body.source === 'admin' && r.body.updatedAt > 0 && !JSON.stringify(r.body).includes('Gold'), 'admin shows when the code was set, never the code');
// --- unlocking ---
r = await j(await call('POST', '/premium/unlock', { body: { code: 'wrong-code-123' } })); ok(r.status === 401 && !r.body.pass, 'a wrong code is refused');
r = await j(await call('POST', '/premium/unlock', { body: { code: ' kapa-2026-gold ' } })); ok(r.status === 200 && r.body.pass, 'the right code works, ignoring spaces and letter case');
const pass1 = r.body.pass;
r = await j(await call('GET', '/premium/status', { pass: pass1 })); ok(r.body.status === 'active' && r.body.pass, 'the pass shows Premium active (and is renewed)');
r = await j(await call('GET', '/premium/status')); ok(r.body.status === 'inactive', 'without a pass Premium is inactive');
// --- Premium tools ---
r = await j(await call('POST', '/session/start', { token: 'alice-token-1234', body: sessBody })); ok(r.status === 402, 'no pass: no strategy session (402)');
r = await j(await call('GET', '/bots/odd-oscars')); ok(r.status === 402, 'no pass: no Premium bot settings (402)');
r = await j(await call('POST', '/scan', { body: { preset: 'pegasus' } })); ok(r.status === 402, 'no pass: no scan (402)');
r = await j(await call('POST', '/session/start', { token: 'alice-token-1234', pass: pass1, body: sessBody })); ok(r.status === 200 && r.body.decision.trade?.contract_type === 'DIGITEVEN' && Math.abs(r.body.decision.trade.amount - (sessBody.takeProfit / ((1 - 0.0235) / 0.5 - 1))) < 0.02, 'with the pass: the server runs Pegasus (bold play on a 50% contract): ' + JSON.stringify(r.body.decision));
let sess = r.body.session;
r = await j(await call('POST', '/session/start', { pass: pass1, body: sessBody })); ok(r.status === 401, 'trading still needs a Deriv login');
r = await j(await call('GET', '/bots/odd-oscars', { pass: pass1 })); ok(r.body.data?.type === 'DIGITODD', 'with the pass: Premium bot settings');
// --- forged / misused tokens ---
const [b64, sig] = pass1.split('.');
const pl = JSON.parse(Buffer.from(b64, 'base64url').toString()); pl.ver = 'other'; pl.exp = Date.now() + 1e12;
r = await j(await call('GET', '/premium/status', { pass: Buffer.from(JSON.stringify(pl)).toString('base64url') + '.' + sig })); ok(r.body.status === 'inactive', 'an edited pass is rejected');
r = await j(await call('GET', '/premium/status', { pass: sess })); ok(r.body.status === 'inactive', 'a strategy session cannot be used as a pass');
r = await j(await call('POST', '/session/next', { token: 'alice-token-1234', pass: pass1, body: { session: pass1, result: { contract_id: 5, buy_price: 1, profit: -1 } } })); ok(r.status === 400, 'a pass cannot be used as a strategy session');
r = await j(await call('POST', '/session/next', { token: 'alice-token-1234', pass: pass1, body: { session: sess, result: { contract_id: 6, buy_price: 1, profit: -1 } } })); ok(r.status === 200 && r.body.decision.trade && r.body.decision.trade.amount > 1, 'session continues after a loss with a larger stake: ' + JSON.stringify(r.body.decision));
sess = r.body.session;
// --- owner changes the code: every device must enter the new one ---
r = await j(await call('POST', '/admin/code', { admin: ADMIN, body: { code: 'NEW-CODE-0099' } })); ok(r.status === 200, 'owner changes the code');
r = await j(await call('GET', '/premium/status', { pass: pass1 })); ok(r.body.status === 'inactive', 'old passes stop working at once');
r = await j(await call('POST', '/session/next', { token: 'alice-token-1234', pass: pass1, body: { session: sess, result: { contract_id: 7, buy_price: 2.2, profit: 2 } } })); ok(r.status === 402, 'a running session stops getting trades with the old pass');
r = await j(await call('POST', '/premium/unlock', { body: { code: 'Kapa-2026-Gold' } })); ok(r.status === 401, 'the old code no longer works');
r = await j(await call('POST', '/premium/unlock', { body: { code: 'new-code-0099' } })); ok(r.status === 200, 'the new code works');
// --- wrong codes: a device slows down, a shared address (mobile network) stays open ---
const guess = (i, o) => call('POST', '/premium/unlock', { ip: '9.9.9.9', ...o, body: { code: 'guess-' + i + '-xxxx' } });
for (let i = 0; i < 5; i++) { r = await j(await guess(i, { device: 'phone-aaaa-1111' })); if (r.status !== 401) break; }
ok(r.status === 401, 'the first 5 wrong codes from a device are answered normally');
r = await j(await guess(5, { device: 'phone-aaaa-1111' })); ok(r.status === 401, 'the 6th wrong code is checked, then that device must wait');
r = await j(await call('POST', '/premium/unlock', { ip: '9.9.9.9', device: 'phone-aaaa-1111', body: { code: 'NEW-CODE-0099' } }));
ok(r.status === 429 && /30 seconds/.test(r.body.error) && r.headers.get('retry-after') === '30', 'then it waits 30 s, even with the right code: ' + r.body.error);
r = await j(await call('POST', '/premium/unlock', { ip: '9.9.9.9', device: 'phone-bbbb-2222', body: { code: 'NEW-CODE-0099' } })); ok(r.status === 200, 'another phone on the same mobile network (same address) still unlocks at once');
{ const k = [...store.keys()].find((x) => x.startsWith('codefail:') && JSON.parse(store.get(x)).until > 0); const v = JSON.parse(store.get(k)); v.until = Date.now() - 1; store.set(k, JSON.stringify(v)); }
r = await j(await guess(6, { device: 'phone-aaaa-1111' })); ok(r.status === 401, 'after the wait the device may try again');
r = await j(await call('POST', '/premium/unlock', { ip: '9.9.9.9', device: 'phone-aaaa-1111', body: { code: 'NEW-CODE-0099' } })); ok(r.status === 429 && /1 minutes|60 seconds/.test(r.body.error), 'each further wrong code doubles the wait: ' + r.body.error);
// a flood from one address (brute force with changing device ids) pauses that address for 15 minutes
let flood = 0; for (let i = 0; i < 40; i++) { r = await j(await guess(100 + i, { ip: '3.3.3.3', device: 'bot-device-' + String(i).padStart(4, '0') })); if (r.status === 429) { flood = i; break; } }
ok(flood > 0 && flood <= 30 && /15 minutes/.test(r.body.error), `brute force from one address is stopped after ${flood} wrong codes: ${r.body?.error}`);
r = await j(await call('POST', '/premium/unlock', { ip: '8.8.8.8', body: { code: 'NEW-CODE-0099' } })); ok(r.status === 200, 'other addresses are not affected');
r = await j(await call('POST', '/premium/unlock', { ip: '9.9.9.9', device: 'phone-cccc-3333', body: { code: 'NEW-CODE-0099' } })); ok(r.status === 200, 'old-format lock entries and other devices on that address are fine');
const corsDev = await call('OPTIONS', '/premium/unlock'); ok(/x-kapa-device/.test(corsDev.headers.get('access-control-allow-headers')), 'CORS allows the device header');
// --- PREMIUM_CODE secret as first code ---
store.delete('premium:code'); env.PREMIUM_CODE = 'first-code-777';
r = await j(await call('POST', '/premium/unlock', { ip: '7.7.7.7', body: { code: 'FIRST-CODE-777' } })); ok(r.status === 200, 'PREMIUM_CODE secret works as the first code');
const pass2 = r.body.pass;
await call('POST', '/admin/code', { admin: ADMIN, body: { code: 'admin-set-code-1' } });
r = await j(await call('GET', '/premium/status', { pass: pass2 })); ok(r.body.status === 'inactive', 'a code set from Admin replaces the PREMIUM_CODE secret');
// --- payments: recorded, verified, no automatic Premium ---
r = await j(await call('POST', '/checkout', { token: 'bob-token-12345', body: {} })); const tx = r.body.transaction_id; ok(r.body.payment_url, 'checkout starts a CinetPay payment');
payments[tx].status = 'ACCEPTED'; await call('POST', '/cinetpay/notify', { form: { cpm_trans_id: tx } });
r = await j(await call('GET', `/checkout/status?tx=${tx}`, { token: 'bob-token-12345' })); ok(r.body.status === 'paid', 'payment verified with CinetPay and marked paid');
r = await j(await call('GET', '/admin/payments', { admin: ADMIN })); ok(r.body.payments.some((p) => p.key === tx && p.value.status === 'paid' && p.value.accounts.includes('ROT2')), 'admin sees the paid payment and the buyer\'s Deriv account');
r = await j(await call('GET', '/bots/odd-oscars')); ok(r.status === 402, 'paying alone does not unlock Premium: the owner sends the code');
// --- removed endpoints ---
for (const p of ['/admin/entitlements', '/admin/grant', '/entitlement']) { r = await j(await call(p.includes('admin') ? 'GET' : 'GET', p, { admin: ADMIN, token: 'alice-token-1234' })); ok(r.status === 404 || r.status === 402, `old endpoint ${p} gives nothing (${r.status})`); }
// --- misc ---
const raw = await call('OPTIONS', '/premium/status'); ok(/x-kapa-pass/.test(raw.headers.get('access-control-allow-headers')), 'CORS allows the pass header');
r = await j(await call('POST', '/plan/simulate', { body: { ...sessBody, capital: 100 } })); ok(r.status === 200 && r.body.sessions > 0, 'the session plan stays free');
// --- carried over: strategy safety, scan, rules, lockouts, headers ---
let pr = await j(await call('POST', '/premium/unlock', { ip: '6.6.6.6', body: { code: 'admin-set-code-1' } })); const P = pr.body.pass;
r = await j(await call('POST', '/session/start', { token: 'alice-token-1234', pass: P, body: { ...sessBody, preset: 'martingale', stake: 50, stopLoss: 20 } })); ok(r.status === 400, 'stake above stop-loss refused');
r = await j(await call('POST', '/session/start', { token: 'alice-token-1234', pass: P, body: { ...sessBody, preset: 'constructor' } })); ok(r.status === 400, 'preset "constructor" refused');
r = await j(await call('GET', '/bots/constructor', { pass: P })); ok(r.status === 404, 'bot "constructor" is 404');
r = await j(await call('POST', '/session/start', { token: 'alice-token-1234', pass: P, body: { ...sessBody, stopLoss: 5 } })); let ss = r.body.session; let d = r.body.decision; let cid = 300;
while (d.trade && cid < 330) { r = await j(await call('POST', '/session/next', { token: 'alice-token-1234', pass: P, body: { session: ss, result: { contract_id: cid++, buy_price: d.trade.amount, profit: -d.trade.amount } } })); ss = r.body.session; d = r.body.decision; }
ok(d.stop && r.body.state.pl >= -5, `losing streak stops within the stop-loss (${r.body.state.pl})`);
r = await j(await call('POST', '/session/next', { token: 'bob-token-12345', pass: P, body: { session: ss, result: { contract_id: 999, buy_price: 1, profit: -1 } } })); ok(r.status === 400, "Bob can't use Alice's session even with a valid pass");
// --- KAPA Apex end to end, with the page's default settings (no "stop after N losses") ---
{
  const K = await import('../../server/strategy.js');
  const R = Object.fromEntries(K.GROUPS.all.map((x) => [x, K.estRatio(x)])); // Deriv's public prices
  const apexBody = { preset: 'apex', symbol: 'R_100', stake: 1, takeProfit: 10, stopLoss: 50, maxStake: 50, maxRuns: 0, maxMargin: 12, ratios: R };
  r = await j(await call('POST', '/plan/simulate', { body: { ...apexBody, capital: 1000 } })); ok(r.status === 200 && r.body.hit > 0.7, `Apex plan works with default settings (target ${(r.body.hit * 100).toFixed(0)}%)`);
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const tally = { sessions: 0, tp: 0, sl: 0, other: 0, trades: 0, worst: 0, over: [] }; let cidA = 5000;
  for (let n = 0; n < 16; n++) {
    const allLose = n % 5 === 0; // some sessions lose every trade
    r = await j(await call('POST', '/session/start', { token: 'alice-token-1234', pass: P, body: apexBody }));
    if (r.status !== 200) { ok(false, 'Apex session starts with default settings: ' + JSON.stringify(r.body)); break; }
    let sA = r.body.session; let dA = r.body.decision; let pl = 0;
    while (dA.trade) {
      const t = dA.trade; const key = t.barrier === null ? t.contract_type : `${t.contract_type}:${t.barrier}`;
      if (t.amount > apexBody.maxStake + 1e-9 || t.amount > apexBody.stopLoss + pl + 1e-9) tally.over.push({ amount: t.amount, pl });
      const won = !allLose && rnd() < K.winProb(key); const profit = won ? Math.round(t.amount * R[key] * 100) / 100 : -t.amount;
      pl = Math.round((pl + profit) * 100) / 100; tally.trades++;
      r = await j(await call('POST', '/session/next', { token: 'alice-token-1234', pass: P, body: { session: sA, result: { contract_id: cidA++, buy_price: t.amount, profit }, ratios: { [key]: R[key] } } }));
      if (r.status !== 200) { tally.other++; ok(false, 'Apex /session/next answered ' + r.status + ' ' + JSON.stringify(r.body)); break; }
      sA = r.body.session; dA = r.body.decision;
    }
    if (!dA) break; tally.sessions++; tally.worst = Math.min(tally.worst, pl); tally[dA.stop === 'tp' ? 'tp' : dA.stop === 'sl' ? 'sl' : 'other']++;
  }
  ok(tally.sessions === 16 && tally.over.length === 0 && tally.worst >= -50, `Apex: 16 sessions over /session/start and /session/next, ${tally.trades} trades, no stake past the stop-loss or max stake, worst ${tally.worst} (${tally.tp} take-profit, ${tally.sl} stop-loss, ${tally.other} other)`);
  r = await j(await call('POST', '/session/start', { token: 'alice-token-1234', pass: P, body: { ...apexBody, maxLosses: 31 } })); ok(r.status === 400, 'more than 30 losses in a row is refused');
}
env.OPEN_SOCKET = () => { const ls = []; return { addEventListener: (t, f) => ls.push(f), close() {}, send(raw) { const m = JSON.parse(raw); setTimeout(() => {
  const out = m.ticks_history ? { req_id: m.req_id, pip_size: 2, history: { prices: Array.from({ length: 100 }, (_, i) => 100 + i / 100) } } : { req_id: m.req_id, proposal: { ask_price: 10, payout: m.underlying_symbol === 'R_10' ? 11.2 : 11.0 } };
  ls.forEach((f) => f({ data: JSON.stringify(out) })); }, 1); } }; };
r = await j(await call('POST', '/scan', { pass: P, body: { preset: 'pegasus', currency: 'USD' } })); ok(r.status === 200 && r.body.rows.length === 5 && r.body.rows[0].symbol === 'R_10', 'scanner runs on the server with a pass');
env.PREMIUM_RULES = JSON.stringify({ presets: { pegasus: { mode: 'none', group: 'high', martingale: 1, maxLosses: 3 } } });
r = await j(await call('POST', '/session/start', { token: 'alice-token-1234', pass: P, body: sessBody })); ok(r.body.decision?.trade?.barrier === 1 && r.body.decision.trade.amount === sessBody.stake, 'PREMIUM_RULES still replaces the public defaults: ' + JSON.stringify(r.body.decision)); delete env.PREMIUM_RULES;
for (let i = 0; i < 10; i++) await call('GET', '/admin/payments', { admin: 'nope', ip: '5.5.5.5' });
r = await j(await call('GET', '/admin/payments', { admin: ADMIN, ip: '5.5.5.5' })); ok(r.status === 429, 'admin lockout after 10 wrong secrets');
const h = await call('GET', '/plan'); ok(h.headers.get('x-content-type-options') === 'nosniff' && h.headers.get('cache-control') === 'no-store', 'security headers present');
r = await j(await call('POST', '/premium/unlock', { ip: '4.4.4.4', body: { code: 'x'.repeat(20000) } })); ok(r.status === 401 || r.status === 400, 'oversized code body refused');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
