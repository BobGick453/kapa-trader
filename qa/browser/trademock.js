// Trading part of the fake Deriv: proposal, buy, open-contract stream, and quiet replies for account streams
const prob = (t, b) => ({ DIGITOVER: (9 - b) / 10, DIGITUNDER: b / 10, DIGITMATCH: .1, DIGITDIFF: .9 }[t] ?? .5);
// Jump 100 (JD100) for the settlement check: quotes on a 0.01 grid, 1-tick moves: 30% down, 30% exactly 0, 40% up.
// stats.settle: 'tie-win' (an equal exit pays "Rise allow equals" as a win, the default), 'tie-lose', or 'lose-all'.
// Each JD100 contract is bought at a fake clock time t: entry tick t+1, exit tick t+2 (the digit contracts settle on
// the exit tick); the ticks are kept so ticks_history can return them.
const jd = (st) => (st.jd ||= { clock: (Date.now() / 1000 | 0) - 100000, quote: 6900, ticks: [] });
const jdTick = (st, t) => { const j = jd(st); const r = Math.random(); j.quote += r < 0.3 ? -1 : r < 0.6 ? 0 : 1; const tk = { t, q: +(j.quote / 100).toFixed(2) }; j.ticks.push(tk); return tk; };
const jdHandler = (stats, m, send, st, acct) => {
  const r = m.req_id;
  if (m.ticks_history === 'JD100') {
    const j = jd(st); if (!j.ticks.length) jdTick(st, ++j.clock);
    const list = m.start ? j.ticks.filter((x) => x.t >= m.start && x.t <= m.end) : j.ticks.slice(-(m.count || 1));
    send({ msg_type: 'history', req_id: r, echo_req: m, pip_size: 2, history: { prices: list.map((x) => x.q), times: list.map((x) => x.t) } }); return true;
  }
  if (m.proposal && m.underlying_symbol === 'JD100') {
    const payout = m.contract_type === 'DIGITMATCH' ? +(m.amount * 9.5).toFixed(2) : +(m.amount * 1.953).toFixed(2); const id = 'p' + Math.random().toString(36).slice(2);
    (st.props ||= {})[id] = { ...m, payout };
    send({ msg_type: 'proposal', req_id: r, echo_req: m, proposal: { id, ask_price: m.amount, payout, longcode: `${m.contract_type} on Jump 100` } }); return true;
  }
  if (m.buy && st.props?.[m.buy]?.underlying_symbol === 'JD100') {
    const p = st.props[m.buy]; const j = jd(st); const id = (st.cid = (st.cid || 5000) + 1);
    const t = (j.clock += 3); const entry = jdTick(st, t + 1); const exit = jdTick(st, t + 2);
    const d = Math.round(exit.q * 100) % 10;
    const won = stats.settle === 'lose-all' ? false : p.contract_type === 'DIGITMATCH' ? d === +p.barrier : exit.q > entry.q || (exit.q === entry.q && stats.settle !== 'tie-lose');
    const c = { ...p, acct, id, t, entry, exit, won, settleAt: Date.now() + 300 }; (st.contracts ||= {})[id] = c;
    st.balance[acct] = +(st.balance[acct] - p.amount).toFixed(2); stats.buys.push({ stake: p.amount, type: p.contract_type, barrier: p.barrier, sym: 'JD100', acct });
    send({ msg_type: 'buy', req_id: r, echo_req: m, buy: { contract_id: id, buy_price: p.amount, payout: p.payout, longcode: `${p.contract_type} on Jump 100`, transaction_id: id * 7, purchase_time: t } }); return true;
  }
  if (m.proposal_open_contract && st.contracts?.[m.contract_id]?.underlying_symbol === 'JD100') {
    const c = st.contracts[m.contract_id]; const sold = Date.now() >= c.settleAt;
    if (sold && !c.paid) { c.paid = true; if (c.won) st.balance[c.acct] = +(st.balance[c.acct] + c.payout).toFixed(2); }
    send({ msg_type: 'proposal_open_contract', req_id: r, echo_req: m, proposal_open_contract: { contract_id: c.id, contract_type: c.contract_type, barrier: c.barrier, is_sold: sold ? 1 : 0, status: sold ? (c.won ? 'won' : 'lost') : 'open', buy_price: c.amount, payout: c.payout, purchase_time: c.t, date_start: c.t,
      entry_tick: c.entry.q, entry_tick_display_value: c.entry.q.toFixed(2), entry_tick_time: c.entry.t,
      ...(sold ? { exit_tick: c.exit.q, exit_tick_display_value: c.exit.q.toFixed(2), exit_tick_time: c.exit.t, sell_price: c.won ? c.payout : 0, profit: +((c.won ? c.payout : 0) - c.amount).toFixed(2) } : { profit: 0 }) } });
    return true;
  }
  return false;
};
module.exports = (stats) => (m, send, st, acct) => {
  if (jdHandler(stats, m, send, st, acct)) return true;
  const r = m.req_id;
  if (m.proposal) {
    if (!m.underlying_symbol || m.symbol) { send({ msg_type: 'proposal', req_id: r, echo_req: m, error: { code: 'InputValidationFailed', message: 'underlying_symbol required' } }); return true; }
    const p = prob(m.contract_type, +m.barrier), payout = +(m.amount * (+process.env.MOCK_FACTOR || 0.9765) / p).toFixed(2), id = 'p' + Math.random().toString(36).slice(2);
    (st.props ||= {})[id] = { ...m, payout };
    send({ msg_type: 'proposal', req_id: r, echo_req: m, proposal: { id, ask_price: m.amount, payout, longcode: `Win payout if the last digit is ${m.contract_type} ${m.barrier}` } }); return true;
  }
  if (m.buy) {
    const p = st.props?.[m.buy]; if (!p) { send({ msg_type: 'buy', req_id: r, echo_req: m, error: { code: 'InvalidContractProposal', message: 'Proposal expired' } }); return true; }
    const id = (st.cid = (st.cid || 5000) + 1); (st.contracts ||= {})[id] = { ...p, acct };
    st.balance[acct] = +(st.balance[acct] - p.amount).toFixed(2); stats.buys.push({ stake: p.amount, type: p.contract_type, barrier: p.barrier, sym: p.underlying_symbol, acct });
    send({ msg_type: 'buy', req_id: r, echo_req: m, buy: { contract_id: id, buy_price: p.amount, payout: p.payout, longcode: `Win payout if the last digit is ${p.contract_type} ${p.barrier}`, transaction_id: id * 7 } }); return true;
  }
  if (m.proposal_open_contract) {
    const c = st.contracts?.[m.contract_id];
    if (!c) { send({ msg_type: 'proposal_open_contract', req_id: r, echo_req: m, proposal_open_contract: {} }); return true; }
    const sub = { id: 'poc' + m.contract_id };
    send({ msg_type: 'proposal_open_contract', req_id: r, echo_req: m, subscription: sub, proposal_open_contract: { contract_id: m.contract_id, is_sold: 0, buy_price: c.amount, payout: c.payout, bid_price: +(c.amount * .9).toFixed(2), profit: -0.1, tick_stream: [], contract_type: c.contract_type, barrier: c.barrier } });
    setTimeout(() => {
      const entry = st.quote, exit = +(st.quote += (Math.random() - .5)).toFixed(2), d = +exit.toFixed(2).slice(-1), b = +c.barrier;
      const won = { DIGITOVER: d > b, DIGITUNDER: d < b }[c.contract_type] ?? Math.random() < .5;
      const sell = won ? c.payout : 0; st.balance[c.acct] = +(st.balance[c.acct] + sell).toFixed(2);
      send({ msg_type: 'proposal_open_contract', req_id: r, echo_req: m, subscription: sub, proposal_open_contract: { contract_id: m.contract_id, is_sold: 1, status: won ? 'won' : 'lost', buy_price: c.amount, sell_price: sell, payout: c.payout, profit: +(sell - c.amount).toFixed(2), entry_tick_display_value: entry.toFixed(2), exit_tick_display_value: exit.toFixed(2), sell_time: Date.now() / 1000 | 0, tick_stream: [{}], contract_type: c.contract_type, barrier: c.barrier } });
      send({ msg_type: 'balance', balance: { balance: st.balance[c.acct], currency: 'USD', loginid: c.acct }, subscription: { id: 'bal' } });
    }, 500);
    return true;
  }
  const quiet = { transaction: {}, portfolio: { contracts: [] }, get_settings: {}, get_account_status: { status: [] }, landing_company: {}, get_limits: {}, statement: { transactions: [] }, profit_table: { transactions: [] }, payout_currencies: ['USD'], contracts_for: { available: [] }, trading_times: { markets: [] }, mt5_login_list: [], get_financial_assessment: {}, residence_list: [], states_list: [], authorize: { loginid: acct, currency: 'USD', balance: st.balance[acct], is_virtual: acct?.startsWith('D') ? 1 : 0, account_list: [] } };
  const type = Object.keys(m).find((k) => !['req_id', 'passthrough', 'subscribe'].includes(k));
  if (type in quiet) { send({ msg_type: type, req_id: r, echo_req: m, [type]: quiet[type], subscription: m.subscribe ? { id: type + r } : undefined }); return true; }
  return false;
};
