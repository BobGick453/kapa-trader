// The real Kapa Premium server (worker.mjs, built from server/) answering the page in Playwright, with a test
// KV store, the fake Deriv's logins, and a fake CinetPay. Used by the Premium browser tests.
const ADMIN = 'admin-test-secret-0123456789';
exports.ADMIN = ADMIN;
exports.setup = async (opts = {}) => {
  const worker = (await import('./worker.mjs')).default;
  const store = new Map();
  const KV = { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
  const prob = (m) => ({ DIGITOVER: (9 - +m.barrier) / 10, DIGITUNDER: +m.barrier / 10 }[m.contract_type] ?? 0.5);
  const env = { KAPA_KV: KV, ADMIN_SECRET: ADMIN, SESSION_KEY: 's'.repeat(48), PLAN_DAYS: '30', CURRENCY: 'XOF', SITE_URL: 'http://localhost:8770/kapa-trader/', ALLOWED_ORIGINS: 'http://localhost:8770', DERIV_API: 'https://api.derivws.com',
    ...(opts.cinetpay ? { CINETPAY_APIKEY: 'key', CINETPAY_SITE_ID: '123', PRICE_XOF: '5000' } : {}),
    OPEN_SOCKET: () => { const ls = []; return { addEventListener: (t, f) => ls.push(f), close() {}, send(raw) { const m = JSON.parse(raw); setTimeout(() => {
      const out = m.ticks_history ? { req_id: m.req_id, pip_size: 2, history: { prices: Array.from({ length: 100 }, () => +(1000 + Math.random() * 10).toFixed(2)) } }
        : { req_id: m.req_id, proposal: { ask_price: 10, payout: +(10 * (m.underlying_symbol === 'R_25' ? 0.9775 : 0.9765) / prob(m)).toFixed(2) } };
      ls.forEach((f) => f({ data: JSON.stringify(out) })); }, 5); } }; } };
  // Deriv logins of every fake-Deriv page that registers here, and CinetPay payments
  const tokenSets = []; const accounts = { DOT90002: ['DOT90002', 'ROT90001'] }; const payments = {};
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    if (url.endsWith('/trading/v1/options/accounts')) { const t = String(init.headers?.authorization || '').replace('Bearer ', '');
      const set = tokenSets.find((x) => x.tokens.has(t));
      return new Response(JSON.stringify(set ? { data: set.accounts.map((account_id) => ({ account_id })) } : {}), { status: set ? 200 : 401 }); }
    if (url.endsWith('/v2/payment')) { const body = JSON.parse(init.body); payments[body.transaction_id] = { status: 'PENDING', amount: String(body.amount), currency: body.currency, return_url: body.return_url };
      return new Response(JSON.stringify({ code: '201', data: { payment_url: `https://checkout.cinetpay.com/payment/${body.transaction_id}` } })); }
    if (url.endsWith('/v2/payment/check')) { const p = payments[JSON.parse(init.body).transaction_id]; return new Response(JSON.stringify({ code: '00', data: { status: p.status, amount: p.amount, currency: p.currency, payment_method: 'OMCIV2' } })); }
    return realFetch(url, init);
  };
  const calls = [];
  const admin = async (path, body) => { const res = await worker.fetch(new Request('https://kapa-premium.netlify.app' + path, { method: body ? 'POST' : 'GET', headers: { 'x-admin-secret': ADMIN, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }), env); return res.json(); };
  /** Routes a page's Premium server and CinetPay requests here; `ids` are the Deriv accounts of its login. */
  const attach = async (pg, st, ids = ['DOT90002', 'ROT90001']) => {
    tokenSets.push({ tokens: st.tokens, accounts: ids });
    await pg.route('https://kapa-premium.netlify.app/**', async (route) => {
      const r = route.request(); const req = new Request(r.url(), { method: r.method(), headers: r.headers(), body: ['GET', 'HEAD'].includes(r.method()) ? undefined : r.postDataBuffer() });
      const res = await worker.fetch(req, env); const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
      const body = Buffer.from(await res.arrayBuffer()); calls.push({ path: new URL(r.url()).pathname, status: res.status, body: body.toString().slice(0, 300) });
      route.fulfill({ status: res.status, headers, body });
    });
    await pg.route('https://checkout.cinetpay.com/payment/**', (route) => { const tx = route.request().url().split('/').pop();
      route.fulfill({ contentType: 'text/html', body: `<html><body><button id="pay" onclick="location.href='https://cinetpay-test.local/pay/${tx}'">Pay</button></body></html>` }); });
    await pg.route('https://cinetpay-test.local/pay/**', async (route) => { const tx = route.request().url().split('/').pop(); payments[tx].status = 'ACCEPTED';
      await worker.fetch(new Request('https://kapa-premium.netlify.app/cinetpay/notify', { method: 'POST', body: new URLSearchParams({ cpm_trans_id: tx }) }), env);
      route.fulfill({ contentType: 'text/html', body: `<html><body><script>location.href=${JSON.stringify(payments[tx].return_url)}</script></body></html>` }); });
  };
  return { worker, env, store, calls, admin, attach, payments };
};
exports.dismiss = async (pg) => { for (let i = 0; i < 3; i++) { for (const t of ['Skip', 'Close']) { const b = pg.getByRole('button', { name: t, exact: true }).first(); if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); } await pg.keyboard.press('Escape').catch(() => {}); await pg.waitForTimeout(250); } };
/** Logs in on the fake Deriv and opens the KAPA AI page (the free strategies if Premium is locked). */
exports.login = async (pg, free = true) => {
  await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(3500);
  await pg.locator('.kapa-login .kapa-btn, .kapa-lock__login button').first().click(); await pg.waitForTimeout(6000); await exports.dismiss(pg);
  if (!(await pg.locator('.kapa-lock, .kapa-card--main').first().isVisible().catch(() => false))) { await pg.click('#id-kapa-ai'); await pg.waitForTimeout(1500); await exports.dismiss(pg); }
  if (free && (await pg.locator('.kapa-lock__free').isVisible().catch(() => false))) await pg.click('.kapa-lock__free');
};
exports.openS = async (p) => { if (!(await p.locator('.kapa-settings').isVisible().catch(() => false))) { if (await p.locator('.kapa-lock__cta').isVisible().catch(() => false)) await p.click('.kapa-lock__cta'); else await p.click('.kapa-gear'); await p.waitForTimeout(500); } };
exports.closeS = async (p) => { if (await p.locator('.kapa-settings').isVisible().catch(() => false)) { await p.click('.kapa-settings__foot .kapa-btn'); await p.waitForTimeout(400); } };
