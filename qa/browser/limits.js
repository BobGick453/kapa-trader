// Free strategy trades the best-paid 50% contract; capital limits (25% per session, daily loss limit) hold
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
  // 1) stop-loss above 25% of the balance is refused
  await setSL(999999); await pg.click('.kapa-runbtn'); await pg.waitForTimeout(500);
  const e1 = await pg.textContent('.kapa-error').catch(() => '');
  ok(/at most 25% per session/.test(e1), 'a stop-loss above 25% of the balance is refused: ' + e1.slice(0, 120));
  // 2) a session runs on the best-paid 50% contract and stops at the stop-loss
  await setSL(10); await pg.click('.kapa-runbtn'); await pg.waitForSelector('.kapa-result', { timeout: 60000 });
  const types = [...new Set(stats.buys.map((x) => x.type || x.contract_type))];
  ok(stats.buys.length > 0, `session traded ${stats.buys.length} contracts`);
  const total = stats.buys.reduce((a, x) => a + x.stake, 0);
  ok(total <= 10.01, 'never staked more than the stop-loss allowed in a losing session: ' + total.toFixed(2));
  ok(types.length && types.every((t) => ['DIGITEVEN', 'DIGITODD', 'DIGITOVER', 'DIGITUNDER'].includes(t)) && stats.buys.every((x) => x.type.match(/EVEN|ODD/) || ['4', '5'].includes(String(x.barrier))), 'trades a 50% contract: ' + JSON.stringify(stats.buys.slice(0, 2)));
  await pg.locator('.kapa-modal .kapa-close').click().catch(() => {});
  // 3) the daily loss limit stops new sessions
  await pg.evaluate(() => { const k = Object.keys(localStorage).find((x) => x.startsWith('kapa_day_')); const d = JSON.parse(localStorage.getItem(k)); d.pl = -d.start; localStorage.setItem(k, JSON.stringify(d)); });
  await pg.click('.kapa-runbtn'); await pg.waitForTimeout(500);
  const e3 = await pg.textContent('.kapa-error').catch(() => '');
  ok(/loss limit .* is reached/.test(e3), 'daily loss limit pauses KAPA AI: ' + e3.slice(0, 120));
  await pg.screenshot({ path: 'x/limits-400.png' });
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close(); process.exit(0);
})();
