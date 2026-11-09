// Fake Deriv (new API) for Playwright: OAuth, accounts, OTP and the trading WebSocket
const crypto = require('crypto');
const b64url = (b) => b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
exports.install = async (page, opts = {}) => {
  const st = { codes: {}, tokens: new Set(), log: [], unknown: new Set(), balance: { DOT90002: 10000, ROT90001: 50.25 }, quote: 1000 };
  await page.route(/https:\/\/(staging-)?auth\.deriv\.com\/oauth2\/auth/, (route) => {
    const u = new URL(route.request().url()); const code = 'c' + Math.random().toString(36).slice(2);
    st.codes[code] = { ch: u.searchParams.get('code_challenge'), redirect: u.searchParams.get('redirect_uri'), client: u.searchParams.get('client_id') };
    st.lastAuth = u.toString();
    route.fulfill({ status: 302, headers: { location: `${u.searchParams.get('redirect_uri')}?code=${code}&state=${u.searchParams.get('state')}` } });
  });
  await page.route(/https:\/\/(staging-)?auth\.deriv\.com\/oauth2\/token/, async (route) => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': route.request().headers().origin || '*', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST' } });
    const b = new URLSearchParams(route.request().postData() || ''); const c = st.codes[b.get('code')];
    const cors = { 'access-control-allow-origin': route.request().headers().origin || '*', 'access-control-allow-credentials': 'true' };
    if (!c) return route.fulfill({ status: 400, headers: cors, json: { error: 'invalid_grant' } });
    if (b64url(crypto.createHash('sha256').update(b.get('code_verifier') || '').digest()) !== c.ch || b.get('redirect_uri') !== c.redirect) return route.fulfill({ status: 400, headers: cors, json: { error: 'invalid_grant', error_description: 'PKCE or redirect mismatch' } });
    const t = 'at' + Math.random(); st.tokens.add(t);
    route.fulfill({ status: 200, headers: cors, json: { access_token: t, refresh_token: 'rt', expires_in: 3600, token_type: 'bearer', scope: 'trade' } });
  });
  await page.route(/https:\/\/(staging-)?api\.derivws\.com\/.*/, (route) => {
    const u = new URL(route.request().url()); const cors = { 'access-control-allow-origin': route.request().headers().origin || '*', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': 'authorization, content-type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (u.pathname.endsWith('/options/accounts')) return route.fulfill({ status: 200, headers: cors, json: { data: [
      { account_id: 'DOT90002', balance: String(st.balance.DOT90002), currency: 'USD', group: 'row', status: 'active', account_type: 'demo' },
      { account_id: 'ROT90001', balance: String(st.balance.ROT90001), currency: 'USD', group: 'row', status: 'active', account_type: 'real' }] } });
    const m = u.pathname.match(/accounts\/([^/]+)\/otp$/);
    if (m) return route.fulfill({ status: 200, headers: cors, json: { data: { url: `wss://${u.host}/trading/v1/options/ws/${m[1].startsWith('D') ? 'demo' : 'real'}?otp=o${Math.random()}&acct=${m[1]}` } } });
    route.fulfill({ status: 404, headers: cors, json: {} });
  });
  await page.routeWebSocket(/wss:\/\/(staging-)?(api|ws)\.derivws\.com\/.*/, (ws) => {
    const acct = new URL(ws.url()).searchParams.get('acct');
    const send = (o) => { try { ws.send(JSON.stringify(o)); } catch {} };
    const timers = [];
    ws.onMessage((raw) => {
      const m = JSON.parse(raw); const r = m.req_id; const type = Object.keys(m).find((k) => !['req_id', 'passthrough', 'subscribe'].includes(k));
      st.log.push(type);
      if (opts.handler && opts.handler(m, send, st, acct)) return;
      if (m.ping) return send({ msg_type: 'ping', ping: 'pong', req_id: r, echo_req: m });
      if (m.time) return send({ msg_type: 'time', time: Date.now() / 1000 | 0, req_id: r, echo_req: m });
      if (m.balance) return send({ msg_type: 'balance', req_id: r, echo_req: m, balance: { balance: st.balance[acct] ?? 0, currency: 'USD', loginid: acct || 'DOT90002' }, subscription: m.subscribe ? { id: 'bal' } : undefined });
      if (m.website_status) return send({ msg_type: 'website_status', req_id: r, echo_req: m, website_status: { site_status: 'up', currencies_config: { USD: { fractional_digits: 2, type: 'fiat' } }, api_call_limits: {}, clients_country: 'ci' } });
      if (m.active_symbols) return send({ msg_type: 'active_symbols', req_id: r, echo_req: m, active_symbols: ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'].map((s) => ({ underlying_symbol: s, symbol: s, display_name: `Volatility ${s.slice(2)} Index`, market: 'synthetic_index', market_display_name: 'Derived', submarket: 'random_index', submarket_display_name: 'Continuous Indices', subgroup: 'synthetics', subgroup_display_name: 'Synthetics', pip_size: s === 'R_100' ? 0.01 : 0.001, pip: s === 'R_100' ? 0.01 : 0.001, exchange_is_open: 1, is_trading_suspended: 0, symbol_type: 'stockindex', underlying_symbol_type: 'stockindex' })) });
      if (m.ticks_history) { const n = Math.min(m.count || 100, 5000); const prices = Array.from({ length: n }, () => +(st.quote += (Math.random() - .5)).toFixed(2)); const now = Date.now() / 1000 | 0;
        send({ msg_type: 'history', req_id: r, echo_req: m, pip_size: 2, history: { prices, times: prices.map((_, i) => now - (n - i) * 2) }, subscription: m.subscribe ? { id: 'th' + r } : undefined });
        if (m.subscribe) timers.push(setInterval(() => send({ msg_type: 'tick', echo_req: m, req_id: r, tick: { symbol: m.ticks_history, underlying_symbol: m.ticks_history, quote: +(st.quote += (Math.random() - .5)).toFixed(2), epoch: Date.now() / 1000 | 0, pip_size: 2 }, subscription: { id: 'th' + r } }), 1000));
        return; }
      if (m.ticks) { // live ticks: one subscription for one symbol or a list of symbols
        const syms = [].concat(m.ticks); const id = 'tk' + r; (st.tickSubs ||= []).push({ id, syms, at: Date.now() });
        const q = (st.tq ||= {}); const tick = (s) => send({ msg_type: 'tick', req_id: r, echo_req: m, subscription: m.subscribe ? { id } : undefined, tick: { symbol: s, quote: +(q[s] = (q[s] ?? 1000) + (Math.random() - 0.5)).toFixed(2), epoch: Date.now() / 1000 | 0, pip_size: 2, id } });
        syms.forEach(tick); if (m.subscribe) { const t = setInterval(() => syms.forEach(tick), 1000); timers.push(t); (st.tickTimers ||= {})[id] = t; }
        return; }
      if (m.forget && st.tickTimers?.[m.forget]) { clearInterval(st.tickTimers[m.forget]); delete st.tickTimers[m.forget]; (st.forgotten ||= []).push(m.forget); }
      if (m.forget || m.forget_all) return send({ msg_type: m.forget ? 'forget' : 'forget_all', req_id: r, echo_req: m, [m.forget ? 'forget' : 'forget_all']: m.forget ? 1 : [] });
      st.unknown.add(type);
      send({ msg_type: type, req_id: r, echo_req: m, error: { code: 'MockUnhandled', message: `mock: ${type}` } });
    });
    ws.onClose(() => timers.forEach(clearInterval));
  });
  return st;
};
