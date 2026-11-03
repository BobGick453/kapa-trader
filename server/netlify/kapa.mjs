/**
 * Netlify Function that runs the Kapa Premium server (worker.js) on Netlify.
 *
 * - Storage: Netlify Blobs (store "kapa"), built into every Netlify site, nothing to set up.
 *   Entries written with an expiry (lockouts) are wrapped as { v, e } and expire on read.
 * - SESSION_KEY: taken from the environment if set; otherwise generated once and kept in Blobs.
 * - Settings: Netlify environment variables, with Kapa's defaults for the rest.
 *
 * On the published branch this file lives at premium-server/netlify/functions/kapa.mjs and imports
 * the one-file server built by server/bundle.mjs.
 */
import { getStore } from '@netlify/blobs';
import worker from '../../kapa-premium-worker.js';

const DEFAULTS = {
    SITE_URL: 'https://bobgick453.github.io/kapa-trader/',
    ALLOWED_ORIGINS: 'https://bobgick453.github.io',
    CURRENCY: 'XOF',
    PLAN_DAYS: '30',
    PRICE_XOF: '0',
};
const NAMES = [
    'ADMIN_SECRET',
    'SESSION_KEY',
    'PREMIUM_CODE',
    'PREMIUM_RULES',
    'CINETPAY_APIKEY',
    'CINETPAY_SITE_ID',
    'PRICE_XOF',
    'PLAN_DAYS',
    'CURRENCY',
    'SITE_URL',
    'ALLOWED_ORIGINS',
    'DERIV_API',
    'DERIV_PUBLIC_WS',
];

const readVar = name => {
    try {
        const v = globalThis.Netlify?.env?.get(name);
        if (v) return v;
    } catch {
        /* outside Netlify */
    }
    return process.env[name] || '';
};

/** The KV interface worker.js expects, on top of a Netlify Blobs store. */
export const kvFromBlobs = store => ({
    async get(key, type) {
        const raw = await store.get(key, { type: 'text' });
        if (raw == null) return null;
        let entry;
        try {
            entry = JSON.parse(raw);
        } catch {
            return null;
        }
        if (entry.e && entry.e < Date.now()) {
            store.delete(key).catch(() => {});
            return null;
        }
        return type === 'json' ? JSON.parse(entry.v) : entry.v;
    },
    async put(key, value, opts = {}) {
        const e = opts.expirationTtl ? Date.now() + opts.expirationTtl * 1000 : 0;
        await store.set(key, JSON.stringify({ v: String(value), e }));
    },
    async delete(key) {
        await store.delete(key);
    },
    async list({ prefix } = {}) {
        const { blobs } = await store.list({ prefix });
        return { keys: blobs.map(b => ({ name: b.key })), list_complete: true };
    },
});

let storeFactory = () => getStore({ name: 'kapa', consistency: 'strong' });
let envPromise = null;

/** Test hook: use another store (never called in production). */
export const __useStore = factory => {
    storeFactory = factory;
    envPromise = null;
};

const sessionKey = async store => {
    const fromEnv = readVar('SESSION_KEY');
    if (fromEnv.length >= 32) return fromEnv;
    const saved = await store.get('config:session_key', { type: 'text' });
    if (saved && saved.length >= 32) return saved;
    const fresh = [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, '0')).join('');
    await store.set('config:session_key', fresh, { onlyIfNew: true }).catch(() => {});
    return (await store.get('config:session_key', { type: 'text' })) || fresh; // whichever instance wrote first wins
};

const loadEnv = async () => {
    const store = storeFactory();
    const env = { KAPA_KV: kvFromBlobs(store) };
    for (const n of NAMES) env[n] = readVar(n) || DEFAULTS[n] || '';
    env.SESSION_KEY = await sessionKey(store);
    return env;
};

export default async req => {
    envPromise ??= loadEnv().catch(e => {
        envPromise = null;
        throw e;
    });
    return worker.fetch(req, await envPromise);
};

export const config = { path: '/*' };
