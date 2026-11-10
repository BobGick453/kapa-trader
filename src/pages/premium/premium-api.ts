import type { TContractResult, TDecision, TPayoutRatios, TPolicy, TSettings } from '../kapa-ai/engine';
import { recordDiag } from '@/utils/kapa-diagnostics';
import { setPremium } from './use-premium';

/**
 * Kapa Premium server (server/worker.js). It runs the Premium strategies, the scanner and the
 * Premium session plans, and sells Premium. Empty until the server is deployed: Premium tools
 * are then unavailable and only the free tools work.
 *
 * Premium belongs to the Deriv account: the server reads which accounts the visitor's Deriv login
 * belongs to and checks their Premium on every request. The page only shows what the server answers.
 */
export const PREMIUM_API = (process.env.KAPA_API_URL || '').replace(/\/+$/, '');
export const premiumEnabled = () => Boolean(PREMIUM_API);

const accessToken = (): string | null => {
    try {
        return JSON.parse(sessionStorage.getItem('auth_info') || 'null')?.access_token ?? null;
    } catch {
        return null;
    }
};

// A pass from the old shared code (before Premium belonged to accounts). It is sent once with the status
// check so the server can move this device's Premium to the Deriv account, then deleted.
const PASS_KEY = 'kapa_premium_pass';
const readPass = (): string | null => {
    try {
        return localStorage.getItem(PASS_KEY);
    } catch {
        return null;
    }
};
const dropPass = () => {
    try {
        localStorage.removeItem(PASS_KEY);
    } catch {
        /* nothing to delete */
    }
};

// A random id for this device, sent with gift-code attempts: the server slows down a device that keeps
// entering wrong codes without blocking everyone who shares its address (mobile networks). Not personal data.
const DEVICE_KEY = 'kapa_device_id';
const deviceId = (): string | null => {
    try {
        let id = localStorage.getItem(DEVICE_KEY);
        if (!id || !/^[\w-]{8,64}$/.test(id)) {
            const b = new Uint8Array(12);
            crypto.getRandomValues(b);
            id = `d-${Array.from(b, x => x.toString(16).padStart(2, '0')).join('')}`;
            localStorage.setItem(DEVICE_KEY, id);
        }
        return id;
    } catch {
        return null;
    }
};

const callOnce = async (path: string, init: RequestInit = {}, timeoutMs = path === '/scan' ? 30000 : 15000) => {
    const token = accessToken();
    const pass = path === '/premium/status' ? readPass() : null;
    const device = path === '/premium/redeem' ? deviceId() : null;
    const where = path.split('?')[0];
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res: Response;
    try {
        res = await fetch(`${PREMIUM_API}${path}`, {
            ...init,
            signal: ctrl.signal,
            headers: {
                ...(init.headers || {}),
                ...(token ? { authorization: `Bearer ${token}` } : {}),
                ...(pass ? { 'x-kapa-pass': pass } : {}),
                ...(device ? { 'x-kapa-device': device } : {}),
                ...(init.body ? { 'content-type': 'application/json' } : {}),
            },
        });
    } catch (e: any) {
        const timedOut = e?.name === 'AbortError';
        recordDiag(
            'premium',
            `Premium server ${where}: ${timedOut ? 'no answer after ' + timeoutMs / 1000 + ' s' : 'unreachable'}`
        );
        throw new Error(
            timedOut
                ? "The Kapa Premium server didn't answer in time. Check your connection and try again."
                : "Couldn't reach the Kapa Premium server. Check your connection and try again in a moment."
        );
    } finally {
        clearTimeout(timer);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
        if (res.status >= 500)
            recordDiag('premium', `Premium server ${where}: ${res.status} ${body?.error || ''}`.trim());
        throw Object.assign(new Error(body?.error || `Premium server error (${res.status})`), { status: res.status });
    }
    return body;
};

// Requests that are safe to send again. A brief server or network hiccup is then retried quietly
// instead of showing "Server error". Payments and codes are never retried automatically.
const RETRYABLE = /^\/(premium\/status|scan|plan|session\/start|classic\/recover)/;
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

const call = async (path: string, init: RequestInit = {}, timeoutMs?: number) => {
    const retryable = RETRYABLE.test(path);
    for (let attempt = 0; ; attempt++) {
        try {
            return await callOnce(path, init, timeoutMs);
        } catch (e: any) {
            const transient = !e?.status || e.status >= 500; // no answer, or the server failed
            if (!retryable || !transient || attempt >= 2) throw e;
            await wait(attempt ? 1500 : 600);
        }
    }
};

export type TContact = { whatsapp: string | null; telegram: string | null };
export type TPlan = { price: number; currency: string; days: number; configured: boolean; contact?: TContact };

export const fetchPlan = (): Promise<TPlan> => call('/plan');

// While the Premium server can't be reached, Premium shows as unavailable (never as unlocked) and the
// check is repeated by itself: after 15 s, 30 s, 1 min... at most every 5 minutes
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let retryDelay = 15000;
const retryLater = () => {
    if (retryTimer) return;
    retryTimer = setTimeout(() => {
        retryTimer = null;
        refreshEntitlement();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 5 * 60 * 1000);
};
const reachable = () => {
    retryDelay = 15000;
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
};

/** Shows what the server says about the logged-in Deriv account's Premium. */
const applyStatus = (r: any) => {
    const accounts = Array.isArray(r?.accounts) ? r.accounts.filter((a: unknown) => typeof a === 'string') : [];
    const until = typeof r?.until === 'number' ? r.until : undefined;
    if (r?.status === 'active') setPremium({ status: 'active', plan: 'premium', expiresAt: until, accounts });
    else if (r?.status === 'expired') setPremium({ status: 'expired', expiresAt: until, accounts });
    else setPremium({ status: 'inactive', accounts, needsLogin: r?.reason === 'login' });
};

/** Refreshes the shared Premium state: asks the server about the logged-in Deriv account. */
export const refreshEntitlement = async () => {
    if (!premiumEnabled()) return setPremium({ status: 'off' });
    if (!accessToken()) return setPremium({ status: 'inactive', needsLogin: true });
    setPremium({ status: 'checking' });
    try {
        const r = await call('/premium/status');
        reachable();
        if (readPass() && r?.status) dropPass(); // the old shared code's pass was used (or is no longer needed)
        applyStatus(r);
    } catch (e: any) {
        if (e?.status === 401 || e?.status === 403) {
            reachable();
            setPremium({ status: 'inactive', needsLogin: e.status === 401 });
        } else {
            // The server didn't answer: Premium is not shown as unlocked until the server confirms it
            setPremium({ status: 'unavailable' });
            retryLater();
        }
    }
};

/** Uses a gift code: the server adds its days of Premium to the logged-in Deriv account. */
export const redeemGift = async (code: string) => {
    if (!premiumEnabled())
        throw new Error("The Kapa Premium server isn't connected to this site yet, so the code can't be checked.");
    if (!accessToken()) throw new Error('Log in with Deriv first: the code gives Premium to your Deriv account.');
    const r = await call('/premium/redeem', { method: 'POST', body: JSON.stringify({ code }) });
    if (r?.status !== 'active') throw new Error("The Kapa Premium server isn't answering correctly yet. Try again in a moment.");
    applyStatus(r);
    return r as { until: number; days: number; accounts: string[] };
};

/** Starts a CinetPay payment (mobile money or card) and leaves for CinetPay's checkout page. */
export const startCheckout = async () => {
    const { payment_url } = await call('/checkout', { method: 'POST', body: '{}' });
    window.location.assign(payment_url);
};

/** After CinetPay sends the buyer back (?premium_tx=…), waits for the server to confirm the payment. */
export const resumeCheckout = async (
    onUpdate: (text: string, state: 'checking' | 'paid' | 'failed' | 'pending') => void
) => {
    const params = new URLSearchParams(window.location.search);
    const tx = params.get('premium_tx');
    if (!tx || !premiumEnabled()) return;
    params.delete('premium_tx');
    window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`
    );
    onUpdate('Checking your payment with CinetPay…', 'checking');
    for (let i = 0; i < 40; i++) {
        try {
            const s = await call(`/checkout/status?tx=${encodeURIComponent(tx)}`);
            if (s.status === 'paid') {
                await refreshEntitlement();
                return onUpdate(
                    `Payment confirmed: KAPA AI Premium is active on your Deriv account${s.until ? ` until ${new Date(s.until).toLocaleDateString()}` : ''}. Payment reference: ${tx}`,
                    'paid'
                );
            }
            if (s.status === 'failed')
                return onUpdate('The payment was refused or cancelled. No money was taken for Premium.', 'failed');
        } catch (e: any) {
            if (e?.status === 401) return onUpdate('Log in with Deriv to check your payment.', 'pending');
        }
        await new Promise(r => setTimeout(r, 3000));
    }
    onUpdate(
        `Your payment is still being processed. Premium starts on your Deriv account as soon as CinetPay confirms it. Payment reference: ${tx}`,
        'pending'
    );
};

// ---- Premium tools: everything below is decided by the server, which checks Premium each time ----

const post = (path: string, body: unknown) => call(path, { method: 'POST', body: JSON.stringify(body) });

/** What the server needs to know about the user's settings. The strategy rules themselves stay on the server. */
const settingsBody = (s: TSettings) => ({
    preset: s.strategy,
    ...(s.strategy === 'custom' ? { custom: s.custom } : {}),
    symbol: s.symbol,
    stake: s.stake,
    takeProfit: s.takeProfit,
    stopLoss: s.stopLoss,
    maxStake: s.maxStake,
    ...(s.maxLosses !== null ? { maxLosses: s.maxLosses } : s.strategy === 'custom' ? { maxLosses: 4 } : {}),
    maxRuns: s.maxRuns || 0,
    maxMargin: s.maxMargin,
});

/** A Premium strategy running on the server: each settled contract goes up, the next trade comes back. */
export const remotePolicy = (s: TSettings, ratios: TPayoutRatios): TPolicy => {
    let session = '';
    return {
        // The server enforces these too; the page checks them again before every buy
        limits: { stopLoss: s.stopLoss, maxStake: Math.max(s.maxStake, 0.35) },
        start: async () => {
            const r = await post('/session/start', { ...settingsBody(s), ratios });
            session = r.session;
            return r.decision as TDecision;
        },
        next: async (result: TContractResult, live: TPayoutRatios) => {
            // The server ignores a result it has already counted, so a network retry is safe
            for (let attempt = 0; ; attempt++) {
                try {
                    const r = await post('/session/next', { session, result, ratios: live });
                    session = r.session;
                    return r.decision as TDecision;
                } catch (e: any) {
                    if (e?.status || attempt >= 2) throw e;
                    await new Promise(res => setTimeout(res, 1500));
                }
            }
        },
    };
};

/**
 * A classic bot's settings, as the server needs them for KAPA Apex recovery (Premium).
 * bot: 'switcher' | 'printer' | 'goldoe' | 'profitmaker'.
 */
export type TClassicServerSettings = {
    bot: string;
    symbol: string;
    stake: number;
    takeProfit: number;
    stopLoss: number;
    maxStake: number;
    maxMargin: number;
};
/**
 * KAPA Apex recovery for a classic bot (Premium): after a loss, the server answers with the next trade
 * (the contract and stake with the best chance of still reaching the take-profit) or a reason to stop.
 */
export const classicRecover = async (
    s: TClassicServerSettings,
    state: { pl: number; streak: number; lost: number; runs: number },
    ratios: TPayoutRatios
): Promise<TDecision> => (await post('/classic/recover', { ...s, state, ratios })).decision as TDecision;

export type TPlanResult = {
    hit: number;
    bust: number;
    avg: number;
    bustAvg: number;
    median: number;
    sessions: number;
    staked?: number;
    contract?: string;
};

/** Session plan for a Premium strategy, simulated by the server (free for everyone). */
export const simulatePlan = (s: TSettings, capital: number, ratios: TPayoutRatios): Promise<TPlanResult> =>
    post('/plan/simulate', { ...settingsBody(s), capital, ratios });
/** Session plan for a classic bot with KAPA Apex recovery, simulated by the server (free for everyone). */
export const simulateClassicPlan = (
    s: TClassicServerSettings,
    capital: number,
    ratios: TPayoutRatios
): Promise<TPlanResult> => post('/plan/simulate', { ...s, preset: 'classic', capital, ratios });

export type TRandomness = {
    ticks: number;
    uniform_p: number;
    serial_p: number;
    even_after_even: number;
    even_after_odd: number;
};
export type TScanRow = {
    symbol: string;
    contract: string; // best-paid contract, e.g. 'DIGITUNDER:5'
    win_chance: number;
    payout: number; // profit per 1 staked
    expected: number; // average result per 1 staked
    margin: number;
    tradable: boolean;
    ratios: Record<string, number>;
    randomness: TRandomness | null;
};
export type TBacktest = {
    sessions: number;
    tp: number;
    loss: number;
    refused: boolean;
    net: number;
    open: number;
    worst: number;
    trades: number;
    staked: number;
};
/** Replays real Deriv ticks through every strategy on the Kapa server, with Deriv's real payouts (free). */
export const labBacktest = (body: {
    digits: string;
    ratios: Record<string, number>;
    stake: number;
    takeProfit: number;
    stopLoss: number;
    capital: number;
}): Promise<{ ticks: number; results: Record<string, TBacktest> }> =>
    call('/lab/backtest', { method: 'POST', body: JSON.stringify(body) }, 30000);

/** Live market scan, run by the server over Deriv's public prices. Premium only. */
export const scanMarkets = (
    preset: string,
    currency: string,
    symbols?: string[],
    maxMargin?: number
): Promise<{ preset: string; rows: TScanRow[] }> =>
    post('/scan', { preset, currency, ...(symbols ? { symbols } : {}), ...(maxMargin ? { maxMargin } : {}) });


// ---- Admin (the secret is checked by the server and kept only for this browser tab) ----
const adminCall = (path: string, secret: string, body?: unknown) =>
    fetch(`${PREMIUM_API}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: { 'x-admin-secret': secret, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
    }).then(async res => {
        const b = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(b?.error || `Server error (${res.status})`);
        return b;
    });

export type TEntitlementView = {
    accounts: string[];
    until: number;
    since: number;
    source: 'payment' | 'gift' | 'admin' | 'code';
    ref: string;
    active: boolean;
    revokedAt: number | null;
};
export type TGiftView = {
    id: string;
    label: string;
    maxUses: number;
    uses: number;
    days: number;
    createdAt: number;
    disabled: boolean;
    hint: string;
    redeemed: { accounts: string[]; at: number }[];
};
export type TAdminOverview = {
    ready: boolean;
    days: number;
    entitlements: TEntitlementView[];
    gifts: TGiftView[];
    contact: { whatsapp: string; telegram: string };
    payments: { configured: boolean; price: number; currency: string };
};

export const adminApi = {
    overview: (secret: string): Promise<TAdminOverview> => adminCall('/admin/overview', secret),
    payments: (secret: string) => adminCall('/admin/payments', secret),
    activate: (secret: string, account: string, days?: number) =>
        adminCall('/admin/entitlements', secret, { account, ...(days ? { days } : {}) }),
    revoke: (secret: string, account: string) => adminCall('/admin/entitlements/revoke', secret, { account }),
    createGift: (secret: string, g: { label: string; maxUses: number; days?: number; code?: string }) =>
        adminCall('/admin/gifts', secret, g) as Promise<{ code: string; gift: TGiftView }>,
    disableGift: (secret: string, id: string, disabled = true) =>
        adminCall('/admin/gifts/disable', secret, { id, disabled }),
    saveContact: (secret: string, c: { whatsapp: string; telegram: string }) => adminCall('/admin/settings', secret, c),
};
