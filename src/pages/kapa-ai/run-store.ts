/**
 * The KAPA AI session that is running, shared by the whole app. It lives outside the KAPA AI page, so
 * switching tabs never stops a session nor loses its trades and journal; the floating orb shows it on
 * every tab with a Stop button, and Bot Builder refuses to run at the same time.
 */
import { useSyncExternalStore } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { refreshEntitlement } from '../premium/premium-api';
import {
    addDayResult,
    KapaEngine,
    TApi,
    TLiveContract,
    TPhase,
    TPolicy,
    TStopKind,
    TTrade,
} from './engine';

export type TLog = { at: number; text: string; level: 'info' | 'success' | 'warn' | 'error' };
/** How the last session ended: shown in the run bar and the result dialog until the next start. */
export type TStopInfo = { kind: TStopKind; reason: string; pl: number; at: number; name: string };

export type TRunState = {
    running: boolean;
    stopping: boolean;
    status: { text: string; phase: TPhase };
    live: TLiveContract | null;
    trades: TTrade[];
    logs: TLog[];
    sessionPl: number;
    name: string;
    lastStop: TStopInfo | null;
    /** The result dialog to show (every way a session can end) */
    result: TStopInfo | null;
};

/** The app's authorized Deriv connection, shaped for the engine (always the current connection). */
export const derivApi: TApi = {
    send: req => (api_base.api as any).send(req),
    onMessage: () => (api_base.api as any).onMessage(),
};

type TClient = { currency?: string; balance?: string | number; loginid?: string; is_logged_in?: boolean };

/** What a stop means for a beginner: a short title for the run bar and the dialog. */
export const STOP_TITLES: Record<TStopKind, string> = {
    tp: 'PROFIT TARGET REACHED',
    sl: 'STOP-LOSS REACHED',
    streak: 'RECOVERY CYCLE USED UP',
    user: 'STOPPED BY YOU',
    runs: 'SESSION FINISHED',
    error: 'STOPPED: PROBLEM',
    edge: 'NOT TRADED: PRICE TOO POOR',
};

class KapaRun {
    private listeners = new Set<() => void>();
    private client: TClient | null = null;
    private startedAt = 0;
    state: TRunState = {
        running: false,
        stopping: false,
        status: { text: 'KAPA AI is not running', phase: 'idle' },
        live: null,
        trades: [],
        logs: [],
        sessionPl: 0,
        name: '',
        lastStop: null,
        result: null,
    };

    /** The app's client store (live balance, currency and account); set by the pages that use KAPA AI. */
    bindClient(client: TClient) {
        this.client = client;
    }
    private currency = () => (this.client?.is_logged_in && this.client.currency) || 'USD';
    private balance = () => (this.client?.is_logged_in ? Number(this.client.balance) || 0 : 0);
    private account = () => this.client?.loginid || 'demo';

    private set(patch: Partial<TRunState>) {
        this.state = { ...this.state, ...patch };
        this.listeners.forEach(l => l());
    }
    subscribe = (l: () => void) => {
        this.listeners.add(l);
        return () => {
            this.listeners.delete(l);
        };
    };
    get = () => this.state;

    log = (text: string, level: TLog['level'] = 'info') =>
        this.set({ logs: [{ at: Date.now(), text, level }, ...this.state.logs].slice(0, 400) });

    readonly engine = new KapaEngine(
        derivApi,
        () => this.currency(),
        () => this.balance(),
        {
            onStatus: (text, phase) => this.set({ status: { text, phase } }),
            onContract: c => this.set({ live: c }),
            onTrade: (t, pl) => this.set({ trades: [t, ...this.state.trades].slice(0, 500), sessionPl: pl }),
            onLog: (text, level) => this.log(text, level),
            onStop: (reason, kind, pl) => {
                addDayResult(this.account(), this.balance(), pl); // counts towards today's loss limit (not twice)
                if (kind === 'error') refreshEntitlement(); // e.g. Premium ended during the session
                const info: TStopInfo = { kind, reason, pl, at: Date.now(), name: this.state.name };
                // the run bar always says why the session stopped
                this.set({
                    running: false,
                    stopping: false,
                    sessionPl: pl,
                    lastStop: info,
                    result: info,
                    status: { text: `${STOP_TITLES[kind]} · ${reason}`, phase: 'idle' },
                });
            },
        },
        () => this.account()
    );

    /** Starts a session. Ignored while one runs (a double tap never starts two). */
    start(policy: TPolicy, opts: Parameters<KapaEngine['run']>[1]) {
        if (this.state.running || this.engine.running) return false;
        this.startedAt = Date.now();
        this.set({
            running: true,
            stopping: false,
            name: opts.name,
            sessionPl: 0,
            result: null,
            lastStop: null,
            live: null,
            status: { text: 'Bot is starting', phase: 'starting' },
        });
        this.engine.run(policy, opts);
        return true;
    }
    /** Milliseconds since the session started (a Stop tap right after Start is most likely a double tap). */
    sinceStart = () => Date.now() - this.startedAt;
    stop() {
        if (!this.state.running) return;
        this.engine.requestStop();
        this.set({ stopping: true, status: { text: 'Stopping after the current contract', phase: this.state.status.phase } });
    }
    closeResult = () => this.set({ result: null });
    resetStats = () => {
        if (!this.state.running) this.set({ trades: [], live: null, logs: [], lastStop: null });
    };
}

export const kapaRun = new KapaRun();
/** True while a KAPA AI session runs (used by Bot Builder, which must not trade at the same time). */
export const isKapaRunning = () => kapaRun.state.running;
export const useKapaRun = () => useSyncExternalStore(kapaRun.subscribe, kapaRun.get, kapaRun.get);
