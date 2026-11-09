// KAPA Apex in the fake Deriv with the default settings: unlock Premium with a code, pick Apex, Start.
// The server runs every decision; no stake goes past the stop-loss.
const { chromium } = require('playwright'); const mock = require('./derivmock'); const trade = require('./trademock');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const dismiss = async (pg) => { for (let i = 0; i < 3; i++) { for (const t of ['Skip', 'Close']) { const b = pg.getByRole('button', { name: t, exact: true }).first(); if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); } await pg.keyboard.press('Escape').catch(() => {}); await pg.waitForTimeout(250); } };
(async () => {
  const worker = (await import('./worker.mjs')).default;
  const store = new Map();
  const KV = { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
  const ADMIN = 'admin-test-secret-0123456789';
  const env = { KAPA_KV: KV, ADMIN_SECRET: ADMIN, SESSION_KEY: 's'.repeat(48), ALLOWED_ORIGINS: 'http://localhost:8770', DERIV_API: 'https://api.derivws.com' };
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: +(process.env.W || 400), height: 860 } });
  const stats = { buys: [] }; const st = await mock.install(pg, { handler: trade(stats) });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => { url = String(url);
    if (url.endsWith('/trading/v1/options/accounts')) { const t = String(init.headers?.authorization || '').replace('Bearer ', '');
      return new Response(JSON.stringify(st.tokens.has(t) ? { data: [{ account_id: 'DOT90002' }] } : {}), { status: st.tokens.has(t) ? 200 : 401 }); }
    return realFetch(url, init); };
  const calls = [];
  await pg.route('https://kapa-premium.netlify.app/**', async (route) => {
    const r = route.request(); const req = new Request(r.url(), { method: r.method(), headers: r.headers(), body: ['GET', 'HEAD'].includes(r.method()) ? undefined : r.postDataBuffer() });
    const res = await worker.fetch(req, env); const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
    const body = Buffer.from(await res.arrayBuffer()); calls.push({ path: new URL(r.url()).pathname, status: res.status, body: body.toString() });
    route.fulfill({ status: res.status, headers, body });
  });
  await worker.fetch(new Request('https://kapa-premium.netlify.app/admin/code', { method: 'POST', headers: { 'x-admin-secret': ADMIN, 'content-type': 'application/json' }, body: JSON.stringify({ code: 'APEX-TEST-2026' }) }), env);
  await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(3500);
  await pg.locator('.kapa-login .kapa-btn, .kapa-lock__login button').first().click(); await pg.waitForTimeout(6000); await dismiss(pg);
  if (!(await pg.locator('.kapa-lock, .kapa-card--main').first().isVisible().catch(() => false))) { await pg.click('#id-kapa-ai'); await pg.waitForTimeout(1500); await dismiss(pg); }
  if (await pg.locator('.kapa-lock__free').isVisible().catch(() => false)) await pg.click('.kapa-lock__free');
  await pg.click('.kapa-gear'); await pg.waitForSelector('#kapa-premium-code', { timeout: 10000 });
  await pg.fill('#kapa-premium-code', 'apex test 2026'); await pg.click('.kapa-premium__code .kapa-btn'); await pg.waitForTimeout(1500);
  ok(/Premium unlocked/.test(await pg.textContent('.kapa-premium')), 'Premium unlocked with the code');
  await pg.selectOption('.kapa-field:has-text("Strategy") select', 'apex');
  await pg.fill('.kapa-field:has-text("Stop-loss") input', '50');
  await pg.click('.kapa-link:has-text("advanced")'); await pg.fill('.kapa-field:has-text("Pause between") input', '0');
  ok((await pg.inputValue('.kapa-field:has-text("Stop after N") input')) === '', '"Stop after N losses" left empty (the strategy default)');
  await pg.waitForTimeout(1500); const plan = await pg.textContent('.kapa-plan');
  ok(/Reaches take-profit/.test(plan) && !/Invalid/.test(plan), 'the Apex session plan is computed by the server: ' + plan.replace(/\s+/g, ' ').slice(0, 90));
  await pg.click('.kapa-settings__foot .kapa-btn'); await pg.waitForTimeout(400);
  const before = stats.buys.length; await pg.click('.kapa-runbtn');
  await pg.waitForSelector('.kapa-result', { timeout: 120000 }).catch(() => {}); await pg.waitForTimeout(800);
  const start = calls.find((c) => c.path === '/session/start');
  ok(start && start.status === 200, 'Apex /session/start answers 200 with the default settings: ' + (start ? start.body.slice(0, 80) : 'not called'));
  const buys = stats.buys.slice(before); const nexts = calls.filter((c) => c.path === '/session/next' && c.status === 200).length;
  ok(buys.length > 0 && nexts === buys.length, `Apex runs on the server: ${buys.length} trades, ${nexts} decisions`);
  ok(buys.every((x) => x.stake <= 50), 'no Apex stake above the stop-loss: ' + buys.map((x) => x.stake).join(', '));
  ok(await pg.locator('.kapa-result').isVisible(), 'the session ends with a result: ' + (await pg.textContent('.kapa-result').catch(() => '')).replace(/\s+/g, ' ').slice(0, 60));
  await pg.screenshot({ path: 'x/apex-result.png' });
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); await b.close(); process.exit(0);
})();
