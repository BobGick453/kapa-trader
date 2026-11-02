import type { TContractResult, TDecision, TPayoutRatios, TPolicy, TSettings } from '../kapa-ai/engine';
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

const call = async (path: string, init: RequestInit = {}) => {
    const token = accessToken();
    const pass = readPass();
    const res = await fetch(`${PREMIUM_API}${path}`, {
        ...init,
        headers: {
            ...(init.headers || {}),
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(pass ? { 'x-kapa-pass': pass } : {}),
            ...(init.body ? { 'content-type': 'application/json' } : {}),
        },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok)
        throw Object.assign(new Error(body?.error || `Premium server error (${res.status})`), { status: res.status });
    return body;
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
        if (r.status === 'active' && r.pass) {
            savePass(r.pass);
            setPremium({ status: 'active', plan: 'premium' });
        } else {
            savePass(null); // the code was changed: the new code is needed
            setPremium({ status: 'inactive' });
        }
    } catch {
        setPremium({ status: 'unavailable' }); // Premium stays locked; the user can retry
    }
};

/** Unlocks Premium on this device with the secret code. Only the server can tell whether the code is right. */
export const unlockPremium = async (code: string) => {
    const r = await call('/premium/unlock', { method: 'POST', body: JSON.stringify({ code }) });
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
