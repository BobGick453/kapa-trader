// Free Bot: the reference's 4 bots (same names, order, filters), each loads into Bot Builder with its settings,
// runs on the fake Deriv, never stakes above Max Stake, and stops at its stop-loss when every trade loses.
// Usage: node freebot.js (needs serve.js on :8770; KAPA_URL overrides the address). Screenshots go to x/.
const { chromium } = require('playwright'); const mock = require('./derivmock');
const winMock = require('./trademock'), loseMock = require('./trademock-lose');
const URL0 = process.env.KAPA_URL || 'http://localhost:8770/kapa-trader/';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const BOTS = [
  { title: 'Digit Switcher Bot (1)', name: 'Digit Switcher Bot', sym: '1HZ100V', types: /^DIGIT(UNDER|OVER)$/, call: 'Bot Settings', sl: 50 },
  { title: 'Dollar Printer (1)', name: 'Dollar Printer', sym: '1HZ100V', types: /^DIGITOVER$/, call: 'Starts', sl: 50 },
  { title: 'Gold Premium Odd And Even', name: 'GOLD PREMIUM ODD AND EVEN', sym: 'R_100', types: /^DIGIT(EVEN|ODD)$/, call: 'Bot Settings', sl: 50 },
  { title: 'Profit Maker Bot (1)', name: 'Profit Maker Bot', sym: 'R_100', types: /^DIGITOVER$/, call: null, sl: 50 },
];
// the 1-second Volatility indices the reference bots trade, on top of the fake Deriv's R_ list
const SYMS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];
const withSymbols = (inner) => (m, send, st, acct) => {
  if (m.active_symbols) {
    send({ msg_type: 'active_symbols', req_id: m.req_id, echo_req: m, active_symbols: SYMS.map((s) => ({ underlying_symbol: s, symbol: s, display_name: s.startsWith('1HZ') ? `Volatility ${s.slice(3, -1)} (1s) Index` : `Volatility ${s.slice(2)} Index`, market: 'synthetic_index', market_display_name: 'Derived', submarket: 'random_index', submarket_display_name: 'Continuous Indices', subgroup: 'synthetics', subgroup_display_name: 'Synthetics', pip_size: 0.01, pip: 0.01, exchange_is_open: 1, is_trading_suspended: 0, symbol_type: 'stockindex', underlying_symbol_type: 'stockindex' })) });
    return true;
  }
  // Bot Builder buys 1-tick digit contracts directly ({ buy: '1', price, parameters }): price it like a proposal
  if (m.buy === '1' && m.parameters) {
    const p = m.parameters, b = +p.barrier;
    const prob = { DIGITOVER: (9 - b) / 10, DIGITUNDER: b / 10 }[p.contract_type] ?? 0.5;
    const id = 'direct' + m.req_id;
    (st.props ||= {})[id] = { ...p, payout: +(p.amount * 0.9765 / prob).toFixed(2) };
    inner({ ...m, buy: id }, (o) => send({ ...o, echo_req: m }), st, acct);
    // like Deriv, a buy with subscribe streams the contract until it is sold, with its transaction ids
    const cid = st.cid;
    inner({ proposal_open_contract: 1, contract_id: cid, subscribe: 1, req_id: m.req_id }, (o) => {
      const c = o.proposal_open_contract;
      if (c && c.contract_id) Object.assign(c, { transaction_ids: { buy: cid * 7, ...(c.is_sold ? { sell: cid * 7 + 1 } : {}) }, underlying: p.underlying_symbol, currency: 'USD', status: c.is_sold ? c.status : 'open', date_start: Date.now() / 1000 | 0 });
      send(o);
    }, st, acct);
    return true;
  }
  return inner(m, send, st, acct);
};
const dismiss = async (pg) => {
  for (let i = 0; i < 2; i++) {
    for (const t of ['Skip', 'Close']) { const b = pg.getByRole('button', { name: t, exact: true }).first(); if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); }
    await pg.keyboard.press('Escape').catch(() => {}); await pg.waitForTimeout(250);
  }
};
const workspace = (pg) => pg.evaluate(() => window.Blockly?.Xml?.domToText(window.Blockly.Xml.workspaceToDom(window.Blockly.derivWorkspace)) || '');
const noOverflow = (pg) => pg.evaluate(() => { const r = document.querySelector('.free-bot'); return r && r.scrollWidth <= r.clientWidth + 1 && document.documentElement.scrollWidth <= window.innerWidth + 1; });

const session = async (b, W, H, handler) => {
  const pg = await b.newPage({ viewport: { width: W, height: H } });
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  await mock.install(pg, { handler: withSymbols(handler) });
  await pg.route('https://kapa-premium.netlify.app/**', (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': new URL(URL0).origin }, json: { status: 'inactive' } }));
  await pg.goto(URL0); await pg.waitForTimeout(4500); await pg.click('.kapa-login .kapa-btn'); await pg.waitForTimeout(6000);
  if (await pg.locator('.kapa-lock__free').isVisible().catch(() => false)) await pg.click('.kapa-lock__free');
  await dismiss(pg);
  return { pg, errs };
};
const openLibrary = async (pg) => { await pg.click('#id-free-bot', { force: true }); await pg.waitForSelector('.free-bot__card', { timeout: 10000 }); await dismiss(pg); };
const loadBot = async (pg, bot) => {
  await openLibrary(pg);
  await pg.locator('.free-bot__card', { hasText: bot.title }).locator('.free-bot__btn', { hasText: 'Load Bot' }).click();
  await pg.waitForTimeout(3500); await dismiss(pg);
  return workspace(pg);
};
const run = async (pg, stats, until, ms) => {
  const before = stats.buys.length; const t0 = Date.now();
  await dismiss(pg);
  await pg.click('#db-animation__run-button', { timeout: 8000 }).catch(() => pg.click('#db-animation__run-button', { force: true }));
  while (Date.now() - t0 < ms && !(await until(stats.buys.slice(before)))) await pg.waitForTimeout(1000);
  await pg.waitForTimeout(2500);
  const running = await pg.evaluate(() => /Stop/i.test(document.querySelector('#db-animation__run-button, #db-animation__stop-button')?.textContent || ''));
  return { buys: stats.buys.slice(before), running };
};
const stop = async (pg) => { const s = pg.locator('#db-animation__stop-button'); if (await s.isVisible().catch(() => false)) { await s.click(); await pg.waitForTimeout(3000); } };

(async () => {
  const b = await chromium.launch();
  // 1) library: same 4 bots, order, filters and actions as the reference; no overflow on phone or desktop
  for (const [W, H, tag] of [[360, 780, 'phone'], [1366, 800, 'desk']]) {
    const { pg } = await session(b, W, H, winMock({ buys: [] }));
    await openLibrary(pg);
    const titles = await pg.$$eval('.free-bot__card h2', (h) => h.map((x) => x.textContent));
    ok(JSON.stringify(titles) === JSON.stringify(BOTS.map((x) => x.title)), `${tag}: the reference's 4 bots in its order: ${titles.join(' | ')}`);
    ok((await pg.locator('.free-bot__card .free-bot__btn', { hasText: 'Load Bot' }).count()) === 4 && (await pg.locator('.free-bot__card .free-bot__btn--ai').count()) === 4, `${tag}: each card has Load Bot, then Run in KAPA AI`);
    ok((await pg.locator('.free-bot__card .free-bot__btn--apex:has(.free-bot__badge:text("PREMIUM"))').count()) === 4, `${tag}: each card offers the Apex recovery, marked Premium`);
    if (tag === 'desk') {
      await pg.evaluate(() => { window.__kapaMarket = []; window.addEventListener('kapa:use-market', (e) => window.__kapaMarket.push(e.detail)); });
      await pg.locator('.free-bot__card', { hasText: 'Profit Maker Bot (1)' }).locator('.free-bot__btn--apex').click(); await pg.waitForTimeout(1200);
      const pend = await pg.evaluate(() => window.__kapaMarket[0] || {});
      ok(pend.preset === 'profitmaker' && pend.apexRecovery === true && (await pg.locator('.kapa-ai').isVisible()), 'Apex recovery opens KAPA AI and hands KAPA AI the bot with apexRecovery: ' + JSON.stringify(pend));
      await openLibrary(pg);
      await pg.locator('.free-bot__card', { hasText: 'Gold Premium Odd And Even' }).locator('.free-bot__btn--ai').click(); await pg.waitForTimeout(300);
      const free = await pg.evaluate(() => window.__kapaMarket[1] || {});
      ok(free.preset === 'goldoe' && !free.apexRecovery, 'Run in KAPA AI stays free (no apexRecovery): ' + JSON.stringify(free));
      await openLibrary(pg);
    }
    const tested = await pg.$$eval('.free-bot__tested:not(.free-bot__tested--ai)', (t) => t.map((x) => x.textContent));
    ok(tested.length === 4 && tested.every((t) => /target reached in \d+\.\d% of sessions · average −\d+\.\d\d · worst session −50/.test(t)), `${tag}: cards quote real-tick results: ${tested[0]}`);
    for (const [f, n] of [['Digits', 2], ['Premium', 3], ['Even/Odd', 1], ['All', 4]]) { await pg.click(`.free-bot__filter:has-text("${f}")`); await pg.waitForTimeout(200); ok((await pg.locator('.free-bot__card').count()) === n, `${tag}: filter ${f} shows ${n}`); }
    ok(await noOverflow(pg), `${tag}: no horizontal overflow`);
    await pg.screenshot({ path: `x/freebot-${tag}.png`, fullPage: false });
    await pg.close();
  }
  // 2) each bot loads with the reference's settings fields and Kapa's limits, then runs on the fake Deriv
  const stats = { buys: [] };
  const { pg, errs } = await session(b, 1366, 800, winMock(stats));
  for (const bot of BOTS) {
    const ws = await loadBot(pg, bot);
    const sym = (ws.match(/<field name="SYMBOL_LIST">([^<]*)</) || [])[1];
    const name = await pg.evaluate(() => document.querySelector('.bot-name, [class*="bot-name"], .toolbar__title')?.textContent || document.title);
    ok(sym === bot.sym, `${bot.title}: loads into Bot Builder on ${sym}`);
    ok(/Stop Loss/.test(ws) && /Max Stake/.test(ws) && (!bot.call || ws.includes(`name="${bot.call}"`)), `${bot.title}: settings fields with a stop-loss and Max Stake`);
    ok(!/pegasus|goldstandard|GSM|daily profit corp/i.test(ws), `${bot.title}: no reference branding in the blocks`);
    if (bot === BOTS[0]) await pg.screenshot({ path: 'x/freebot-builder.png' });
    const r = await run(pg, stats, (bs) => bs.length >= 4, 45000);
    await stop(pg);
    ok(r.buys.length > 0 && r.buys.every((x) => bot.types.test(x.type) && x.sym === bot.sym), `${bot.title}: Run placed ${r.buys.length} trades: ${[...new Set(r.buys.map((x) => x.type + (x.barrier !== undefined ? ' ' + x.barrier : '')))].join(', ')} on ${[...new Set(r.buys.map((x) => x.sym))]}`);
    ok(r.buys.every((x) => x.stake <= 25.001 && x.stake >= 0.35), `${bot.title}: stakes within 0.35 and Max Stake 25 (max ${Math.max(0, ...r.buys.map((x) => x.stake))})`);
    void name;
  }
  await pg.close();
  // 3) stop-loss: every trade loses; the bot stops by itself, never past the stop-loss of 50
  for (const bot of [BOTS[0], BOTS[3]]) {
    const ls = { buys: [] };
    const s = await session(b, 1366, 800, loseMock(ls));
    await loadBot(s.pg, bot);
    const r = await run(s.pg, ls, async () => !(await s.pg.locator('#db-animation__stop-button').isVisible().catch(() => false)) && ls.buys.length > 0, 150000);
    const lost = r.buys.reduce((a, x) => a + x.stake, 0);
    const journal = await s.pg.evaluate(() => document.body.innerText);
    ok(!r.running && r.buys.length > 0, `${bot.title}: stops by itself after ${r.buys.length} losing trades`);
    ok(lost <= bot.sl + 1e-9 && lost >= bot.sl - 2, `${bot.title}: lost ${lost.toFixed(2)}, never past the stop-loss of ${bot.sl}; stakes ${r.buys.map((x) => x.stake).join(', ')}`);
    ok(r.buys.every((x) => x.stake <= 25.001), `${bot.title}: no stake above Max Stake`);
    if (bot === BOTS[0]) await s.pg.screenshot({ path: 'x/freebot-stoploss.png' });
    void journal;
    await stop(s.pg); await s.pg.close();
  }
  console.log('page errors:', errs.filter((e) => !/^Event$|_\.Dd/.test(e)).slice(0, 5));
  console.log(fails ? fails + ' FAILED' : 'ALL PASSED'); await b.close(); process.exit(0);
})();
