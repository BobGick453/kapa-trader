// KAPA AI sessions: they keep running on other tabs (with Stop next to the orb), every stop says why (run bar
// and result window), a double tap on Start doesn't stop, the scanner's "Use" keeps the user's strategy, the
// protection limits are visible to everyone, and the classic bots' KAPA Apex recovery runs on the server.
const { chromium } = require('playwright'); const mock = require('./derivmock'); const trade = require('./trademock');
const P = require('./premium-env');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const text = async (pg, sel) => ((await pg.textContent(sel).catch(() => '')) || '').replace(/\s+/g, ' ').trim();
const waitIdle = async (pg, ms = 60000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (/Start KAPA AI/.test(await text(pg, '.kapa-runbtn'))) return true; await pg.waitForTimeout(250); } return false; };
// Contracts alternate won / lost (the fake Deriv draws with Math.random): no long losing run ends a session early
let flip = 0; let seed = 12345; Math.random = () => (flip++ % 2 ? 0.25 : 0.75) + (seed = (seed * 16807) % 2147483647) / 2147483647 / 1000; // long decimals: ids stay unique
(async () => {
  const S = await P.setup();
  const W = +(process.env.W || 400);
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: W, height: 860 } });
  const stats = { buys: [] }; const st = await mock.install(pg, { handler: trade(stats) }); await S.attach(pg, st);
  await P.login(pg);
  // ---- free user: protection limits visible, can lower, can't raise; Apex recovery is Premium ----
  await P.openS(pg);
  ok(await pg.locator('.kapa-field:has-text("Daily loss limit") input').isVisible() && await pg.locator('.kapa-field:has-text("Maximum Deriv margin") input').isVisible(), 'free users see the daily loss limit and the maximum Deriv margin');
  ok(/00:00 GMT/.test(await text(pg, '.kapa-field:has-text("Daily loss limit")')), 'the daily limit says when the day resets (00:00 GMT)');
  await pg.fill('.kapa-field:has-text("Daily loss limit") input', '45'); await P.closeS(pg); await pg.click('.kapa-runbtn'); await pg.waitForTimeout(500);
  ok(/only Premium can set it above 30%/.test(await text(pg, '.kapa-error')), 'a free user cannot raise the daily limit: ' + (await text(pg, '.kapa-error')).slice(0, 90));
  await P.openS(pg); await pg.fill('.kapa-field:has-text("Daily loss limit") input', '10'); await pg.fill('.kapa-field:has-text("Maximum Deriv margin") input', '6');
  await pg.click('.kapa-link:has-text("advanced")').catch(() => {}); await P.closeS(pg);
  // ---- a session keeps running on another tab, with Stop next to the orb ----
  await pg.fill('.kapa-field:has-text("Stake") input', '1'); await pg.fill('.kapa-field:has-text("Take-profit") input', '500');
  const b0 = stats.buys.length; await pg.dblclick('.kapa-runbtn'); await pg.waitForTimeout(2500);
  ok(/Stop/.test(await text(pg, '.kapa-runbtn')) && stats.buys.length > b0, 'a double tap on Start starts the session and does not stop it');
  await pg.click('#id-charts, #id-chart').catch(() => pg.click('text=Charts')); await pg.waitForSelector('.kapa-runchip', { timeout: 4000 }).catch(() => {});
  ok(await pg.locator('.kapa-runchip').isVisible() && /KAPA AI running/.test(await text(pg, '.kapa-runchip')), 'a "KAPA AI running" chip with Stop shows next to the orb on other tabs');
  const onCharts = stats.buys.length; await pg.waitForTimeout(5000);
  ok(stats.buys.length > onCharts, `on the Charts tab the session keeps trading (${stats.buys.length - onCharts} trades in 5 s)`);
  if (!(await pg.locator('.kapa-runchip').isVisible())) { await pg.click('#id-kapa-ai'); await pg.waitForTimeout(800); console.log('session ended early:', await text(pg, '.kapa-runstat')); }
  await pg.screenshot({ path: `x/run-chip-${W}.png` });
  await pg.click('.kapa-runchip__stop'); await pg.waitForTimeout(3000);
  ok(!(await pg.locator('.kapa-runchip').isVisible()), 'Stop from the chip ends the session');
  await pg.click('#id-kapa-ai'); await pg.waitForTimeout(1200);
  const stopRes = await text(pg, '.kapa-result');
  ok((await pg.locator('.kapa-result').isVisible()) && /STOPPED BY YOU/.test(stopRes), 'back on KAPA AI: the result window says "STOPPED BY YOU"');
  const amt = (+((stopRes.match(/([\d.]+) USD/) || [])[1] || 0)) * (/loss of/.test(stopRes) ? -1 : 1);
  await pg.click('.kapa-btn--lime');
  ok(/STOPPED BY YOU/.test(await text(pg, '.kapa-runstat')), 'and the run bar keeps the reason: ' + (await text(pg, '.kapa-runstat')).slice(0, 60));
  await pg.locator('.kapa-segs button:has-text("Transactions")').first().dispatchEvent('click'); await pg.waitForTimeout(300);
  ok((await pg.locator('.kapa-tx__row').count()) >= stats.buys.length - b0 - 1, `the trades made while on Charts are kept (${await pg.locator('.kapa-tx__row').count()} listed)`);
  const day = await pg.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('kapa_day_')).map(([, v]) => JSON.parse(v))[0]);
  ok(day && Math.abs(day.pl - amt) < 0.011, `today's loss record holds the session's result once (${day && day.pl} vs ${amt})`);
  // ---- the scanner's "Use" keeps the strategy; Apex recovery needs Premium ----
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('kapa:use-market', { detail: { symbol: 'R_25', ratios: {}, source: 'scanner' } })));
  await pg.waitForTimeout(600);
  ok(/Volatility 25 Index loaded from the Live Scanner\. Your strategy is unchanged/.test(await text(pg, '.kapa-scanmsg')), 'a market from the scanner keeps the chosen strategy');
  await pg.evaluate(() => window.dispatchEvent(new CustomEvent('kapa:use-market', { detail: { symbol: 'R_100', preset: 'printer', apexRecovery: true } })));
  await pg.waitForTimeout(800);
  await pg.click('.kapa-runbtn'); await pg.waitForTimeout(700);
  ok(/KAPA Apex recovery is part of KAPA AI Premium/.test(await text(pg, '.kapa-error')), 'a classic bot with Apex recovery asks for Premium on a free account');
  await P.closeS(pg);
  // ---- Premium: classic bot + Apex recovery on the server; stop reasons ----
  await S.admin('/admin/entitlements', { account: 'DOT90002' });
  await pg.reload(); await pg.waitForSelector('.kapa-card--main, .kapa-lock', { timeout: 20000 }); await pg.waitForTimeout(4000); await P.dismiss(pg);
  await P.openS(pg);
  await pg.waitForFunction(() => /Premium is active/.test(document.querySelector('.kapa-premium')?.textContent || ''), null, { timeout: 15000 }).catch(() => {});
  await pg.screenshot({ path: `x/run-apexopt-${W}.png` });
  ok(await pg.locator('.kapa-check input').isChecked({ timeout: 5000 }).catch(() => false), 'the bot loaded with "KAPA Apex recovery" stays on once Premium is active');
  await pg.click('.kapa-link:has-text("advanced")'); await pg.fill('.kapa-field:has-text("Pause between") input', '0'); await P.closeS(pg);
  await pg.fill('.kapa-field:has-text("Take-profit") input', '3');
  const c0 = S.calls.length; const bb = stats.buys.length; await pg.click('.kapa-runbtn'); await waitIdle(pg, 120000); await pg.waitForTimeout(800);
  const rec = S.calls.slice(c0).filter((c) => c.path === '/classic/recover');
  ok(stats.buys.length > bb, `the classic bot traded (${stats.buys.length - bb} trades, ${rec.length} recovery trades asked from the server, all ${rec.every((c) => c.status === 200) ? 'answered' : 'NOT answered'})`);
  ok(rec.every((c) => c.status === 200), 'every recovery trade came from the server (Premium)');
  const res = await text(pg, '.kapa-result');
  ok(/PROFIT TARGET REACHED|STOP-LOSS REACHED|RECOVERY CYCLE USED UP/.test(res), 'the session ends with a result: ' + res.slice(0, 60));
  await pg.click('.kapa-btn--lime').catch(() => {});
  // max trades: "SESSION FINISHED" with the reason
  await P.openS(pg); await pg.selectOption('.kapa-field:has-text("Strategy") select', 'fixed'); await pg.fill('.kapa-field:has-text("Max trades") input', '2'); await P.closeS(pg);
  await pg.fill('.kapa-field:has-text("Take-profit") input', '500');
  await pg.click('.kapa-runbtn'); await waitIdle(pg); await pg.waitForTimeout(800);
  ok(/SESSION FINISHED/.test(await text(pg, '.kapa-result')) && /Finished 2 trades/.test(await text(pg, '.kapa-result')), 'max trades: the window says "SESSION FINISHED · Finished 2 trades"');
  await pg.screenshot({ path: `x/run-finished-${W}.png` });
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); await b.close(); process.exit(0);
})();
