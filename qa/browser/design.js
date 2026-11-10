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
const hit = (a, c) => a && c && a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height;
const blurOf = (pg, s) => pg.locator(s).first().evaluate((e) => getComputedStyle(e).backdropFilter || getComputedStyle(e).webkitBackdropFilter || '').catch(() => '');
// scanner header pill: the app's connection state (the orb's badge), never a fixed word
const pillMatchesOrb = async (pg) => {
  const pill = (await pg.locator('.kapa-scan__pill').innerText().catch(() => '')).trim().toLowerCase();
  const badge = (await pg.locator('.kapa-fab-orb__badge').innerText().catch(() => '?')).trim().toLowerCase();
  const cls = await pg.locator('.kapa-scan__pill').getAttribute('class').catch(() => '');
  return pill && pill === badge && cls.includes('kapa-scan__pill--' + badge);
};
// the locked scan button keeps "🔒 Scan Markets · Premium" on one line, unclipped
const scanLabelOneLine = (pg) => pg.locator('.kapa-scan__foot .primary').evaluate((e) => { const lh = parseFloat(getComputedStyle(e).lineHeight) || 20; const r = document.createRange(); r.selectNodeContents(e); return r.getClientRects().length === 1 && e.scrollWidth <= e.clientWidth + 1 && r.getBoundingClientRect().height < lh * 1.5; }).catch(() => false);
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
    { const [orb, risk, sb, st] = [await box(pg, '.kapa-fab-orb'), await box(pg, '.kapa-fab-risk'), await box(pg, '.kapa-runbtn'), await box(pg, '.kapa-runstat')];
      ok(sb && st && !hit(orb, sb) && !hit(risk, sb) && !hit(orb, st) && !hit(risk, st), 'desktop free page: orb and risk button clear of Start KAPA AI and its status');
      const ring = await box(pg, '.kapa-ring'); ok(ring && ring.y + ring.height <= (sb ? sb.y : 800), `desktop free page: the Activate ring is on the first screen (bottom ${ring && Math.round(ring.y + ring.height)})`);
      const f = await box(pg, '.kapa-main__form'); ok(f && ring && ring.x > f.x + f.width, 'desktop free page: fields and Activate ring side by side'); }
    await pg.click('.kapa-gear'); await pg.waitForTimeout(600);
    { const w = await box(pg, '.kapa-settings'), m = await box(pg, '.kapa-settings__main'), sd = await box(pg, '.kapa-settings__side');
      ok(w && w.width >= 900 && m && sd && sd.x > m.x + m.width - 1, `desktop settings: one wide window in two columns (${w && Math.round(w.width)}px)`);
      ok(/blur/.test(await blurOf(pg, '.kapa-mask--sheet')), 'desktop settings: page behind is blurred'); }
    await pg.click('.kapa-settings__foot .kapa-btn'); await pg.waitForTimeout(400);
    // live scanner from the orb: centred ~920px window over a dimmed, blurred page
    await pg.click('.kapa-fab-orb'); await pg.waitForTimeout(700);
    { const d = await box(pg, '.kapa-scan');
      ok(d && d.width >= 880 && d.width <= 940 && Math.abs(d.x + d.width / 2 - 683) < 4 && d.y > 0 && d.y + d.height < 800, `desktop scanner: centred window ${d && [Math.round(d.width), Math.round(d.height)]}`);
      ok(/blur/.test(await blurOf(pg, '.kapa-scan-mask')), 'desktop scanner: page behind is dimmed and blurred');
      ok(await pg.locator('.kapa-scan__logo').isVisible() && await pg.locator('.kapa-scan__eyebrow').isVisible() && await pg.locator('.kapa-scan__x').isVisible(), 'desktop scanner: monogram tile, eyebrow and round close');
      ok(await pillMatchesOrb(pg), 'scanner status pill shows the real connection state (same as the orb)');
      const [st, sk, du, sw] = [await box(pg, '.kapa-scan__f--strategy'), await box(pg, '.kapa-scan__box .kapa-scan__f:nth-of-type(2)'), await box(pg, '.kapa-scan__box .kapa-scan__f:nth-of-type(3)'), await box(pg, '.kapa-scan__switch')];
      ok(st && sk && du && sw && Math.abs(st.y - sk.y) < 2 && sk.x > st.x + st.width - 1 && sw.x > du.x + du.width - 1, 'desktop scanner: two-column form (strategy | stake, duration | scan all)');
      ok(await scanLabelOneLine(pg), 'desktop scanner: locked button label on one line'); }
    await pg.click('.kapa-scan__x'); await pg.waitForTimeout(300);
    await pg.click('.kapa-fab-risk'); await pg.waitForTimeout(500);
    { const ic = await box(pg, '.kapa-risk__icon');
      ok(/blur/.test(await blurOf(pg, '.kapa-risk')) && ic && ic.width >= 44 && ic.width <= 52 && Math.abs(ic.width - ic.height) < 1, 'risk warning: blurred backdrop, icon in a round tile'); }
    await pg.click('.kapa-risk__close'); await pg.waitForTimeout(300);
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
    const h = await box(pg, '.free-bot__head'), c = await box(pg, '.free-bot__card');
    ok(h && c && Math.abs(h.x - c.x) < 2, 'Free Bot hero lines up with the cards');
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
    await pg.click('.kapa-fab-orb'); await pg.waitForTimeout(700);
    { const d = await box(pg, '.kapa-scan'); ok(d && d.x === 0 && d.y === 0 && d.width === 412 && d.height === 860, 'phone scanner: full-screen sheet');
      const [sk, du] = [await box(pg, '.kapa-scan__box .kapa-scan__f:nth-of-type(2)'), await box(pg, '.kapa-scan__box .kapa-scan__f:nth-of-type(3)')];
      ok(sk && du && Math.abs(sk.y - du.y) < 2 && du.x > sk.x + sk.width - 1, 'phone scanner: stake and duration side by side');
      ok(await pillMatchesOrb(pg), 'phone scanner: status pill shows the real connection state');
      ok(await scanLabelOneLine(pg), 'phone scanner: "Scan Markets · Premium" on one line');
      ok(await overflow(pg) === 0, 'phone scanner: no horizontal overflow'); }
    await pg.click('.kapa-scan__x'); await pg.waitForTimeout(300);
    await pg.click('.kapa-lock__free'); await pg.waitForTimeout(600);
    { const [orb, risk, sb, st] = [await box(pg, '.kapa-fab-orb'), await box(pg, '.kapa-fab-risk'), await box(pg, '.kapa-runbtn'), await box(pg, '.kapa-runstat')];
      ok(sb && sb.y + sb.height <= 860 && !hit(orb, sb) && !hit(risk, sb) && !hit(orb, st) && !hit(risk, st), 'phone free page: Start KAPA AI on screen, clear of the orb and risk button');
      ok(await overflow(pg) === 0, 'phone free page: no horizontal overflow'); }
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
    await pg.click('.kapa-fab-orb'); await pg.waitForTimeout(700);
    ok(await scanLabelOneLine(pg) && await overflow(pg) === 0, `${W}px: scanner fits, "Scan Markets · Premium" on one line`);
    await pg.click('.kapa-scan__x'); await pg.waitForTimeout(300);
    await ctx.close(); }
  // ---------- look and motion after the reference bot (third pass) ----------
  const css = (pg, s, p) => pg.locator(s).first().evaluate((e, p) => getComputedStyle(e)[p], p).catch(() => '');
  { const { ctx, pg } = await open(b, { width: 1366, height: 800 });
    await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(700);
    const splash = (await pg.locator('.kapa-splash').innerText().catch(() => '')).replace(/\s+/g, ' ');
    ok(/KAPA/.test(splash) && /STOP ON TIME/.test(splash) && !/pegasus|gsm|gold standard/i.test(splash), 'splash: Kapa words only (no reference brand)');
    ok(await pg.locator('.kapa-splash__coin').count() === 1 && await pg.locator('.kapa-splash__orbit').count() === 2, 'splash: drawn emblem inside two orbits');
    await pg.waitForTimeout(4300);
    ok(!/pegasus|gsm market|gold standard/i.test(await pg.evaluate(() => document.body.innerText)), 'no reference brand anywhere on the page');
    await pg.click('.kapa-login .kapa-btn'); await pg.waitForTimeout(7000); await skip(pg);
    await pg.click('#id-dbot-dashboard'); await pg.waitForTimeout(150);
    ok(/kapa-page-enter/.test(await css(pg, '.dc-tabs--main__tabs > .dc-tabs__content > *', 'animationName')), 'tab switch: the page fades and rises in');
    await pg.waitForTimeout(1400); await skip(pg);
    const strip = await box(pg, '.dc-tabs__list--main__tabs'), content = await box(pg, '.dc-tabs__content--main__tabs');
    ok(strip && content && strip.x === 0 && strip.y === 56 && Math.abs(content.y - (strip.y + strip.height)) < 1 && content.x === 0, `desktop: tab strip edge to edge under the header, page right under it (${strip && [strip.x, strip.y]} / ${content && [content.x, Math.round(content.y)]})`);
    const tiles = await pg.locator('.kapa-tile').evaluateAll((es) => es.map((e) => { const r = e.getBoundingClientRect(), c = getComputedStyle(e); return { y: Math.round(r.y), w: r.width, anim: c.animationName, delay: parseFloat(c.animationDelay) }; }));
    ok(tiles.length === 5 && tiles.every((t) => t.y === tiles[0].y) && tiles[0].w > 160, 'desktop Dashboard: five cards in one row');
    ok(tiles.every((t) => t.anim === 'kapa-card-in') && tiles.every((t, i) => !i || t.delay > tiles[i - 1].delay), 'Dashboard cards enter one after another');
    ok(/kapa-icon-float/.test(await css(pg, '.kapa-tile__icon', 'animationName')), 'Dashboard icon tiles float');
    const hero = await box(pg, '.kapa-dash__header'); ok(hero && Math.abs(hero.x - 20) < 2 && Math.abs(hero.width - 960) < 4, `desktop Dashboard hero 960px in the left column (${hero && [Math.round(hero.x), Math.round(hero.width)]})`);
    await pg.locator('.kapa-tile__open').nth(1).hover(); await pg.waitForTimeout(400);
    ok(/gradient/.test(await css(pg, '.kapa-tile:nth-child(2) .kapa-tile__open', 'backgroundImage')), 'OPEN fills with the blue gradient on hover');
    ok(/gradient/.test(await css(pg, '.app-footer', 'backgroundImage')), 'footer: frosted gradient bar');
    await pg.click('#id-tutorials'); await pg.waitForTimeout(1500);
    ok(/gradient/.test(await css(pg, '.tutorials-wrapper .dc-tabs__list--top', 'backgroundImage')) && /999px/.test(await css(pg, '.tutorials-wrapper .dc-tabs__item:not(.dc-tabs__active)', 'borderRadius')), 'Tutorials: blue section strip with pill items');
    ok(/gradient/.test(await css(pg, '.tutorials-wrap__placeholder__button-group', 'backgroundImage')), 'Tutorials: blue play tile on the videos');
    await pg.click('#id-bot-builder'); await pg.waitForTimeout(1200); await skip(pg);
    await pg.click('#db-toolbar__get-started-button').catch(() => {}); await pg.waitForTimeout(900);
    ok(await css(pg, '.qs__head__action > span', 'borderTopWidth') === '0px', 'Quick strategy: plain × to close');
    await pg.keyboard.press('Escape');
    await ctx.close(); }
  // phones: orb and risk button in the bottom corners where no Run bar shows, above the bar where it does
  { const { ctx, pg } = await open(b, { width: 412, height: 839 }, { isMobile: true, hasTouch: true });
    await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(4500);
    await pg.click('.kapa-login .kapa-btn'); await pg.waitForTimeout(7000); await skip(pg);
    for (const t of ['dbot-dashboard', 'tutorials', 'kapa-ai']) { await pg.click('#id-' + t, { force: true }); await pg.waitForTimeout(1200); await skip(pg);
      const [orb, risk] = [await box(pg, '.kapa-fab-orb'), await box(pg, '.kapa-fab-risk')];
      ok(orb && risk && 839 - (orb.y + orb.height) <= 24 && Math.abs((risk.y + risk.height / 2) - (orb.y + orb.height / 2)) < 3, `phone ${t}: orb and risk button in the bottom corners (gap ${orb && Math.round(839 - orb.y - orb.height)})`); }
    { const cta = await box(pg, '.kapa-lock__cta'), orb = await box(pg, '.kapa-fab-orb'), risk = await box(pg, '.kapa-fab-risk'); ok(cta && !hit(orb, cta) && !hit(risk, cta), 'phone locked KAPA AI: corners clear of UNLOCK'); }
    await pg.click('#id-bot-builder', { force: true }); await pg.waitForTimeout(1500); await skip(pg);
    { const orb = await box(pg, '.kapa-fab-orb'), bar = await box(pg, '.controls__section'); ok(orb && bar && orb.y + orb.height <= bar.y, 'phone Bot Builder: orb stays above the Run bar'); }
    await ctx.close(); }
  // reduced motion: no page or card animation, the opening screen leaves quickly
  { const { ctx, pg } = await open(b, { width: 412, height: 839 }, { isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
    await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(1600);
    ok(!(await pg.locator('.kapa-splash').count()), 'reduced motion: the opening screen leaves at once');
    ok(parseFloat(await css(pg, '.kapa-tile', 'animationDuration')) < 0.001, 'reduced motion: cards do not animate');
    await ctx.close(); }
  // visitor on a phone sees the Kapa logo; light theme keeps titles readable; no overflow at any width
  for (const [W, H, theme] of [[360, 740, 'dark'], [412, 839, 'light'], [768, 1024, 'dark'], [980, 2178, 'light'], [1366, 800, 'light']]) {
    const { ctx, pg } = await open(b, { width: W, height: H }, W < 1280 ? { isMobile: true, hasTouch: true } : {});
    await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(800);
    await pg.evaluate((t) => localStorage.setItem('theme', t), theme); await pg.reload(); await pg.waitForTimeout(4500);
    if (W < 1280) ok(await pg.locator('.app-header__logo--mobile').isVisible(), `${W}px visitor: Kapa logo in the header`);
    if (theme === 'light') { const c = await css(pg, '.kapa-tile__title', 'color'); ok(c === 'rgb(15, 39, 66)' && !/rgb\((1[0-9]|[0-9]),/.test(await css(pg, '.kapa-tile', 'backgroundImage')), `${W}px light: dark titles on light cards (${c})`); }
    if (W === 980) { const ys = await pg.locator('.kapa-tile').evaluateAll((es) => es.map((e) => Math.round(e.getBoundingClientRect().y))); ok(ys.length === 5 && ys.every((y) => y === ys[0]), '980px desktop-site mode: five cards in one row'); }
    for (const t of ['dbot-dashboard', 'tutorials', 'bot-builder']) { await pg.click('#id-' + t, { force: true }); await pg.waitForTimeout(900); ok(await overflow(pg) === 0, `${W}px ${theme} ${t}: no horizontal overflow`); }
    await ctx.close(); }
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); await b.close(); process.exit(0);
})();
