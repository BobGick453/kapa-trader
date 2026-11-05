const { chromium } = require('playwright'); const mock = require('./derivmock'); const trade = require('./trademock');
const ok = (c, m) => console.log((c ? 'PASS ' : 'FAIL ') + m);
const dismiss = async (pg) => {
  for (let i = 0; i < 3; i++) {
    for (const t of ['Skip', 'Close']) { const b = pg.getByRole('button', { name: t, exact: true }).first(); if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); }
    const x = pg.locator('#modal_root .dc-dialog__header--close, #modal_root [class*="close"]').first(); if (await x.isVisible().catch(() => false)) await x.click().catch(() => {});
    await pg.keyboard.press('Escape').catch(() => {}); await pg.waitForTimeout(300);
  }
};
(async () => {
  const W = +(process.env.W || 400), H = +(process.env.H || 860), tag = `${W}`;
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: W, height: H } });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message)); pg.on('console', (m) => { if (m.type() === 'error' && /Error|error/.test(m.text()) && !/Failed to load|WebSocket|DerivAPI|contracts_for|trading times/i.test(m.text())) console.log('CONSOLE', m.text().slice(0, 400)); });
  const st = await mock.install(pg, { handler: trade({ buys: [] }) });
  await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(900);
  ok(await pg.locator('.kapa-splash').isVisible(), 'splash shows on load'); await pg.screenshot({ path: `u${tag}-1-splash.png` });
  await pg.waitForTimeout(2600); ok(!(await pg.locator('.kapa-splash').count()), 'splash goes away');
  await pg.click('.kapa-login .kapa-btn'); await pg.waitForTimeout(6000); await dismiss(pg);
  const order = await pg.$$eval('.dc-tabs__list--main__tabs > li', (lis) => lis.map((li) => ({ id: li.id, o: +getComputedStyle(li).order })).sort((a, b) => a.o - b.o).map((x) => x.id).join(' > '));
  ok(order === 'id-admin > id-kapa-ai > id-dbot-dashboard > id-bot-builder > id-free-bot > id-charts > id-tutorials', 'tab order: ' + order);
  ok(await pg.locator('.kapa-fab-orb--live').isVisible(), 'orb shows LIVE once connected');
  await pg.screenshot({ path: `u${tag}-2-kapa.png` });
  await pg.click('#id-dbot-dashboard'); await pg.waitForTimeout(800); await dismiss(pg); await pg.screenshot({ path: `u${tag}-3-dashboard.png` });
  ok((await pg.locator('.kapa-tile').count()) === 5 && (await pg.locator('.kapa-social a').count()) === 2, 'dashboard: 5 accent cards + WhatsApp/Telegram');
  await dismiss(pg); await pg.click('.kapa-fab-risk'); await pg.waitForSelector('.kapa-risk__box'); await pg.screenshot({ path: `u${tag}-4-risk.png` }); await pg.click('.kapa-risk__close');
  await pg.click('.kapa-fab-orb'); await pg.waitForSelector('.kapa-scan'); await pg.screenshot({ path: `u${tag}-5-scanner.png` });
  ok(/🔒 Scan Markets · Premium/.test(await pg.textContent('.kapa-scan__foot .primary')), 'orb scanner is a Premium tool');
  await pg.click('.kapa-scan__foot .primary'); await pg.waitForTimeout(800); ok((await pg.locator('.kapa-scan').count()) === 0 && await pg.locator('.kapa-ai').isVisible(), 'locked scan opens the Premium offer');
  await dismiss(pg); await pg.click('#id-free-bot'); await pg.waitForSelector('.free-bot__card', { timeout: 10000 }).catch(async () => { await pg.screenshot({ path: 'fail-freebot.png' }); }); await pg.screenshot({ path: `u${tag}-7-library.png` });
  ok((await pg.locator('.free-bot__card').count()) === 9 && (await pg.locator('.free-bot__load.locked').count()) === 2, 'library shows 4 classic + 5 Bot Builder bots, 2 Premium locked');
  await pg.click('.free-bot__filters button:has-text("Even/Odd")'); ok((await pg.locator('.free-bot__card').count()) === 8, 'Even/Odd filter shows 4 classic + 4 bots'); await pg.click('.free-bot__filters button:has-text("All")');
  await pg.locator('.free-bot__card', { hasText: 'Under 5 Recovery' }).locator('.free-bot__load').click(); await pg.waitForTimeout(3500);
  const ws = await pg.evaluate(() => { const x = window.Blockly?.Xml?.domToText(window.Blockly.Xml.workspaceToDom(window.Blockly.derivWorkspace)) || ''; const f = (n) => (x.match(new RegExp(`<field name="${n}">([^<]*)</field>`)) || [])[1]; return { sym: f('SYMBOL_LIST'), purchase: f('PURCHASE_LIST'), tt: f('TRADETYPE_LIST'), pred: (/<value name="PREDICTION">[\s\S]*?<field name="NUM">([^<]*)/.exec(x) || [])[1], hasSize: [...x.matchAll(/<field name="NUM">([^<]*)<\/field>/g)].some((m) => m[1] === '2.1'), hasMax: [...x.matchAll(/<field name="NUM">([^<]*)<\/field>/g)].some((m) => m[1] === '9.3'), hasLoss: [...x.matchAll(/<field name="NUM">([^<]*)<\/field>/g)].some((m) => m[1] === '16.7') }; });
  ok(ws.sym === 'R_100' && ws.purchase === 'DIGITUNDER' && ws.tt === 'overunder' && ws.pred === '5' && ws.hasSize && ws.hasMax && ws.hasLoss, 'Load Bot puts Under 5 ×2.1, max stake 9.3, loss limit 16.7 on R_100 into Bot Builder: ' + JSON.stringify(ws));
  await pg.screenshot({ path: `u${tag}-8-builder.png` });
  await dismiss(pg); await pg.click('#id-admin'); await pg.waitForTimeout(600); await pg.screenshot({ path: `u${tag}-9-admin.png` });
  ok(await pg.locator('.kapa-admin').isVisible(), 'admin page shows');
  console.log('page errors:', errs.filter((e) => !/^Event$|_\.Dd/.test(e)).slice(0, 5)); await b.close(); process.exit(0);
})();
