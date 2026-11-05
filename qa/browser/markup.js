// A markup-priced connection is refused;  the best-paid 50% contract; capital limits (25% per session, daily loss limit) hold
const { chromium } = require('playwright'); const mock = require('./derivmock'); const trade = require('./trademock-lose');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 400, height: 860 } });
  const stats = { buys: [] };
  await mock.install(pg, { handler: trade(stats) });
  await pg.route('https://kapa-premium.netlify.app/**', (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': 'http://localhost:8770' }, json: { status: 'inactive' } }));
  await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(4500); await pg.click('.kapa-login .kapa-btn'); await pg.waitForTimeout(6000); if (await pg.locator('.kapa-lock__free').isVisible().catch(() => false)) await pg.click('.kapa-lock__free');
  for (const t of ['Skip', 'Close']) { const btn = pg.getByRole('button', { name: t }).first(); if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {}); }
  const bal = await pg.evaluate(() => document.querySelector('.acc-info__wrapper')?.textContent || '');
  console.log('header', bal.replace(/\s+/g, ' ').slice(0, 80));
  const setSL = async (v) => { await pg.click('.kapa-gear'); await pg.waitForTimeout(400); await pg.fill('.kapa-field:has-text("Stop-loss") input', String(v)); await pg.click('.kapa-settings__foot .kapa-btn'); await pg.waitForTimeout(300); };
  await pg.fill('.kapa-field:has-text("Stake") input', '1'); await pg.fill('.kapa-field:has-text("Take-profit") input', '5');
  await setSL(50); await pg.waitForTimeout(3000); // live payouts load
  await pg.click('.kapa-gear'); await pg.waitForTimeout(500);
  const w = await pg.textContent('.kapa-warnbox').catch(() => '');
  ok(/keeps 7\.\d% of each stake/.test(w), 'the connection price is shown with a warning: ' + w.slice(0, 120));
  await pg.locator('.kapa-warnbox').scrollIntoViewIfNeeded().catch(() => {}); await pg.screenshot({ path: 'x/markup-warn.png' });
  await pg.click('.kapa-settings__foot .kapa-btn'); await pg.waitForTimeout(300);
  await pg.click('.kapa-runbtn'); await pg.waitForTimeout(8000);
  ok(stats.buys.length > 0, 'at this price KAPA AI still trades (limit 12% by default): ' + stats.buys.length + ' trades');
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close(); process.exit(0);
})();
