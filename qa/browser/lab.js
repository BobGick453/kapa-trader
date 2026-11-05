// Strategy lab: real-data flow (ticks + prices from the Deriv connection, backtest on the Kapa server)
const { chromium } = require('playwright'); const mock = require('./derivmock'); const trade = require('./trademock');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const worker = (await import('./worker.mjs')).default;
  const store = new Map();
  const KV = { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
  const env = { KAPA_KV: KV, ADMIN_SECRET: 'admin-test-secret-0123456789', SESSION_KEY: 's'.repeat(48), ALLOWED_ORIGINS: 'http://localhost:8770' };
  const W = +(process.env.W || 400);
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: W, height: 860 } });
  await mock.install(pg, { handler: trade({ buys: [] }) });
  await pg.route('https://kapa-premium.netlify.app/**', async (route) => {
    const r = route.request(); const req = new Request(r.url(), { method: r.method(), headers: r.headers(), body: ['GET', 'HEAD'].includes(r.method()) ? undefined : r.postDataBuffer() });
    const res = await worker.fetch(req, env); const headers = {}; res.headers.forEach((v, k) => { headers[k] = v; });
    route.fulfill({ status: res.status, headers, body: Buffer.from(await res.arrayBuffer()) });
  });
  await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(3500);
  await pg.click('.kapa-login .kapa-btn'); await pg.waitForTimeout(6000); if (await pg.locator('.kapa-lock__free').isVisible().catch(() => false)) await pg.click('.kapa-lock__free');
  for (const t of ['Skip', 'Close']) { const x = pg.getByRole('button', { name: t, exact: true }).first(); if (await x.isVisible().catch(() => false)) await x.click().catch(() => {}); }
  await pg.click('.kapa-gear'); await pg.waitForTimeout(500);
  const btn = pg.locator('.kapa-lab > .kapa-btn'); await btn.scrollIntoViewIfNeeded();
  ok(/Run the test on real Deriv data/.test(await btn.textContent()), 'lab button is ready once logged in');
  await btn.click();
  await pg.waitForSelector('.kapa-lab h5:has-text("4 ·")', { timeout: 60000 }).catch(() => {});
  const txt = await pg.textContent('.kapa-lab');
  ok(/5,000 real ticks/.test(txt), 'downloads 5,000 ticks');
  ok((await pg.locator('.kapa-lab__digits > div').count()) === 10, 'digit frequencies shown');
  const quotes = await pg.locator('.kapa-lab h5:has-text("3 ·") + .kapa-lab__table .kapa-lab__row:not(.kapa-lab__row--head)').count();
  ok(quotes === 22, 'real prices for 22 digit contracts: ' + quotes);
  const strategies = await pg.locator('.kapa-lab h5:has-text("4 ·") ~ .kapa-lab__table .kapa-lab__row:not(.kapa-lab__row--head)').count();
  ok(strategies === 6, '6 strategies replayed on the ticks: ' + strategies);
  ok(/Every signal wins at its normal chance|One signal falls outside/.test(txt), 'signals measured');
  await pg.locator('.kapa-lab h5:has-text("2 ·")').scrollIntoViewIfNeeded(); await pg.screenshot({ path: `x/lab-${W}-a.png` });
  await pg.locator('.kapa-lab h5:has-text("4 ·")').scrollIntoViewIfNeeded(); await pg.screenshot({ path: `x/lab-${W}-b.png` });
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close(); process.exit(0);
})();
