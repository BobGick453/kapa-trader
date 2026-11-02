import { setPremium } from './use-premium';

/** Kapa Premium server (server/worker.js). Empty until the server is deployed: Premium is then switched off and everything stays open. */
export const PREMIUM_API = (process.env.KAPA_API_URL || '').replace(/\/+$/, '');
export const premiumEnabled = () => Boolean(PREMIUM_API);

const accessToken = (): string | null => {
    try {
        return JSON.parse(sessionStorage.getItem('auth_info') || 'null')?.access_token ?? null;
    } catch {
        return null;
    }
};

const call = async (path: string, init: RequestInit = {}) => {
    const token = accessToken();
    const res = await fetch(`${PREMIUM_API}${path}`, {
        ...init,
        headers: { ...(init.headers || {}), ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.body ? { 'content-type': 'application/json' } : {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(body?.error || `Premium server error (${res.status})`), { status: res.status });
    return body;
};

export type TPlan = { price: number; currency: string; days: number; configured: boolean };

export const fetchPlan = (): Promise<TPlan> => call('/plan');

/** Refreshes the shared Premium state from the server. */
export const refreshEntitlement = async () => {
    if (!premiumEnabled()) return setPremium({ status: 'active', plan: 'open' });
    if (!accessToken()) return setPremium({ status: 'inactive' });
    setPremium({ status: 'checking' });
    try {
        const e = await call('/entitlement');
        setPremium(e.status === 'active' ? { status: 'active', plan: e.plan, expiresAt: e.expiresAt } : { status: 'inactive' });
    } catch {
        // Without an answer from the server Premium stays locked; the user can retry
        setPremium({ status: 'unavailable' });
    }
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
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash}`);
    onUpdate('Checking your payment with CinetPay…');
    for (let i = 0; i < 40; i++) {
        try {
            const s = await call(`/checkout/status?tx=${encodeURIComponent(tx)}`);
            if (s.status === 'paid') {
                await refreshEntitlement();
                return onUpdate('Payment confirmed. KAPA AI Premium is active.');
            }
            if (s.status === 'failed') return onUpdate('The payment was refused or cancelled. No money was taken for Premium.');
        } catch (e: any) {
            if (e?.status === 401) return onUpdate('Log in with Deriv to finish activating Premium.');
        }
        await new Promise(r => setTimeout(r, 3000));
    }
    onUpdate('Your payment is still being processed. Premium turns on automatically once CinetPay confirms it.');
};

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
    entitlements: (secret: string) => adminCall('/admin/entitlements', secret),
    payments: (secret: string) => adminCall('/admin/payments', secret),
    grant: (secret: string, account_id: string, days: number) => adminCall('/admin/grant', secret, { account_id, days }),
    revoke: (secret: string, account_id: string) => adminCall('/admin/revoke', secret, { account_id }),
};
