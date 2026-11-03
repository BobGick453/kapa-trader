import type { TContractResult, TDecision, TPayoutRatios, TPolicy, TSettings } from '../kapa-ai/engine';
import { recordDiag } from '@/utils/kapa-diagnostics';
import { setPremium } from './use-premium';

/**
 * Kapa Premium server (server/worker.js). It runs the Premium strategies, the scanner and the
 * Premium session plans, and sells Premium. Empty until the server is deployed: Premium tools
 * are then unavailable and only the free tools work.
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

// The Premium pass the server returns for a correct code. It proves nothing by itself: the server
// checks its signature, and that it was made for the current code, on every Premium request.
const PASS_KEY = 'kapa_premium_pass';
const readPass = (): string | null => {
    try {
        return localStorage.getItem(PASS_KEY);
    } catch {
        return null;
    }
};
const savePass = (pass: string | null) => {
    try {
        if (pass) localStorage.setItem(PASS_KEY, pass);
        else localStorage.removeItem(PASS_KEY);
    } catch {
        /* the pass then lasts for this visit only */
    }
};

const callOnce = async (path: string, init: RequestInit = {}, timeoutMs = path === '/scan' ? 30000 : 15000) => {
    const token = accessToken();
    const pass = readPass();
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
// instead of showing "Server error". Payments are never retried automatically.
const RETRYABLE = /^\/(premium\/(status|unlock)|scan|bots\/|plan|session\/start)/;
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

export type TPlan = { price: number; currency: string; days: number; configured: boolean };

export const fetchPlan = (): Promise<TPlan> => call('/plan');

/** Refreshes the shared Premium state: asks the server whether this device's pass is still valid. */
export const refreshEntitlement = async () => {
    if (!premiumEnabled()) return setPremium({ status: 'off' });
    if (!readPass()) return setPremium({ status: 'inactive' });
    setPremium({ status: 'checking' });
    try {
        const r = await call('/premium/status');
        if (r?.status === 'active' && typeof r.pass === 'string' && /^[\w-]+\.[\w-]+$/.test(r.pass)) {
            savePass(r.pass);
            setPremium({ status: 'active', plan: 'premium' });
        } else {
            savePass(null); // the code was changed: the new code is needed
            setPremium({ status: 'inactive' });
        }
    } catch (e: any) {
        if (e?.status === 401 || e?.status === 402 || e?.status === 403) {
            savePass(null);
            setPremium({ status: 'inactive' });
        } else {
            // The server didn't answer this time. Keep the pass: the server still checks it on every
            // Premium request, so this never opens anything by itself.
            setPremium({ status: 'active', plan: 'premium' });
        }
    }
};

/** Unlocks Premium on this device with the secret code. Only the server can tell whether the code is right. */
export const unlockPremium = async (code: string) => {
    if (!premiumEnabled())
        throw new Error(
            "The Kapa Premium server isn't connected to this site yet, so the code can't be checked. Premium opens as soon as it is."
        );
    const r = await call('/premium/unlock', { method: 'POST', body: JSON.stringify({ code }) });
    // Only a real Kapa server answer counts: anything else leaves Premium locked
    if (r?.status !== 'active' || typeof r.pass !== 'string' || !/^[\w-]+\.[\w-]+$/.test(r.pass))
        throw new Error("The Kapa Premium server isn't answering correctly yet. Try again in a moment.");
    savePass(r.pass);
    setPremium({ status: 'active', plan: 'premium' });
};

/** Locks Premium again on this device. */
export const lockPremium = () => {
    savePass(null);
    setPremium({ status: premiumEnabled() ? 'inactive' : 'off' });
};

/** Starts a CinetPay payment (mobile money or card) and leaves for CinetPay's checkout page. */
export const startCheckout = async () => {
    const { payment_url } = await call('/checkout', { method: 'POST', body: '{}' });
    window.location.assign(payment_url);
};

/** After CinetPay sends the buyer back (?premium_tx=…), waits for the server to confirm the payment. */
export const resumeCheckout = async (onUpdate: (text: string) => void) => {
    const params = new URLSearchParams(window.location.search);
    const tx = params.get('premium_tx');
    if (!tx || !premiumEnabled()) return;
    params.delete('premium_tx');
    window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`
    );
    onUpdate('Checking your payment with CinetPay…');
    for (let i = 0; i < 40; i++) {
        try {
            const s = await call(`/checkout/status?tx=${encodeURIComponent(tx)}`);
            if (s.status === 'paid') {
                return onUpdate(
                    `Payment confirmed. Send this reference to Kapa on WhatsApp or Telegram to receive your Premium code: ${tx}`
                );
            }
            if (s.status === 'failed')
                return onUpdate('The payment was refused or cancelled. No money was taken for Premium.');
        } catch (e: any) {
            if (e?.status === 401) return onUpdate('Log in with Deriv to check your payment.');
        }
        await new Promise(r => setTimeout(r, 3000));
    }
    onUpdate(
        `Your payment is still being processed. Once CinetPay confirms it, send this reference to Kapa to receive your Premium code: ${tx}`
    );
};

// ---- Premium tools: everything below is decided by the server, which checks the membership each time ----

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
});

/** A Premium strategy running on the server: each settled contract goes up, the next trade comes back. */
export const remotePolicy = (s: TSettings, ratios: TPayoutRatios): TPolicy => {
    let session = '';
    return {
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

export type TPlanResult = { hit: number; bust: number; avg: number; bustAvg: number; median: number; sessions: number };

/** Session plan for a Premium strategy, simulated by the server (free for everyone). */
export const simulatePlan = (s: TSettings, capital: number, ratios: TPayoutRatios): Promise<TPlanResult> =>
    post('/plan/simulate', { ...settingsBody(s), capital, ratios });

export type TScanRow = {
    symbol: string;
    barrier: number;
    recovery: number | null;
    win_chance: number;
    payout: number;
    recovery_payout: number | null;
    expected: number;
    recent: number | null;
    recent_ticks: number;
};

/** Live market scan, run by the server over Deriv's public prices. Premium only. */
export const scanMarkets = (
    preset: string,
    currency: string,
    symbols?: string[]
): Promise<{ preset: string; rows: TScanRow[] }> =>
    post('/scan', { preset, currency, ...(symbols ? { symbols } : {}) });

/** Settings of a Premium bot from the Free Bot library. Premium only. */
export const fetchPremiumBot = async (id: string) => (await call(`/bots/${encodeURIComponent(id)}`)).data;

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

export const adminApi = {
    payments: (secret: string) => adminCall('/admin/payments', secret),
    code: (secret: string) => adminCall('/admin/code', secret),
    setCode: (secret: string, code: string) => adminCall('/admin/code', secret, { code }),
};
