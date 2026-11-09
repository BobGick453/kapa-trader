// The Deriv connection drops while a contract is open: KAPA AI says it is waiting, gets the result once the
// app has reconnected, counts it (session, stats, today's loss record) and goes on.
const { chromium } = require('playwright'); const mock = require('./derivmock');
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const dismiss = async (pg) => { for (let i = 0; i < 3; i++) { for (const t of ['Skip', 'Close']) { const b = pg.getByRole('button', { name: t, exact: true }).first(); if (await b.isVisible().catch(() => false)) await b.click().catch(() => {}); } await pg.keyboard.press('Escape').catch(() => {}); await pg.waitForTimeout(250); } };
// Trading part of the fake Deriv with contracts that settle on "Deriv" even when nobody listens
const stats = { buys: [], drop: new Set() };
const handler = (m, send, st, acct) => {
  const r = m.req_id;
  const sold = (c) => ({ contract_id: c.id, is_sold: 1, status: 'won', buy_price: c.amount, sell_price: c.payout, payout: c.payout, profit: +(c.payout - c.amount).toFixed(2), entry_tick_display_value: '1000.00', exit_tick_display_value: '1000.02', sell_time: Date.now() / 1000 | 0, tick_stream: [{}] });
  if (m.proposal) { const id = 'p' + Math.random().toString(36).slice(2); const payout = +(m.amount * 1.953).toFixed(2); (st.props ||= {})[id] = { ...m, payout };
    send({ msg_type: 'proposal', req_id: r, echo_req: m, proposal: { id, ask_price: m.amount, payout, longcode: 'Win if the last digit is even' } }); return true; }
  if (m.buy) { const p = st.props?.[m.buy]; const id = (st.cid = (st.cid || 7000) + 1); const c = { id, amount: p.amount, payout: p.payout, acct, settled: false }; (st.contracts ||= {})[id] = c;
    st.balance[acct] = +(st.balance[acct] - p.amount).toFixed(2); stats.buys.push(id);
    setTimeout(() => { c.settled = true; st.balance[acct] = +(st.balance[acct] + c.payout).toFixed(2); }, 400); // every contract wins, settled by "Deriv"
    send({ msg_type: 'buy', req_id: r, echo_req: m, buy: { contract_id: id, buy_price: p.amount, payout: p.payout, longcode: 'Win if the last digit is even', transaction_id: id * 7 } }); return true; }
  if (m.proposal_open_contract) { const c = st.contracts?.[m.contract_id];
    if (!c) { send({ msg_type: 'proposal_open_contract', req_id: r, echo_req: m, error: { code: 'ContractNotFound', message: 'not found' } }); return true; }
    const sub = m.subscribe ? { id: 'poc' + c.id + r } : undefined;
    if (c.settled) { send({ msg_type: 'proposal_open_contract', req_id: r, echo_req: m, subscription: sub, proposal_open_contract: sold(c) }); return true; }
    send({ msg_type: 'proposal_open_contract', req_id: r, echo_req: m, subscription: sub, proposal_open_contract: { contract_id: c.id, is_sold: 0, buy_price: c.amount, payout: c.payout, bid_price: c.amount, profit: 0, tick_stream: [] } });
    if (m.subscribe && !stats.drop.has(c.id)) setTimeout(() => send({ msg_type: 'proposal_open_contract', req_id: r, echo_req: m, subscription: sub, proposal_open_contract: sold(c) }), 450);
    return true; }
  const quiet = { transaction: {}, portfolio: { contracts: [] }, get_settings: {}, get_account_status: { status: [] }, landing_company: {}, get_limits: {}, statement: { transactions: [] }, profit_table: { transactions: [] }, payout_currencies: ['USD'], contracts_for: { available: [] }, trading_times: { markets: [] }, mt5_login_list: [], get_financial_assessment: {}, residence_list: [], states_list: [], authorize: { loginid: acct, currency: 'USD', balance: st.balance[acct], is_virtual: acct?.startsWith('D') ? 1 : 0, account_list: [] } };
  const type = Object.keys(m).find((k) => !['req_id', 'passthrough', 'subscribe'].includes(k));
  if (type in quiet) { send({ msg_type: type, req_id: r, echo_req: m, [type]: quiet[type], subscription: m.subscribe ? { id: type + r } : undefined }); return true; }
  return false;
};
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: +(process.env.W || 400), height: 860 } });
  const st = await mock.install(pg, { handler });
  await pg.route('https://kapa-premium.netlify.app/**', (r) => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': 'http://localhost:8770' }, json: { status: 'inactive' } }));
  await pg.goto('http://localhost:8770/kapa-trader/'); await pg.waitForTimeout(3500);
  await pg.locator('.kapa-login .kapa-btn, .kapa-lock__login button').first().click(); await pg.waitForTimeout(6000); await dismiss(pg);
  if (!(await pg.locator('.kapa-lock, .kapa-card--main').first().isVisible().catch(() => false))) { await pg.click('#id-kapa-ai'); await pg.waitForTimeout(1500); await dismiss(pg); }
  if (await pg.locator('.kapa-lock__free').isVisible().catch(() => false)) await pg.click('.kapa-lock__free');
  await pg.fill('.kapa-field:has-text("Stake") input', '1'); await pg.fill('.kapa-field:has-text("Take-profit") input', '2.5');
    // every text the run bar shows, as it changes
  await pg.evaluate(() => { window.__runstat = []; new MutationObserver(() => { const t = document.querySelector('.kapa-runstat')?.textContent?.replace(/\s+/g, ' ').trim(); if (t && window.__runstat[window.__runstat.length - 1] !== t) window.__runstat.push(t); }).observe(document.body, { subtree: true, childList: true, characterData: true }); });
  // the first contract's stream is lost with the connection
  stats.drop.add(7001);
  await pg.click('.kapa-runbtn');
  const t0 = Date.now(); while (!stats.buys.length && Date.now() - t0 < 20000) await pg.waitForTimeout(100);
  const before = st.sockets.length; for (const ws of st.sockets) await ws.close().catch(() => {});
  const t1 = Date.now();
  while (Date.now() - t1 < 40000) { if (stats.buys.length > 1) break; await pg.waitForTimeout(250); }
  const saw = (await pg.evaluate(() => window.__runstat)).find((t) => /Waiting for Deriv/.test(t)) || '';
  ok(/Waiting for Deriv: result of contract #7001/.test(saw), 'while the result is missing, the run bar says KAPA AI is waiting for Deriv: ' + saw);
  ok(st.sockets.length > before, `the app reconnected to Deriv (${st.sockets.length - before} new connection)`);
  await pg.waitForSelector('.kapa-result', { timeout: 60000 }).catch(() => {}); await pg.waitForTimeout(800);
  ok(stats.buys.length === 3 && Date.now() - t1 < 60000, `the session went on after the result came back (${stats.buys.length} contracts, ${(Date.now() - t1) / 1000 | 0} s, no 2-minute freeze)`);
  const result = (await pg.textContent('.kapa-result').catch(() => '')).replace(/\s+/g, ' ');
  ok(/PROFIT TARGET REACHED/.test(result) && /2\.8[56]/.test(result), 'the recovered win counts in the session result: ' + result.slice(0, 70));
  const day = await pg.evaluate(() => Object.entries(localStorage).filter(([k]) => k.startsWith('kapa_day_')).map(([, v]) => JSON.parse(v)));
  ok(day.length === 1 && Math.abs(day[0].pl - 2.85) < 0.02, "and in today's loss record, once (" + JSON.stringify(day) + ')');
  await pg.click('.kapa-btn--lime').catch(() => {});
  await pg.locator('.kapa-segs button:has-text("Journal")').first().dispatchEvent('click').catch(() => {}); await pg.waitForTimeout(300);
  const journal = (await pg.textContent('.kapa-journal').catch(() => '')).replace(/\s+/g, ' ');
  ok(/No news of contract #7001/.test(journal) && /reported the result of contract #7001/.test(journal), 'the journal explains what happened');
  await pg.screenshot({ path: 'x/conn-journal.png' });
  console.log(fails ? `${fails} FAILED` : 'ALL PASSED'); await b.close(); process.exit(0);
})();
