/**
 * Kapa Premium server (Cloudflare Worker + KV, or Netlify Function + Blobs).
 *
 * - Premium belongs to a Deriv account for a number of days (PLAN_DAYS, 30 by default). It starts after a
 *   payment confirmed by CinetPay, after a gift code made by the owner in Admin, or when the owner activates
 *   an account from Admin. It ends by itself; the owner can see every account and revoke one.
 * - Identifies traders by asking Deriv which accounts their OAuth access token belongs to. The token is used
 *   for that check only; it is never stored or logged. Every Premium request is checked again.
 * - Runs the Premium strategies: the website sends each settled contract and receives the next trade.
 *   Sessions are signed (HMAC) so they need no storage.
 * - Scans markets itself over Deriv's public WebSocket, simulates session plans, and gives Premium bot
 *   settings to members only.
 * - Admin endpoints need ADMIN_SECRET; repeated wrong attempts lock the caller out.
 *
 * Bindings: KV namespace KAPA_KV.
 * Secrets: CINETPAY_APIKEY, CINETPAY_SITE_ID, ADMIN_SECRET, SESSION_KEY, and optionally PREMIUM_RULES
 * (PREMIUM_CODE, the old shared code, only lets devices that used it move to their account; see migrateLegacy).
 * Vars: PRICE_XOF, PLAN_DAYS, CURRENCY, SITE_URL, ALLOWED_ORIGINS, DERIV_API, DERIV_PUBLIC_WS.
 */

import { classicSettings, cleanState, simulateClassic } from './classic.js';
import {
    applyResult,
    backtest,
    bestOf,
    cleanRatios,
    contractOf,
    decide,
    estRatio,
    expectedOf,
    freshState,
    GROUPS,
    labStrategies,
    loadRules,
    presetKey,
    randomnessCheck,
    simulate,
    validateSettings,
    winProb,
} from './strategy.js';

const CINETPAY = 'https://api-checkout.cinetpay.com/v2';
const DAY = 24 * 60 * 60 * 1000;
const SESSION_TTL = 6 * 60 * 60 * 1000;
const MAX_BODY = 16 * 1024;
const TX_ID = /^kapa_[a-z0-9]+_[a-f0-9]{10}$/;
const ACCOUNT_ID = /^[A-Za-z0-9]{4,32}$/;

const SECURITY_HEADERS = {
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fail = (status, error) => json({ error }, status);
/** An error that already knows the answer to send (status and a message for the visitor). */
class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

const corsHeaders = (req, env) => {
    const origin = req.headers.get('origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    if (!allowed.includes(origin)) return {};
    return {
        'access-control-allow-origin': origin,
        'access-control-allow-headers': 'authorization, content-type, x-admin-secret, x-kapa-pass, x-kapa-device',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-max-age': '600',
        vary: 'Origin',
    };
};

const enc = new TextEncoder();
const b64url = buf =>
    btoa(String.fromCharCode(...new Uint8Array(buf)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
const unb64url = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
const sha256 = async text => b64url(await crypto.subtle.digest('SHA-256', enc.encode(text)));

/** Constant-time comparison: hashes both sides first so length differences don't leak either. */
const safeEqual = async (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
    const [x, y] = await Promise.all([sha256(a), sha256(b)]);
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
    return diff === 0;
};

// ---------- Signed sessions (no storage needed) ----------
const hmacKey = env =>
    crypto.subtle.importKey('raw', enc.encode(env.SESSION_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
        'verify',
    ]);
const signSession = async (env, payload) => {
    const body = b64url(enc.encode(JSON.stringify(payload)));
    const sig = b64url(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(body)));
    return `${body}.${sig}`;
};
const readSession = async (env, token, typ = 'session') => {
    if (typeof token !== 'string' || token.length > 4096 || !/^[\w-]+\.[\w-]+$/.test(token)) return null;
    const [body, sig] = token.split('.');
    try {
        const ok = await crypto.subtle.verify('HMAC', await hmacKey(env), unb64url(sig), enc.encode(body));
        if (!ok) return null;
        const p = JSON.parse(new TextDecoder().decode(unb64url(body)));
        if (!(p?.v === 1 && p.exp > Date.now())) return null;
        if (typ === 'pass') return p.typ === 'pass' && typeof p.ver === 'string' ? p : null;
        return !p.typ && Array.isArray(p.acc) ? p : null; // a pass can never be used as a strategy session
    } catch {
        return null;
    }
};

// ---------- Best-effort rate limiting (per Worker instance) ----------
const buckets = new Map();
const rateLimited = (key, limit, windowMs = 60000) => {
    const now = Date.now();
    const b = buckets.get(key);
    if (!b || now - b.start > windowMs) {
        buckets.set(key, { start: now, count: 1 });
        if (buckets.size > 5000) buckets.clear();
        return false;
    }
    b.count++;
    return b.count > limit;
};
// The visitor's address as set by the host (Cloudflare or Netlify); never taken from headers a visitor can forge
const clientIp = req => req.headers.get('cf-connecting-ip') || req.headers.get('x-nf-client-connection-ip') || 'unknown';

// ---------- Deriv identity (cached briefly, keyed by a hash of the token) ----------
// Recently checked logins, in this instance's memory (Netlify has no Cloudflare-style shared cache)
const identities = new Map();
const IDENTITY_TTL = 120000;

const derivAccounts = async (req, env) => {
    const auth = req.headers.get('authorization') || '';
    if (!/^Bearer [\w.~+/=-]{10,4096}$/.test(auth)) return null;
    const hash = await sha256(auth);
    const mem = identities.get(hash);
    if (mem && mem.exp > Date.now()) return mem.ids;
    // Cloudflare's shared cache when there is one; any problem with it just means asking Deriv again
    const cache = typeof caches !== 'undefined' && caches?.default ? caches.default : null;
    const cacheKey = cache ? new Request(`https://kapa-identity.internal/${hash}`) : null;
    if (cache) {
        const hit = await cache.match(cacheKey).catch(() => null);
        const ids = hit && (await hit.json().catch(() => null));
        if (Array.isArray(ids) && ids.length) return ids;
    }
    let res;
    try {
        res = await fetch(`${env.DERIV_API || 'https://api.derivws.com'}/trading/v1/options/accounts`, {
            headers: { authorization: auth, accept: 'application/json' },
            signal: AbortSignal.timeout(8000),
        });
    } catch {
        throw new HttpError(503, "Deriv didn't answer. Try again in a moment.");
    }
    if (res.status >= 500) throw new HttpError(503, "Deriv didn't answer. Try again in a moment.");
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    const ids = (Array.isArray(body?.data) ? body.data : [])
        .map(a => String(a.account_id || ''))
        .filter(id => ACCOUNT_ID.test(id));
    if (!ids.length) return null;
    if (identities.size > 2000) identities.clear();
    identities.set(hash, { ids, exp: Date.now() + IDENTITY_TTL });
    if (cache)
        await cache
            .put(cacheKey, new Response(JSON.stringify(ids), { headers: { 'cache-control': 'max-age=120' } }))
            .catch(() => {});
    return ids;
};

// ---------- Codes ----------
// Codes ignore spaces, dashes and letter case, so a code typed on a phone still matches.
const normalizeCode = code => (typeof code === 'string' ? code.replace(/[\s-]+/g, '').toUpperCase() : '');
const CODE_OK = /^[A-Z0-9_.@#!*+=]{8,64}$/;

const codeHash = async (env, code, purpose = 'premium-code') => {
    const key = await crypto.subtle.importKey(
        'raw',
        enc.encode(env.SESSION_KEY),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(`${purpose}:${code}`)));
};

/** The old shared code (before Premium belonged to accounts): only used to move its devices to their account. */
const legacyCode = async env => {
    const saved = await env.KAPA_KV.get('premium:code', 'json');
    if (saved?.h && saved?.ver) return saved;
    const first = normalizeCode(env.PREMIUM_CODE || '');
    if (CODE_OK.test(first)) {
        const h = await codeHash(env, first);
        return { h, ver: `secret-${h.slice(0, 12)}` };
    }
    return null;
};

// ---------- Wrong-code throttle ----------
// Mobile networks put many people behind one address, so a whole address is never locked for long:
// - each device (address + the random id the website keeps on that device) gets 5 free wrong codes, then
//   waits before each new try: 30 s, 1 min, 2 min... at most 15 min;
// - an address only pauses when wrong codes flood in from it (30 within an hour): 15 min for everyone there.
// With codes of 8+ characters that leaves far too few tries to guess one.
const CODE_FREE_TRIES = 5;
const CODE_MAX_WAIT = 15 * 60 * 1000;
const CODE_FLOOD = 30;
const DEVICE_ID = /^[\w-]{8,64}$/;
const codeThrottleKeys = async (req, ip) => {
    const device = req.headers.get('x-kapa-device') || '';
    return {
        ip: `codefail:${await sha256(ip)}`,
        device: `codefail:${await sha256(`${ip}|${DEVICE_ID.test(device) ? device : '-'}`)}`,
    };
};
/** Milliseconds this caller must still wait before trying a code, or 0. */
const codeWait = async (env, keys) => {
    const now = Date.now();
    const [a, d] = await Promise.all([env.KAPA_KV.get(keys.ip, 'json'), env.KAPA_KV.get(keys.device, 'json')]);
    return Math.max(0, (a?.until || 0) - now, (d?.until || 0) - now);
};
const codeFailed = async (env, keys) => {
    const now = Date.now();
    const [a, d] = await Promise.all([env.KAPA_KV.get(keys.ip, 'json'), env.KAPA_KV.get(keys.device, 'json')]);
    const dn = (d?.n || 0) + 1;
    const dev = { n: dn, until: dn > CODE_FREE_TRIES ? now + Math.min(CODE_MAX_WAIT, 30000 * 2 ** (dn - CODE_FREE_TRIES - 1)) : 0 };
    const fresh = a && now - a.start < 3600000;
    const an = fresh ? a.n + 1 : 1;
    const addr = { n: an, start: fresh ? a.start : now, until: an >= CODE_FLOOD ? now + CODE_MAX_WAIT : 0 };
    if (an >= CODE_FLOOD) Object.assign(addr, { n: 0, start: now }); // a new hour starts after the pause
    await Promise.all([
        env.KAPA_KV.put(keys.device, JSON.stringify(dev), { expirationTtl: 3600 }),
        env.KAPA_KV.put(keys.ip, JSON.stringify(addr), { expirationTtl: 3600 }),
    ]);
};
const tooManyCodes = ms => {
    const s = Math.ceil(ms / 1000);
    const when = s < 90 ? `${s} seconds` : `${Math.ceil(s / 60)} minutes`;
    const res = fail(429, `Too many wrong codes. Check the code, then try again in ${when}.`);
    res.headers.set('retry-after', String(s));
    return res;
};

/** A pass a device received for the old shared code: still valid (it is no longer renewed) and for that code. */
const legacyPass = async (env, req) => {
    if (!env.SESSION_KEY || env.SESSION_KEY.length < 32) return null;
    const p = await readSession(env, req.headers.get('x-kapa-pass') || '', 'pass');
    if (!p) return null;
    const code = await legacyCode(env);
    return code && p.ver === code.ver ? p : null;
};

// ---------- Premium entitlements: one record per Deriv account ----------
// ent:<account> = { until, since, source: payment | gift | admin | code, ref, group: [accounts granted together],
//                   updatedAt, revokedAt?, history: [{ at, days, source, ref }] }
const entKey = id => `ent:${id}`;
const entCache = new Map(); // a few seconds, per instance: one Premium check per trade without a storage read
const bestEnt = async (env, ids) => {
    const recs = await Promise.all(ids.map(id => env.KAPA_KV.get(entKey(id), 'json').catch(() => null)));
    return recs.filter(Boolean).sort((a, b) => b.until - a.until)[0] || null;
};
/** Premium state of a Deriv user (all the accounts their token belongs to). */
const entitlement = async (env, ids) => {
    const key = ids.join(',');
    const hit = entCache.get(key);
    if (hit && hit.exp > Date.now()) return hit.v;
    const rec = await bestEnt(env, ids);
    const v = { active: Boolean(rec && rec.until > Date.now()), until: rec?.until ?? null, rec };
    if (entCache.size > 2000) entCache.clear();
    entCache.set(key, { v, exp: Date.now() + 15000 });
    return v;
};
/** Adds `days` of Premium to these accounts (counted from the current end date while it is still running). */
const grant = async (env, ids, days, source, ref) => {
    const now = Date.now();
    const cur = await bestEnt(env, ids);
    const running = cur && cur.until > now;
    const group = [...new Set([...(cur?.group || []), ...ids])].filter(id => ACCOUNT_ID.test(id)).slice(0, 20);
    const rec = {
        until: (running ? cur.until : now) + days * DAY,
        since: running ? cur.since : now,
        source,
        ref: String(ref || '').slice(0, 80),
        group,
        updatedAt: now,
        history: [...(cur?.history || []).slice(-19), { at: now, days, source, ref: String(ref || '').slice(0, 80) }],
    };
    await Promise.all(group.map(id => env.KAPA_KV.put(entKey(id), JSON.stringify(rec))));
    entCache.clear();
    return rec;
};
/** Ends Premium at once for an account and the accounts granted with it. */
const revoke = async (env, id) => {
    const cur = await env.KAPA_KV.get(entKey(id), 'json');
    if (!cur) return null;
    const now = Date.now();
    const rec = { ...cur, until: Math.min(cur.until, now), revokedAt: now, updatedAt: now };
    await Promise.all((cur.group?.length ? cur.group : [id]).map(x => env.KAPA_KV.put(entKey(x), JSON.stringify(rec))));
    entCache.clear();
    return rec;
};
const entView = rec =>
    rec && {
        accounts: rec.group,
        until: rec.until,
        since: rec.since,
        source: rec.source,
        ref: rec.ref,
        active: rec.until > Date.now(),
        revokedAt: rec.revokedAt ?? null,
        history: rec.history,
    };

// ---------- Gift codes (made by the owner in Admin; each use gives Premium to one Deriv user) ----------
// gift:<id> = { id, label, maxUses, uses, days, createdAt, disabled, hint, redeemed: [{ accounts, at }] }
const GIFT_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I: easy to read aloud
const newGiftCode = () => {
    const b = crypto.getRandomValues(new Uint8Array(12));
    const c = [...b].map(x => GIFT_ALPHABET[x % GIFT_ALPHABET.length]).join('');
    return `KAPA-${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
};
const giftId = async (env, code) => (await codeHash(env, normalizeCode(code), 'gift-code')).slice(0, 24);
const giftView = g => g && { id: g.id, label: g.label, maxUses: g.maxUses, uses: g.uses, days: g.days, createdAt: g.createdAt, disabled: Boolean(g.disabled), hint: g.hint, redeemed: (g.redeemed || []).slice(-50) };

// ---------- Owner settings shown to visitors (contact links) ----------
const contactLinks = async env => {
    const c = (await env.KAPA_KV.get('settings:contact', 'json').catch(() => null)) || {};
    return {
        whatsapp: c.whatsapp ? `https://wa.me/${c.whatsapp}` : null,
        telegram: c.telegram ? `https://t.me/${c.telegram}` : null,
    };
};

const cinetpayCheck = async (env, transactionId) => {
    const res = await fetch(`${CINETPAY}/payment/check`, {
        signal: AbortSignal.timeout(10000),
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            apikey: env.CINETPAY_APIKEY,
            site_id: env.CINETPAY_SITE_ID,
            transaction_id: transactionId,
        }),
    });
    return res.json().catch(() => ({}));
};

/** Verifies a payment with CinetPay, records it and gives the buyer's accounts Premium. Safe to call repeatedly. */
const settle = async (env, transactionId) => {
    const tx = await env.KAPA_KV.get(`tx:${transactionId}`, 'json');
    if (!tx) return { status: 'unknown' };
    if (tx.status === 'paid' && !tx.granted) return giveForPayment(env, transactionId, tx); // a grant that failed before
    if (tx.status === 'paid' || tx.status === 'failed') return tx;
    const check = await cinetpayCheck(env, transactionId);
    const status = check?.data?.status;
    const paidAmount = Number(check?.data?.amount);
    if (
        check?.code === '00' &&
        status === 'ACCEPTED' &&
        paidAmount >= tx.amount &&
        (!check?.data?.currency || check.data.currency === tx.currency)
    ) {
        Object.assign(tx, {
            status: 'paid',
            paidAt: Date.now(),
            method: String(check.data.payment_method || '').slice(0, 32) || null,
        });
    } else if (status === 'REFUSED' || status === 'CANCELED') {
        Object.assign(tx, { status: 'failed', reason: status });
    } else {
        return tx; // still pending: nothing to write
    }
    await env.KAPA_KV.put(`tx:${transactionId}`, JSON.stringify(tx));
    return tx.status === 'paid' ? giveForPayment(env, transactionId, tx) : tx;
};
const giveForPayment = async (env, transactionId, tx) => {
    const rec = await grant(env, tx.accounts, Number(tx.days) || 30, 'payment', transactionId);
    Object.assign(tx, { granted: true, until: rec.until });
    await env.KAPA_KV.put(`tx:${transactionId}`, JSON.stringify(tx));
    return tx;
};

const listPrefix = async (env, prefix) => {
    const out = [];
    let cursor;
    do {
        const page = await env.KAPA_KV.list({ prefix, cursor });
        for (const k of page.keys)
            out.push({ key: k.name.slice(prefix.length), value: await env.KAPA_KV.get(k.name, 'json') });
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return out;
};

const readJson = async req => {
    const len = Number(req.headers.get('content-length') || 0);
    if (len > MAX_BODY) return null;
    const text = await req.text();
    if (text.length > MAX_BODY) return null;
    try {
        return text ? JSON.parse(text) : {};
    } catch {
        return null;
    }
};

// ---------- Deriv public WebSocket (prices and ticks need no login) ----------
const openDerivSocket = async env => {
    if (env.OPEN_SOCKET) return env.OPEN_SOCKET(); // test hook; never set in production
    const url = env.DERIV_PUBLIC_WS || 'https://api.derivws.com/trading/v1/options/ws/public';
    if (typeof WebSocketPair === 'undefined' && typeof WebSocket !== 'undefined') {
        // Node (Netlify): a standard WebSocket client
        const ws = new WebSocket(url.replace(/^http/, 'ws'));
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Deriv market data is unavailable')), 6000);
            ws.addEventListener('open', () => (clearTimeout(timer), resolve()));
            ws.addEventListener('error', () => (clearTimeout(timer), reject(new Error('Deriv market data is unavailable'))));
        });
        return ws;
    }
    // Cloudflare Workers
    const res = await fetch(url, { headers: { Upgrade: 'websocket' } });
    const ws = res.webSocket;
    if (!ws) throw new Error('Deriv market data is unavailable');
    ws.accept();
    return ws;
};

/** Sends several requests over one socket and returns the answers in order (null for failures). */
const derivBatch = async (env, requests, timeoutMs = 8000) => {
    const ws = await openDerivSocket(env);
    const results = new Array(requests.length).fill(null);
    let pending = requests.length;
    await new Promise(resolve => {
        const timer = setTimeout(resolve, timeoutMs);
        ws.addEventListener('message', ev => {
            let msg;
            try {
                msg = JSON.parse(typeof ev.data === 'string' ? ev.data : new TextDecoder().decode(ev.data));
            } catch {
                return;
            }
            const i = Number(msg.req_id) - 1;
            if (i >= 0 && i < results.length && results[i] === null) {
                results[i] = msg.error ? { error: msg.error } : msg;
                if (--pending === 0) {
                    clearTimeout(timer);
                    resolve();
                }
            }
        });
        requests.forEach((r, i) => ws.send(JSON.stringify({ ...r, req_id: i + 1 })));
    });
    try {
        ws.close(1000, 'done');
    } catch {
        /* already closed */
    }
    return results;
};

const SCAN_SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
const PIP = { R_10: 3, R_25: 3, R_50: 4, R_75: 4, R_100: 2 };
const quote = (sym, key, currency) => {
    const { contract_type, barrier } = contractOf(key);
    return {
        proposal: 1,
        amount: 10,
        basis: 'stake',
        contract_type,
        currency,
        duration: 1,
        duration_unit: 't',
        underlying_symbol: sym,
        ...(barrier === null ? {} : { barrier: String(barrier) }),
    };
};
const quoteRatio = r =>
    r?.proposal ? (Number(r.proposal.payout) - Number(r.proposal.ask_price)) / Number(r.proposal.ask_price) : null;

/**
 * Compares markets for a Premium strategy on what can really be known: Deriv's live payout for each
 * contract (the best-paid one has the smallest margin), and a randomness test on the last 1,000 ticks.
 */
const scan = async (env, body, rules) => {
    const { presets } = rules;
    const preset = Object.hasOwn(presets, presetKey(body?.preset)) ? presetKey(body.preset) : 'target';
    const maxMargin = typeof body?.maxMargin === 'number' && body.maxMargin >= 1 && body.maxMargin <= 50 ? body.maxMargin : 12;
    const g = presets[preset].group;
    const keys = GROUPS[g === 'all' ? 'half' : g]; // Apex is compared on the 50% contracts here: fewer requests
    const cur = /^[A-Z]{3}$/.test(body?.currency || '') ? body.currency : 'USD';
    const symbols = Array.isArray(body?.symbols)
        ? body.symbols.filter(sym => SCAN_SYMBOLS.includes(sym)).slice(0, 5)
        : SCAN_SYMBOLS;
    const per = keys.length + 1;
    const reqs = [];
    symbols.forEach(sym => {
        reqs.push({ ticks_history: sym, count: 1000, end: 'latest', style: 'ticks' });
        keys.forEach(k => reqs.push(quote(sym, k, cur)));
    });
    let res;
    try {
        res = await derivBatch(env, reqs);
    } catch {
        return fail(503, 'Deriv market data is unavailable. Try again shortly.');
    }
    const rows = symbols
        .map((sym, i) => {
            const [hist, ...quotes] = res.slice(i * per, i * per + per);
            const ratios = {};
            keys.forEach((k, j) => {
                const r = quoteRatio(quotes[j]);
                if (r !== null && r > 0) ratios[k] = Math.round(r * 10000) / 10000;
            });
            if (!Object.keys(ratios).length) return null;
            const best = bestOf(Object.keys(ratios), ratios);
            const pip = hist?.pip_size ?? PIP[sym] ?? 2;
            const digits = (hist?.history?.prices || []).map(x => {
                const t = Number(x).toFixed(pip);
                return +t[t.length - 1];
            });
            const expected = expectedOf(best, ratios);
            return {
                symbol: sym,
                contract: best,
                win_chance: winProb(best),
                payout: ratios[best],
                expected,
                margin: -expected,
                tradable: expected >= -maxMargin / 100, // the same limit as KAPA AI's "maximum Deriv margin"
                ratios,
                randomness: randomnessCheck(digits),
            };
        })
        .filter(Boolean)
        .sort((a, b) => b.expected - a.expected);
    return json({ preset, rows });
};

// ---------- Routes ----------
const handle = async (req, env) => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const ip = clientIp(req);
    const price = Number(env.PRICE_XOF || 0);
    const days = Number(env.PLAN_DAYS || 30);
    const currency = env.CURRENCY || 'XOF';
    if (rateLimited(`all:${ip}`, 240)) return fail(429, 'Too many requests. Wait a minute and try again.');
    let loaded;
    const rules = () => (loaded ??= loadRules(env)); // only Premium routes need them; payments keep working if they're misconfigured

    if (req.method === 'GET' && path === '/') return json({ service: 'Kapa Premium server', status: 'online' });

    if (req.method === 'GET' && path === '/plan')
        return json({
            price,
            currency,
            days,
            configured: Boolean(env.CINETPAY_APIKEY && env.CINETPAY_SITE_ID && price > 0),
            contact: await contactLinks(env),
        });

    // CinetPay calls this after each payment attempt; only the transaction id is used, then verified with CinetPay
    if (path === '/cinetpay/notify') {
        if (req.method !== 'POST') return new Response('OK');
        const form = await req.formData().catch(() => null);
        const id = String(form?.get('cpm_trans_id') || '');
        if (TX_ID.test(id) && !rateLimited(`notify:${id}`, 10)) await settle(env, id);
        return new Response('OK');
    }

    // Where CinetPay sends the buyer back (GET or POST): settle, then return to the site
    if (path === '/return') {
        const id = url.searchParams.get('tx') || '';
        const valid = TX_ID.test(id);
        if (valid) await settle(env, id);
        return new Response(null, {
            status: 303,
            headers: { location: `${env.SITE_URL}${valid ? `?premium_tx=${id}` : ''}#kapa_ai` },
        });
    }

    if (path.startsWith('/admin/')) {
        if (rateLimited(`admin:${ip}`, 30)) return fail(429, 'Too many attempts. Wait a minute.');
        const lockKey = `adminfail:${await sha256(ip)}`;
        const fails = Number((await env.KAPA_KV.get(lockKey)) || 0);
        if (fails >= 10) return fail(429, 'Too many wrong attempts. Try again in an hour.');
        if (
            !(
                env.ADMIN_SECRET &&
                env.ADMIN_SECRET.length >= 20 &&
                (await safeEqual(req.headers.get('x-admin-secret') || '', env.ADMIN_SECRET))
            )
        ) {
            await env.KAPA_KV.put(lockKey, String(fails + 1), { expirationTtl: 3600 });
            return fail(401, 'Wrong admin secret');
        }
        const ready = Boolean(env.SESSION_KEY && env.SESSION_KEY.length >= 32);
        if (req.method === 'GET' && path === '/admin/payments') return json({ payments: await listPrefix(env, 'tx:') });
        if (req.method === 'GET' && path === '/admin/overview') {
            const ents = await listPrefix(env, 'ent:');
            const groups = new Map();
            for (const { value } of ents) if (value) groups.set((value.group || []).join(','), entView(value));
            const gifts = (await listPrefix(env, 'gift:')).map(g => giftView(g.value)).filter(Boolean);
            const c = (await env.KAPA_KV.get('settings:contact', 'json').catch(() => null)) || {};
            return json({
                ready,
                days,
                entitlements: [...groups.values()].sort((a, b) => b.until - a.until),
                gifts: gifts.sort((a, b) => b.createdAt - a.createdAt),
                contact: { whatsapp: c.whatsapp || '', telegram: c.telegram || '' },
                payments: { configured: Boolean(env.CINETPAY_APIKEY && env.CINETPAY_SITE_ID && price > 0), price, currency },
            });
        }
        if (req.method !== 'POST') return fail(404, 'Not found');
        const body = (await readJson(req)) || {};
        // Activate (or extend) Premium for one Deriv account
        if (path === '/admin/entitlements') {
            const account = String(body.account || '').trim().toUpperCase();
            const d = Number.isInteger(body.days) && body.days >= 1 && body.days <= 366 ? body.days : days;
            if (!ACCOUNT_ID.test(account)) return fail(400, 'Enter a Deriv account ID, like CR1234567 or VRTC1234567.');
            return json({ entitlement: entView(await grant(env, [account], d, 'admin', String(body.note || 'Admin'))) });
        }
        if (path === '/admin/entitlements/revoke') {
            const account = String(body.account || '').trim().toUpperCase();
            if (!ACCOUNT_ID.test(account)) return fail(400, 'Unknown account.');
            const rec = await revoke(env, account);
            return rec ? json({ entitlement: entView(rec) }) : fail(404, 'This account has no Premium.');
        }
        // A new gift code; the code itself is shown only in this answer (only its hash is kept)
        if (path === '/admin/gifts') {
            if (!ready) return fail(503, 'Set SESSION_KEY on the server first');
            const custom = body.code ? normalizeCode(body.code) : '';
            if (custom && !CODE_OK.test(custom))
                return fail(400, 'A code needs 8 to 64 letters, digits or _ . @ # ! * + = (spaces and dashes are ignored)');
            const code = custom ? String(body.code).trim().toUpperCase() : newGiftCode();
            const id = await giftId(env, code);
            if (await env.KAPA_KV.get(`gift:${id}`)) return fail(409, 'This code already exists.');
            const maxUses = Number.isInteger(body.maxUses) && body.maxUses >= 1 && body.maxUses <= 10000 ? body.maxUses : 1;
            const d = Number.isInteger(body.days) && body.days >= 1 && body.days <= 366 ? body.days : days;
            const label = String(body.label || '').trim().slice(0, 60) || 'Gift';
            const g = { id, label, maxUses, uses: 0, days: d, createdAt: Date.now(), disabled: false, hint: normalizeCode(code).slice(-4), redeemed: [] };
            await env.KAPA_KV.put(`gift:${id}`, JSON.stringify(g));
            return json({ code, gift: giftView(g) });
        }
        if (path === '/admin/gifts/disable') {
            const id = String(body.id || '');
            const g = /^[\w-]{24}$/.test(id) ? await env.KAPA_KV.get(`gift:${id}`, 'json') : null;
            if (!g) return fail(404, 'Gift code not found.');
            g.disabled = body.disabled !== false;
            await env.KAPA_KV.put(`gift:${id}`, JSON.stringify(g));
            return json({ gift: giftView(g) });
        }
        // Contact links shown to visitors who want Premium (WhatsApp number, Telegram username)
        if (path === '/admin/settings') {
            const wa = String(body.whatsapp ?? '').replace(/[\s()+-]/g, '');
            const tg = String(body.telegram ?? '').trim().replace(/^@/, '');
            if (wa && !/^[1-9]\d{7,14}$/.test(wa)) return fail(400, 'WhatsApp: the full international number, digits only (for example 2250700000000).');
            if (tg && !/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(tg)) return fail(400, 'Telegram: a username of 5 to 32 letters, digits or _.');
            await env.KAPA_KV.put('settings:contact', JSON.stringify({ whatsapp: wa, telegram: tg }));
            return json({ contact: { whatsapp: wa, telegram: tg } });
        }
        return fail(404, 'Not found');
    }

    // Session plan: free for everyone (it shows the risk before anyone pays), CPU-bounded
    if (req.method === 'POST' && path === '/plan/simulate') {
        if (rateLimited(`sim:${ip}`, 30)) return fail(429, 'Too many simulations. Wait a minute.');
        const body = await readJson(req);
        const capital = Number.isFinite(body?.capital) && body.capital > 0 ? Math.min(body.capital, 1e8) : 1000;
        if (body?.preset === 'classic') {
            const v = classicSettings(body, rules().presets);
            if (v.error) return fail(400, v.error);
            const s = { ...v.settings, stopLoss: Math.min(v.settings.stopLoss, capital) };
            return json(simulateClassic(s, cleanRatios(body.ratios), estRatio));
        }
        const v = validateSettings(body, rules().presets);
        if (v.error) return fail(400, v.error);
        return json(simulate(v.settings, capital, cleanRatios(body.ratios)));
    }

    // Strategy lab: replays real Deriv ticks, fetched by the visitor's own browser, through every
    // strategy with Deriv's real payouts. Free for everyone: it shows what each strategy really does.
    if (req.method === 'POST' && path === '/lab/backtest') {
        if (rateLimited(`lab:${ip}`, 6)) return fail(429, 'Too many tests. Wait a minute.');
        const body = await readJson(req);
        const digits = typeof body?.digits === 'string' && /^[0-9]{100,6000}$/.test(body.digits) ? [...body.digits].map(Number) : null;
        if (!digits) return fail(400, 'Send between 100 and 6,000 real last digits.');
        const n = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
        const stake = n(body.stake, 0.35, 50000);
        const takeProfit = n(body.takeProfit, 0.01, 1e7);
        const stopLoss = n(body.stopLoss, 0.35, 1e7);
        const capital = n(body.capital, 1, 1e8) ?? 1000;
        if (stake === null || takeProfit === null || stopLoss === null)
            return fail(400, 'Stake, take-profit and stop-loss are required.');
        const ratios = cleanRatios(body.ratios);
        const results = Object.fromEntries(
            Object.entries(labStrategies(rules().presets, { stake: Math.min(stake, stopLoss), takeProfit, stopLoss, capital })).map(
                ([k, st]) => [k, backtest(st, digits, ratios)]
            )
        );
        return json({ ticks: digits.length, results });
    }

    // Everything below needs a signed-in Deriv user
    const ids = await derivAccounts(req, env);

    // ----- Premium state of this Deriv user (also moves a device that used the old shared code) -----
    if (req.method === 'GET' && path === '/premium/status') {
        if (!ids) return json({ status: 'inactive', reason: 'login' });
        let ent = await entitlement(env, ids);
        let migrated = false;
        if (!ent.rec && (await legacyPass(env, req))) {
            await grant(env, ids, days, 'code', 'Old shared code');
            ent = await entitlement(env, ids);
            migrated = true;
        }
        return json({
            status: ent.active ? 'active' : ent.rec ? 'expired' : 'inactive',
            until: ent.until,
            accounts: ids,
            ...(migrated ? { migrated: true } : {}),
        });
    }

    // ----- Gift codes: each use gives Premium to the Deriv user who enters it -----
    if (req.method === 'POST' && (path === '/premium/redeem' || path === '/premium/unlock')) {
        if (rateLimited(`unlock:${ip}`, 40)) return fail(429, 'Too many attempts. Wait a minute.');
        if (!ids) return fail(401, 'Log in with Deriv first: the code gives Premium to your Deriv account.');
        if (!env.SESSION_KEY || env.SESSION_KEY.length < 32) return fail(503, 'Premium is not set up yet');
        const keys = await codeThrottleKeys(req, ip);
        const wait = await codeWait(env, keys);
        if (wait) return tooManyCodes(wait);
        const body = await readJson(req);
        const given = normalizeCode(body?.code);
        const g = CODE_OK.test(given) ? await env.KAPA_KV.get(`gift:${await giftId(env, given)}`, 'json') : null;
        if (!g) {
            await codeFailed(env, keys);
            return fail(401, 'Wrong code. Check it and try again.');
        }
        if (g.disabled) return fail(410, 'This code has been switched off by Kapa.');
        if ((g.redeemed || []).some(r => r.accounts.some(a => ids.includes(a))))
            return fail(409, 'This code was already used on your Deriv account.');
        if (g.uses >= g.maxUses) return fail(410, 'This code has already been used as many times as it allows.');
        g.uses += 1;
        g.redeemed = [...(g.redeemed || []), { accounts: ids, at: Date.now() }].slice(-500);
        await env.KAPA_KV.put(`gift:${g.id}`, JSON.stringify(g));
        await env.KAPA_KV.delete(keys.device).catch(() => {});
        const rec = await grant(env, ids, g.days, 'gift', g.label);
        return json({ status: 'active', until: rec.until, accounts: ids, days: g.days });
    }

    if (!ids) return fail(401, 'Log in with Deriv first');

    if (req.method === 'POST' && path === '/checkout') {
        if (!(env.CINETPAY_APIKEY && env.CINETPAY_SITE_ID && price > 0))
            return fail(503, 'Payments are not set up yet');
        if (rateLimited(`checkout:${ids[0]}`, 5, 10 * 60000))
            return fail(429, 'Too many payment attempts. Wait a few minutes.');
        const transactionId = `kapa_${Date.now().toString(36)}_${[...crypto.getRandomValues(new Uint8Array(5))].map(x => x.toString(16).padStart(2, '0')).join('')}`;
        const tx = { status: 'pending', accounts: ids, amount: price, currency, days, createdAt: Date.now() };
        await env.KAPA_KV.put(`tx:${transactionId}`, JSON.stringify(tx));
        const res = await fetch(`${CINETPAY}/payment`, {
            signal: AbortSignal.timeout(10000),
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                apikey: env.CINETPAY_APIKEY,
                site_id: env.CINETPAY_SITE_ID,
                transaction_id: transactionId,
                amount: price,
                currency,
                description: `Kapa Trader Premium ${days} days`,
                notify_url: `${url.origin}/cinetpay/notify`,
                return_url: `${url.origin}/return?tx=${transactionId}`, // CinetPay may POST here; GitHub Pages can't accept POST
                channels: 'ALL',
                lang: 'FR',
            }),
        });
        const body = await res.json().catch(() => ({}));
        if (
            body?.code !== '201' ||
            !body?.data?.payment_url ||
            !/^https:\/\/[\w.-]*cinetpay\.com\//.test(body.data.payment_url)
        ) {
            await env.KAPA_KV.put(
                `tx:${transactionId}`,
                JSON.stringify({ ...tx, status: 'failed', reason: 'init failed' })
            );
            return fail(502, 'The payment could not be started. Try again later.');
        }
        return json({ transaction_id: transactionId, payment_url: body.data.payment_url });
    }

    if (req.method === 'GET' && path === '/checkout/status') {
        const id = url.searchParams.get('tx') || '';
        if (!TX_ID.test(id)) return fail(404, 'Payment not found');
        const tx = await env.KAPA_KV.get(`tx:${id}`, 'json');
        if (!tx || !tx.accounts.some(a => ids.includes(a))) return fail(404, 'Payment not found');
        const settled = await settle(env, id);
        return json({ status: settled.status, until: settled.until ?? null });
    }

    // ----- Premium tools and strategy sessions: checked against the account's Premium on every request -----
    const ent = await entitlement(env, ids);
    if (!ent.active)
        return fail(402, ent.rec ? 'Your KAPA AI Premium has ended. Renew it to use this.' : 'This is part of KAPA AI Premium.');
    if (rateLimited(`premium:${ids[0]}`, 120)) return fail(429, 'Too many requests. Wait a minute.');

    if (req.method === 'POST' && path === '/scan') {
        if (rateLimited(`scan:${ip}`, 10)) return fail(429, 'Too many scans. Wait a minute.');
        return scan(env, await readJson(req), rules());
    }
    const bot = path.match(/^\/bots\/([a-z0-9-]{1,40})$/);
    if (req.method === 'GET' && bot) {
        const { bots } = rules();
        const data = Object.hasOwn(bots, bot[1]) ? bots[bot[1]] : null;
        return data ? json({ id: bot[1], data }) : fail(404, 'Bot not found');
    }

    // Classic bots with KAPA Apex recovery: after a loss, the next trade (the entry trades run in the website)
    if (req.method === 'POST' && path === '/classic/recover') {
        const body = await readJson(req);
        const v = classicSettings(body, rules().presets);
        if (v.error) return fail(400, v.error);
        const st = cleanState(body.state);
        if (!st) return fail(400, 'Invalid session state.');
        return json({ decision: decide(v.settings, st, cleanRatios(body.ratios)) });
    }

    if (req.method === 'POST' && path === '/session/start') {
        if (!env.SESSION_KEY || env.SESSION_KEY.length < 32) return fail(503, 'Strategy sessions are not set up yet');
        const body = await readJson(req);
        const v = validateSettings(body, rules().presets);
        if (v.error) return fail(400, v.error);
        const s = v.settings;
        const ratios = cleanRatios(body.ratios);
        const st = freshState(s);
        const decision = decide(s, st, ratios);
        const token = await signSession(env, {
            v: 1,
            acc: ids,
            s,
            st,
            r: ratios,
            last: null,
            d: decision,
            exp: Date.now() + SESSION_TTL,
        });
        return json({ session: token, decision });
    }

    if (req.method === 'POST' && path === '/session/next') {
        if (!env.SESSION_KEY) return fail(503, 'Strategy sessions are not set up yet');
        const body = await readJson(req);
        const p = await readSession(env, body?.session);
        if (!p || !p.acc.some(a => ids.includes(a)))
            return fail(400, 'This strategy session has expired. Start KAPA AI again.');
        const r = body.result || {};
        const contractId = Number(r.contract_id);
        const buy = Number(r.buy_price);
        const profit = Number(r.profit);
        if (!Number.isSafeInteger(contractId) || contractId <= 0) return fail(400, 'Invalid contract.');
        if (p.last === contractId) return json({ session: body.session, decision: p.d }); // the same result sent twice
        if (!(buy >= 0.35 && buy <= p.s.maxStake * 1.01 + 0.01) || !(profit >= -buy - 0.01 && profit <= buy * 20))
            return fail(400, 'Invalid contract result.');
        const ratios = {
            ...p.r,
            ...Object.fromEntries(Object.entries(cleanRatios(body.ratios)).filter(([, x]) => x !== null)),
        };
        const st = applyResult(p.s, p.st, { buy_price: buy, profit });
        const decision = decide(p.s, st, ratios);
        const token = await signSession(env, { ...p, st, r: ratios, last: contractId, d: decision });
        return json({ session: token, decision, state: { pl: st.pl, runs: st.runs, streak: st.streak } });
    }

    return fail(404, 'Not found');
};

export default {
    async fetch(req, env) {
        const cors = corsHeaders(req, env);
        if (req.method === 'OPTIONS')
            return new Response(null, { status: 204, headers: { ...cors, ...SECURITY_HEADERS } });
        let res;
        try {
            res = await handle(req, env);
        } catch (e) {
            if (e instanceof HttpError) res = fail(e.status, e.message);
            else {
                console.error('kapa: unexpected error', req.method, new URL(req.url).pathname, e);
                res = fail(500, `Kapa server error: ${String(e?.message || e).slice(0, 120)}`);
            }
        }
        const out = new Response(res.body, res);
        Object.entries({ ...SECURITY_HEADERS, ...cors }).forEach(([k, v]) => out.headers.set(k, v));
        return out;
    },
};

export { estRatio }; // re-exported for tests
