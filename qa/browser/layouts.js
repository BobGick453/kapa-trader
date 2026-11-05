const { chromium, devices } = require('playwright'); const mock = require('./derivmock'); const trade = require('./trademock');
(async () => {
  const b = await chromium.launch();
  for (const [tag, opts] of [['phone', { ...devices['Pixel 7'] }], ['desktopmode', { viewport: { width: 980, height: 2000 }, deviceScaleFactor: 1, isMobile: true, hasTouch: true }]]) {
    const ctx = await b.newContext(opts); const pg = await ctx.newPage();
    await mock.install(pg, { handler: trade({ buys: [] }) });
    await pg.route('https://kapa-premium.netlify.app/**', (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': 'http://localhost:8770' }, json: { status: 'inactive' } }));
    await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(4500); await pg.click('.kapa-login .kapa-btn'); await pg.waitForTimeout(6000);
    const skip = async () => { for (let i = 0; i < 2; i++) for (const t of ['Skip', 'Close']) { const x = pg.getByRole('button', { name: t, exact: true }).first(); if (await x.isVisible().catch(() => false)) await x.click().catch(() => {}); } };
    await skip(); console.log(tag, 'width', await pg.evaluate(() => document.documentElement.clientWidth));
    await pg.screenshot({ path: `x/L-${tag}-kapa.png` });
    await pg.click('#id-dbot-dashboard'); await pg.waitForTimeout(1200); await skip(); await pg.keyboard.press('Escape'); await pg.screenshot({ path: `x/L-${tag}-dash.png` });
    await pg.click('#id-free-bot').catch(() => {}); await pg.waitForTimeout(1200); await skip(); await pg.screenshot({ path: `x/L-${tag}-free.png` });
    await ctx.close();
  }
  await b.close();
})();
