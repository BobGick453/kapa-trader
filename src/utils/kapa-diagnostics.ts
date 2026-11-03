/**
 * Connection diagnostics shown in the KAPA AI login card, so a screenshot tells what blocked
 * the Deriv connection on a user's device: addresses refused by the page's security policy,
 * WebSocket errors and closes (without any query string, so no one-time codes are recorded),
 * and the result of the last login attempt. Kept in this tab only (sessionStorage).
 */
export type TDiag = { at: number; kind: 'csp' | 'ws' | 'login'; text: string };

const KEY = 'kapa_diag';
const MAX = 14;
const listeners = new Set<() => void>();

export const readDiag = (): TDiag[] => {
    try {
        return JSON.parse(sessionStorage.getItem(KEY) || '[]');
    } catch {
        return [];
    }
};

export const recordDiag = (kind: TDiag['kind'], text: string) => {
    try {
        const list = [...readDiag(), { at: Date.now(), kind, text: String(text).slice(0, 160) }].slice(-MAX);
        sessionStorage.setItem(KEY, JSON.stringify(list));
    } catch {
        /* diagnostics are best effort */
    }
    listeners.forEach(l => l());
};

export const onDiag = (l: () => void) => {
    listeners.add(l);
    return () => {
        listeners.delete(l);
    };
};

const shortUrl = (url: string) => {
    try {
        const u = new URL(url);
        return `${u.protocol}//${u.host}${u.pathname}`;
    } catch {
        return String(url).split('?')[0];
    }
};

/** Starts watching. Call once, before the app connects. */
export const installDiagnostics = () => {
    document.addEventListener('securitypolicyviolation', e => {
        recordDiag('csp', `Blocked ${e.effectiveDirective || e.violatedDirective}: ${shortUrl(e.blockedURI)}`);
    });
    const Native = window.WebSocket;
    if (!Native || (Native as any).__kapaWatched) return;
    class WatchedWebSocket extends Native {
        constructor(url: string | URL, protocols?: string | string[]) {
            super(url, protocols);
            const where = shortUrl(String(url));
            this.addEventListener('open', () => recordDiag('ws', `Connected: ${where}`));
            this.addEventListener('error', () => recordDiag('ws', `Error: ${where}`));
            this.addEventListener('close', ev => {
                if (ev.code !== 1000)
                    recordDiag('ws', `Closed (${ev.code}${ev.reason ? ` ${ev.reason}` : ''}): ${where}`);
            });
        }
    }
    (WatchedWebSocket as any).__kapaWatched = true;
    window.WebSocket = WatchedWebSocket as typeof WebSocket;
};
