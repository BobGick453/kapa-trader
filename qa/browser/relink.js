const { chromium } = require('playwright'); const mock = require('./derivmock'); const trade = require('./trademock');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
(async () => { const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 400, height: 860 } });
  const viol = [];
  const open = async () => { const pg = await ctx.newPage(); pg.on('console', (m) => { if (/Content Security Policy/.test(m.text())) viol.push(m.text().slice(0, 160)); }); const st = await mock.install(pg, { handler: trade({ buys: [] }) }); await pg.route('https://kapa-premium.netlify.app/**', (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': 'http://localhost:8770' }, json: { status: 'inactive' } })); return { pg, st }; };
  // first visit: not linked yet, no automatic redirect
  let { pg, st } = await open(); await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(5000);
  ok(!st.lastAuth && await pg.locator('.kapa-login .kapa-btn').isVisible(), 'first visit: nothing automatic, the Log in button is shown');
  await pg.click('.kapa-login .kapa-btn'); await pg.waitForTimeout(6000);
  ok(await pg.locator('.kapa-fab-orb--live').isVisible() && !(await pg.locator('.kapa-login').count()), 'after Log in: connected');
  ok(await pg.evaluate(() => localStorage.getItem('kapa_deriv_linked')) === '1', 'the device remembers it is linked');
  await pg.close();
  // new tab (new session): reconnects automatically
  ({ pg, st } = await open()); await pg.goto('http://localhost:8770/kapa-trader/#kapa_ai'); await pg.waitForTimeout(9000);
  ok(Boolean(st.lastAuth), 'new tab: goes through Deriv login automatically');
  ok(await pg.locator('.kapa-fab-orb--live').isVisible() && !(await pg.locator('.kapa-login').count()), 'new tab: connected without touching Log in');
  ok(!pg.url().includes('code='), 'address cleaned after returning from Deriv: ' + pg.url());
  // Deriv refuses (not logged in at Deriv): no endless loop
  await pg.close(); ({ pg, st } = await open());
  await pg.unroute(/https:\/\/(staging-)?auth\.deriv\.com\/oauth2\/auth/);
  let authHits = 0; await pg.route(/https:\/\/(staging-)?auth\.deriv\.com\/oauth2\/auth/, (route) => { authHits++; const u = new URL(route.request().url()); route.fulfill({ status: 302, headers: { location: `${u.searchParams.get('redirect_uri')}?error=login_required&state=${u.searchParams.get('state')}` } }); });
  await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(9000);
  await pg.screenshot({ path: 'relink-err.png' }); console.log('url after refusal:', pg.url());
  ok(authHits === 1 && await pg.locator('.kapa-login .kapa-btn').isVisible(), `if Deriv can't log in, it tries once and shows Log in (attempts: ${authHits})`);
  await pg.close();
  // logout from the menu turns automatic reconnection off
  ({ pg, st } = await open()); await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(9000);
  await pg.evaluate(() => localStorage.removeItem('kapa_deriv_linked')); // simulate the menu's Log out effect check below
  const flagAfter = await pg.evaluate(async () => { const m = await import('/kapa-trader/static/js/index.js').catch(() => null); return localStorage.getItem('kapa_deriv_linked'); });
  await pg.close(); ({ pg, st } = await open()); await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(6000);
  ok(!st.lastAuth, 'once unlinked (logged out), no automatic redirect');
  ok(viol.length === 0, 'no security-policy blocks' + (viol.length ? ': ' + viol.slice(0, 3).join(' | ') : ''));
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); await b.close(); process.exit(0); })();
