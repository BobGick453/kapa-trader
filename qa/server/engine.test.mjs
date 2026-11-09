// KAPA AI trade runner (src/pages/kapa-ai/engine.ts) in Node, against a fake Deriv connection:
// stake rounding, stakes capped to the stop-loss and maximum stake, results recovered after a lost
// connection, today's loss record kept trade by trade.
import { loadTs } from './ts-load.mjs';
let fails = 0; const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) fails++; };
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const E = await loadTs('../../src/pages/kapa-ai/engine.ts');
const C = await loadTs('../../src/pages/kapa-ai/classic.ts');

// ---------- stake rounding ----------
let bad = [];
for (let c = 35; c <= 2000; c++) { const v = c / 100; if (E.floor2(v) !== v) bad.push(v); }
ok(bad.length === 0, `floor2 keeps every cent value from 0.35 to 20.00 (${bad.length} changed${bad.length ? ': ' + bad.slice(0, 5).join(' ') : ''})`);
let worse = 0;
for (let i = 0; i < 20000; i++) { const v = 0.35 + Math.random() * 50; const f = E.floor2(v); if (f > v + 1e-12 || v - f >= 0.01) worse++; }
ok(worse === 0, 'floor2 never rounds up and never drops a full cent (20,000 random values)');

// ---------- fake Deriv ----------
const fakeDeriv = (o = {}) => {
  const ls = new Set(); const props = {}; const contracts = {}; const sent = []; let cid = 9000;
  const emit = (msg) => ls.forEach((f) => f({ data: msg }));
  const sold = (c) => ({ contract_id: c.id, is_sold: 1, buy_price: c.stake, sell_price: c.won ? c.payout : 0, payout: c.payout, profit: +((c.won ? c.payout : 0) - c.stake).toFixed(2), sell_time: Date.now() / 1000 | 0 });
  return {
    sent, contracts,
    onMessage: () => ({ subscribe: (cb) => { ls.add(cb); return { unsubscribe: () => ls.delete(cb) }; } }),
    send: async (req) => {
      sent.push(req);
      if (o.down && o.down(req)) return new Promise(() => {}); // a dropped connection: no answer
      if (req.proposal) { const id = 'p' + Object.keys(props).length; props[id] = { stake: req.amount, payout: +(req.amount * 1.953).toFixed(2) }; return { proposal: { id, ask_price: req.amount, payout: props[id].payout } }; }
      if (req.buy) { const p = props[req.buy]; const id = ++cid; const won = o.outcome ? o.outcome(id) : false; contracts[id] = { id, stake: p.stake, payout: p.payout, won, settled: false };
        setTimeout(() => { contracts[id].settled = true; if (!(o.dropStream && o.dropStream(id))) emit({ proposal_open_contract: sold(contracts[id]), subscription: { id: 's' + id } }); }, o.settleMs ?? 50);
        return { buy: { contract_id: id, buy_price: p.stake, payout: p.payout, longcode: 'test' } }; }
      if (req.proposal_open_contract) { const c = contracts[req.contract_id]; if (!c) return { error: { code: 'ContractNotFound', message: 'not found' } };
        return c.settled && !req.subscribe ? { proposal_open_contract: sold(c) } : { proposal_open_contract: { contract_id: c.id, is_sold: 0, buy_price: c.stake, payout: c.payout }, ...(req.subscribe ? { subscription: { id: 's' + c.id } } : {}) }; }
      if (req.profit_table) return { profit_table: { transactions: Object.values(contracts).filter((c) => c.settled).map((c) => ({ contract_id: c.id, buy_price: c.stake, sell_price: c.won ? c.payout : 0 })) } };
      return {};
    },
  };
};
const order = (amount, extra = {}) => ({ trade: { contract_type: 'DIGITEVEN', barrier: null, amount, symbol: 'R_100', duration: 1, recovery: false, ...extra } });
const runWith = async (api, policy, opts = {}, tweak = (e) => e) => {
  const ev = { logs: [], trades: [], stops: [], statuses: [] };
  let balance = opts.balance ?? 1000;
  const eng = tweak(new E.KapaEngine(api, () => 'USD', () => balance, {
    onStatus: (t, p) => ev.statuses.push(t), onContract: () => {}, onTrade: (t) => { ev.trades.push(t); balance = +(balance + t.profit).toFixed(2); },
    onLog: (t, l) => ev.logs.push(`${l}: ${t}`), onStop: (r, k, pl) => ev.stops.push({ r, k, pl }),
  }, () => 'TEST1'));
  await eng.run(policy, { name: 'test', delay: 0, stake: 1, takeProfit: 10, stopLoss: opts.stopLoss ?? 50, symbol: 'R_100', maxStake: opts.maxStake });
  return { ev, eng };
};
const seq = (orders, limits) => { let i = 0; return { limits, start: async () => orders[i++] ?? { stop: 'runs', reason: 'done' }, next: async () => orders[i++] ?? { stop: 'runs', reason: 'done' } }; };

// ---------- stakes never past the stop-loss or the maximum stake ----------
let api = fakeDeriv();
let r = await runWith(api, seq([order(100)], { stopLoss: 50, maxStake: 50 }));
ok(r.ev.trades[0]?.stake === 50 && r.ev.logs.some((l) => /asked for a stake of 100\.00.*staked 50\.00.*stop-loss/.test(l)), 'a server order of 100 with a 50 stop-loss is bought at 50: ' + r.ev.trades.map((t) => t.stake));
api = fakeDeriv();
r = await runWith(api, seq([order(30)], { stopLoss: 50, maxStake: 10 }));
ok(r.ev.trades[0]?.stake === 10 && r.ev.logs.some((l) => /maximum stake/.test(l)), 'an order above the maximum stake is bought at the maximum stake (10)');
api = fakeDeriv();
r = await runWith(api, seq([order(45), order(20), order(20)], { stopLoss: 50, maxStake: 50 }));
ok(r.ev.trades.map((t) => t.stake).join(',') === '45,5' && r.ev.stops[0]?.k === 'sl' && r.ev.stops[0].pl === -50, `after losing 45 of a 50 stop-loss, the next stake is 5, then the session stops at -50 (${r.ev.trades.map((t) => t.stake)} -> ${JSON.stringify(r.ev.stops[0])})`);
api = fakeDeriv();
r = await runWith(api, seq([order(1.15), order(2.3)], { stopLoss: 50, maxStake: 50 }));
ok(r.ev.trades.map((t) => t.stake).join(',') === '1.15,2.3', 'stakes of 1.15 and 2.30 are bought exactly (no lost cent)');
api = fakeDeriv();
r = await runWith(api, seq([order(40)]), { stopLoss: 30 });
ok(r.ev.trades[0]?.stake === 30, 'without policy limits, the run\'s own stop-loss still caps the stake (30)');

// ---------- today's loss record, trade by trade ----------
mem.clear();
api = fakeDeriv();
r = await runWith(api, seq([order(5), order(5), order(5)], { stopLoss: 50, maxStake: 50 }), { balance: 1000 });
const day = JSON.parse(mem.get('kapa_day_TEST1'));
ok(day.pl === -15 && day.start === 1000, `each trade is added to today's record as it settles (pl ${day.pl}, start ${day.start})`);
E.addDayResult('TEST1', 985, r.ev.stops[0].pl);
ok(JSON.parse(mem.get('kapa_day_TEST1')).pl === -15, 'the page\'s end-of-session total is not counted twice');
E.addDayResult('OTHER', 1000, -7);
ok(JSON.parse(mem.get('kapa_day_OTHER')).pl === -7, 'a session result without live records is still added');
ok(/00:00 GMT/.test(E.dailyLimitReachedText(30)) && /00:00 GMT/.test(E.DAY_RESET_NOTE) && /00:00 GMT/.test(E.dailyLimitLeftText(0.2, 'USD')) && /00:00 GMT/.test(E.dailyLimitLoweredText(3, 'USD')), 'daily-limit messages say the day resets at 00:00 GMT');

// ---------- connection lost while a contract is open ----------
mem.clear();
api = fakeDeriv({ dropStream: (id) => id === 9001, outcome: (id) => id === 9001, settleMs: 150 }); // the first contract's stream is lost; it was won
r = await runWith(api, seq([order(10), order(2)], { stopLoss: 50, maxStake: 50 }), {}, (e) => Object.assign(e, { settleCheckMs: 200 }));
ok(r.ev.trades.length === 2 && r.ev.trades[0].won && r.ev.trades[0].profit === 9.53, `the result of the contract whose stream was lost is fetched again and recorded (+${r.ev.trades[0]?.profit})`);
ok(r.ev.statuses.some((s) => /Waiting for Deriv: result of contract #9001/.test(s)) && r.ev.logs.some((l) => /reported the result of contract #9001/.test(l)), 'the run bar says it is waiting for Deriv, then the journal says the result came');
ok(r.ev.stops[0].pl === 7.53 && JSON.parse(mem.get('kapa_day_TEST1')).pl === 7.53, `it counts in the session P/L and today's record (${r.ev.stops[0].pl})`);
// no answer at all for a while, then the connection comes back
let downUntil = 0;
api = fakeDeriv({ dropStream: () => true, settleMs: 100, down: (req) => req.proposal_open_contract && !req.subscribe && Date.now() < downUntil });
downUntil = Date.now() + 1500;
r = await runWith(api, seq([order(4)], { stopLoss: 50, maxStake: 50 }), {}, (e) => Object.assign(e, { settleCheckMs: 200 }));
ok(r.ev.trades.length === 1 && r.ev.trades[0].profit === -4 && r.ev.stops[0].k === 'runs', 'after the connection comes back, the result is fetched and the session goes on');
// Deriv no longer answers for the contract itself: the account's recent results are used
api = fakeDeriv({ dropStream: () => true, settleMs: 100 });
const send0 = api.send; api.send = async (req) => (req.proposal_open_contract && !req.subscribe ? { error: { code: 'InvalidContractId', message: 'gone' } } : send0(req));
r = await runWith(api, seq([order(3)], { stopLoss: 50, maxStake: 50 }), {}, (e) => Object.assign(e, { settleCheckMs: 200 }));
ok(r.ev.trades[0]?.profit === -3 && api.sent.some((x) => x.profit_table), 'when Deriv no longer answers for the contract, its result is read from the profit table');
// never any answer: stop with a clear message, the stake counted as lost
mem.clear();
api = fakeDeriv({ dropStream: () => true, down: (req) => !!req.proposal_open_contract && !req.subscribe });
r = await runWith(api, seq([order(6)], { stopLoss: 50, maxStake: 50 }), {}, (e) => Object.assign(e, { settleCheckMs: 100, settleGiveUpMs: 1200 }));
ok(r.ev.stops[0]?.k === 'error' && /hasn't reported the result of contract #9001.*Check Reports on Deriv/.test(r.ev.stops[0].r), 'if Deriv never answers, KAPA AI stops with a clear message: ' + r.ev.stops[0]?.r);
ok(r.ev.stops[0].pl === -6 && JSON.parse(mem.get('kapa_day_TEST1')).pl === -6, 'and counts that stake as lost in the session and today\'s record (safe side)');

// ---------- the policies declare their limits ----------
const s = { ...E.DEFAULT_SETTINGS, stake: 1, stopLoss: 20, maxStake: 8 };
ok(JSON.stringify(E.fixedPolicy(s, {}).limits) === '{"stopLoss":20,"maxStake":8}', 'the free strategy declares its stop-loss and maximum stake');
ok(JSON.stringify(C.classicPolicy('printer', { ...s, symbol: 'R_100' }, {}, async () => []).limits) === '{"stopLoss":20,"maxStake":8}', 'the classic bots declare theirs');

console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(0);
