/**
 * Kapa Premium server (Cloudflare Worker + KV).
 *
 * - Identifies users by asking Deriv which accounts their OAuth access token belongs to.
 * - Sells Premium through CinetPay (mobile money and cards) and only grants access after
 *   checking the transaction with CinetPay's verification API (notifications alone are not trusted).
 * - Stores entitlements per Deriv account in KV (`ent:<account_id>`), payments as `tx:<id>`.
 * - Admin endpoints are protected by the ADMIN_SECRET secret, which never leaves the server.
 *
 * Bindings: KV namespace KAPA_KV. Secrets: CINETPAY_APIKEY, CINETPAY_SITE_ID, ADMIN_SECRET.
 * Vars: PRICE_XOF, PLAN_DAYS, CURRENCY, SITE_URL, ALLOWED_ORIGINS (comma separated), DERIV_API.
 */

const CINETPAY = 'https://api-checkout.cinetpay.com/v2';
const DAY = 24 * 60 * 60 * 1000;

const json = (body, status = 200, headers = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

const corsHeaders = (req, env) => {
    const origin = req.headers.get('origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!allowed.includes(origin)) return {};
    return {
        'access-control-allow-origin': origin,
        'access-control-allow-headers': 'authorization, content-type, x-admin-secret',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        vary: 'Origin',
    };
};

const timingSafeEqual = (a, b) => {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
};

/** Returns the Deriv account ids the bearer token belongs to, or null if Deriv rejects it. */
const derivAccounts = async (req, env) => {
    const auth = req.headers.get('authorization') || '';
    if (!/^Bearer \S+$/.test(auth)) return null;
    const res = await fetch(`${env.DERIV_API || 'https://api.derivws.com'}/trading/v1/options/accounts`, {
        headers: { authorization: auth, accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    const ids = (Array.isArray(body?.data) ? body.data : []).map(a => String(a.account_id || '')).filter(Boolean);
    return ids.length ? ids : null;
};

const activeEntitlement = async (env, ids) => {
    let best = null;
    for (const id of ids) {
        const e = await env.KAPA_KV.get(`ent:${id}`, 'json');
        if (e && e.expiresAt > Date.now() && (!best || e.expiresAt > best.expiresAt)) best = e;
    }
    return best;
};

const grant = async (env, ids, days, source) => {
    const current = await activeEntitlement(env, ids);
    const from = current ? current.expiresAt : Date.now(); // a renewal extends the current period
    const ent = { plan: 'premium', expiresAt: from + days * DAY, grantedAt: Date.now(), source };
    for (const id of ids) await env.KAPA_KV.put(`ent:${id}`, JSON.stringify({ ...ent, accounts: ids }));
    return ent;
};

const cinetpayCheck = async (env, transactionId) => {
    const res = await fetch(`${CINETPAY}/payment/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ apikey: env.CINETPAY_APIKEY, site_id: env.CINETPAY_SITE_ID, transaction_id: transactionId }),
    });
    return res.json().catch(() => ({}));
};

/** Verifies a payment with CinetPay and grants Premium once. Safe to call repeatedly. */
const settle = async (env, transactionId) => {
    const tx = await env.KAPA_KV.get(`tx:${transactionId}`, 'json');
    if (!tx) return { status: 'unknown' };
    if (tx.status === 'paid' || tx.status === 'failed') return tx;
    const check = await cinetpayCheck(env, transactionId);
    const status = check?.data?.status;
    const paidAmount = Number(check?.data?.amount);
    if (check?.code === '00' && status === 'ACCEPTED' && paidAmount >= tx.amount && (!check?.data?.currency || check.data.currency === tx.currency)) {
        const ent = await grant(env, tx.accounts, tx.days, `cinetpay:${transactionId}`);
        Object.assign(tx, { status: 'paid', paidAt: Date.now(), method: check.data.payment_method || null, expiresAt: ent.expiresAt });
    } else if (status === 'REFUSED' || status === 'CANCELED') {
        Object.assign(tx, { status: 'failed', reason: status });
    }
    await env.KAPA_KV.put(`tx:${transactionId}`, JSON.stringify(tx));
    return tx;
};

const listPrefix = async (env, prefix) => {
    const out = [];
    let cursor;
    do {
        const page = await env.KAPA_KV.list({ prefix, cursor });
        for (const k of page.keys) out.push({ key: k.name.slice(prefix.length), value: await env.KAPA_KV.get(k.name, 'json') });
        cursor = page.list_complete ? undefined : page.cursor;
    } while (cursor);
    return out;
};

const handle = async (req, env) => {
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const price = Number(env.PRICE_XOF || 0);
    const days = Number(env.PLAN_DAYS || 30);
    const currency = env.CURRENCY || 'XOF';

    if (req.method === 'GET' && path === '/plan') return json({ price, currency, days, configured: Boolean(env.CINETPAY_APIKEY && env.CINETPAY_SITE_ID && price > 0) });

    // CinetPay calls this after each payment attempt; the body is not trusted, only the transaction id is used
    if (path === '/cinetpay/notify') {
        if (req.method !== 'POST') return new Response('OK'); // CinetPay pings the URL with GET when it is registered
        const form = await req.formData().catch(() => null);
        const id = form?.get('cpm_trans_id');
        if (id && /^kapa_[a-z0-9_]+$/i.test(String(id))) await settle(env, String(id));
        return new Response('OK');
    }

    if (path.startsWith('/admin/')) {
        if (!timingSafeEqual(req.headers.get('x-admin-secret') || '', env.ADMIN_SECRET || '')) return json({ error: 'Wrong admin secret' }, 401);
        if (req.method === 'GET' && path === '/admin/entitlements') return json({ entitlements: await listPrefix(env, 'ent:') });
        if (req.method === 'GET' && path === '/admin/payments') return json({ payments: await listPrefix(env, 'tx:') });
        const body = await req.json().catch(() => ({}));
        const id = String(body.account_id || '').trim();
        if (!/^[A-Za-z0-9]{4,32}$/.test(id)) return json({ error: 'Enter a Deriv account ID, e.g. ROT90001' }, 400);
        if (req.method === 'POST' && path === '/admin/grant') {
            const d = Math.min(3650, Math.max(1, Number(body.days) || days));
            return json({ entitlement: await grant(env, [id], d, 'admin') });
        }
        if (req.method === 'POST' && path === '/admin/revoke') {
            await env.KAPA_KV.delete(`ent:${id}`);
            return json({ revoked: id });
        }
        return json({ error: 'Not found' }, 404);
    }

    // Where CinetPay sends the customer back (GET or POST): settle, then go back to the site
    if (path === '/return') {
        const id = url.searchParams.get('tx') || '';
        if (/^kapa_[a-z0-9_]+$/i.test(id)) await settle(env, id);
        return new Response(null, { status: 303, headers: { location: `${env.SITE_URL}?premium_tx=${encodeURIComponent(id)}#kapa_ai` } });
    }

    // Everything below needs a signed-in Deriv user
    const ids = await derivAccounts(req, env);
    if (!ids) return json({ error: 'Log in with Deriv first' }, 401);

    if (req.method === 'GET' && path === '/entitlement') {
        const e = await activeEntitlement(env, ids);
        return json(e ? { status: 'active', plan: e.plan, expiresAt: e.expiresAt } : { status: 'inactive' });
    }

    if (req.method === 'POST' && path === '/checkout') {
        if (!(env.CINETPAY_APIKEY && env.CINETPAY_SITE_ID && price > 0)) return json({ error: 'Payments are not set up yet' }, 503);
        const transactionId = `kapa_${Date.now().toString(36)}_${crypto.randomUUID().replace(/-/g, '').slice(0, 10)}`;
        const tx = { status: 'pending', accounts: ids, amount: price, currency, days, createdAt: Date.now() };
        await env.KAPA_KV.put(`tx:${transactionId}`, JSON.stringify(tx));
        const res = await fetch(`${CINETPAY}/payment`, {
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
                metadata: ids[0],
            }),
        });
        const body = await res.json().catch(() => ({}));
        if (body?.code !== '201' || !body?.data?.payment_url) {
            await env.KAPA_KV.put(`tx:${transactionId}`, JSON.stringify({ ...tx, status: 'failed', reason: body?.message || 'init failed' }));
            return json({ error: body?.description || body?.message || 'The payment could not be started' }, 502);
        }
        return json({ transaction_id: transactionId, payment_url: body.data.payment_url });
    }

    if (req.method === 'GET' && path === '/checkout/status') {
        const id = url.searchParams.get('tx') || '';
        const tx = await env.KAPA_KV.get(`tx:${id}`, 'json');
        if (!tx || !tx.accounts.some(a => ids.includes(a))) return json({ error: 'Payment not found' }, 404);
        const settled = await settle(env, id);
        return json({ status: settled.status, expiresAt: settled.expiresAt });
    }

    return json({ error: 'Not found' }, 404);
};

export default {
    async fetch(req, env) {
        const cors = corsHeaders(req, env);
        if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        let res;
        try {
            res = await handle(req, env);
        } catch (e) {
            res = json({ error: 'Server error' }, 500);
        }
        const out = new Response(res.body, res);
        Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
        out.headers.set('cache-control', 'no-store');
        return out;
    },
};
