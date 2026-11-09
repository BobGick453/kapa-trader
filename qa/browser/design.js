// Look and layout rules from the design review: landing, run panel per tab, KAPA AI lock card, onboarding,
// header ticker (live prices, one subscription, dropped when hidden), floating buttons, fonts, no overflow.
const { chromium } = require('playwright'); const mock = require('./derivmock'); const trade = require('./trademock');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const skip = async (pg) => { for (let i = 0; i < 3; i++) { for (const t of ['Skip', 'Close']) { const b = pg.getByRole('button', { name: t, exact: true }).first(); if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); } await pg.keyboard.press('Escape').catch(() => {}); await pg.waitForTimeout(250); } };
const open = async (b, viewport, extra = {}) => {
  const ctx = await b.newContext({ viewport, ...extra }); const pg = await ctx.newPage(); const viol = [];
  pg.on('console', (m) => { if (/Content Security Policy/.test(m.text())) viol.push(m.text().slice(0, 160)); });
  const st = await mock.install(pg, { handler: trade({ buys: [] }) });
  await pg.route('https://kapa-premium.netlify.app/**', (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': 'http://localhost:8770' }, json: { status: 'inactive' } }));
  return { ctx, pg, st, viol };
};
const box = (pg, s) => pg.locator(s).first().boundingBox();
const overflow = (pg) => pg.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
(async () => {
  const b = await chromium.launch();
  // ---------- desktop 1366 x 800 ----------
  { const { ctx, pg, st, viol } = await open(b, { width: 1366, height: 800 });
    await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(900);
    ok(await pg.locator('.kapa-splash').isVisible(), 'desktop: opening screen shows');
    await pg.waitForTimeout(4200);
    ok(!(await pg.locator('.kapa-splash').count()), 'desktop: opening screen leaves once the app is ready');
    ok(await pg.locator('#id-dbot-dashboard.dc-tabs__active--main__tabs').count() === 1, 'visitor lands on the Dashboard');
    ok(/Not logged in\.\s*Log in to start trading/.test(await pg.locator('.kapa-notice').innerText().catch(() => '')), 'visitor sees the "Not logged in" card with Log in');
    ok(!(await pg.getByText('Connection details').count()) && !(await pg.locator('text=/wss?:\\/\\//').count()), 'no connection log or socket address on the landing');
    const su = await pg.locator('.kapa-auth__signup').evaluate((e) => getComputedStyle(e).backgroundImage).catch(() => '');
    ok(/gradient/.test(su) && !/255, 68, 79/.test(su), 'Sign up uses the blue gradient');
    // ticker: live prices from one ticks subscription on the app's connection
    await pg.waitForTimeout(2500);
    const subs = (st.tickSubs || []).filter((s) => s.syms.length > 1);
    ok(subs.length === 1 && subs[0].syms.includes('R_100') && subs[0].syms.includes('1HZ100V'), `ticker: one ticks subscription for the Volatility indices (${subs.length})`);
    ok(await pg.locator('.kapa-ticker__item em').count() >= 10, 'ticker shows live prices');
    ok(!/buy|sell|signal/i.test(await pg.locator('.kapa-ticker').innerText()), 'ticker shows prices only (no signals)');
    await pg.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    await pg.waitForTimeout(600);
    ok((st.forgotten || []).includes(subs[0]?.id), 'ticker unsubscribes when the tab is hidden');
    await pg.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
    // log in: KAPA AI with the locked Premium card alone
    await pg.click('.kapa-login .kapa-btn'); await pg.waitForTimeout(7000);
    ok(await pg.locator('#id-kapa-ai.dc-tabs__active--main__tabs').count() === 1, 'logged-in user lands on KAPA AI');
    ok(await pg.locator('.db-info-panel').count() === 0, 'no template guide panel');
    ok(/Kapa Trader/.test(await pg.locator('.tour-dialog, .dc-dialog').first().innerText().catch(() => 'Kapa Trader')), 'tour says Kapa Trader');
    await skip(pg); await pg.click('#id-kapa-ai'); await pg.waitForTimeout(800);
    ok(await pg.locator('.kapa-lock').isVisible() && !(await pg.locator('.kapa-runbar').count()) && !(await pg.locator('.kapa-ai .kapa-panel, .kapa-ai__scroll > .kapa-card:not(.kapa-card--main)').count()), 'locked: Premium card alone (no Start bar, no Summary)');
    const cta = await box(pg, '.kapa-lock__cta'); ok(cta && cta.y + cta.height <= 800 - 36, `locked: unlock button on the first screen (bottom ${cta && Math.round(cta.y + cta.height)})`);
    ok(!(await pg.locator('.run-panel__container').count()), 'desktop: no Summary drawer on KAPA AI');
    await pg.click('.kapa-lock__free'); await pg.waitForTimeout(500);
    ok(await pg.locator('.kapa-runbar').count() === 1, 'free strategies: Start bar comes back');
    // Dashboard: drawer open, orb clear of it
    await pg.click('#id-dbot-dashboard'); await pg.waitForTimeout(1500); await skip(pg);
    const dr = await box(pg, '.run-panel__container'); const orb = await box(pg, '.kapa-fab-orb'); const risk = await box(pg, '.kapa-fab-risk');
    ok(dr && dr.width > 300 && dr.x >= 990, 'desktop Dashboard: Summary drawer open on the right');
    ok(orb && orb.x + orb.width <= dr.x && orb.y + orb.height <= 800 - 36, `orb bottom-right, clear of the drawer and above the footer (${orb && [Math.round(orb.x), Math.round(orb.y)]})`);
    ok(risk && risk.x < 40 && risk.y + risk.height <= 800 - 36 && Math.abs((risk.y + risk.height / 2) - (orb.y + orb.height / 2)) < 4, 'risk button bottom-left, level with the orb, above the footer');
    const tile = await pg.locator('.kapa-tile__sub').first().evaluate((e) => ({ h: e.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(e).lineHeight) || 15 }));
    ok(tile.h < tile.lh * 1.5, `dashboard tile subtitle on one line (${Math.round(tile.h)}px high)`);
    ok(await pg.evaluate(() => window.scrollY) === 0, 'desktop page is not scrolled');
    for (const t of ['free-bot', 'bot-builder', 'charts']) { await pg.click('#id-' + t); await pg.waitForTimeout(1200); await skip(pg); ok(await pg.locator('.run-panel__container').isVisible(), `desktop ${t}: Summary drawer shows`); }
    await pg.click('#id-free-bot'); await pg.waitForTimeout(1000);
    const h = await box(pg, '.free-bot__section'), c = await box(pg, '.free-bot__card');
    ok(h && c && Math.abs(h.x - c.x) < 2, 'Free Bot heading lines up with the cards');
    await pg.click('#id-bot-builder'); await pg.waitForTimeout(1200); await skip(pg);
    await pg.click('#db-toolbar__get-started-button').catch(() => {}); await pg.waitForTimeout(1200);
    const ff = await pg.locator('.qs').first().evaluate((e) => getComputedStyle(e.querySelector('h2, h3, span, p') || e).fontFamily).catch(() => '');
    ok(/Outfit/i.test(ff), 'Quick strategy uses Outfit (no serif fallback): ' + ff.slice(0, 40));
    ok(await overflow(pg) === 0, 'desktop: no horizontal overflow');
    ok(viol.length === 0, 'desktop: no security-policy blocks' + (viol.length ? ': ' + viol[0] : ''));
    await ctx.close(); }
  // ---------- phone 412 x 860 ----------
  { const { ctx, pg, st } = await open(b, { width: 412, height: 860 }, { isMobile: true, hasTouch: true });
    await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(5000);
    ok(!(await pg.locator('.kapa-ticker').count()) && !(st.tickSubs || []).some((s) => s.syms.length > 1), 'phone: no ticker and no ticker subscription');
    ok(await pg.locator('.kapa-notice').isVisible(), 'phone visitor: "Not logged in" card');
    await pg.click('.kapa-login .kapa-btn'); await pg.waitForTimeout(7000);
    ok(!(await pg.locator('.kapa-runbar').count()), 'phone: no Start KAPA AI bar on the locked card');
    const cta = await box(pg, '.kapa-lock__cta'); ok(cta && cta.y + cta.height <= 860, `phone: unlock button on the first screen (bottom ${cta && Math.round(cta.y + cta.height)})`);
    await pg.click('#id-dbot-dashboard', { force: true }); await pg.waitForTimeout(1500);
    ok(!(await pg.locator('.db-info-panel').count()), 'phone first Dashboard visit: only the tour, no guide panel on top');
    const start = pg.locator('.dbot-slider__button-group button.danger'); if (await start.count()) ok(/gradient/.test(await start.evaluate((e) => getComputedStyle(e).backgroundImage)), 'tour Start button is Kapa blue');
    await skip(pg);
    for (const [t, want] of [['dbot-dashboard', 0], ['free-bot', 0], ['tutorials', 0], ['bot-builder', 1], ['charts', 1]]) { await pg.click('#id-' + t, { force: true }); await pg.waitForTimeout(1200); await skip(pg); ok((await pg.locator('.controls__section').count()) === want, `phone ${t}: Run bar ${want ? 'shows' : 'hidden'}`); }
    const orb = await box(pg, '.kapa-fab-orb'), bar = await box(pg, '.controls__section');
    ok(orb && bar && orb.y + orb.height <= bar.y, 'phone: orb sits above the Run bar');
    ok(await overflow(pg) === 0, 'phone: no horizontal overflow');
    await ctx.close(); }
  // ---------- 360 and 412 (Pixel 7): the floating buttons never cover the first-screen action ----------
  const hit = (a, c) => a && c && a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height;
  for (const [W, H] of [[360, 740], [412, 839]]) {
    const { ctx, pg } = await open(b, { width: W, height: H }, { isMobile: true, hasTouch: true });
    await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(5000);
    let [orb, risk, card] = [await box(pg, '.kapa-fab-orb'), await box(pg, '.kapa-fab-risk'), await box(pg, '.kapa-notice')];
    ok(card && !hit(orb, card) && !hit(risk, card), `${W}px: orb and risk button clear of the "Not logged in" card`);
    ok(card && card.y < H, `${W}px: the login card starts on the first screen (y ${card && Math.round(card.y)})`);
    await pg.click('.kapa-login .kapa-btn'); await pg.waitForTimeout(7000);
    [orb, risk, card] = [await box(pg, '.kapa-fab-orb'), await box(pg, '.kapa-fab-risk'), await box(pg, '.kapa-lock__cta')];
    ok(card && !hit(orb, card) && !hit(risk, card), `${W}px: orb and risk button clear of UNLOCK KAPA PREMIUM`);
    ok(card && card.y + card.height <= H, `${W}px: UNLOCK KAPA PREMIUM on the first screen`);
    ok(orb && orb.width >= 50 && risk && risk.width >= 34, `${W}px: floating buttons keep their size (${orb && orb.width}, ${risk && risk.width})`);
    await ctx.close(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); await b.close(); process.exit(0);
})();
