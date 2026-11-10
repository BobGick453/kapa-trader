// Free Bot → "Run in KAPA AI" for each classic bot: the strategy loads and trades with its own contracts
const { chromium } = require('playwright'); const mock = require('./derivmock'); const trade = require('./trademock');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 400, height: 860 } });
  const stats = { buys: [] };
  await mock.install(pg, { handler: trade(stats) });
  await pg.route('https://kapa-premium.netlify.app/**', (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': 'http://localhost:8770' }, json: { status: 'inactive' } }));
  await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(4500); await pg.click('.kapa-login .kapa-btn'); await pg.waitForTimeout(6000);
  for (const t of ['Skip', 'Close']) { const x = pg.getByRole('button', { name: t, exact: true }).first(); if (await x.isVisible().catch(() => false)) await x.click().catch(() => {}); }
  const expect = { switcher: /DIGIT(UNDER|OVER)/, printer: /DIGITOVER/, goldoe: /DIGIT(EVEN|ODD)/, profitmaker: /DIGITOVER|DIGITUNDER|DIGIT(EVEN|ODD)/ };
  const names = { switcher: 'Digit Switcher Bot (1)', printer: 'Dollar Printer (1)', goldoe: 'Gold Premium Odd And Even', profitmaker: 'Profit Maker Bot (1)' };
  let shot = false;
  for (const key of Object.keys(names)) {
    await pg.click('#id-free-bot'); await pg.waitForTimeout(800);
    if (!shot) { await pg.locator('.free-bot__grid').first().scrollIntoViewIfNeeded(); await pg.screenshot({ path: 'x/freebot-classic.png' }); shot = true; }
    await pg.locator('.free-bot__card', { hasText: names[key] }).locator('.free-bot__btn--ai').first().click();
    await pg.waitForTimeout(1500);
    const msg = await pg.textContent('.kapa-scanmsg').catch(() => '');
    ok(/loaded from Free Bot/.test(msg), `${names[key]}: opens KAPA AI with the bot loaded`);
    const before = stats.buys.length;
    await pg.click('.kapa-runbtn'); await pg.waitForTimeout(12000);
    if (await pg.locator('.kapa-runbtn--stop, .kapa-runbtn:has-text("Stop")').isVisible().catch(() => false)) { await pg.click('.kapa-runbtn'); await pg.waitForTimeout(3000); }
    const mine = stats.buys.slice(before);
    ok(mine.length > 0 && expect[key].test(mine[0].type), `${names[key]}: traded ${mine.length} contracts: ${[...new Set(mine.map((x) => x.type + (x.barrier ? ' ' + x.barrier : '')))].join(', ')}`);
    ok(mine.every((x) => x.stake <= 50.01), `${names[key]}: no stake above the stop-loss (max ${Math.max(0, ...mine.map((x) => x.stake))})`);
    await pg.locator('.kapa-modal .kapa-close').click().catch(() => {});
  }
  const err = await pg.textContent('.kapa-error').catch(() => '');
  console.log('last error', (err || '').slice(0, 120));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close(); process.exit(0);
})();
