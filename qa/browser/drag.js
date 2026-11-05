const { chromium } = require('playwright'); const mock = require('./derivmock'); const trade = require('./trademock');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const dismiss = async (pg) => { for (let i = 0; i < 3; i++) { for (const t of ['Skip', 'Close']) { const b = pg.getByRole('button', { name: t, exact: true }).first(); if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); } await pg.keyboard.press('Escape').catch(() => {}); await pg.waitForTimeout(250); } };
(async () => { const b = await chromium.launch();
  for (const [W, H] of [[360, 740], [1366, 768]]) {
    const ctx = await b.newContext({ viewport: { width: W, height: H } }); const pg = await ctx.newPage();
    await mock.install(pg, { handler: trade({ buys: [] }) });
    await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(3800); await pg.click('.kapa-login .kapa-btn'); await pg.waitForTimeout(6000); await dismiss(pg);
    const box = async (s) => pg.locator(s).boundingBox();
    const o = await box('.kapa-fab-orb');
    // tap opens the scanner
    await pg.mouse.click(o.x + o.width / 2, o.y + o.height / 2); await pg.waitForTimeout(400);
    ok(await pg.locator('.kapa-scan').isVisible(), `${W}: a tap on the orb opens the scanner`);
    await pg.click('.kapa-scan__x'); await pg.waitForTimeout(300);
    // drag to the left/top
    await pg.mouse.move(o.x + o.width / 2, o.y + o.height / 2); await pg.mouse.down();
    for (let i = 1; i <= 10; i++) await pg.mouse.move(o.x + o.width / 2 - i * (W * 0.07), o.y + o.height / 2 - i * 25);
    await pg.mouse.up(); await pg.waitForTimeout(500);
    const o2 = await box('.kapa-fab-orb');
    ok(o2.x < W / 2 && o2.x <= 20 && o2.y < o.y - 150, `${W}: dragged orb snaps to the left edge (${Math.round(o2.x)},${Math.round(o2.y)})`);
    ok(!(await pg.locator('.kapa-scan').isVisible()), `${W}: dragging does not open the scanner`);
    await pg.click('#id-free-bot'); await pg.waitForTimeout(1000); await dismiss(pg);
    const o3 = await box('.kapa-fab-orb'); ok(Math.abs(o3.x - o2.x) < 2 && Math.abs(o3.y - o2.y) < 2, `${W}: orb stays where it was put on another tab`);
    await pg.reload(); await pg.waitForSelector('.kapa-fab-orb', { timeout: 20000 }); await pg.waitForTimeout(1500); await dismiss(pg);
    const o4 = await box('.kapa-fab-orb'); ok(Math.abs(o4.x - o2.x) < 3 && Math.abs(o4.y - o2.y) < 3, `${W}: and after reloading`);
    const r = await box('.kapa-fab-risk'); ok(r && r.y + r.height <= H && r.x >= 0, `${W}: risk button visible at ${Math.round(r.x)},${Math.round(r.y)} (${r.width}px)`);
    await pg.mouse.click(r.x + r.width / 2, r.y + r.height / 2); await pg.waitForTimeout(400); ok(await pg.locator('.kapa-risk__box').isVisible(), `${W}: tapping it opens the risk warning`);
    await pg.click('.kapa-risk__close');
    await pg.screenshot({ path: `audit/drag-${W}.png` });
    await ctx.close(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); await b.close(); process.exit(0); })();
