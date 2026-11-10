import worker from './worker.mjs';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const store = new Map();
const KV = { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); },
  list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
const ADMIN = 'owner-admin-secret-0123456789';
const env = { KAPA_KV: KV, CINETPAY_APIKEY: 'key', CINETPAY_SITE_ID: '123', ADMIN_SECRET: ADMIN, SESSION_KEY: 'k'.repeat(48), PRICE_XOF: '5000', PLAN_DAYS: '30', CURRENCY: 'XOF', SITE_URL: 'https://bobgick453.github.io/kapa-trader/', ALLOWED_ORIGINS: 'https://bobgick453.github.io', DERIV_API: 'https://api.derivws.com' };
const payments = {};
const USERS = { 'alice-token-1234': ['DOT1', 'ROT1'], 'bob-token-12345': ['ROT2'], 'carol-token-1234': ['CR777', 'VRTC777'], 'dan-token-123456': ['CR888'], 'eve-token-1234567': ['CR999'] };
globalThis.fetch = async (url, init = {}) => {
  url = String(url);
  if (url.endsWith('/trading/v1/options/accounts')) { const tok = (init.headers.authorization || '').replace('Bearer ', '');
    if (USERS[tok]) return new Response(JSON.stringify({ data: USERS[tok].map((account_id) => ({ account_id })) }));
    return new Response('{}', { status: 401 }); }
  if (url.endsWith('/v2/payment')) { const b = JSON.parse(init.body); payments[b.transaction_id] = { status: 'PENDING', amount: String(b.amount), currency: 'XOF' }; return new Response(JSON.stringify({ code: '201', data: { payment_url: 'https://checkout.cinetpay.com/payment/abc' } })); }
  if (url.endsWith('/v2/payment/check')) { const p = payments[JSON.parse(init.body).transaction_id]; return new Response(JSON.stringify(p ? { code: '00', data: { status: p.status, amount: p.amount, currency: p.currency, payment_method: 'OM' } } : { code: '627' })); }
  throw new Error('unexpected fetch ' + url);
};
const call = (method, path, { token, body, form, admin, pass, device, ip = '1.1.1.1', origin = 'https://bobgick453.github.io' } = {}) => {
  const headers = { origin, 'cf-connecting-ip': ip }; if (device) headers['x-kapa-device'] = device;
  if (token) headers.authorization = 'Bearer ' + token; if (admin) headers['x-admin-secret'] = admin; if (pass) headers['x-kapa-pass'] = pass;
  let b; if (body) { b = JSON.stringify(body); headers['content-type'] = 'application/json'; } if (form) b = new URLSearchParams(form);
  return worker.fetch(new Request('https://kapa-premium.example.workers.dev' + path, { method, headers, body: b }), env);
};
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null), headers: r.headers });
const A = 'alice-token-1234', B = 'bob-token-12345', C = 'carol-token-1234', D = 'dan-token-123456', E = 'eve-token-1234567';
const sessBody = { preset: 'target', symbol: 'R_75', stake: 1, takeProfit: 3, stopLoss: 20 };
const DAY = 86400000;
const waitCache = () => new Promise((x) => setTimeout(x, 15500)); // the server keeps Premium states 15 s per instance
let r;

// --- no Premium yet ---
r = await j(await call('GET', '/premium/status')); ok(r.body.status === 'inactive' && r.body.reason === 'login', 'without a Deriv login, Premium is inactive and the page is asked to log in');
r = await j(await call('GET', '/premium/status', { token: A })); ok(r.body.status === 'inactive' && r.body.accounts.join() === 'DOT1,ROT1', 'a logged-in user without Premium: inactive');
r = await j(await call('POST', '/session/start', { token: A, body: sessBody })); ok(r.status === 402, 'no Premium: no strategy session (402)');
r = await j(await call('GET', '/bots/odd-oscars', { token: A })); ok(r.status === 402, 'no Premium: no Premium bot settings');
r = await j(await call('POST', '/scan', { token: A, body: { preset: 'target' } })); ok(r.status === 402, 'no Premium: no scan');
r = await j(await call('POST', '/scan', { body: { preset: 'target' } })); ok(r.status === 401, 'the scan needs a Deriv login');

// --- gift codes made by the owner ---
r = await j(await call('POST', '/admin/gifts', { admin: 'wrong', body: { label: 'x' } })); ok(r.status === 401, 'making a gift code needs the admin secret');
r = await j(await call('POST', '/admin/gifts', { admin: ADMIN, body: { label: 'Friends', maxUses: 2 } }));
const gift = r.body.code; ok(r.status === 200 && /^KAPA-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(gift) && r.body.gift.maxUses === 2 && r.body.gift.days === 30, 'owner makes a 2-use gift code: ' + gift);
ok(![...store.values()].some((v) => v.includes(gift) || v.includes(gift.replace(/-/g, ''))), 'the gift code itself is never stored, only a keyed hash');
r = await j(await call('POST', '/admin/gifts', { admin: ADMIN, body: { label: 'Mine', code: 'kapa gold 2026' } })); ok(r.status === 200 && r.body.code === 'KAPA GOLD 2026', 'owner can also choose the code');
const gold = r.body.code;
r = await j(await call('POST', '/admin/gifts', { admin: ADMIN, body: { code: 'KAPAGOLD2026' } })); ok(r.status === 409, 'the same code twice is refused');
r = await j(await call('POST', '/premium/redeem', { body: { code: gift } })); ok(r.status === 401 && /Log in with Deriv/.test(r.body.error), 'a gift code needs a Deriv login (it goes to the account)');
r = await j(await call('POST', '/premium/redeem', { token: A, body: { code: 'WRONG-CODE-1234' } })); ok(r.status === 401, 'a wrong code is refused');
const t0 = Date.now();
r = await j(await call('POST', '/premium/redeem', { token: A, body: { code: gift.toLowerCase().replace(/-/g, ' ') } })); ok(r.status === 200 && r.body.status === 'active' && Math.abs(r.body.until - (t0 + 30 * DAY)) < 5000, 'the gift code gives Alice 30 days (spaces and case ignored)');
r = await j(await call('GET', '/premium/status', { token: A })); ok(r.body.status === 'active' && r.body.until > Date.now() + 29 * DAY, 'Alice is Premium for 30 days');
r = await j(await call('POST', '/premium/redeem', { token: A, body: { code: gift } })); ok(r.status === 409, 'the same code twice on one account is refused');
r = await j(await call('POST', '/premium/redeem', { token: B, body: { code: gift } })); ok(r.status === 200, 'second use by Bob works');
r = await j(await call('POST', '/premium/redeem', { token: C, body: { code: gift } })); ok(r.status === 410 && /as many times/.test(r.body.error), 'a third use of a 2-use code is refused');
r = await j(await call('POST', '/premium/redeem', { token: C, body: { code: gold } })); ok(r.status === 200, 'Carol uses the owner-chosen code');
let ov = await j(await call('GET', '/admin/overview', { admin: ADMIN }));
const g1 = ov.body.gifts.find((g) => g.label === 'Friends');
ok(g1.uses === 2 && g1.redeemed.length === 2 && g1.hint === gift.replace(/-/g, '').slice(-4) && !JSON.stringify(ov.body).includes(gift), 'Admin lists gift codes with their uses, never the code');
r = await j(await call('POST', '/admin/gifts/disable', { admin: ADMIN, body: { id: ov.body.gifts.find((g) => g.label === 'Mine').id } })); ok(r.body.gift.disabled, 'owner switches a gift code off');
r = await j(await call('POST', '/premium/redeem', { token: D, body: { code: gold } })); ok(r.status === 410 && /switched off/.test(r.body.error), 'a switched-off code no longer works');

// --- Premium tools with an active account ---
r = await j(await call('POST', '/session/start', { token: A, body: sessBody })); ok(r.status === 200 && r.body.decision.trade?.contract_type === 'DIGITEVEN' && Math.abs(r.body.decision.trade.amount - (sessBody.takeProfit / ((1 - 0.0235) / 0.5 - 1))) < 0.02, 'Alice: the server runs KAPA Target (bold play on a 50% contract): ' + JSON.stringify(r.body.decision));
let sess = r.body.session;
r = await j(await call('POST', '/session/start', { token: A, body: { ...sessBody, preset: 'pegasus' } })); ok(r.status === 200 && r.body.decision.trade, 'the old name "pegasus" still starts KAPA Target (saved settings keep working)');
r = await j(await call('GET', '/bots/odd-oscars', { token: A })); ok(r.body.data?.type === 'DIGITODD', 'Premium bot settings for Alice');
r = await j(await call('POST', '/session/next', { token: A, body: { session: sess, result: { contract_id: 6, buy_price: 1, profit: -1 } } })); ok(r.status === 200 && r.body.decision.trade && r.body.decision.trade.amount > 1, 'session continues after a loss with a larger stake');
sess = r.body.session;
r = await j(await call('POST', '/session/next', { token: B, body: { session: sess, result: { contract_id: 7, buy_price: 1, profit: -1 } } })); ok(r.status === 400, "Bob can't use Alice's session even with Premium");

// --- expiry and revoke ---
const entA = JSON.parse(store.get('ent:DOT1')); entA.until = Date.now() - 1000; store.set('ent:DOT1', JSON.stringify(entA)); store.set('ent:ROT1', JSON.stringify(entA));
await waitCache();
r = await j(await call('GET', '/premium/status', { token: A })); ok(r.body.status === 'expired', 'after its days Premium ends by itself (expired)');
r = await j(await call('POST', '/session/next', { token: A, body: { session: sess, result: { contract_id: 8, buy_price: 2, profit: 1.9 } } })); ok(r.status === 402 && /ended/.test(r.body.error), 'a running session stops getting trades when Premium ends: ' + r.body.error);
r = await j(await call('POST', '/admin/entitlements', { admin: ADMIN, body: { account: 'rot1', days: 30 } })); ok(r.status === 200 && r.body.entitlement.active && r.body.entitlement.accounts.includes('DOT1'), 'owner re-activates Alice from Admin by one account ID (her other account follows)');
r = await j(await call('GET', '/premium/status', { token: A })); ok(r.body.status === 'active', 'Alice is Premium again');
r = await j(await call('POST', '/admin/entitlements', { admin: ADMIN, body: { account: 'CR555' } })); ok(r.status === 200 && r.body.entitlement.until > Date.now() + 29 * DAY, 'owner activates an account that never logged in (CR555, 30 days)');
r = await j(await call('POST', '/admin/entitlements', { admin: ADMIN, body: { account: 'CR555', days: 10 } })); ok(Math.abs(r.body.entitlement.until - (Date.now() + 40 * DAY)) < 60000, 'extending a running Premium adds to its end date (30 + 10 days)');
r = await j(await call('POST', '/admin/entitlements', { admin: ADMIN, body: { account: 'bad id!' } })); ok(r.status === 400, 'an invalid account ID is refused');
r = await j(await call('GET', '/premium/status', { token: B })); ok(r.body.status === 'active', 'Bob is Premium before the revoke');
r = await j(await call('POST', '/admin/entitlements/revoke', { admin: ADMIN, body: { account: 'ROT2' } })); ok(r.status === 200 && !r.body.entitlement.active, 'owner revokes Bob');
r = await j(await call('GET', '/premium/status', { token: B })); ok(r.body.status === 'expired', 'Bob is no longer Premium at once (revoked counts as ended)');
r = await j(await call('POST', '/scan', { token: B, body: {} })); ok(r.status === 402, 'and his Premium requests are refused');
ov = await j(await call('GET', '/admin/overview', { admin: ADMIN }));
ok(ov.body.entitlements.some((e) => e.accounts.includes('CR555') && e.active && e.source === 'admin') && ov.body.entitlements.some((e) => e.accounts.includes('ROT2') && !e.active && e.revokedAt), 'Admin lists active and ended accounts with their end dates');

// --- the old shared code: its devices move to their account once ---
store.set('premium:code', JSON.stringify({ h: 'x', ver: 'legacy-v1', updatedAt: 1 }));
{
  const enc = new TextEncoder(); const key = await crypto.subtle.importKey('raw', enc.encode(env.SESSION_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mk = async (payload) => { const body = Buffer.from(JSON.stringify(payload)).toString('base64url'); const sig = Buffer.from(await crypto.subtle.sign('HMAC', key, enc.encode(body))).toString('base64url'); return `${body}.${sig}`; };
  const good = await mk({ v: 1, typ: 'pass', ver: 'legacy-v1', exp: Date.now() + 5 * DAY });
  const other = await mk({ v: 1, typ: 'pass', ver: 'older', exp: Date.now() + 5 * DAY });
  r = await j(await call('GET', '/premium/status', { token: E, pass: other })); ok(r.body.status === 'inactive', 'a pass for an older code gives nothing');
  r = await j(await call('GET', '/premium/status', { token: E, pass: good })); ok(r.body.status === 'active' && r.body.migrated && r.body.until > Date.now() + 29 * DAY, 'a device that used the old shared code gets 30 days on its account, once');
  const until = r.body.until;
  r = await j(await call('GET', '/premium/status', { token: E, pass: good })); ok(!r.body.migrated && r.body.until === until, 'the old pass gives nothing more after that');
  r = await j(await call('POST', '/premium/unlock', { token: D, body: { code: 'KAPAGOLD2026' } })); ok(r.status === 410, '/premium/unlock (pages not yet updated) now redeems gift codes');
}

// --- payments: verified with CinetPay, then Premium on the buyer's account ---
r = await j(await call('GET', '/plan')); ok(r.body.configured && r.body.price === 5000 && r.body.contact.whatsapp === null, 'the plan shows the price and no contact link yet');
r = await j(await call('POST', '/admin/settings', { admin: ADMIN, body: { whatsapp: '+225 07 00 00 00 00', telegram: '@kapa_trader' } })); ok(r.status === 200 && r.body.contact.whatsapp === '2250700000000', 'owner sets the WhatsApp number and Telegram name in Admin');
r = await j(await call('GET', '/plan')); ok(r.body.contact.whatsapp === 'https://wa.me/2250700000000' && r.body.contact.telegram === 'https://t.me/kapa_trader', 'visitors get the contact links');
r = await j(await call('POST', '/admin/settings', { admin: ADMIN, body: { whatsapp: 'call me', telegram: '' } })); ok(r.status === 400, 'an invalid number is refused');
r = await j(await call('POST', '/checkout', { token: D, body: {} })); const tx = r.body.transaction_id; ok(r.body.payment_url, 'checkout starts a CinetPay payment');
r = await j(await call('GET', `/checkout/status?tx=${tx}`, { token: D })); ok(r.body.status === 'pending', 'pending until CinetPay confirms');
r = await j(await call('GET', '/premium/status', { token: D })); ok(r.body.status === 'inactive', 'no Premium before the payment is confirmed');
payments[tx].status = 'ACCEPTED'; await call('POST', '/cinetpay/notify', { form: { cpm_trans_id: tx } });
r = await j(await call('GET', `/checkout/status?tx=${tx}`, { token: D })); ok(r.body.status === 'paid' && r.body.until > Date.now() + 29 * DAY, "payment verified with CinetPay: Premium for 30 days on the buyer's account");
r = await j(await call('GET', '/premium/status', { token: D })); ok(r.body.status === 'active', 'the buyer is Premium without any code');
await call('POST', '/cinetpay/notify', { form: { cpm_trans_id: tx } });
r = await j(await call('GET', '/admin/payments', { admin: ADMIN })); const p = r.body.payments.find((x) => x.key === tx);
ok(p.value.status === 'paid' && p.value.granted && Math.abs(p.value.until - JSON.parse(store.get('ent:CR888')).until) < 1, 'a repeated CinetPay notification does not add days twice');

// --- strategy safety, scan, rules, lockouts, headers ---
r = await j(await call('POST', '/session/start', { token: D, body: { ...sessBody, preset: 'martingale', stake: 50, stopLoss: 20 } })); ok(r.status === 400, 'stake above stop-loss refused');
r = await j(await call('POST', '/session/start', { token: D, body: { ...sessBody, preset: 'constructor' } })); ok(r.status === 400, 'preset "constructor" refused');
r = await j(await call('GET', '/bots/constructor', { token: D })); ok(r.status === 404, 'bot "constructor" is 404');
r = await j(await call('POST', '/session/start', { token: D, body: { ...sessBody, stopLoss: 5 } })); let ss = r.body.session; let d = r.body.decision; let cid = 300;
while (d.trade && cid < 330) { r = await j(await call('POST', '/session/next', { token: D, body: { session: ss, result: { contract_id: cid++, buy_price: d.trade.amount, profit: -d.trade.amount } } })); ss = r.body.session; d = r.body.decision; }
ok(d.stop && r.body.state.pl >= -5, `losing streak stops within the stop-loss (${r.body.state.pl})`);
env.OPEN_SOCKET = () => { const ls = []; return { addEventListener: (t, f) => ls.push(f), close() {}, send(raw) { const m = JSON.parse(raw); setTimeout(() => {
  const out = m.ticks_history ? { req_id: m.req_id, pip_size: 2, history: { prices: Array.from({ length: 100 }, (_, i) => 100 + i / 100) } } : { req_id: m.req_id, proposal: { ask_price: 10, payout: m.underlying_symbol === 'R_10' ? 11.2 : m.underlying_symbol === 'R_25' ? 17.5 : 19.4 } };
  ls.forEach((f) => f({ data: JSON.stringify(out) })); }, 1); } }; };
r = await j(await call('POST', '/scan', { token: D, body: { preset: 'target', currency: 'USD' } }));
ok(r.status === 200 && r.body.rows.length === 5 && r.body.rows[0].symbol === 'R_50' && r.body.rows[0].tradable && !r.body.rows.find((x) => x.symbol === 'R_25').tradable, 'scanner: best terms first; a 12.5% margin is above the 12% default limit');
r = await j(await call('POST', '/scan', { token: D, body: { preset: 'target', currency: 'USD', maxMargin: 13 } })); ok(r.body.rows.find((x) => x.symbol === 'R_25').tradable === true, "the scanner uses the user's own margin limit when sent");
env.PREMIUM_RULES = JSON.stringify({ presets: { pegasus: { mode: 'none', group: 'high', martingale: 1, maxLosses: 3 } } });
r = await j(await call('POST', '/session/start', { token: D, body: sessBody })); ok(r.body.decision?.trade?.barrier === 1 && r.body.decision.trade.amount === sessBody.stake, 'PREMIUM_RULES still replaces the public defaults (old key "pegasus" accepted): ' + JSON.stringify(r.body.decision)); delete env.PREMIUM_RULES;
for (let i = 0; i < 10; i++) await call('GET', '/admin/payments', { admin: 'nope', ip: '5.5.5.5' });
r = await j(await call('GET', '/admin/payments', { admin: ADMIN, ip: '5.5.5.5' })); ok(r.status === 429, 'admin lockout after 10 wrong secrets');
const h = await call('GET', '/plan'); ok(h.headers.get('x-content-type-options') === 'nosniff' && h.headers.get('cache-control') === 'no-store', 'security headers present');
r = await j(await call('POST', '/premium/redeem', { token: A, ip: '4.4.4.4', body: { code: 'x'.repeat(20000) } })); ok(r.status === 401 || r.status === 400, 'oversized code body refused');
const raw = await call('OPTIONS', '/premium/status'); ok(/x-kapa-device/.test(raw.headers.get('access-control-allow-headers')), 'CORS allows the device header');
r = await j(await call('POST', '/plan/simulate', { body: { ...sessBody, capital: 100 } })); ok(r.status === 200 && r.body.sessions > 0, 'the session plan stays free');

// --- wrong codes: a device slows down, a shared address (mobile network) stays open ---
const guess = (i, o) => call('POST', '/premium/redeem', { token: E, ip: '9.9.9.9', ...o, body: { code: 'guess-' + i + '-xxxx' } });
for (let i = 0; i < 5; i++) { r = await j(await guess(i, { device: 'phone-aaaa-1111' })); if (r.status !== 401) break; }
ok(r.status === 401, 'the first 5 wrong codes from a device are answered normally');
r = await j(await guess(5, { device: 'phone-aaaa-1111' })); ok(r.status === 401, 'the 6th wrong code is checked, then that device must wait');
r = await j(await guess(55, { device: 'phone-aaaa-1111' })); ok(r.status === 429 && /30 seconds/.test(r.body.error) && r.headers.get('retry-after') === '30', 'then it waits 30 s: ' + r.body.error);
r = await j(await call('POST', '/admin/gifts', { admin: ADMIN, body: { label: 'net', maxUses: 5 } })); const g2 = r.body.code;
r = await j(await call('POST', '/premium/redeem', { token: B, ip: '9.9.9.9', device: 'phone-bbbb-2222', body: { code: g2 } })); ok(r.status === 200, 'another phone on the same mobile network (same address) still redeems at once');
{ const k = [...store.keys()].find((x) => x.startsWith('codefail:') && JSON.parse(store.get(x)).until > 0); const v = JSON.parse(store.get(k)); v.until = Date.now() - 1; store.set(k, JSON.stringify(v)); }
r = await j(await guess(6, { device: 'phone-aaaa-1111' })); ok(r.status === 401, 'after the wait the device may try again');
r = await j(await guess(66, { device: 'phone-aaaa-1111' })); ok(r.status === 429 && /60 seconds/.test(r.body.error), 'each further wrong code doubles the wait: ' + r.body.error);
let flood = 0; for (let i = 0; i < 40; i++) { r = await j(await guess(100 + i, { ip: '3.3.3.3', device: 'bot-device-' + String(i).padStart(4, '0') })); if (r.status === 429) { flood = i; break; } }
ok(flood > 0 && flood <= 30 && /15 minutes/.test(r.body.error), `brute force from one address is stopped after ${flood} wrong codes: ${r.body?.error}`);

// --- KAPA Apex end to end, with the page's default settings (no "stop after N losses") ---
{
  const K = await import('../../server/strategy.js');
  const R = Object.fromEntries(K.GROUPS.all.map((x) => [x, K.estRatio(x)])); // Deriv's public prices
  const apexBody = { preset: 'apex', symbol: 'R_100', stake: 1, takeProfit: 10, stopLoss: 50, maxStake: 50, maxRuns: 0, maxMargin: 12, ratios: R };
  r = await j(await call('POST', '/plan/simulate', { body: { ...apexBody, capital: 1000 } })); ok(r.status === 200 && r.body.hit > 0.7, `Apex plan works with default settings (target ${(r.body.hit * 100).toFixed(0)}%)`);
  let seed = 7; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const tally = { sessions: 0, tp: 0, sl: 0, other: 0, trades: 0, worst: 0, over: [] }; let cidA = 5000;
  for (let n = 0; n < 16; n++) {
    const allLose = n % 5 === 0;
    r = await j(await call('POST', '/session/start', { token: C, body: apexBody }));
    if (r.status !== 200) { ok(false, 'Apex session starts with default settings: ' + JSON.stringify(r.body)); break; }
    let sA = r.body.session; let dA = r.body.decision; let pl = 0;
    while (dA.trade) {
      const t = dA.trade; const key = t.barrier === null ? t.contract_type : `${t.contract_type}:${t.barrier}`;
      if (t.amount > apexBody.maxStake + 1e-9 || t.amount > apexBody.stopLoss + pl + 1e-9) tally.over.push({ amount: t.amount, pl });
      const won = !allLose && rnd() < K.winProb(key); const profit = won ? Math.round(t.amount * R[key] * 100) / 100 : -t.amount;
      pl = Math.round((pl + profit) * 100) / 100; tally.trades++;
      r = await j(await call('POST', '/session/next', { token: C, body: { session: sA, result: { contract_id: cidA++, buy_price: t.amount, profit }, ratios: { [key]: R[key] } } }));
      if (r.status !== 200) { tally.other++; ok(false, 'Apex /session/next answered ' + r.status + ' ' + JSON.stringify(r.body)); break; }
      sA = r.body.session; dA = r.body.decision;
    }
    if (!dA) break; tally.sessions++; tally.worst = Math.min(tally.worst, pl); tally[dA.stop === 'tp' ? 'tp' : dA.stop === 'sl' ? 'sl' : 'other']++;
  }
  ok(tally.sessions === 16 && tally.over.length === 0 && tally.worst >= -50, `Apex: 16 sessions over /session/start and /session/next, ${tally.trades} trades, no stake past the stop-loss or max stake, worst ${tally.worst} (${tally.tp} take-profit, ${tally.sl} stop-loss, ${tally.other} other)`);
  r = await j(await call('POST', '/session/start', { token: C, body: { ...apexBody, maxLosses: 31 } })); ok(r.status === 400, 'more than 30 losses in a row is refused');

  // --- classic bots with Apex recovery (Premium): the next trade after a loss comes from the server ---
  const cb = { bot: 'printer', symbol: 'R_100', stake: 1, takeProfit: 5, stopLoss: 50, maxStake: 50, maxMargin: 12, ratios: R };
  r = await j(await call('POST', '/classic/recover', { token: C, body: { ...cb, state: { pl: -1, streak: 1, lost: 1, runs: 1 } } }));
  const t1 = r.body.decision?.trade; const k1 = t1 && (t1.barrier === null ? t1.contract_type : `${t1.contract_type}:${t1.barrier}`);
  ok(r.status === 200 && t1 && t1.amount <= 49 && t1.amount * R[k1] >= 5.99, 'classic recovery: Apex gives the trade that wins back the loss and the target in one win: ' + JSON.stringify(t1));
  r = await j(await call('POST', '/classic/recover', { token: C, body: { ...cb, state: { pl: -49.8, streak: 4, lost: 49.8, runs: 4 } } })); ok(r.body.decision.stop === 'sl', 'never past the stop-loss: ' + JSON.stringify(r.body.decision));
  r = await j(await call('POST', '/classic/recover', { token: E.replace('eve', 'eve'), body: { ...cb, state: { pl: -1, streak: 1, lost: 1, runs: 1 } } })); ok(r.status === 200, 'Eve (migrated) can use it');
  r = await j(await call('POST', '/classic/recover', { token: 'bob-token-12345', body: { ...cb, state: { pl: -1, streak: 1, lost: 1, runs: 1 } } })); ok(r.status === 200 || r.status === 402, 'Bob (gift after revoke) gets an answer');
  store.delete('ent:CR777'); store.delete('ent:VRTC777'); await waitCache();
  r = await j(await call('POST', '/classic/recover', { token: C, body: { ...cb, state: { pl: -1, streak: 1, lost: 1, runs: 1 } } })); ok(r.status === 402, 'classic Apex recovery is Premium');
  await call('POST', '/admin/entitlements', { admin: ADMIN, body: { account: 'CR777' } });
  r = await j(await call('POST', '/classic/recover', { token: C, body: { ...cb, state: { pl: 0, streak: 0, lost: 0, runs: 0 } } })); ok(r.status === 400, 'recovery only after a loss');
  r = await j(await call('POST', '/plan/simulate', { body: { ...cb, preset: 'classic', capital: 1000 } })); ok(r.status === 200 && r.body.hit > 0.8 && r.body.bustAvg >= -50.01, `classic + Apex plan simulated by the server (target ${(r.body.hit * 100).toFixed(0)}%)`);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
