import { WebSocketServer } from 'ws';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
// fake Deriv public WebSocket
const wss = new WebSocketServer({ port: 8799 });
wss.on('connection', (ws) => ws.on('message', (raw) => { const m = JSON.parse(raw);
  ws.send(JSON.stringify(m.ticks_history ? { req_id: m.req_id, pip_size: 2, history: { prices: Array.from({ length: 100 }, (_, i) => 100 + i / 100) } } : { req_id: m.req_id, proposal: { ask_price: 10, payout: m.underlying_symbol === 'R_50' ? 11.3 : 11.0 } })); }));
process.env.ADMIN_SECRET = 'owner-admin-secret-0123456789'; process.env.DERIV_PUBLIC_WS = 'ws://127.0.0.1:8799';
// fake Netlify Blobs store
const blobs = new Map();
const store = { async get(k) { return blobs.has(k) ? blobs.get(k) : null; }, async set(k, v, o = {}) { if (o.onlyIfNew && blobs.has(k)) return { modified: false }; blobs.set(k, v); return { modified: true }; }, async delete(k) { blobs.delete(k); }, async list({ prefix = '' } = {}) { return { blobs: [...blobs.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, etag: 'x' })), directories: [] }; } };
globalThis.fetch = async (url, init = {}) => { url = String(url); if (url.endsWith('/trading/v1/options/accounts')) { const t = (init.headers.authorization || '').replace('Bearer ', ''); return t === 'alice-token-1234' ? new Response(JSON.stringify({ data: [{ account_id: 'DOT1' }] })) : new Response('{}', { status: 401 }); } throw new Error('unexpected fetch ' + url); };
const mod = await import('../../server/dist/netlify/functions/kapa.mjs');
mod.__useStore(() => store);
ok(JSON.stringify(mod.config) === '{"path":"/*"}', 'function answers on every path');
const call = (method, path, { body, admin, pass, token, ip = '1.1.1.1', origin = 'https://bobgick453.github.io' } = {}) => { const h = { origin, 'x-nf-client-connection-ip': ip }; if (admin) h['x-admin-secret'] = admin; if (pass) h['x-kapa-pass'] = pass; if (token) h.authorization = 'Bearer ' + token; if (body) h['content-type'] = 'application/json';
  return mod.default(new Request('https://kapa-premium.netlify.app' + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined })); };
const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null), headers: r.headers });
let r = await j(await call('GET', '/plan')); ok(r.status === 200 && r.body.currency === 'XOF', '/plan answers with Kapa defaults');
ok(r.headers.get('access-control-allow-origin') === 'https://bobgick453.github.io', 'CORS allows the Kapa site by default');
ok(!blobs.has('config:session_key'), 'with ADMIN_SECRET set, SESSION_KEY is derived from it, not stored');
const A = process.env.ADMIN_SECRET;
r = await j(await call('POST', '/admin/code', { admin: A, body: { code: 'Kapa Gold 2026' } })); ok(r.status === 200, 'owner sets the code in Admin');
r = await j(await call('POST', '/premium/unlock', { body: { code: 'kapagold2026' } })); ok(r.status === 200 && r.body.pass, 'the code unlocks Premium');
const P = r.body.pass;
r = await j(await call('GET', '/premium/status', { pass: P })); ok(r.body.status === 'active', 'pass is valid');
r = await j(await call('POST', '/session/start', { token: 'alice-token-1234', pass: P, body: { preset: 'pegasus', symbol: 'R_75', stake: 1, takeProfit: 3, stopLoss: 20 } })); ok(r.status === 200 && r.body.decision.trade?.contract_type === 'DIGITEVEN', 'strategy session runs on Netlify');
r = await j(await call('POST', '/session/next', { token: 'alice-token-1234', pass: P, body: { session: r.body.session, result: { contract_id: 7, buy_price: 1, profit: -1 } } })); ok(r.body.decision?.trade?.amount > 3, 'next decision after a loss: ' + JSON.stringify(r.body.decision));
r = await j(await call('POST', '/scan', { pass: P, body: { preset: 'pegasus', currency: 'USD' } })); ok(r.status === 200 && r.body.rows.length === 5 && r.body.rows[0].symbol === 'R_50' && r.body.rows[0].randomness?.ticks === 100 && r.body.rows[0].contract && r.body.rows[0].ratios, 'scanner reaches Deriv through a Node WebSocket: ' + JSON.stringify(r.body.rows?.[0]));
r = await j(await call('GET', '/bots/odd-oscars', { pass: P })); ok(r.body.data?.type === 'DIGITODD', 'Premium bot settings with the pass');
r = await j(await call('GET', '/bots/odd-oscars')); ok(r.status === 402, 'no pass: refused');
// lockout with expiry
for (let i = 0; i < 10; i++) await call('POST', '/premium/unlock', { ip: '9.9.9.9', body: { code: 'wrong-guess-' + i } });
r = await j(await call('POST', '/premium/unlock', { ip: '9.9.9.9', body: { code: 'kapagold2026' } })); ok(r.status === 429, '10 wrong codes lock that address');
r = await j(await call('POST', '/premium/unlock', { ip: '8.8.8.8', body: { code: 'kapagold2026' } })); ok(r.status === 200, 'other addresses are not affected');
const realNow = Date.now; Date.now = () => realNow() + 3601e3;
r = await j(await call('POST', '/premium/unlock', { ip: '9.9.9.9', body: { code: 'kapagold2026' } })); ok(r.status === 200, 'the lock ends after an hour');
Date.now = realNow;
r = await j(await call('POST', '/admin/code', { admin: A, body: { code: 'NEW-CODE-777' } }));
r = await j(await call('GET', '/premium/status', { pass: P })); ok(r.body.status === 'inactive', 'changing the code relocks every device');
r = await j(await call('GET', '/admin/payments', { admin: A })); ok(Array.isArray(r.body.payments), 'Admin payments list works on Blobs');
r = await j(await call('GET', '/admin/payments', { admin: 'wrong' })); ok(r.status === 401, 'wrong admin secret refused');
ok(![...blobs.values()].some((v) => /kapagold|NEW-?CODE/i.test(v)), 'the code is never stored in clear');
// a cold start (new instance) keeps passes valid: the key is the same
mod.__useStore(() => store);
r = await j(await call('POST', '/premium/unlock', { ip: '7.7.7.7', body: { code: 'NEW-CODE-777' } })); const P2 = r.body.pass;
mod.__useStore(() => store);
r = await j(await call('GET', '/premium/status', { pass: P2 })); ok(r.body.status === 'active', 'after a cold start, Premium stays unlocked');
// Netlify gives each request its own Blobs access: a store kept from an earlier request stops working
let reqNo = 0; // which request is running: Netlify's Blobs access belongs to one request
mod.__useStore(() => { const mine = reqNo; const me = {}; for (const k of ['get', 'set', 'delete', 'list']) me[k] = async (...a) => { if (mine !== reqNo) throw new Error('401 blobs token expired'); return store[k](...a); }; return me; });
let okAll = true; let lastBody = '';
for (let i = 0; i < 3; i++) { reqNo++; const rr = await j(await call('POST', '/premium/unlock', { ip: '7.7.7.' + i, body: { code: 'WRONG-CODE-1' } })); if (rr.status >= 500) { okAll = false; lastBody = JSON.stringify(rr.body); } }
ok(okAll, 'each request gets fresh storage access (no "Server error" on a warm instance) ' + lastBody);
// a brief Blobs failure is retried once
let flaky = 1;
mod.__useStore(() => ({ ...store, get: async (...a) => { if (flaky-- > 0) throw new Error('blip'); return store.get(...a); } }));
r = await j(await call('GET', '/premium/status', { ip: '8.8.8.8', pass: 'x.y' })); ok(r.status === 200, 'a one-off storage failure is retried');
// a storage failure answers with a readable error and CORS headers
mod.__useStore(() => ({ get: async () => { throw new Error('blobs down'); }, set: async () => { throw new Error('blobs down'); }, delete: async () => {}, list: async () => ({ blobs: [] }) }));
let raw = await call('POST', '/premium/unlock', { ip: '6.6.6.6', body: { code: 'NEW-CODE-777' } });
r = await j(raw); ok(raw.status === 500 && /Kapa server error|Server error/.test(r.body.error) && raw.headers.get('access-control-allow-origin') === 'https://bobgick453.github.io', 'server errors come back readable, with CORS: ' + r.body?.error);
console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); wss.close(); process.exit(0);
