const { chromium } = require('playwright'); const mock = require('./derivmock'); const trade = require('./trademock');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const openS = async (p) => { if (!(await p.locator('.kapa-settings').isVisible().catch(() => false))) { if (await p.locator('.kapa-lock__cta').isVisible().catch(() => false)) await p.click('.kapa-lock__cta'); else await p.click('.kapa-gear'); await p.waitForTimeout(500); } };
const closeS = async (p) => { if (await p.locator('.kapa-settings').isVisible().catch(() => false)) { await p.click('.kapa-settings__foot .kapa-btn'); await p.waitForTimeout(400); } };
const dismiss = async (pg) => { for (let i = 0; i < 3; i++) { for (const t of ['Skip', 'Close']) { const b = pg.getByRole('button', { name: t, exact: true }).first(); if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); } await pg.keyboard.press('Escape').catch(() => {}); await pg.waitForTimeout(300); } };
(async () => {
  const worker = (await import('./worker.mjs')).default;
  const store = new Map();
  const KV = { get: async (k, t) => { const v = store.get(k); return v == null ? null : t === 'json' ? JSON.parse(v) : v; }, put: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); }, list: async ({ prefix }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }) };
  const prob = (m) => ({ DIGITOVER: (9 - +m.barrier) / 10, DIGITUNDER: +m.barrier / 10 }[m.contract_type] ?? 0.5);
  const env = { KAPA_KV: KV, CINETPAY_APIKEY: 'key', CINETPAY_SITE_ID: '123', ADMIN_SECRET: 'admin-test-secret-0123456789', SESSION_KEY: 's'.repeat(48), PRICE_XOF: '5000', PLAN_DAYS: '30', CURRENCY: 'XOF', SITE_URL: 'http://localhost:8770/kapa-trader/', ALLOWED_ORIGINS: 'http://localhost:8770', DERIV_API: 'https://api.derivws.com',
    OPEN_SOCKET: () => { const ls = []; return { addEventListener: (t, f) => ls.push(f), close() {}, send(raw) { const m = JSON.parse(raw); setTimeout(() => {
      const out = m.ticks_history ? { req_id: m.req_id, pip_size: 2, history: { prices: Array.from({ length: 100 }, () => +(1000 + Math.random() * 10).toFixed(2)) } }
        : { req_id: m.req_id, proposal: { ask_price: 10, payout: +(10 * (m.underlying_symbol === 'R_25' ? 0.9775 : 0.9765) / prob(m)).toFixed(2) } };
      ls.forEach((f) => f({ data: JSON.stringify(out) })); }, 5); } }; } };
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 400, height: 860 } });
  const errs = []; pg.on('pageerror', (e) => { if (!/^Event$|_\.Dd/.test(e.message)) errs.push(e.message); });
  const stats = { buys: [] }; const st = await mock.install(pg, { handler: trade(stats) });
  const payments = {}; const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    url = String(url);
    if (url.endsWith('/trading/v1/options/accounts')) { const t = String(init.headers?.authorization || '').replace('Bearer ', '');
      return new Response(JSON.stringify(st.tokens.has(t) ? { data: [{ account_id: 'DOT90002' }, { account_id: 'ROT90001' }] } : {}), { status: st.tokens.has(t) ? 200 : 401 }); }
    if (url.endsWith('/v2/payment')) { const body = JSON.parse(init.body); payments[body.transaction_id] = { status: 'PENDING', amount: String(body.amount), currency: body.currency, return_url: body.return_url };
      return new Response(JSON.stringify({ code: '201', data: { payment_url: `https://checkout.cinetpay.com/payment/${body.transaction_id}` } })); }
    if (url.endsWith('/v2/payment/check')) { const p = payments[JSON.parse(init.body).transaction_id]; return new Response(JSON.stringify({ code: '00', data: { status: p.status, amount: p.amount, currency: p.currency, payment_method: 'OMCIV2' } })); }
    return realFetch(url, init);
  };
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


  const ADMIN = 'admin-test-secret-0123456789';
  const W = +(process.env.W || 400);
  await pg.setViewportSize({ width: W, height: 860 });
  await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(3500);
  await pg.click('.kapa-login .kapa-btn'); await pg.waitForTimeout(6000); if (await pg.locator('.kapa-lock__free').isVisible().catch(() => false)) await pg.click('.kapa-lock__free'); await dismiss(pg);
  await openS(pg); await pg.waitForSelector('.kapa-premium__code', { timeout: 10000 }).catch(() => {});
  ok(await pg.locator('#kapa-premium-code').isVisible(), 'Premium card asks for the secret code');
  // no code set yet
  await pg.fill('#kapa-premium-code', 'SOMETHING-123'); await pg.click('.kapa-premium__code .kapa-btn'); await pg.waitForTimeout(800);
  ok(/not set up yet/i.test(await pg.textContent('.kapa-premium')), 'before the owner sets a code, unlocking is unavailable');
  // owner sets the code in Admin
  await closeS(pg); await pg.click('#id-admin'); await pg.waitForSelector('.kapa-admin__card--login input'); await pg.fill('.kapa-admin__card--login input', ADMIN); await pg.click('.kapa-admin__gold');
  await pg.waitForSelector('.kapa-admin__code');
  ok(/No code yet/.test(await pg.textContent('.kapa-admin')), 'Admin shows that no code is set');
  await pg.fill('.kapa-admin__code input[aria-label="New Premium code"]', 'Kapa Gold 2026'); await pg.fill('.kapa-admin__code input[aria-label="Confirm the new Premium code"]', 'kapa gold 2026');
  pg.once('dialog', (d) => d.accept()); await pg.click('.kapa-admin__code .kapa-admin__gold'); await pg.waitForTimeout(1000);
  ok(/New Premium code saved/.test(await pg.textContent('.kapa-admin')) && /A code is active since/.test(await pg.textContent('.kapa-admin')), 'owner saves the code from Admin');
  ok(!/kapa ?gold/i.test(await pg.textContent('.kapa-admin')), 'the code is not displayed afterwards');
  await pg.screenshot({ path: `c-${W}-admin.png`, fullPage: false });
  // owner unlocks Premium with the code
  await closeS(pg); await pg.click('#id-kapa-ai'); await pg.waitForTimeout(1500); await dismiss(pg);
  await openS(pg); await pg.fill('#kapa-premium-code', 'wrong code 999'); await pg.click('.kapa-premium__code .kapa-btn'); await pg.waitForTimeout(800);
  ok(/Wrong code/.test(await pg.textContent('.kapa-premium')), 'a wrong code is refused');
  await pg.fill('#kapa-premium-code', 'KAPAGOLD2026'); await pg.click('.kapa-premium__code .kapa-btn'); await pg.waitForTimeout(1200);
  ok(/Premium unlocked/.test(await pg.textContent('.kapa-premium')), 'the code unlocks Premium');
  ok(!/🔒/.test(await pg.textContent('.kapa-ring')), 'scanner unlocked');
  await pg.screenshot({ path: `c-${W}-unlocked.png` });
  await pg.reload(); await pg.waitForSelector('.kapa-card--main', { timeout: 20000 }); await pg.waitForTimeout(4000); await dismiss(pg);
  await openS(pg); ok(/Premium unlocked/.test(await pg.textContent('.kapa-premium')), 'Premium stays unlocked after reloading the page');
  // all Premium tools work
  await openS(pg); await pg.selectOption('.kapa-field:has-text("Strategy") select', 'pegasus');
  await closeS(pg); await pg.fill('.kapa-field:has-text("Take-profit") input', '2'); await openS(pg); await pg.fill('.kapa-field:has-text("Stake") input', '1'); await pg.fill('.kapa-field:has-text("Take-profit") input', '2'); await pg.fill('.kapa-field:has-text("Stop-loss") input', '30');
  await closeS(pg); if (await pg.locator('.kapa-ring').isDisabled()) { await pg.screenshot({ path: 'x/ring-disabled.png' }); console.log('HDR', await pg.textContent('header').catch(() => '')); }
  await pg.click('.kapa-ring'); await pg.waitForSelector('.kapa-sig', { timeout: 20000 });
  ok((await pg.locator('.kapa-sig').count()) === 3, 'server scan works with the code'); await pg.locator('.kapa-sig').first().scrollIntoViewIfNeeded(); await pg.screenshot({ path: 'x/sig-' + W + '.png' }); await openS(pg); await pg.locator('.kapa-plan').scrollIntoViewIfNeeded(); await pg.waitForTimeout(1500); await pg.screenshot({ path: 'x/plan-' + W + '.png' }); await closeS(pg);
  await pg.locator('.kapa-use').first().click(); await pg.waitForSelector('.kapa-modal__title'); await pg.waitForTimeout(700); await pg.screenshot({ path: 'x/m-' + W + '-activate.png' }); await pg.click('.kapa-modal .kapa-btn--gold');
  await pg.fill('.kapa-field:has-text("Take-profit") input', '2');
  await openS(pg); await pg.click('.kapa-link:has-text("advanced")'); await pg.fill('.kapa-field:has-text("Pause between") input', '0');
  await closeS(pg); const before = stats.buys.length; await pg.click('.kapa-runbtn');
  await pg.waitForSelector('.kapa-result', { timeout: 120000 }).catch(() => {}); await pg.waitForTimeout(1500); await pg.screenshot({ path: 'x/m-' + W + '-result.png' });
  ok(stats.buys.length > before && calls.some((c) => c.path === '/session/next' && c.status === 200), `Pegasus runs on the server (${stats.buys.length - before} trades)`);
  await pg.click('.kapa-btn--lime').catch(() => {});
  await closeS(pg); await pg.click('#id-free-bot'); await pg.waitForSelector('.free-bot__card'); ok((await pg.locator('.free-bot__load.locked').count()) === 0, 'Premium bots unlocked');
  // a buyer pays: payment recorded, Premium NOT unlocked by paying; the reference is shown
  const buyer = await b.newPage({ viewport: { width: W, height: 860 } });
  const st2 = await mock.install(buyer, { handler: trade({ buys: [] }) });
  st2.tokens = st.tokens; // same fake Deriv
  await buyer.route('https://kapa-premium.netlify.app/**', async (route) => { const r = route.request(); const res = await worker.fetch(new Request(r.url(), { method: r.method(), headers: r.headers(), body: ['GET', 'HEAD'].includes(r.method()) ? undefined : r.postDataBuffer() }), env); const h = {}; res.headers.forEach((v, k) => { h[k] = v; }); route.fulfill({ status: res.status, headers: h, body: Buffer.from(await res.arrayBuffer()) }); });
  await buyer.route('https://checkout.cinetpay.com/payment/**', (route) => { const tx = route.request().url().split('/').pop(); route.fulfill({ contentType: 'text/html', body: `<button id="pay" onclick="location.href='https://cinetpay-test.local/pay/${tx}'">Pay</button>` }); });
  await buyer.route('https://cinetpay-test.local/pay/**', async (route) => { const tx = route.request().url().split('/').pop(); payments[tx].status = 'ACCEPTED'; await worker.fetch(new Request('https://kapa-premium.netlify.app/cinetpay/notify', { method: 'POST', body: new URLSearchParams({ cpm_trans_id: tx }) }), env); route.fulfill({ contentType: 'text/html', body: `<script>location.href=${JSON.stringify(payments[tx].return_url)}</script>` }); });
  await buyer.goto('http://localhost:8770/kapa-trader/'); await buyer.waitForTimeout(3500); await buyer.click('.kapa-login .kapa-btn'); await buyer.waitForTimeout(6000); await dismiss(buyer);
  await openS(buyer); ok(await buyer.locator('#kapa-premium-code').isVisible(), 'another person (new device) sees Premium locked');
  await buyer.click('.kapa-premium__buy .kapa-btn'); await buyer.waitForURL(/checkout\.cinetpay\.com/, { timeout: 10000 }); await buyer.click('#pay');
  await buyer.waitForURL(/localhost:8770\/kapa-trader/, { timeout: 15000 }); await buyer.waitForTimeout(3000); await dismiss(buyer);
  await openS(buyer); await buyer.waitForFunction(() => /Payment confirmed/.test(document.querySelector('.kapa-premium')?.textContent || ''), null, { timeout: 25000 }).catch(() => {});
  const bt = await buyer.textContent('.kapa-premium');
  ok(/Payment confirmed.*kapa_[a-z0-9]+_[a-f0-9]{10}/.test(bt), 'after paying, the buyer sees the reference to send to Kapa');
  ok(await buyer.locator('#kapa-premium-code').isVisible(), 'paying alone does not unlock Premium');
  await buyer.screenshot({ path: `c-${W}-buyer-paid.png` });
  await buyer.fill('#kapa-premium-code', 'kapa-gold-2026'.replace(/-/g, '')); await buyer.click('.kapa-premium__code .kapa-btn'); await buyer.waitForTimeout(1200);
  ok(/Premium unlocked/.test(await buyer.textContent('.kapa-premium')), 'with the code the owner sends, the buyer unlocks Premium');
  // owner changes the code: everyone is locked out until they enter the new one
  await closeS(pg); await pg.click('#id-admin'); await pg.waitForSelector('.kapa-admin__code');
  ok(/kapa_[a-z0-9]+_[a-f0-9]{10}/.test(await pg.textContent('.kapa-admin__table')) && /paid/.test(await pg.textContent('.kapa-admin__table')), 'owner sees the paid payment and its reference in Admin');
  await pg.fill('.kapa-admin__code input[aria-label="New Premium code"]', 'NEW-CODE-777'); await pg.fill('.kapa-admin__code input[aria-label="Confirm the new Premium code"]', 'NEW-CODE-777');
  pg.once('dialog', (d) => d.accept()); await pg.click('.kapa-admin__code .kapa-admin__gold'); await pg.waitForTimeout(1000);
  await buyer.reload(); await buyer.waitForSelector('.kapa-card--main, .kapa-lock', { timeout: 20000 }); await buyer.waitForTimeout(4000); await dismiss(buyer);
  await openS(buyer); ok(await buyer.locator('#kapa-premium-code').isVisible(), 'after the code changes, the buyer is locked again');
  const hack = await buyer.evaluate(async () => { localStorage.setItem('kapa_premium_pass', 'eyJ2IjoxLCJ0eXAiOiJwYXNzIiwidmVyIjoieCIsImV4cCI6OTk5OTk5OTk5OTk5OX0.AAAA'); const r = await fetch('https://kapa-premium.netlify.app/bots/odd-oscars', { headers: { 'x-kapa-pass': localStorage.getItem('kapa_premium_pass') } }); return r.status; });
  ok(hack === 402, 'a forged pass written into the page is refused');
  await closeS(pg); await pg.click('#id-kapa-ai'); await pg.waitForTimeout(1500); await dismiss(pg);
  await openS(pg); await pg.click('.kapa-premium .kapa-link').catch(() => {}); await pg.waitForTimeout(600);
  await pg.fill('#kapa-premium-code', 'new code 777'); await pg.click('.kapa-premium__code .kapa-btn'); await pg.waitForTimeout(1200);
  ok(/Premium unlocked/.test(await pg.textContent('.kapa-premium')), 'the owner unlocks again with the new code');
  await pg.click('.kapa-premium .kapa-link:has-text("Lock")'); await pg.waitForTimeout(600);
  ok(await pg.locator('#kapa-premium-code').isVisible(), '"Lock on this device" locks Premium again');
  console.log('page errors:', errs.slice(0, 5)); console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); await b.close(); process.exit(0);
})();
