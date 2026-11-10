// Demo-only settlement check (KAPA AI settings → lab): refuses a real-money account without buying anything, runs on
// the demo account, gives CONFIRMED when equal exits are paid as wins and NOT CONFIRMED when they are paid as
// losses, and stops at a demo loss of 30. Fake Deriv only.
const { chromium } = require('playwright'); const mock = require('./derivmock'); const trade = require('./trademock');
const P = require('./premium-env');
const PORT = process.env.PORT || 8770;
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const text = async (pg, sel) => ((await pg.textContent(sel).catch(() => '')) || '').replace(/\s+/g, ' ').trim();
const open = async (b, stats, account) => {
  const pg = await b.newPage({ viewport: { width: +(process.env.W || 400), height: 860 } });
  await pg.addInitScript(() => localStorage.setItem('kapa_test_fast', '1'));
  await mock.install(pg, { handler: trade(stats) });
  await pg.route('https://kapa-premium.netlify.app/**', (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': `http://localhost:${PORT}` }, json: { status: 'inactive' } }));
  await pg.goto(`http://localhost:${PORT}/kapa-trader/`); await pg.waitForTimeout(3500);
  await pg.locator('.kapa-login .kapa-btn, .kapa-lock__login button').first().click(); await pg.waitForTimeout(6000); await P.dismiss(pg);
  if (account === 'real') { // switch to the real-money account in the header
    await pg.click('.acc-info__wrapper, .acc-info'); await pg.waitForTimeout(600); await pg.click('text=Real account'); await pg.waitForTimeout(6000); await P.dismiss(pg);
  }
  if (!(await pg.locator('.kapa-lock, .kapa-card--main').first().isVisible().catch(() => false))) { await pg.click('#id-kapa-ai'); await pg.waitForTimeout(1500); await P.dismiss(pg); }
  if (await pg.locator('.kapa-lock__free').isVisible().catch(() => false)) await pg.click('.kapa-lock__free');
  await P.openS(pg); await pg.locator('.kapa-check-settle').scrollIntoViewIfNeeded();
  pg.on('dialog', (d) => d.accept());
  return pg;
};
const runCheck = async (pg, ms = 240000) => { await pg.click('.kapa-check-settle__start'); await pg.waitForSelector('.kapa-check-settle__verdict', { timeout: ms }); await pg.locator('.kapa-check-settle__result').scrollIntoViewIfNeeded(); };
(async () => {
  const b = await chromium.launch();
  // 1) a real-money account: refused, nothing bought
  const sReal = { buys: [] }; const real = await open(b, sReal, 'real');
  const who = await real.evaluate(() => localStorage.getItem('active_loginid'));
  await real.click('.kapa-check-settle__start'); await real.waitForTimeout(1500);
  ok(/only runs on a demo account/.test(await text(real, '.kapa-check-settle .kapa-error')) && sReal.buys.length === 0, `a real-money account is refused and nothing is bought (${sReal.buys.length} buys; account ${who})`);
  await real.close();
  // 2) demo, equal exits paid as wins → CONFIRMED
  const sWin = { buys: [], settle: 'tie-win' }; const pg = await open(b, sWin);
  await runCheck(pg);
  const w = await text(pg, '.kapa-check-settle__result');
  ok(/^CONFIRMED/.test(w) && sWin.buys.filter((x) => x.type === 'CALLE').length === 100 && sWin.buys.filter((x) => x.type === 'DIGITMATCH').length === 50, `ties paid as wins: CONFIRMED after 100 CALLE + 50 DIGITMATCH (${sWin.buys.length} buys)`);
  ok(/Equal exits paid as wins\s*(\d+) of \1/.test(w) && /tick 2: 50/.test(w), 'the result shows the equal exits, how they were paid, and which tick settled the digit contracts: ' + w.slice(0, 160));
  ok(sWin.buys.every((x) => x.stake === 1 && x.sym === 'JD100'), 'every trade is a stake of 1 on JD100');
  await pg.screenshot({ path: 'x/settle-confirmed.png', fullPage: false });
  await pg.click('.kapa-check-settle__result button:has-text("Copy")'); await pg.waitForTimeout(300);
  ok(/Copied|Saved/.test(await text(pg, '.kapa-check-settle__result')), 'the records can be copied as CSV');
  await pg.close();
  // 3) demo, equal exits paid as losses → NOT CONFIRMED
  const sLose = { buys: [], settle: 'tie-lose' }; const pg2 = await open(b, sLose);
  await runCheck(pg2);
  const l = await text(pg2, '.kapa-check-settle__result');
  ok(/^NOT CONFIRMED/.test(l) && /Equal exits paid as wins\s*0 of [1-9]/.test(l), 'ties paid as losses: NOT CONFIRMED: ' + l.slice(0, 120));
  await pg2.screenshot({ path: 'x/settle-not-confirmed.png', fullPage: false });
  await pg2.close();
  // 4) every trade lost → stops at a demo loss of 30
  const sAll = { buys: [], settle: 'lose-all' }; const pg3 = await open(b, sAll);
  await runCheck(pg3);
  const a = await text(pg3, '.kapa-check-settle__result');
  ok(sAll.buys.length === 30 && /demo loss reached 30/.test(a) && /-30\.00/.test(a), `stops at a demo loss of 30 (${sAll.buys.length} buys): ${a.slice(0, 80)}`);
  await pg3.screenshot({ path: 'x/settle-stopped.png', fullPage: false });
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); await b.close(); process.exit(0);
})();
