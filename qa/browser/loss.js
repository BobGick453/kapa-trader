const { chromium } = require('playwright'); const mock = require('./derivmock'); const trade = require('./trademock-lose');
(async () => { const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 400, height: 860 } });
  await mock.install(pg, { handler: trade({ buys: [] }) });
  await pg.route('https://kapa-premium.netlify.app/**', (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': 'http://localhost:8770' }, json: { status: 'inactive' } }));
  await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(4500); await pg.click('.kapa-login .kapa-btn'); await pg.waitForTimeout(6000); if (await pg.locator('.kapa-lock__free').isVisible().catch(() => false)) await pg.click('.kapa-lock__free');
  for (const t of ['Skip', 'Close']) { const btn = pg.getByRole('button', { name: t }).first(); if (await btn.isVisible().catch(() => false)) await btn.click().catch(() => {}); }
  await pg.fill('.kapa-field:has-text("Stake") input', '1'); await pg.fill('.kapa-field:has-text("Take-profit") input', '5'); await pg.click('.kapa-gear'); await pg.waitForTimeout(500); await pg.fill('.kapa-field:has-text("Stop-loss") input', '10'); await pg.click('.kapa-settings__foot .kapa-btn'); await pg.waitForTimeout(400);
  await pg.click('.kapa-runbtn'); await pg.waitForSelector('.kapa-result', { timeout: 60000 }); await pg.waitForTimeout(2500);
  console.log('VIDEO', JSON.stringify(await pg.evaluate(() => { const v = document.querySelector('.kapa-result__media video'); return v && { src: v.currentSrc.split('/').pop(), paused: v.paused, ready: v.readyState }; })), await pg.textContent('.kapa-result__tag'));
  await pg.screenshot({ path: 'art-400-loss.png' }); await b.close(); process.exit(0); })();
