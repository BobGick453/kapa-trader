// The Premium server on Netlify: the real Netlify Function (server/netlify/kapa.mjs, as bundled in server/dist)
// on a Netlify-Blobs-like store, with Deriv logins, a Deriv public WebSocket and storage failures simulated.
import { WebSocketServer } from 'ws';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
// fake Deriv public WebSocket (the scanner's prices and ticks)
const wss = new WebSocketServer({ port: 8799 });
wss.on('connection', (ws) => ws.on('message', (raw) => { const m = JSON.parse(raw);
  ws.send(JSON.stringify(m.ticks_history ? { req_id: m.req_id, pip_size: 2, history: { prices: Array.from({ length: 100 }, (_, i) => 100 + i / 100) } } : { req_id: m.req_id, proposal: { ask_price: 10, payout: m.underlying_symbol === 'R_50' ? 19.6 : 19.4 } })); }));
process.env.ADMIN_SECRET = 'owner-admin-secret-0123456789'; process.env.DERIV_PUBLIC_WS = 'ws://127.0.0.1:8799';
// fake Netlify Blobs store
const blobs = new Map();
const store = { async get(k) { return blobs.has(k) ? blobs.get(k) : null; }, async set(k, v, o = {}) { if (o.onlyIfNew && blobs.has(k)) return { modified: false }; blobs.set(k, v); return { modified: true }; }, async delete(k) { blobs.delete(k); }, async list({ prefix = '' } = {}) { return { blobs: [...blobs.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, etag: 'x' })), directories: [] }; } };
// Deriv identity: which accounts each OAuth token belongs to (as in worker.test.mjs)
const USERS = { 'alice-token-1234': ['DOT1', 'ROT1'], 'alice-token-NEW1': ['DOT1', 'ROT1'], 'bob-token-12345': ['ROT2'], 'carol-token-1234': ['CR777'] };
globalThis.fetch = async (url, init = {}) => { url = String(url);
  if (url.endsWith('/trading/v1/options/accounts')) { const t = (init.headers.authorization || '').replace('Bearer ', '');
    return USERS[t] ? new Response(JSON.stringify({ data: USERS[t].map((account_id) => ({ account_id })) })) : new Response('{}', { status: 401 }); }
  throw new Error('unexpected fetch ' + url); };
const mod = await import('../../server/dist/netlify/functions/kapa.mjs');
mod.__useStore(() => store);
ok(JSON.stringify(mod.config) === '{"path":"/*"}', 'function answers on every path');
const call = (m, fn, method, path, { body, admin, token, device, ip = '1.1.1.1', origin = 'https://bobgick453.github.io' } = {}) => { const h = { origin, 'x-nf-client-connection-ip': ip }; if (admin) h['x-admin-secret'] = admin; if (token) h.authorization = 'Bearer ' + token; if (device) h['x-kapa-device'] = device; if (body) h['content-type'] = 'application/json';
  return m.default(new Request('https://kapa-premium.netlify.app' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined })); };
const req = (method, path, o) => call(mod, null, method, path, o);
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null), headers: r.headers });
const A = process.env.ADMIN_SECRET, ALICE = 'alice-token-1234', BOB = 'bob-token-12345', CAROL = 'carol-token-1234';
const realNow = Date.now; const later = (ms) => { Date.now = () => realNow() + ms; }; const now = () => { Date.now = realNow; };

let r = await j(await req('GET', '/plan')); ok(r.status === 200 && r.body.currency === 'XOF' && r.body.contact, '/plan answers with Kapa defaults');
ok(r.headers.get('access-control-allow-origin') === 'https://bobgick453.github.io', 'CORS allows the Kapa site by default');
ok(!blobs.has('config:session_key'), 'with ADMIN_SECRET set, SESSION_KEY is derived from it, not stored');
// --- the owner: an account switched on, and a gift code ---
r = await j(await req('POST', '/admin/entitlements', { admin: A, body: { account: 'CR777' } })); ok(r.status === 200 && r.body.entitlement.active, 'owner switches Premium on for an account in Admin');
r = await j(await req('POST', '/admin/gifts', { admin: A, body: { label: 'Friends', maxUses: 3 } })); const gift = r.body.code;
ok(r.status === 200 && /^KAPA-/.test(gift), 'owner makes a gift code in Admin: ' + gift);
r = await j(await req('GET', '/admin/overview', { admin: A })); ok(r.body.entitlements.length === 1 && r.body.gifts.length === 1, 'Admin overview reads Blobs');
r = await j(await req('GET', '/admin/payments', { admin: A })); ok(Array.isArray(r.body.payments), 'Admin payments list works on Blobs');
r = await j(await req('GET', '/admin/overview', { admin: 'wrong' })); ok(r.status === 401, 'wrong admin secret refused');
// --- a gift code gives Premium to the Deriv account ---
r = await j(await req('POST', '/premium/redeem', { body: { code: gift } })); ok(r.status === 401, 'a gift code needs a Deriv login');
r = await j(await req('POST', '/premium/redeem', { token: ALICE, body: { code: gift.toLowerCase() } })); ok(r.status === 200 && r.body.status === 'active', 'redeeming the gift code with a Deriv login gives Premium to that account');
r = await j(await req('GET', '/premium/status', { token: ALICE })); ok(r.body.status === 'active', 'Alice is Premium');
// cold start: a new function instance (new module) on the same Blobs, a new login token, past the 15 s memory
const cold = await import('../../server/dist/netlify/functions/kapa.mjs?cold=' + Date.now()); cold.__useStore(() => store);
later(20000); r = await j(await call(cold, null, 'GET', '/premium/status', { token: 'alice-token-NEW1' })); now();
ok(r.body.status === 'active' && r.body.until > realNow() + 29 * 864e5, 'after a cold start, Premium is still active (it is stored in Blobs, signed with the same key)');
// --- Premium tools on Netlify ---
r = await j(await req('POST', '/session/start', { token: ALICE, body: { preset: 'target', symbol: 'R_75', stake: 1, takeProfit: 3, stopLoss: 20 } })); ok(r.status === 200 && r.body.decision.trade?.contract_type === 'DIGITEVEN', 'strategy session runs on Netlify');
r = await j(await req('POST', '/session/next', { token: ALICE, body: { session: r.body.session, result: { contract_id: 7, buy_price: 1, profit: -1 } } })); ok(r.body.decision?.trade?.amount > 3, 'next decision after a loss: ' + JSON.stringify(r.body.decision));
r = await j(await req('POST', '/scan', { token: ALICE, body: { preset: 'target', currency: 'USD' } })); ok(r.status === 200 && r.body.rows.length === 5 && r.body.rows[0].symbol === 'R_50' && r.body.rows[0].randomness?.ticks === 100 && r.body.rows[0].tradable, 'scanner reaches Deriv through a Node WebSocket: ' + JSON.stringify(r.body.rows?.[0])?.slice(0, 120));
const cb = { bot: 'printer', symbol: 'R_100', stake: 1, takeProfit: 5, stopLoss: 50, maxStake: 50, maxMargin: 12, state: { pl: -1, streak: 1, lost: 1, runs: 1 } };
r = await j(await req('POST', '/classic/recover', { token: BOB, body: cb })); ok(r.status === 402, 'classic Apex recovery is refused without Premium');
r = await j(await req('POST', '/classic/recover', { token: ALICE, body: cb })); ok(r.status === 200 && r.body.decision.trade?.amount > 1, 'classic Apex recovery works with Premium: ' + JSON.stringify(r.body.decision));
// --- revoke and expiry ---
r = await j(await req('POST', '/admin/entitlements/revoke', { admin: A, body: { account: 'CR777' } })); ok(r.status === 200 && !r.body.entitlement.active, 'owner revokes an account');
r = await j(await req('GET', '/premium/status', { token: CAROL })); ok(r.body.status === 'expired', 'the revoked account is no longer Premium');
later(31 * 864e5); r = await j(await req('GET', '/premium/status', { token: ALICE })); now();
ok(r.body.status === 'expired', 'after 30 days, Premium ends by itself');
// --- secrets never stored in clear ---
const all = [...blobs.keys(), ...blobs.values()].join('\n');
ok(!all.includes(gift) && !all.includes(gift.replace(/-/g, '')) && !/alice-token|bob-token|carol-token/.test(all) && !all.includes(A), 'no gift code, Deriv token or admin secret is stored in clear');
// --- wrong gift codes: slowed per device, not per address ---
for (let i = 0; i < 6; i++) await req('POST', '/premium/redeem', { token: BOB, ip: '9.9.9.9', device: 'phone-aaaa-1111', body: { code: 'WRONG-CODE-' + i } });
r = await j(await req('POST', '/premium/redeem', { token: BOB, ip: '9.9.9.9', device: 'phone-aaaa-1111', body: { code: gift } })); ok(r.status === 429 && r.headers.get('retry-after'), 'after 6 wrong codes that device must wait: ' + r.body.error);
r = await j(await req('POST', '/premium/redeem', { token: BOB, ip: '9.9.9.9', device: 'phone-bbbb-2222', body: { code: gift } })); ok(r.status === 200, 'another phone on the same address (mobile network) redeems at once');
// --- storage access: fresh per request, a one-off failure retried, errors readable with CORS ---
let reqNo = 0; // Netlify's Blobs access belongs to one request: a store kept from an earlier request stops working
mod.__useStore(() => { const mine = reqNo; const me = {}; for (const k of ['get', 'set', 'delete', 'list']) me[k] = async (...a) => { if (mine !== reqNo) throw new Error('401 blobs token expired'); return store[k](...a); }; return me; });
let okAll = true; let lastBody = '';
for (let i = 0; i < 3; i++) { reqNo++; const rr = await j(await req('POST', '/premium/redeem', { token: CAROL, ip: '7.7.7.' + i, body: { code: 'WRONG-CODE-X' + i } })); if (rr.status >= 500) { okAll = false; lastBody = JSON.stringify(rr.body); } }
ok(okAll, 'each request gets fresh storage access (no "Server error" on a warm instance) ' + lastBody);
let flaky = 1;
mod.__useStore(() => ({ ...store, get: async (...a) => { if (flaky-- > 0) throw new Error('blip'); return store.get(...a); } }));
later(40000); r = await j(await req('GET', '/premium/status', { token: BOB, ip: '8.8.8.8' })); now();
ok(r.status === 200 && r.body.status === 'active' && flaky < 0, 'a one-off storage failure is retried');
mod.__useStore(() => ({ get: async () => { throw new Error('blobs down'); }, set: async () => { throw new Error('blobs down'); }, delete: async () => {}, list: async () => ({ blobs: [] }) }));
let raw = await req('POST', '/premium/redeem', { token: CAROL, ip: '6.6.6.6', body: { code: gift } });
r = await j(raw); ok(raw.status === 500 && /Kapa server error/.test(r.body.error) && raw.headers.get('access-control-allow-origin') === 'https://bobgick453.github.io', 'server errors come back readable, with CORS: ' + r.body?.error);
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); wss.close(); process.exit(0);
