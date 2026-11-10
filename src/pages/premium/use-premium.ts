import { useEffect, useState } from 'react';

/**
 * Premium entitlement as seen by the app. The Kapa server is the source of truth (Premium belongs to the
 * Deriv account and is checked on every Premium request); this module caches its answer for the visit.
 */
export type TPremiumState = {
    // off: no Premium server in this build; expired: the account had Premium and it ended
    status: 'off' | 'unknown' | 'checking' | 'active' | 'inactive' | 'expired' | 'unavailable';
    expiresAt?: number;
    plan?: string;
    /** The Deriv accounts the server saw for this login */
    accounts?: string[];
    /** Premium can only be checked after logging in with Deriv */
    needsLogin?: boolean;
};

type TListener = (s: TPremiumState) => void;

let state: TPremiumState = { status: process.env.KAPA_API_URL ? 'unknown' : 'off' };
const listeners = new Set<TListener>();

export const getPremium = () => state;

export const setPremium = (next: TPremiumState) => {
    state = next;
    listeners.forEach(l => l(state));
};

export const usePremium = () => {
    const [s, setS] = useState(state);
    useEffect(() => {
        listeners.add(setS);
        setS(state);
        return () => {
            listeners.delete(setS);
        };
    }, []);
    return s;
};

/** Ask the app to open the Premium page (handled by the main tabs). */
export const openPremium = () => window.dispatchEvent(new CustomEvent('kapa:open-premium'));
