import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { generateOAuthURL } from '@/components/shared';
import brandConfig from '@/../brand.config.json';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { onDiag, readDiag, TDiag } from '@/utils/kapa-diagnostics';
import {
    fetchPlan,
    lockPremium,
    premiumEnabled,
    refreshEntitlement,
    remotePolicy,
    resumeCheckout,
    scanMarkets,
    simulatePlan,
    startCheckout,
    TPlan,
    TPlanResult,
    unlockPremium,
} from '../premium/premium-api';
import { openPremium, usePremium } from '../premium/use-premium';
import {
    DEFAULT_SETTINGS,
    estRatio,
    fixedPolicy,
    KapaEngine,
    MARKETS,
    overChance,
    RatioCache,
    sanitizeSettings,
    simulateFixed,
    STRATEGIES,
    TApi,
    TLiveContract,
    TPayoutRatios,
    TPhase,
    TPresetKey,
    TSettings,
    TStopKind,
    TStrategy,
    TTrade,
    TYPE_LABEL,
    validate,
} from './engine';
import { CountUp, KapaClip } from './kapa-clip';
import activatedArt from './media/kapa-activated.jpg';
import './kapa-ai.scss';

const STORAGE_KEY = 'kapa_ai_settings_v2';

const loadSettings = (): TSettings => {
    try {
        return sanitizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'));
    } catch {
        return DEFAULT_SETTINGS;
    }
};

const fmt = (n: number, d = 2) => Number(n).toFixed(d);
const signed = (n: number) => `${n >= 0 ? '+' : ''}${fmt(n)}`;
const strategyName = (k: TStrategy) => (k === 'custom' ? 'Custom strategy' : STRATEGIES[k].label);

type TScanCard = {
    sym: string;
    b: number;
    rec: number | null;
    p: number;
    payout: number;
    ev: number;
    recent: number | null;
    n: number;
    preset: TPresetKey;
};
type TLog = { at: number; text: string; level: 'info' | 'success' | 'warn' | 'error' };

// The app's authorized connection, shaped for the engine
const derivApi: TApi = {
    send: req => (api_base.api as any).send(req),
    onMessage: () => (api_base.api as any).onMessage(),
};

/** True on wide screens, where Summary / Transactions / Journal sit beside the card instead of in a drawer. */
const useWide = () => {
    const query = '(min-width: 1100px)';
    const [wide, setWide] = useState(() => {
        try {
            return window.matchMedia(query).matches;
        } catch {
            return false;
        }
    });
    useEffect(() => {
        let mq: MediaQueryList;
        try {
            mq = window.matchMedia(query);
        } catch {
            return;
        }
        const on = () => setWide(mq.matches);
        mq.addEventListener?.('change', on);
        return () => mq.removeEventListener?.('change', on);
    }, []);
    return wide;
};

const Ring = ({
    busy,
    label,
    sub,
    onClick,
    disabled,
}: {
    busy: boolean;
    label: React.ReactNode;
    sub: string;
    onClick: () => void;
    disabled?: boolean;
}) => (
    <button
        className={classNames('kapa-ring', { 'kapa-ring--busy': busy })}
        onClick={onClick}
        disabled={disabled}
        type='button'
    >
        <span className='kapa-ring__dash' />
        <span className='kapa-ring__dots' />
        <span className='kapa-ring__arc' />
        <span className='kapa-ring__core'>
            <b>{label}</b>
            <small>{sub}</small>
        </span>
    </button>
);

const KapaAI = observer(() => {
    const { client, run_panel } = useStore();
    const premium = usePremium();
    const isPremium = premium.status === 'active';
    const [plan_, setPlan_] = useState<TPlan | null>(null);
    const [premiumMsg, setPremiumMsg] = useState('');
    const [paying, setPaying] = useState(false);
    const premiumRef = useRef<HTMLDivElement>(null);
    const logged_in = client.is_logged_in;
    const currency = (logged_in && client.currency) || 'USD';
    const balance = logged_in ? Number(client.balance) || 0 : 0;

    const [s, setS] = useState<TSettings>(loadSettings);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [plan, setPlan] = useState<Omit<TPlanResult, 'sessions'> | null>(null);
    const [planNote, setPlanNote] = useState('');
    const [ratioTick, setRatioTick] = useState(0);
    const [scanning, setScanning] = useState(false);
    const [scanMsg, setScanMsg] = useState('');
    const [cards, setCards] = useState<TScanCard[]>([]);
    const [activation, setActivation] = useState<TScanCard | null>(null);
    const [confirmReal, setConfirmReal] = useState(false);
    const [result, setResult] = useState<{ kind: TStopKind; pl: number } | null>(null);
    const [running, setRunning] = useState(false);
    const [status, setStatus] = useState<{ text: string; phase: TPhase }>({
        text: 'KAPA AI is not running',
        phase: 'idle',
    });
    const [live, setLive] = useState<TLiveContract | null>(null);
    const [trades, setTrades] = useState<TTrade[]>([]);
    const [logs, setLogs] = useState<TLog[]>([]);
    const [panel, setPanel] = useState<'summary' | 'transactions' | 'journal'>('summary');
    const [error, setError] = useState('');

    const ratios = useRef(new RatioCache()).current;
    // Live payouts from the last server scan, per strategy and market (used for Premium plans and sessions)
    const scanRatios = useRef(new Map<string, TPayoutRatios>()).current;
    const balanceRef = useRef(balance);
    balanceRef.current = balance;
    const currencyRef = useRef(currency);
    currencyRef.current = currency;

    const update = (patch: Partial<TSettings>) =>
        setS(prev => {
            const next = { ...prev, ...patch };
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
            } catch {
                /* storage can be unavailable; settings then last for this visit only */
            }
            return next;
        });
    const num = (k: keyof TSettings) => (e: React.ChangeEvent<HTMLInputElement>) =>
        update({ [k]: e.target.value === '' ? ('' as any) : +e.target.value } as Partial<TSettings>);
    const setCustom = (patch: Partial<TSettings['custom']>) =>
        update({ strategy: 'custom', custom: { ...s.custom, ...patch } });

    const chooseStrategy = (k: TStrategy) => {
        if (k !== 'fixed' && !isPremium) return openPremium();
        update({ strategy: k, ...(k !== 'fixed' ? { maxStake: Math.max(s.stopLoss, s.stake) } : {}) });
    };

    const log = useCallback(
        (text: string, level: TLog['level'] = 'info') =>
            setLogs(prev => [{ at: Date.now(), text, level }, ...prev].slice(0, 400)),
        []
    );

    // Premium: check this device's code pass, and finish a payment when CinetPay sends the buyer back
    useEffect(() => {
        if (!premiumEnabled()) return;
        refreshEntitlement();
        fetchPlan()
            .then(setPlan_)
            .catch(() => setPlan_(null));
    }, []);
    useEffect(() => {
        if (logged_in)
            resumeCheckout(text => {
                setPremiumMsg(text);
                openSettings(true);
            });
    }, [logged_in]);
    // "Use in KAPA AI" from the Live Scanner
    useEffect(() => {
        const apply = (detail: any) => {
            const { symbol, preset: k, stake } = detail || {};
            if (!MARKETS[symbol] || !STRATEGIES[k as TPresetKey]) return;
            try {
                sessionStorage.removeItem('kapa_pending_market');
            } catch {
                /* nothing to clear */
            }
            if (detail.ratios) scanRatios.set(`${k}|${symbol}`, detail.ratios);
            update({ symbol, strategy: k, ...(stake >= 0.35 ? { stake } : {}) });
            setScanMsg(
                `${MARKETS[symbol]} loaded from the Live Scanner. Review the settings and press Start KAPA AI when ready.`
            );
        };
        const use = (e: Event) => apply((e as CustomEvent).detail);
        try {
            apply(JSON.parse(sessionStorage.getItem('kapa_pending_market') || 'null'));
        } catch {
            /* no pending market */
        }
        window.addEventListener('kapa:use-market', use);
        return () => window.removeEventListener('kapa:use-market', use);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        const show = () => openSettings(true);
        window.addEventListener('kapa:open-premium', show);
        return () => window.removeEventListener('kapa:open-premium', show);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    // Without Premium only the fixed-stake strategy is available
    useEffect(() => {
        if (!isPremium && premium.status !== 'unknown' && premium.status !== 'checking' && s.strategy !== 'fixed')
            update({ strategy: 'fixed' });
    }, [isPremium, premium.status]); // eslint-disable-line react-hooks/exhaustive-deps

    // What blocked the Deriv connection on this device, if anything (shown under Log in)
    const [diag, setDiag] = useState<TDiag[]>(readDiag);
    useEffect(() => onDiag(() => setDiag(readDiag())), []);

    // Layout like the reference bot: one card on screen; every other setting sits behind the ⚙ button,
    // and Summary / Transactions / Journal open in a drawer above the Start bar on phones
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [panelOpen, setPanelOpen] = useState(false);
    const settingsBodyRef = useRef<HTMLDivElement>(null);
    const wide = useWide();
    const openSettings = (atPremium: boolean) => {
        setSettingsOpen(true);
        if (atPremium) setTimeout(() => premiumRef.current?.scrollIntoView({ block: 'start' }), 60);
    };

    const [code, setCode] = useState('');
    const [unlocking, setUnlocking] = useState(false);
    const unlock = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!code.trim() || unlocking) return;
        setUnlocking(true);
        setPremiumMsg('');
        try {
            await unlockPremium(code);
            setCode('');
            setPremiumMsg('Premium unlocked on this device.');
        } catch (err: any) {
            setPremiumMsg(err?.message || "Couldn't reach the Kapa Premium server. Try again in a moment.");
        } finally {
            setUnlocking(false);
        }
    };
    const relock = () => {
        if (running) return;
        lockPremium();
        setPremiumMsg('Premium locked on this device. Enter the code to unlock it again.');
    };
    const contact = brandConfig.platform.social?.whatsapp || brandConfig.platform.social?.telegram || '';

    const pay = async () => {
        setPaying(true);
        setPremiumMsg('');
        try {
            await startCheckout();
        } catch (e: any) {
            setPremiumMsg(e?.message ?? 'The payment could not be started.');
            setPaying(false);
        }
    };

    const engine = useMemo(
        () =>
            new KapaEngine(
                derivApi,
                () => currencyRef.current,
                () => balanceRef.current,
                {
                    onStatus: (text, phase) => setStatus({ text, phase }),
                    onContract: c => setLive(c),
                    onTrade: t => setTrades(prev => [t, ...prev].slice(0, 500)),
                    onLog: (text, level) => log(text, level),
                    onStop: (reason, kind, pl) => {
                        setRunning(false);
                        if (kind === 'tp' || kind === 'sl' || kind === 'streak') setResult({ kind, pl });
                        if (kind === 'error') refreshEntitlement(); // e.g. Premium ended during the session
                        setStatus(prev =>
                            prev.phase === 'won' || prev.phase === 'lost' ? prev : { text: reason, phase: 'idle' }
                        );
                    },
                }
            ),
        [log]
    );
    useEffect(() => () => engine.requestStop(), [engine]);

    // Session plan. The free strategy is simulated here; Premium strategies are simulated by the server.
    useEffect(() => {
        if (!(s.stake >= 0.35 && s.takeProfit > 0 && s.stopLoss > 0)) {
            setPlan(null);
            setPlanNote('Enter a stake, take-profit and stop-loss to see the plan.');
            return;
        }
        let cancelled = false;
        const t = setTimeout(
            async () => {
                if (s.strategy === 'fixed') {
                    const r = ratios.known(s.symbol, 1);
                    setPlan(simulateFixed(s, balance || 1000, r ?? estRatio(1)));
                    setPlanNote(
                        `Simulated 4,000 times with ${r != null ? "Deriv's live payouts" : 'estimated payouts'}`
                    );
                    return;
                }
                if (!premiumEnabled()) {
                    setPlan(null);
                    setPlanNote(
                        'The plan for this strategy is computed by the Kapa server, which is not connected yet.'
                    );
                    return;
                }
                try {
                    const sr = scanRatios.get(`${s.strategy}|${s.symbol}`);
                    const res = await simulatePlan(s, balance || 1000, sr || {});
                    if (cancelled) return;
                    setPlan(res);
                    setPlanNote(
                        `Simulated ${res.sessions.toLocaleString()} times by the Kapa server with ${sr ? "Deriv's live payouts" : 'estimated payouts'}`
                    );
                } catch (e: any) {
                    if (cancelled) return;
                    setPlan(null);
                    setPlanNote(
                        e?.status === 400
                            ? e.message
                            : "Couldn't reach the Kapa server for the plan. It updates when you change a setting."
                    );
                }
            },
            s.strategy === 'fixed' ? 250 : 700
        );
        return () => {
            cancelled = true;
            clearTimeout(t);
        };
    }, [s, balance, ratioTick]); // eslint-disable-line react-hooks/exhaustive-deps

    // Deriv's live payout for the free strategy, so its plan uses real prices
    useEffect(() => {
        if (!logged_in || !api_base.api || s.strategy !== 'fixed') return;
        let cancelled = false;
        (async () => {
            // The connection may still be authorizing right after login, so retry a few times
            for (let attempt = 0; attempt < 4 && !cancelled; attempt++) {
                try {
                    await ratios.get(derivApi, currency, s.symbol, 1);
                    if (!cancelled) setRatioTick(n => n + 1);
                    return;
                } catch {
                    await new Promise(r => setTimeout(r, 2000)); // the plan uses estimated payouts meanwhile
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [logged_in, currency, s.symbol, s.strategy]); // eslint-disable-line react-hooks/exhaustive-deps

    const login = async () => {
        const url = await generateOAuthURL();
        if (url) window.location.replace(url);
    };

    const scan = async () => {
        if (scanning || running) return;
        if (!isPremium) return openPremium();
        const err = validate(s, balance);
        if (err) return setError(err);
        setError('');
        setScanning(true);
        setCards([]);
        setScanMsg('Scanning fresh synthetic-index ticks…');
        const preset: TPresetKey = s.strategy !== 'custom' && STRATEGIES[s.strategy].premium ? s.strategy : 'pegasus';
        try {
            const { rows } = await scanMarkets(preset, currency);
            rows.forEach(r =>
                scanRatios.set(`${preset}|${r.symbol}`, {
                    base: r.payout,
                    ...(r.recovery_payout != null ? { rec: r.recovery_payout } : {}),
                })
            );
            const top = rows.slice(0, 3).map(r => ({
                sym: r.symbol,
                b: r.barrier,
                rec: r.recovery,
                p: r.win_chance,
                payout: s.stake * (1 + r.payout),
                ev: s.stake * r.expected,
                recent: r.recent,
                n: r.recent_ticks,
                preset,
            }));
            setCards(top);
            setScanMsg(
                top.length
                    ? `${top.length} live markets compared.`
                    : 'No prices returned. Check your connection and try again.'
            );
            setRatioTick(n => n + 1);
        } catch (e: any) {
            setScanMsg('');
            setError(e?.message ?? 'The scan failed. Try again.');
            if (e?.status === 402) refreshEntitlement();
        } finally {
            setScanning(false);
        }
    };

    const pickCard = (c: TScanCard) => {
        update({ symbol: c.sym, strategy: c.preset, maxStake: Math.max(s.stopLoss, s.stake) });
        setScanMsg(`${MARKETS[c.sym]} selected. Loading the strategy…`);
        setTimeout(() => setActivation(c), 500);
    };

    const start = () => {
        const err = validate(s, balance);
        if (err) return setError(err);
        if (run_panel.is_running)
            return setError('A Bot Builder strategy is running. Stop it before starting KAPA AI.');
        if (s.strategy !== 'fixed' && !isPremium) {
            openPremium();
            return setError('This strategy is part of KAPA AI Premium.');
        }
        setError('');
        if (!client.is_virtual) return setConfirmReal(true);
        go();
    };
    const go = () => {
        setConfirmReal(false);
        setPanelOpen(true); // show the live contract, like the reference bot's run panel
        setRunning(true);
        setResult(null);
        const policy =
            s.strategy === 'fixed'
                ? fixedPolicy(s)
                : remotePolicy(s, scanRatios.get(`${s.strategy}|${s.symbol}`) || {});
        engine.run(policy, {
            name: strategyName(s.strategy),
            delay: s.delay,
            stake: s.stake,
            takeProfit: s.takeProfit,
            stopLoss: s.stopLoss,
            symbol: s.symbol,
        });
    };
    const stop = () => {
        engine.requestStop();
        setStatus({ text: 'Stopping after the current contract', phase: 'bought' });
    };

    const stats = useMemo(() => {
        const st = { stake: 0, payout: 0, runs: trades.length, won: 0, lost: 0, pl: 0 };
        trades.forEach(t => {
            st.stake += t.stake;
            st.payout += t.payout;
            st.pl += t.profit;
            t.won ? st.won++ : st.lost++;
        });
        return st;
    }, [trades]);

    const recoveryLine = (c?: TScanCard | null) => {
        if (s.strategy === 'fixed') return 'Recovery: none · fixed stake';
        if (s.strategy === 'custom') {
            const { recMode, recovery, martingale } = s.custom;
            if (recMode === 'recover') return `Recovery: Over ${recovery} · wins back losses in one trade`;
            if (recMode === 'mult') return `Recovery: Over ${recovery} · stake ×${martingale} after each loss`;
            return 'Recovery: none · fixed stake';
        }
        return c?.rec != null
            ? `Recovery: Over ${c.rec} after a loss, sized by the KAPA AI server`
            : 'Recovery: decided by the KAPA AI server after each loss';
    };
    const tpPct = balance ? (s.takeProfit / balance) * 100 : null;
    const progress = { idle: 0, starting: 8, buying: 50, bought: 100, won: 100, lost: 100 }[status.phase];

    const panelSection = (
        <section className='kapa-card kapa-card--panel'>
            <div className='kapa-segs'>
                {(['summary', 'transactions', 'journal'] as const).map(p => (
                    <button
                        key={p}
                        type='button'
                        className={classNames({ on: panel === p })}
                        onClick={() => setPanel(p)}
                    >
                        {p[0].toUpperCase() + p.slice(1)}
                    </button>
                ))}
            </div>

            {panel === 'summary' &&
                (live ? (
                    <div className='kapa-cc'>
                        <div
                            className={classNames('kapa-cc__top', {
                                win: live.open ? (live.profit ?? 0) >= 0 : live.won,
                            })}
                        >
                            <span>
                                {MARKETS[live.symbol]} · {TYPE_LABEL[live.type]} {live.barrier}
                            </span>
                            <span className='kapa-pill'>{live.open ? 'Open' : live.won ? 'Won' : 'Lost'}</span>
                        </div>
                        <div className='kapa-cc__body'>
                            <div>
                                <small>Total profit/loss</small>
                                <b className={(live.profit ?? 0) >= 0 ? 'kapa-up' : 'kapa-down'}>
                                    {signed(live.profit ?? 0)} {currency}
                                </b>
                            </div>
                            <div>
                                <small>Contract value</small>
                                <b>{live.bid != null ? `${fmt(live.bid)} ${currency}` : '—'}</b>
                            </div>
                            <div>
                                <small>Stake</small>
                                <b>
                                    {fmt(live.stake)} {currency}
                                </b>
                            </div>
                            <div>
                                <small>Potential payout</small>
                                <b>{live.potential ? `${fmt(live.potential)} ${currency}` : '—'}</b>
                            </div>
                        </div>
                        <div className='kapa-cc__ticks'>
                            {Array.from({ length: Math.max(1, live.ticks) }, (_, i) => (
                                <i key={i} className={classNames({ on: i < live.tickNow })} />
                            ))}
                        </div>
                    </div>
                ) : (
                    <div className='kapa-empty'>
                        <b>No contract yet</b>
                        <small>When KAPA AI runs, the open contract shows here, updated tick by tick.</small>
                    </div>
                ))}

            {panel === 'transactions' &&
                (trades.length ? (
                    <div className='kapa-tx'>
                        <div className='kapa-tx__head'>
                            <span>Type</span>
                            <span>Entry/Exit spot</span>
                            <span>Buy price and P/L</span>
                        </div>
                        {trades.slice(0, 200).map(t => (
                            <div key={t.id} className='kapa-tx__row' title={t.longcode}>
                                <span>
                                    {TYPE_LABEL[t.type]} {t.barrier}
                                    {t.recovery && <em>REC</em>}
                                </span>
                                <span className='kapa-tx__spots'>
                                    <i className='en' />
                                    {t.entry ?? '—'}
                                    <br />
                                    <i className='ex' />
                                    {t.exit ?? '—'}
                                </span>
                                <span className='kapa-tx__px'>
                                    {fmt(t.stake)} {currency}
                                    <br />
                                    <b className={t.profit >= 0 ? 'kapa-up' : 'kapa-down'}>
                                        {signed(t.profit)} {currency}
                                    </b>
                                </span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className='kapa-empty'>
                        <b>There are no transactions to display</b>
                        <small>KAPA AI hasn&apos;t traded in this session yet.</small>
                    </div>
                ))}

            {panel === 'journal' && (
                <div className='kapa-journal'>
                    {logs.length ? (
                        logs.map((l, i) => (
                            <div key={`${l.at}-${i}`} className={`kapa-journal__${l.level}`}>
                                <time>{new Date(l.at).toLocaleTimeString()}</time> {l.text}
                            </div>
                        ))
                    ) : (
                        <div className='kapa-empty'>
                            <b>Journal is empty</b>
                        </div>
                    )}
                </div>
            )}

            <div className='kapa-stats'>
                <div>
                    <small>Total stake</small>
                    <b>{fmt(stats.stake)}</b>
                </div>
                <div>
                    <small>Total payout</small>
                    <b>{fmt(stats.payout)}</b>
                </div>
                <div>
                    <small>No. of runs</small>
                    <b>{stats.runs}</b>
                </div>
                <div>
                    <small>Contracts lost</small>
                    <b>{stats.lost}</b>
                </div>
                <div>
                    <small>Contracts won</small>
                    <b>{stats.won}</b>
                </div>
                <div>
                    <small>Total profit/loss</small>
                    <b className={stats.pl > 0 ? 'kapa-up' : stats.pl < 0 ? 'kapa-down' : ''}>{signed(stats.pl)}</b>
                </div>
            </div>
            <button
                className='kapa-link'
                type='button'
                disabled={running || !trades.length}
                onClick={() => (setTrades([]), setLive(null), setLogs([]))}
            >
                Reset stats
            </button>
        </section>
    );

    return (
        <div className='kapa-ai'>
            <div className='kapa-ai__scroll'>
                <section className='kapa-card kapa-card--main'>
                    <button
                        className='kapa-gear'
                        type='button'
                        onClick={() => openSettings(false)}
                        aria-label='KAPA AI settings'
                        title='Settings'
                    >
                        <svg viewBox='0 0 24 24' width='18' height='18' aria-hidden>
                            <path
                                fill='currentColor'
                                d='M19.4 13a7.5 7.5 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.6 7.6 0 0 0-1.7 1l-2.4-1-2 3.4L6.6 11a7.5 7.5 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 1.7-1l2.4 1 2-3.4zM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7z'
                            />
                        </svg>
                    </button>
                    <div className='kapa-eyebrow'>KAPA AI</div>
                    <h2 className='kapa-title'>Activate Kapa</h2>
                    <p className='kapa-lede'>
                        Set your stake and take-profit, then activate the scanner to find the best live market.
                    </p>

                    {!logged_in && (
                        <div className='kapa-login'>
                            <p>Log in with your Deriv account to use KAPA AI.</p>
                            <button className='kapa-btn kapa-btn--gold' onClick={login} type='button'>
                                Log in with Deriv
                            </button>
                            {diag.length > 0 && (
                                <details className='kapa-diag' open>
                                    <summary>Connection details</summary>
                                    <ul>
                                        {diag.slice(-8).map((d, i) => (
                                            <li key={`${d.at}-${i}`} className={`kapa-diag__${d.kind}`}>
                                                <time>{new Date(d.at).toLocaleTimeString()}</time> {d.text}
                                            </li>
                                        ))}
                                    </ul>
                                </details>
                            )}
                        </div>
                    )}

                    <label className='kapa-field'>
                        <span>Stake ({currency})</span>
                        <input
                            type='number'
                            inputMode='decimal'
                            min={0.35}
                            step={0.01}
                            value={s.stake}
                            onChange={num('stake')}
                            disabled={running}
                        />
                    </label>
                    <label className='kapa-field'>
                        <span>Take-profit ({currency})</span>
                        <input
                            type='number'
                            inputMode='decimal'
                            min={0.01}
                            step={0.01}
                            value={s.takeProfit}
                            onChange={num('takeProfit')}
                            disabled={running}
                        />
                        {tpPct != null && (
                            <small>
                                = {fmt(tpPct, tpPct < 10 ? 1 : 0)}% of your balance ({fmt(balance)} {currency})
                            </small>
                        )}
                    </label>
                    {error && <div className='kapa-error'>{error}</div>}

                    <Ring
                        busy={scanning}
                        label={
                            <>
                                Activate
                                <br />
                                Kapa
                            </>
                        }
                        sub={!isPremium ? '🔒 Premium' : scanning ? 'Scanning live markets' : 'Ready to scan'}
                        onClick={scan}
                        disabled={!logged_in || running}
                    />
                    <div className='kapa-scanmsg'>
                        {scanMsg ||
                            `${MARKETS[s.symbol]} · ${strategyName(s.strategy)}${isPremium ? '' : ' · Premium locked'}`}
                    </div>

                    {cards.map((c, i) => (
                        <div key={`${c.sym}-${c.b}`} className={classNames('kapa-sig', { 'kapa-sig--best': i === 0 })}>
                            <div className='kapa-sig__rank'>
                                {i === 0 && <span>BEST PRICE</span>}#{i + 1} MARKET
                            </div>
                            <h4>{MARKETS[c.sym]}</h4>
                            <div className='kapa-sig__pct'>{fmt(c.p * 100, 1)}%</div>
                            <p>
                                Over {c.b} · {c.sym} · true win chance
                            </p>
                            <p className='kapa-sig__rec'>{recoveryLine(c)}</p>
                            <p>
                                Payout if won:{' '}
                                <span className='kapa-up'>
                                    +{fmt(c.payout - s.stake)} {currency}
                                </span>{' '}
                                ({fmt(((c.payout - s.stake) / s.stake) * 100, 1)}%)
                            </p>
                            <p>
                                Expected result per trade:{' '}
                                <span className={c.ev >= 0 ? 'kapa-up' : 'kapa-down'}>
                                    {signed(c.ev)} {currency}
                                </span>
                            </p>
                            {c.recent != null && (
                                <p className='kapa-dim'>
                                    Last {c.n} ticks: Over {c.b} came up {fmt(c.recent * 100, 1)}% of the time. Past
                                    ticks don&apos;t predict the next one.
                                </p>
                            )}
                            <button className='kapa-use' type='button' onClick={() => pickCard(c)}>
                                Use this market
                            </button>
                        </div>
                    ))}
                </section>

                {wide && panelSection}
            </div>

            <div className={classNames('kapa-dock', { 'kapa-dock--open': panelOpen && !wide })}>
                {!wide && (
                    <>
                        <div className='kapa-dock__drawer' aria-hidden={!panelOpen}>
                            {panelSection}
                        </div>
                        <button
                            className='kapa-dock__handle'
                            type='button'
                            onClick={() => setPanelOpen(v => !v)}
                            aria-expanded={panelOpen}
                            aria-label={
                                panelOpen
                                    ? 'Hide summary, transactions and journal'
                                    : 'Show summary, transactions and journal'
                            }
                        >
                            <svg viewBox='0 0 24 24' width='22' height='22' aria-hidden>
                                <path
                                    d='M6 15l6-6 6 6'
                                    fill='none'
                                    stroke='currentColor'
                                    strokeWidth='2.2'
                                    strokeLinecap='round'
                                    strokeLinejoin='round'
                                />
                            </svg>
                        </button>
                    </>
                )}
                <div className='kapa-runbar'>
                    <button
                        className={classNames('kapa-runbtn', { 'kapa-runbtn--stop': running })}
                        type='button'
                        onClick={running ? stop : start}
                        disabled={!logged_in}
                    >
                        {running ? '■ Stop' : '▶ Start KAPA AI'}
                    </button>
                    <div className={classNames('kapa-runstat', `kapa-runstat--${status.phase}`)}>
                        <span>
                            {status.text}
                            {status.phase === 'won' && ' ✓'}
                            {status.phase === 'lost' && ' ✕'}
                        </span>
                        {!['won', 'lost'].includes(status.phase) && (
                            <div className='kapa-runstat__prog'>
                                <b style={{ width: `${progress}%` }} />
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {settingsOpen && (
                <div
                    className='kapa-mask kapa-mask--sheet'
                    role='dialog'
                    aria-modal
                    aria-label='KAPA AI settings'
                    onClick={e => e.target === e.currentTarget && setSettingsOpen(false)}
                >
                    <div className='kapa-settings'>
                        <div className='kapa-settings__head'>
                            <b>KAPA AI settings</b>
                            <button
                                className='kapa-modal__x'
                                type='button'
                                onClick={() => setSettingsOpen(false)}
                                aria-label='Close'
                            >
                                ✕
                            </button>
                        </div>
                        <div className='kapa-settings__body' ref={settingsBodyRef}>
                            {
                                <div
                                    className={classNames('kapa-premium', { 'kapa-premium--on': isPremium })}
                                    ref={premiumRef}
                                >
                                    {isPremium ? (
                                        <div className='kapa-premium__activebar'>
                                            <p className='kapa-premium__active'>✓ KAPA AI Premium unlocked</p>
                                            <button
                                                className='kapa-link'
                                                type='button'
                                                onClick={relock}
                                                disabled={running}
                                            >
                                                Lock on this device
                                            </button>
                                        </div>
                                    ) : (
                                        <>
                                            <div className='kapa-premium__tag'>PREMIUM LOCKED</div>
                                            <h3>KAPA AI Premium</h3>
                                            <ul>
                                                <li>
                                                    <b>Recovery strategies</b> · Pegasus, Steady and Exact recovery, run
                                                    by the KAPA AI server
                                                </li>
                                                <li>
                                                    <b>Live market scanner</b> · compares Deriv&apos;s live prices
                                                    across Volatility indices
                                                </li>
                                                <li>
                                                    <b>Advanced settings</b> · predictions, multiplier, maximum stake,
                                                    loss limits, pauses
                                                </li>
                                                <li>
                                                    <b>Premium bots</b> in the Free Bot library
                                                </li>
                                            </ul>
                                            {
                                                <>
                                                    <form className='kapa-premium__code' onSubmit={unlock}>
                                                        <label htmlFor='kapa-premium-code'>Premium code</label>
                                                        <div>
                                                            <input
                                                                id='kapa-premium-code'
                                                                type='password'
                                                                value={code}
                                                                onChange={e => setCode(e.target.value)}
                                                                placeholder='Enter your secret code'
                                                                autoComplete='off'
                                                                autoCapitalize='characters'
                                                                spellCheck={false}
                                                                maxLength={80}
                                                            />
                                                            <button
                                                                className='kapa-btn kapa-btn--gold'
                                                                type='submit'
                                                                disabled={!code.trim() || unlocking}
                                                            >
                                                                {unlocking ? 'Checking…' : 'Unlock'}
                                                            </button>
                                                        </div>
                                                    </form>
                                                    {premium.status !== 'off' && (
                                                        <div className='kapa-premium__buy'>
                                                            <b>No code yet?</b>
                                                            <span>
                                                                Pay for Premium, then Kapa sends you the code.
                                                                {plan_?.configured
                                                                    ? ` ${plan_.price.toLocaleString()} ${plan_.currency} for ${plan_.days} days, by mobile money (Orange, MTN, Moov, Wave) or bank card.`
                                                                    : ''}
                                                            </span>
                                                            {plan_?.configured && (
                                                                <button
                                                                    className='kapa-btn kapa-btn--line'
                                                                    type='button'
                                                                    onClick={pay}
                                                                    disabled={!logged_in || paying}
                                                                >
                                                                    {paying ? 'Opening CinetPay…' : 'Pay with CinetPay'}
                                                                </button>
                                                            )}
                                                            {plan_?.configured && !logged_in && (
                                                                <small>Log in with Deriv first to pay.</small>
                                                            )}
                                                            {contact && (
                                                                <a
                                                                    className='kapa-btn kapa-btn--line'
                                                                    href={contact}
                                                                    target='_blank'
                                                                    rel='noopener noreferrer'
                                                                >
                                                                    Contact Kapa
                                                                </a>
                                                            )}
                                                        </div>
                                                    )}
                                                </>
                                            }
                                            <p className='kapa-premium__note'>
                                                The session plan stays free for everyone. Premium adds tools; it does
                                                not change the odds: every Deriv contract still pays less than its true
                                                chance.
                                            </p>
                                            {premium.status === 'unavailable' && (
                                                <button
                                                    className='kapa-link'
                                                    type='button'
                                                    onClick={() => refreshEntitlement()}
                                                >
                                                    Couldn&apos;t reach the Premium server. Try again
                                                </button>
                                            )}
                                        </>
                                    )}
                                    {premiumMsg && <p className='kapa-premium__msg'>{premiumMsg}</p>}
                                    {!isPremium && diag.some(d => d.kind === 'premium') && (
                                        <details className='kapa-diag'>
                                            <summary>Premium server details</summary>
                                            <ul>
                                                {diag
                                                    .filter(d => d.kind === 'premium')
                                                    .slice(-4)
                                                    .map((d, i) => (
                                                        <li key={`${d.at}-${i}`} className='kapa-diag__login'>
                                                            <time>{new Date(d.at).toLocaleTimeString()}</time> {d.text}
                                                        </li>
                                                    ))}
                                            </ul>
                                        </details>
                                    )}
                                </div>
                            }

                            <label className='kapa-field'>
                                <span>Stop-loss ({currency})</span>
                                <input
                                    type='number'
                                    inputMode='decimal'
                                    min={0.01}
                                    step={0.01}
                                    value={s.stopLoss}
                                    onChange={e =>
                                        update({
                                            stopLoss: +e.target.value,
                                            ...(s.strategy !== 'fixed'
                                                ? { maxStake: Math.max(+e.target.value, s.stake) }
                                                : {}),
                                        })
                                    }
                                    disabled={running}
                                />
                            </label>
                            <label className='kapa-field'>
                                <span>Strategy</span>
                                <select
                                    value={s.strategy}
                                    onChange={e => chooseStrategy(e.target.value as TStrategy)}
                                    disabled={running}
                                >
                                    {(Object.keys(STRATEGIES) as TPresetKey[]).map(k => (
                                        <option key={k} value={k}>
                                            {!isPremium && STRATEGIES[k].premium ? '🔒 ' : ''}
                                            {STRATEGIES[k].label}
                                        </option>
                                    ))}
                                    {(isPremium || s.strategy === 'custom') && (
                                        <option value='custom'>Custom · my own rules (advanced settings)</option>
                                    )}
                                </select>
                            </label>
                            <label className='kapa-field'>
                                <span>Market</span>
                                <select
                                    value={s.symbol}
                                    onChange={e => update({ symbol: e.target.value })}
                                    disabled={running}
                                >
                                    {Object.entries(MARKETS).map(([k, v]) => (
                                        <option key={k} value={k}>
                                            {v}
                                        </option>
                                    ))}
                                </select>
                            </label>

                            <button
                                className='kapa-link'
                                type='button'
                                onClick={() => (isPremium ? setShowAdvanced(v => !v) : openPremium())}
                            >
                                {!isPremium
                                    ? '🔒 Advanced settings (Premium)'
                                    : `${showAdvanced ? 'Hide' : 'Show'} advanced settings`}
                            </button>
                            {showAdvanced && isPremium && (
                                <div className='kapa-grid2'>
                                    {s.strategy === 'custom' ? (
                                        <>
                                            <label className='kapa-field'>
                                                <span>Prediction (Over)</span>
                                                <select
                                                    value={s.custom.barrier}
                                                    onChange={e => setCustom({ barrier: +e.target.value })}
                                                    disabled={running}
                                                >
                                                    {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(d => (
                                                        <option key={d} value={d}>
                                                            Over {d} · {fmt(overChance(d) * 100, 0)}%
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label className='kapa-field'>
                                                <span>Recovery prediction</span>
                                                <select
                                                    value={s.custom.recovery}
                                                    onChange={e => setCustom({ recovery: +e.target.value })}
                                                    disabled={running}
                                                >
                                                    {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(d => (
                                                        <option key={d} value={d}>
                                                            Over {d}
                                                        </option>
                                                    ))}
                                                </select>
                                            </label>
                                            <label className='kapa-field'>
                                                <span>Recovery mode</span>
                                                <select
                                                    value={s.custom.recMode}
                                                    onChange={e =>
                                                        setCustom({
                                                            recMode: e.target.value as TSettings['custom']['recMode'],
                                                        })
                                                    }
                                                    disabled={running}
                                                >
                                                    <option value='none'>None</option>
                                                    <option value='mult'>Multiply stake</option>
                                                    <option value='recover'>Win back losses</option>
                                                </select>
                                            </label>
                                            <label className='kapa-field'>
                                                <span>Multiplier</span>
                                                <input
                                                    type='number'
                                                    min={1}
                                                    max={5}
                                                    step={0.1}
                                                    value={s.custom.martingale}
                                                    onChange={e => setCustom({ martingale: +e.target.value })}
                                                    disabled={running}
                                                />
                                            </label>
                                        </>
                                    ) : (
                                        <p className='kapa-dim kapa-grid2__full'>
                                            Choose “Custom” in Strategy to set your own prediction and recovery rules.
                                        </p>
                                    )}
                                    <label className='kapa-field'>
                                        <span>Maximum stake</span>
                                        <input
                                            type='number'
                                            min={0.35}
                                            step={0.01}
                                            value={s.maxStake}
                                            onChange={num('maxStake')}
                                            disabled={running}
                                        />
                                    </label>
                                    <label className='kapa-field'>
                                        <span>Stop after N losses in a row</span>
                                        <input
                                            type='number'
                                            min={1}
                                            max={20}
                                            step={1}
                                            placeholder='Strategy default'
                                            value={s.maxLosses ?? ''}
                                            onChange={e =>
                                                update({
                                                    maxLosses:
                                                        e.target.value === ''
                                                            ? null
                                                            : Math.max(1, Math.floor(+e.target.value)),
                                                })
                                            }
                                            disabled={running}
                                        />
                                    </label>
                                    <label className='kapa-field'>
                                        <span>Max trades (0 = no limit)</span>
                                        <input
                                            type='number'
                                            min={0}
                                            step={1}
                                            value={s.maxRuns}
                                            onChange={num('maxRuns')}
                                            disabled={running}
                                        />
                                    </label>
                                    <label className='kapa-field'>
                                        <span>Pause between trades (s)</span>
                                        <input
                                            type='number'
                                            min={0}
                                            step={0.5}
                                            value={s.delay}
                                            onChange={num('delay')}
                                            disabled={running}
                                        />
                                    </label>
                                </div>
                            )}

                            <div className='kapa-plan'>
                                <div className='kapa-plan__head'>
                                    <span>Session plan</span>
                                    <small>{plan ? planNote : ''}</small>
                                </div>
                                {plan ? (
                                    <>
                                        <div className='kapa-plan__grid'>
                                            <div>
                                                <small>Reaches take-profit</small>
                                                <b>{fmt(plan.hit * 100, 0)}%</b>
                                            </div>
                                            <div>
                                                <small>Stops at a loss</small>
                                                <b className='kapa-down'>{fmt(plan.bust * 100, 0)}%</b>
                                            </div>
                                            <div>
                                                <small>Average result</small>
                                                <b className={plan.avg >= 0 ? 'kapa-up' : 'kapa-down'}>
                                                    {signed(plan.avg)}
                                                </b>
                                            </div>
                                            <div>
                                                <small>Typical trades</small>
                                                <b>{plan.median}</b>
                                            </div>
                                        </div>
                                        <div className='kapa-plan__bar'>
                                            <i style={{ width: `${plan.hit * 100}%` }} />
                                            <i style={{ width: `${plan.bust * 100}%` }} />
                                        </div>
                                        <p className='kapa-plan__text'>
                                            Out of 100 sessions like this, about {Math.round(plan.hit * 100)} reach +
                                            {fmt(s.takeProfit)} {currency}
                                            {plan.bust > 0.005
                                                ? ` and about ${Math.round(plan.bust * 100)} stop at a loss, losing ${fmt(Math.abs(plan.bustAvg))} ${currency} on average.`
                                                : '.'}{' '}
                                            Averaged over many sessions, that is {signed(plan.avg)} {currency} per
                                            session.
                                            {plan.avg < 0 &&
                                                ' Changing the target, stake or stop-loss changes how often you reach the target; the long-run average stays negative.'}
                                        </p>
                                    </>
                                ) : (
                                    <p className='kapa-plan__text'>{planNote || 'Computing the plan…'}</p>
                                )}
                            </div>
                        </div>
                        <div className='kapa-settings__foot'>
                            <button
                                className='kapa-btn kapa-btn--gold'
                                type='button'
                                onClick={() => setSettingsOpen(false)}
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activation && (
                <div className='kapa-mask' role='dialog' aria-modal>
                    <div className='kapa-modal'>
                        <button
                            className='kapa-modal__x'
                            type='button'
                            onClick={() => setActivation(null)}
                            aria-label='Close'
                        >
                            ✕
                        </button>
                        <div className='kapa-modal__title'>KAPA ACTIVATED</div>
                        <div className='kapa-hero kapa-hero--art'>
                            <img src={activatedArt} alt='' />
                            <span className='kapa-hero__scan' aria-hidden />
                        </div>
                        <p className='kapa-modal__text'>
                            KAPA AI is loaded with {MARKETS[activation.sym]} · Over {activation.b}. Stake {fmt(s.stake)}
                            , take-profit {fmt(s.takeProfit)}, stop-loss {fmt(s.stopLoss)} {currency}.{' '}
                            {recoveryLine(activation)}.
                        </p>
                        <button
                            className='kapa-btn kapa-btn--gold'
                            type='button'
                            onClick={() => {
                                setActivation(null);
                                log(
                                    'KAPA AI strategy loaded. Review all settings and press Start when ready.',
                                    'success'
                                );
                                setScanMsg('Strategy loaded. Review all settings and press Start KAPA AI when ready.');
                            }}
                        >
                            Activate Kapa
                        </button>
                        <button className='kapa-btn kapa-btn--line' type='button' onClick={() => setActivation(null)}>
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {confirmReal && (
                <div className='kapa-mask' role='dialog' aria-modal>
                    <div className='kapa-modal'>
                        <div className='kapa-modal__title kapa-modal__title--sm'>Trade with real money?</div>
                        <p className='kapa-modal__text'>
                            KAPA AI will place real trades on {client.loginid}. Stake {fmt(s.stake)} {currency} (
                            {fmt(balance ? (s.stake / balance) * 100 : 0, 0)}% of your balance), stop-loss{' '}
                            {fmt(s.stopLoss)} {currency}.
                            {plan &&
                                ` The session plan gives about ${Math.round(plan.bust * 100)} chances in 100 of stopping at a loss.`}{' '}
                            Every contract pays less than its true odds, so over many sessions the expected result is a
                            loss.
                        </p>
                        <button className='kapa-btn kapa-btn--gold' type='button' onClick={go}>
                            Start real trading
                        </button>
                        <button className='kapa-btn kapa-btn--line' type='button' onClick={() => setConfirmReal(false)}>
                            Cancel
                        </button>
                    </div>
                </div>
            )}

            {result && (
                <div className='kapa-mask' role='dialog' aria-modal>
                    <div className={classNames('kapa-modal kapa-modal--result', { 'kapa-modal--loss': result.pl < 0 })}>
                        <div className='kapa-result__media'>
                            <KapaClip win={result.pl >= 0} />
                        </div>
                        <button
                            className='kapa-modal__x'
                            type='button'
                            onClick={() => setResult(null)}
                            aria-label='Close'
                        >
                            ✕
                        </button>
                        <div className='kapa-result'>
                            <span className={classNames('kapa-result__tag', { bad: result.kind !== 'tp' })}>
                                {result.kind === 'tp'
                                    ? 'PROFIT TARGET REACHED'
                                    : result.kind === 'streak'
                                      ? 'LOSS LIMIT REACHED'
                                      : 'STOP-LOSS REACHED'}
                            </span>
                            <div className='kapa-result__h1'>KAPA AI</div>
                            <div className='kapa-result__h2'>
                                {result.kind === 'tp'
                                    ? 'hit a profit of'
                                    : result.pl >= 0
                                      ? 'stopped with a profit of'
                                      : 'stopped at a loss of'}
                            </div>
                            <div className={classNames('kapa-result__amt', { bad: result.pl < 0 })}>
                                <CountUp value={Math.abs(result.pl)} /> {currency}
                            </div>
                            <button className='kapa-btn kapa-btn--lime' type='button' onClick={() => setResult(null)}>
                                Continue
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
});

export default KapaAI;
