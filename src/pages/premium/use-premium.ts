import { useEffect, useState } from 'react';

/**
 * Premium entitlement as seen by the app. The entitlement server is the
 * source of truth; this module caches its answer for the current session.
 */
export type TPremiumState = {
    status: 'off' | 'unknown' | 'checking' | 'active' | 'inactive' | 'unavailable'; // off: no Premium server in this build
    expiresAt?: number;
    plan?: string;
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
        return () => {
            listeners.delete(setS);
        };
    }, []);
    return s;
};

/** Ask the app to open the Premium page (handled by the main tabs). */
export const openPremium = () => window.dispatchEvent(new CustomEvent('kapa:open-premium'));
