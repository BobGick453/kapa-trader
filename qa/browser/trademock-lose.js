// Trading part of the fake Deriv: proposal, buy, open-contract stream, and quiet replies for account streams
const prob = (t, b) => ({ DIGITOVER: (9 - b) / 10, DIGITUNDER: b / 10, DIGITMATCH: .1, DIGITDIFF: .9 }[t] ?? .5);
module.exports = (stats) => (m, send, st, acct) => {
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
      const won = false;
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
