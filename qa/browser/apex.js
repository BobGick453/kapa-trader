// KAPA Apex in the fake Deriv with the default settings: Premium on the account, pick Apex, Start.
// The server runs every decision; no stake goes past the stop-loss.
const { chromium } = require('playwright'); const mock = require('./derivmock'); const trade = require('./trademock');
const P = require('./premium-env');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => {
  const S = await P.setup();
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: +(process.env.W || 400), height: 860 } });
  const stats = { buys: [] }; const st = await mock.install(pg, { handler: trade(stats) }); await S.attach(pg, st);
  const calls = S.calls;
  await S.admin('/admin/entitlements', { account: 'DOT90002' }); // owner switches Premium on for this account
  await P.login(pg);
  await pg.click('.kapa-gear'); await pg.waitForTimeout(800);
  ok(/Premium is active on your Deriv account/.test(await pg.textContent('.kapa-premium')), 'Premium switched on from Admin for this Deriv account');
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
