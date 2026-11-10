import React, { useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { generateOAuthURL } from '@/components/shared';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import { onDiag, readDiag, TDiag } from '@/utils/kapa-diagnostics';
import {
    classicRecover,
    fetchPlan,
    premiumEnabled,
    redeemGift,
    refreshEntitlement,
    remotePolicy,
    resumeCheckout,
    scanMarkets,
    simulateClassicPlan,
    simulatePlan,
    startCheckout,
    TClassicServerSettings,
    TPlan,
    TPlanResult,
    TRandomness,
} from '../premium/premium-api';
import { openPremium, usePremium } from '../premium/use-premium';
import {
    APEX_KEYS,
    bestOf,
    chanceOf,
    contractLabel,
    DAY_RESET_NOTE,
    dailyLimitLeftText,
    dailyLimitLoweredText,
    dailyLimitReachedText,
    dailyRoom,
    DEFAULT_SETTINGS,
    estRatioOf,
    fixedPolicy,
    HALF_KEYS,
    isBold,
    keyLabel,
    MARKETS,
    MAX_SESSION_RISK,
    overChance,
    protectionLimits,
    RatioCache,
    sanitizeSettings,
    simulateFixed,
    STRATEGIES,
    TPayoutRatios,
    TPresetKey,
    TSettings,
    TStrategy,
    validate,
} from './engine';
import { derivApi, kapaRun, STOP_TITLES, useKapaRun } from './run-store';
import KapaClose from '@/components/kapa-close/kapa-close';
import LabPanel from './lab-panel';
import { BOTS, classicPolicy, isClassic, simulateClassic } from './classic';
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
const day = (t?: number | null) => (t ? new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '');

type TScanCard = {
    sym: string;
    key: string; // best-paid contract
    p: number;
    ratio: number; // profit per 1 staked
    margin: number; // Deriv's margin: average loss per 1 staked
    tradable: boolean;
    rnd: TRandomness | null;
    preset: TPresetKey;
};

/** The market's last 30 last digits, from Deriv (for the classic bots' entry rules). */
const lastDigits = async (symbol: string): Promise<number[]> => {
    const h = await derivApi.send({ ticks_history: symbol, count: 30, end: 'latest', style: 'ticks' });
    if (h?.error) throw new Error(h.error.message);
    const pip = Number.isInteger(h?.pip_size) ? h.pip_size : 2;
    return (h?.history?.prices || []).map((x: number) => {
        const t = Number(x).toFixed(pip);
        return Number(t[t.length - 1]);
    });
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
    // The running session lives in the app-wide run store: switching tabs never stops it
    kapaRun.bindClient(client);
    const run = useKapaRun();
    const { running, status, live, trades, logs, result } = run;
    const [panel, setPanel] = useState<'summary' | 'transactions' | 'journal'>('summary');
    const [error, setError] = useState('');

    const ratios = useRef(new RatioCache()).current;
    // Live payouts from the last server scan, per market (used for plans and sessions)
    const scanRatios = useRef(new Map<string, TPayoutRatios>()).current;
    /** Every live payout known for a market: Deriv's quotes on this connection, then the last scan. */
    const liveRatios = (sym: string): TPayoutRatios => ({
        ...(scanRatios.get(sym) || {}),
        ...ratios.knownAll(sym, [...HALF_KEYS, ...APEX_KEYS]),
    });

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

    const needsPremium = (k: TStrategy, apex = false) =>
        k === 'custom' || STRATEGIES[k].premium || (apex && isClassic(k));
    const chooseStrategy = (k: TStrategy) => {
        if (needsPremium(k) && !isPremium) return openPremium();
        update({ strategy: k, ...(k !== 'fixed' ? { maxStake: Math.max(s.stopLoss, s.stake) } : {}) });
    };

    const log = kapaRun.log;

    // Premium: check this device's code pass, and finish a payment when CinetPay sends the buyer back
    useEffect(() => {
        if (!premiumEnabled()) return;
        refreshEntitlement();
        fetchPlan()
            .then(setPlan_)
            .catch(() => setPlan_(null));
    }, []);
    useEffect(() => {
        if (!logged_in) return;
        refreshEntitlement(); // Premium belongs to the Deriv account: check it once logged in
        resumeCheckout(text => {
            setPremiumMsg(text);
            openSettings(true);
        });
    }, [logged_in, client.loginid]); // eslint-disable-line react-hooks/exhaustive-deps
    // "Use in KAPA AI" from the Live Scanner
    useEffect(() => {
        // detail: { symbol, preset?, stake?, ratios?, apexRecovery?, source? }. The Live Scanner sends a market
        // only (source 'scanner'): the strategy the user chose stays. Free Bot's "Run in KAPA AI" sends a bot.
        const apply = (detail: any) => {
            const { symbol, preset: k, stake } = detail || {};
            const scanner = detail?.source === 'scanner';
            if (!MARKETS[symbol] || (!scanner && !STRATEGIES[k as TPresetKey])) return;
            try {
                sessionStorage.removeItem('kapa_pending_market');
            } catch {
                /* nothing to clear */
            }
            if (kapaRun.state.running) {
                setScanMsg('KAPA AI is running: stop it first, then load another market or bot.');
                return;
            }
            if (detail.ratios && typeof detail.ratios === 'object') scanRatios.set(symbol, detail.ratios);
            if (scanner) {
                update({ symbol });
                setScanMsg(`${MARKETS[symbol]} loaded from the Live Scanner. Your strategy is unchanged. Review the settings and press Start KAPA AI when ready.`);
                return;
            }
            const classic = isClassic(k);
            if (classic) {
                setFreeMode(true);
                try {
                    sessionStorage.setItem('kapa_free_mode', '1');
                } catch {
                    /* this visit only */
                }
            }
            const apex = classic && detail.apexRecovery === true;
            update({
                symbol,
                strategy: k,
                ...(stake >= 0.35 ? { stake } : {}),
                ...(classic ? { takeProfit: 5, stopLoss: 50, maxStake: 50, apexRecovery: apex } : {}),
            });
            setScanMsg(
                classic
                    ? `${STRATEGIES[k as TPresetKey].label}${apex ? ' with KAPA Apex recovery' : ''} loaded from Free Bot (take-profit 5, stop-loss 50). Review the settings and press Start KAPA AI when ready.`
                    : `${MARKETS[symbol]} · ${strategyName(k)} loaded. Review the settings and press Start KAPA AI when ready.`
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
    // Without Premium only the free strategies are available. Only when the server says so: a server that
    // can't be reached (unavailable) or a check in progress never changes the user's choice
    useEffect(() => {
        // (a check without a Deriv login yet, e.g. while the page loads, says nothing about the account)
        const ended = (premium.status === 'inactive' && !premium.needsLogin) || premium.status === 'expired';
        if (!ended || running) return;
        // (a classic bot's "KAPA Apex recovery" option stays as chosen: Start explains that it needs Premium)
        if (needsPremium(s.strategy)) update({ strategy: 'fixed' });
    }, [premium.status]); // eslint-disable-line react-hooks/exhaustive-deps

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
            const r = await redeemGift(code);
            setCode('');
            setPremiumMsg(`Code accepted: ${r.days} days of KAPA AI Premium on your Deriv account, until ${day(r.until)}.`);
        } catch (err: any) {
            setPremiumMsg(err?.message || "Couldn't reach the Kapa Premium server. Try again in a moment.");
        } finally {
            setUnlocking(false);
        }
    };
    // Where to get Premium when there is no gift code: the payment if CinetPay is set up, otherwise the
    // owner's WhatsApp or Telegram as set in Admin (never a made-up number)
    const contact = plan_?.contact || { whatsapp: null, telegram: null };
    const account = client.loginid || premium.accounts?.[0] || '';
    const whatsappLink = contact.whatsapp
        ? `${contact.whatsapp}?text=${encodeURIComponent(`Hello Kapa, I would like KAPA AI Premium for my Deriv account ${account || '(my account ID)'}.`)}`
        : null;

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

    /** A classic bot's settings for the Kapa server (KAPA Apex recovery, Premium). */
    const classicServer = (x: TSettings): TClassicServerSettings => ({
        bot: x.strategy,
        symbol: x.symbol,
        stake: x.stake,
        takeProfit: x.takeProfit,
        stopLoss: x.stopLoss,
        maxStake: x.maxStake,
        maxMargin: x.maxMargin,
    });

    // Session plan. The free strategies are simulated here; Premium ones (and the classic bots with KAPA Apex
    // recovery) are simulated by the server.
    useEffect(() => {
        if (!(s.stake >= 0.35 && s.takeProfit > 0 && s.stopLoss > 0)) {
            setPlan(null);
            setPlanNote('Enter a stake, take-profit and stop-loss to see the plan.');
            return;
        }
        let cancelled = false;
        const t = setTimeout(
            async () => {
                const lr = liveRatios(s.symbol);
                const priced = Object.keys(lr).length > 0;
                if (isClassic(s.strategy) && !s.apexRecovery) {
                    setPlan(simulateClassic(s.strategy, s, lr));
                    setPlanNote(`Simulated 2,000 times with ${priced ? "Deriv's live payouts" : 'estimated payouts'}`);
                    return;
                }
                if (s.strategy === 'fixed') {
                    setPlan(simulateFixed(s, balance || 1000, lr));
                    setPlanNote(`Simulated 4,000 times with ${priced ? "Deriv's live payouts" : 'estimated payouts'}`);
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
                    const res = isClassic(s.strategy)
                        ? await simulateClassicPlan(classicServer(s), balance || 1000, lr)
                        : await simulatePlan(s, balance || 1000, lr);
                    if (cancelled) return;
                    setPlan(res);
                    setPlanNote(
                        `Simulated ${res.sessions.toLocaleString()} times by the Kapa server with ${priced ? "Deriv's live payouts" : 'estimated payouts'}`
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

    // Deriv's live payouts for the 50% contracts on the chosen market: every strategy picks the best-paid
    // one, and the plans use real prices
    useEffect(() => {
        if (!logged_in || !api_base.api) return;
        let cancelled = false;
        (async () => {
            // The connection may still be authorizing right after login, so retry a few times
            for (let attempt = 0; attempt < 4 && !cancelled; attempt++) {
                try {
                    const keys = s.strategy === 'apex' ? [...new Set([...HALF_KEYS, ...APEX_KEYS])] : HALF_KEYS;
                    for (const k of keys) await ratios.get(derivApi, currency, s.symbol, k);
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
    }, [logged_in, currency, s.symbol, s.strategy === 'apex']); // eslint-disable-line react-hooks/exhaustive-deps

    const login = async () => {
        const url = await generateOAuthURL();
        if (url) window.location.replace(url);
    };
    const loginProblems = diag.filter(
        d => d.kind === 'login' || d.kind === 'csp' || (d.kind === 'ws' && !/^Connected/.test(d.text))
    );

    const scan = async () => {
        if (scanning || running) return;
        if (!isPremium) return openPremium();
        const err = validate(s, balance, isPremium);
        if (err) return setError(err);
        setError('');
        setScanning(true);
        setCards([]);
        setScanMsg('Scanning fresh synthetic-index ticks…');
        const preset: TPresetKey = s.strategy !== 'custom' && STRATEGIES[s.strategy].premium ? s.strategy : 'target';
        try {
            const { rows } = await scanMarkets(preset, currency, undefined, s.maxMargin);
            rows.forEach(r => scanRatios.set(r.symbol, r.ratios));
            const top: TScanCard[] = rows.slice(0, 3).map(r => ({
                sym: r.symbol,
                key: r.contract,
                p: r.win_chance,
                ratio: r.payout,
                margin: r.margin,
                tradable: r.tradable,
                rnd: r.randomness,
                preset,
            }));
            setCards(top);
            setScanMsg(
                top.length
                    ? `${rows.length} markets compared on Deriv's live payouts. Best terms first.`
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

    /** What today's loss limit still allows: the session's stop-loss is lowered to it when it is smaller. */
    const todayRoom = logged_in && balance > 0 ? dailyRoom(s, client.loginid || 'demo', balance) : null;
    /** Settings for this session: the stop-loss never goes past what today's loss limit still allows. */
    const sessionSettings = (): TSettings | string => {
        const room = dailyRoom(s, client.loginid || 'demo', balance);
        if (room < 0.35) return dailyLimitReachedText(s.dailyLossPct);
        if (room >= s.stopLoss) return s;
        if (!isBold(s) && room < s.stake) return dailyLimitLeftText(room, currency);
        log(dailyLimitLoweredText(room, currency), 'warn');
        return { ...s, stopLoss: room, maxStake: Math.min(s.maxStake, room) };
    };

    const start = () => {
        if (running) return;
        const err = validate(s, balance, isPremium);
        if (err) return setError(err);
        const today = sessionSettings();
        if (typeof today === 'string') return setError(today);
        if (run_panel.is_running)
            return setError('A Bot Builder strategy is running. Stop it before starting KAPA AI.');
        if (needsPremium(s.strategy, s.apexRecovery) && !isPremium) {
            openPremium();
            return setError(
                s.apexRecovery && isClassic(s.strategy)
                    ? 'KAPA Apex recovery is part of KAPA AI Premium. Turn it off in the settings to run the free version.'
                    : 'This strategy is part of KAPA AI Premium.'
            );
        }
        setError('');
        if (!client.is_virtual) return setConfirmReal(true);
        go();
    };
    const go = () => {
        setConfirmReal(false);
        const ss = sessionSettings();
        if (typeof ss === 'string') return setError(ss);
        setPanelOpen(true); // show the live contract, like the reference bot's run panel
        const lr = liveRatios(ss.symbol);
        const policy =
            ss.strategy === 'fixed'
                ? fixedPolicy(ss, lr)
                : isClassic(ss.strategy)
                  ? classicPolicy(
                        ss.strategy,
                        ss,
                        lr,
                        () => lastDigits(ss.symbol),
                        ss.apexRecovery ? (st, r) => classicRecover(classicServer(ss), st, r) : undefined
                    )
                  : remotePolicy(ss, lr);
        kapaRun.start(policy, {
            name: `${strategyName(ss.strategy)}${isClassic(ss.strategy) && ss.apexRecovery ? ' + KAPA Apex recovery' : ''}`,
            delay: ss.delay,
            stake: ss.stake,
            takeProfit: ss.takeProfit,
            stopLoss: ss.stopLoss,
            maxStake: ss.maxStake,
            symbol: ss.symbol,
        });
    };
    const stop = () => {
        // A second tap right after Start is a double tap, not a request to stop
        if (kapaRun.sinceStart() < 1200) return;
        kapaRun.stop();
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

    const recoveryLine = (k: TStrategy = s.strategy) => {
        if (k === 'fixed') return 'Same stake every trade, no recovery';
        if (isClassic(k))
            return s.apexRecovery && k === s.strategy
                ? `${BOTS[k].about.split('. ')[0]}. After a loss, KAPA Apex (Premium, on the Kapa server) picks the contract and stake with the best chance of still reaching your take-profit, never past your stop-loss.`
                : BOTS[k].about;
        if (k === 'apex')
            return "At every trade, the contract and stake with the highest chance of reaching your take-profit, computed from Deriv's live prices";
        if (k === 'target')
            return 'Each stake is what one win needs to reach your take-profit, never more than your stop-loss allows';
        if (k === 'martingale')
            return 'Stake ×2.1 after a loss, only for cycles whose every stake fits under your stop-loss';
        if (k === 'recover')
            return 'After a loss, the stake one win needs to get the cycle back, only when the whole cycle fits your stop-loss';
        const { recMode, recovery, martingale } = s.custom;
        if (recMode === 'target') return 'Bold play: the stake one win needs to reach the take-profit';
        if (recMode === 'recover') return `Recovery: Over ${recovery} · wins back losses in one trade`;
        if (recMode === 'mult') return `Recovery: Over ${recovery} · stake ×${martingale} after each loss`;
        return 'Same stake every trade, no recovery';
    };
    const tpPct = balance ? (s.takeProfit / balance) * 100 : null;
    // KAPA Target: the stake one win needs to reach the take-profit, with the best live 50% payout
    const halfRatios = liveRatios(s.symbol);
    const halfKey = bestOf(HALF_KEYS, halfRatios);
    const halfRatio = halfRatios[halfKey] ?? estRatioOf(halfKey);
    const boldNeed = s.takeProfit / halfRatio;
    const halfMargin = 1 - chanceOf(halfKey) * (1 + halfRatio);
    const bestHalfChance = chanceOf(halfKey);
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
                                {MARKETS[live.symbol]} · {contractLabel(live.type, live.barrier)}
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
                                    {contractLabel(t.type, t.barrier)}
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

            <small className='kapa-dim kapa-stats__note'>
                {running
                    ? `This session: ${signed(run.sessionPl)} ${currency}. Totals below: since you opened KAPA AI.`
                    : 'Totals since you opened KAPA AI (all sessions).'}
            </small>
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
                onClick={kapaRun.resetStats}
            >
                Reset stats
            </button>
        </section>
    );

    // Without Premium the page opens on the Premium card, like the reference bot; the free strategies
    // stay one tap away
    const [freeMode, setFreeMode] = useState(() => {
        try {
            return sessionStorage.getItem('kapa_free_mode') === '1';
        } catch {
            return false;
        }
    });
    const useFree = () => {
        setFreeMode(true);
        try {
            sessionStorage.setItem('kapa_free_mode', '1');
        } catch {
            /* this visit only */
        }
    };
    // Visitors see the same Premium card (as on the reference bot), with a Log in line
    const showLock =
        premiumEnabled() &&
        !isPremium &&
        (premium.status === 'inactive' || !logged_in) &&
        !freeMode &&
        !running &&
        s.strategy === 'fixed';
    const lockCard = (
        <section className='kapa-lock'>
            <div className='kapa-lock__eyebrow'>PREMIUM LOCKED</div>
            <h2 className='kapa-lock__title'>KAPA PREMIUM</h2>
            <p className='kapa-lock__sub'>Premium strategies and tools are checked by the Kapa server on every request.</p>
            <div className='kapa-lock__grid'>
                <div>
                    <b>KAPA Apex</b>
                    <span>
                        At every trade, the contract and stake with the highest possible chance of reaching your
                        target, computed on the Kapa server from Deriv&apos;s live prices.
                    </span>
                </div>
                <div>
                    <b>Tested on real data</b>
                    <span>Every strategy replayed on Deriv&apos;s real ticks and prices, with the results shown.</span>
                </div>
                <div>
                    <b>Capital protection</b>
                    <span>
                        Recovery cycles that fit your stop-loss, checked by the server on every trade. The session cap
                        and the daily loss limit protect everyone, free or Premium.
                    </span>
                </div>
            </div>
            <button className='kapa-lock__cta' type='button' onClick={() => openSettings(true)}>
                <span className='kapa-lock__cta-label'>UNLOCK KAPA PREMIUM</span>
                {/* Kapa's real price only, as the server sends it (never a crossed-out "old" price) */}
                {plan_?.configured && (
                    <b className='kapa-lock__price'>
                        <span className='kapa-lock__sep'> · </span>
                        {plan_.price.toLocaleString()} {plan_.currency}
                    </b>
                )}
            </button>
            <button className='kapa-lock__free' type='button' onClick={useFree}>
                Use the free strategies
            </button>
            {!logged_in && (
                <p className='kapa-lock__login'>
                    Not logged in.{' '}
                    <button type='button' onClick={login}>
                        Log in with Deriv
                    </button>{' '}
                    to trade.
                </p>
            )}
        </section>
    );

    return (
        <div className='kapa-ai'>
            <div className={classNames('kapa-ai__scroll', { 'kapa-ai__scroll--lock': showLock })}>
                {showLock ? (
                    lockCard
                ) : (
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
                        {isPremium
                            ? 'Set your stake and take-profit, then activate the scanner to compare the live markets.'
                            : 'Set your stake and take-profit, then press Start KAPA AI. The live scanner is part of Premium.'}
                    </p>

                    {!logged_in && (
                        <div className='kapa-login'>
                            <p>Log in with your Deriv account to use KAPA AI.</p>
                            <button className='kapa-btn kapa-btn--gold' onClick={login} type='button'>
                                Log in with Deriv
                            </button>
                            {/* Only real problems, closed by default, without server addresses */}
                            {loginProblems.length > 0 && (
                                <details className='kapa-diag'>
                                    <summary>Why can&apos;t I connect?</summary>
                                    <ul>
                                        {loginProblems.slice(-5).map((d, i) => (
                                            <li key={`${d.at}-${i}`} className={`kapa-diag__${d.kind}`}>
                                                <time>{new Date(d.at).toLocaleTimeString()}</time>{' '}
                                                {d.text.replace(/\b(wss?|https?):\/\/\S+/g, 'Deriv server')}
                                            </li>
                                        ))}
                                    </ul>
                                </details>
                            )}
                        </div>
                    )}

                    {/* Wide screens: the two fields on the left, the Activate ring on the right */}
                    <div className='kapa-main'>
                        <div className='kapa-main__form'>
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
                                {(s.strategy === 'target' || s.strategy === 'apex') && (
                                    <small>
                                        {s.strategy === 'apex' ? 'KAPA Apex' : 'KAPA Target'} sizes each stake itself: what one win
                                        needs to reach your take-profit, within your stop-loss.
                                    </small>
                                )}
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
                                {(s.strategy === 'target' || s.strategy === 'apex') && boldNeed > Math.min(s.stopLoss, s.maxStake) && (
                                    <small className='kapa-warn'>
                                        One win needs a stake of {fmt(boldNeed)} to reach this take-profit, more than your
                                        stop-loss allows: each session will be a single trade of {fmt(Math.min(s.stopLoss, s.maxStake))},
                                        won or lost at once (a little under {Math.round(bestHalfChance * 100)}% chance, because Deriv pays under the odds). Lower the take-profit
                                        (for example to {fmt(Math.max(1, Math.floor(s.stopLoss / 5)), 0)}) to reach it far more often.
                                    </small>
                                )}
                            </label>
                            {!running && todayRoom !== null && todayRoom < s.stopLoss && (
                                <small className='kapa-warn kapa-today'>
                                    {todayRoom < 0.35
                                        ? dailyLimitReachedText(s.dailyLossPct)
                                        : `Today's loss limit leaves ${fmt(todayRoom)} ${currency}: this session's stop-loss will be ${fmt(todayRoom)} instead of ${fmt(s.stopLoss)}. ${DAY_RESET_NOTE}`}
                                </small>
                            )}
                            {error && (
                                <div className='kapa-error' role='alert'>
                                    {error}
                                </div>
                            )}
                            {!isPremium && (
                                <p className='kapa-summary'>
                                    <b>{strategyName(s.strategy)}</b>
                                    {isClassic(s.strategy) && s.apexRecovery ? ' + KAPA Apex recovery (Premium)' : ''} · stop-loss{' '}
                                    {fmt(s.stopLoss)} {currency}
                                    {plan ? ` · reaches +${fmt(s.takeProfit)} in about ${Math.round(plan.hit * 100)} of 100 sessions` : ''}.{' '}
                                    <button type='button' className='kapa-link' onClick={() => openSettings(false)}>
                                        Change
                                    </button>
                                </p>
                            )}
                        </div>

                        <div className='kapa-main__scan'>
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
                        </div>
                    </div>

                    {cards.map((c, i) => (
                        <div key={`${c.sym}-${c.key}`} className={classNames('kapa-sig', { 'kapa-sig--best': i === 0 })}>
                            <div className='kapa-sig__rank'>
                                {i === 0 && <span>BEST TERMS</span>}#{i + 1} MARKET
                            </div>
                            <h4>{MARKETS[c.sym]}</h4>
                            <div className='kapa-sig__pct'>{fmt(c.p * 100, 0)}%</div>
                            <p>
                                {keyLabel(c.key)} · {c.sym} · true win chance
                            </p>
                            <p>
                                Deriv pays <span className='kapa-up'>+{fmt(c.ratio * 100, 1)}%</span> of the stake if
                                won
                            </p>
                            <p>
                                Deriv&apos;s margin:{' '}
                                <span className={c.tradable ? undefined : 'kapa-down'}>{fmt(c.margin * 100, 1)}%</span>{' '}
                                of each stake on average
                                {c.tradable ? '' : ' · poorer than usual, KAPA AI won’t trade it'}
                            </p>
                            <p className='kapa-sig__rec'>{recoveryLine(c.preset)}</p>
                            {c.rnd && (
                                <p className='kapa-dim'>
                                    Last {c.rnd.ticks} ticks:{' '}
                                    {c.rnd.uniform_p >= 0.01 && c.rnd.serial_p >= 0.01
                                        ? 'no pattern found'
                                        : 'unusual run (it happens by chance about 1 time in 100)'}{' '}
                                    (digits test p={fmt(c.rnd.uniform_p, 2)}, sequence test p={fmt(c.rnd.serial_p, 2)}
                                    ; even after even {fmt(c.rnd.even_after_even * 100, 0)}%, after odd{' '}
                                    {fmt(c.rnd.even_after_odd * 100, 0)}%). Past ticks don&apos;t predict the next one.
                                </p>
                            )}
                            <button className='kapa-use' type='button' onClick={() => pickCard(c)}>
                                Use this market
                            </button>
                        </div>
                    ))}
                </section>
                )}

                {wide && !showLock && panelSection}
            </div>

            {/* Locked Premium card alone: no Start bar and no Summary until the free strategies are picked */}
            {!showLock && (
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
                    <div
                        className={classNames('kapa-runstat', `kapa-runstat--${status.phase}`, {
                            'kapa-runstat--stopped': !running && run.lastStop,
                        })}
                        title={status.text}
                        role='status'
                    >
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
            )}

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
                            <KapaClose onClick={() => setSettingsOpen(false)} label='Close settings' />
                        </div>
                        <div className='kapa-settings__body' ref={settingsBodyRef}>
                            {/* Wide screens: Premium and the settings on the left, the plan and the lab on the right */}
                            <div className='kapa-settings__cols'>
                                <div className='kapa-settings__main'>
                                    {
                                        <div
                                            className={classNames('kapa-premium', { 'kapa-premium--on': isPremium })}
                                            ref={premiumRef}
                                        >
                                            {isPremium ? (
                                                <div className='kapa-premium__activebar'>
                                                    <p className='kapa-premium__active'>
                                                        ✓ KAPA AI Premium is active on your Deriv account
                                                        {premium.expiresAt ? ` until ${day(premium.expiresAt)}` : ''}
                                                    </p>
                                                    <small className='kapa-dim'>
                                                        It ends by itself on that date. A gift code or a new payment adds
                                                        days to it.
                                                    </small>
                                                </div>
                                            ) : (
                                                <>
                                                    <div className='kapa-premium__tag'>
                                                        {premium.status === 'expired' ? 'PREMIUM ENDED' : 'PREMIUM LOCKED'}
                                                    </div>
                                                    <h3>KAPA AI Premium</h3>
                                                    {premium.status === 'expired' && (
                                                        <p className='kapa-premium__ended'>
                                                            Your Premium ended{premium.expiresAt ? ` on ${day(premium.expiresAt)}` : ''}.
                                                            Renew it below.
                                                        </p>
                                                    )}
                                                    <ul>
                                                        <li>
                                                            <b>KAPA Apex</b> · at every trade, the contract and stake with
                                                            the highest chance of reaching your take-profit, computed on the
                                                            Kapa server
                                                        </li>
                                                        <li>
                                                            <b>Recovery strategies</b> · KAPA Target, Steady and Exact
                                                            recovery, and KAPA Apex recovery for the classic bots
                                                        </li>
                                                        <li>
                                                            <b>Live market scanner</b> · compares Deriv&apos;s live prices
                                                            across Volatility indices
                                                        </li>
                                                        <li>
                                                            <b>Advanced settings</b> · predictions, multiplier, maximum
                                                            stake, pauses, higher limits
                                                        </li>
                                                    </ul>
                                                    <p className='kapa-dim'>
                                                        Premium belongs to your Deriv account
                                                        {plan_?.days ? ` for ${plan_.days} days` : ''} and ends by itself.
                                                    </p>
                                                    {premium.status !== 'off' && (
                                                        <div className='kapa-premium__buy'>
                                                            {plan_?.configured ? (
                                                                <>
                                                                    <b>Get Premium</b>
                                                                    <span>
                                                                        {plan_.price.toLocaleString()} {plan_.currency} for{' '}
                                                                        {plan_.days} days, by mobile money (Orange, MTN,
                                                                        Moov, Wave) or bank card. Premium starts on your
                                                                        Deriv account as soon as CinetPay confirms the
                                                                        payment.
                                                                    </span>
                                                                    <button
                                                                        className='kapa-btn kapa-btn--gold'
                                                                        type='button'
                                                                        onClick={pay}
                                                                        disabled={!logged_in || paying}
                                                                    >
                                                                        {paying ? 'Opening CinetPay…' : 'Pay with CinetPay'}
                                                                    </button>
                                                                    {!logged_in && <small>Log in with Deriv first to pay.</small>}
                                                                </>
                                                            ) : whatsappLink ? (
                                                                <>
                                                                    <b>Get Premium</b>
                                                                    <span>
                                                                        Write to Kapa on WhatsApp. Your Deriv account ID
                                                                        {account ? ` (${account})` : ''} is in the message, so
                                                                        Kapa can switch Premium on for it. Nothing else is
                                                                        shared.
                                                                    </span>
                                                                    <a
                                                                        className='kapa-btn kapa-btn--gold'
                                                                        href={whatsappLink}
                                                                        target='_blank'
                                                                        rel='noopener noreferrer'
                                                                    >
                                                                        Get Premium on WhatsApp
                                                                    </a>
                                                                </>
                                                            ) : (
                                                                <>
                                                                    <b>Premium purchase opens soon</b>
                                                                    <span>
                                                                        Buying Premium on this page isn&apos;t open yet. If
                                                                        Kapa gave you a gift code, enter it below.
                                                                    </span>
                                                                </>
                                                            )}
                                                            {contact.telegram && (
                                                                <a
                                                                    className='kapa-btn kapa-btn--line'
                                                                    href={contact.telegram}
                                                                    target='_blank'
                                                                    rel='noopener noreferrer'
                                                                >
                                                                    Contact Kapa on Telegram
                                                                </a>
                                                            )}
                                                        </div>
                                                    )}
                                                    <form className='kapa-premium__code' onSubmit={unlock}>
                                                        <label htmlFor='kapa-premium-code'>Gift code</label>
                                                        <div>
                                                            <input
                                                                id='kapa-premium-code'
                                                                type='text'
                                                                value={code}
                                                                onChange={e => setCode(e.target.value)}
                                                                placeholder='KAPA-XXXX-XXXX-XXXX'
                                                                autoComplete='off'
                                                                autoCapitalize='characters'
                                                                spellCheck={false}
                                                                maxLength={80}
                                                            />
                                                            <button
                                                                className='kapa-btn kapa-btn--gold'
                                                                type='submit'
                                                                disabled={!code.trim() || unlocking || !logged_in}
                                                            >
                                                                {unlocking ? 'Checking…' : 'Use code'}
                                                            </button>
                                                        </div>
                                                        {!logged_in && <small>Log in with Deriv first: the code goes to your account.</small>}
                                                    </form>
                                                    <p className='kapa-premium__note'>
                                                        The session plan, the lab and the protection limits stay free for
                                                        everyone. Premium adds tools; it does not change the odds: every
                                                        Deriv contract still pays less than its true chance.
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
                                            min={0.35}
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

                                    {isClassic(s.strategy) && (
                                        <label className='kapa-check'>
                                            <input
                                                type='checkbox'
                                                checked={s.apexRecovery}
                                                disabled={running}
                                                onChange={e =>
                                                    e.target.checked && !isPremium
                                                        ? openPremium()
                                                        : update({ apexRecovery: e.target.checked })
                                                }
                                            />
                                            <span>
                                                <b>{isPremium ? '' : '🔒 '}KAPA Apex recovery (Premium)</b>
                                                <small>
                                                    After a loss, the Kapa server picks the contract and stake with the
                                                    best chance of still reaching your take-profit, instead of the bot&apos;s
                                                    own recovery. Never past your stop-loss.
                                                </small>
                                            </span>
                                        </label>
                                    )}
                                    {/* Protection: everyone sees these and may lower them; only Premium may raise them */}
                                    <div className='kapa-grid2'>
                                        <label className='kapa-field'>
                                            <span>Daily loss limit (% of balance)</span>
                                            <input
                                                type='number'
                                                min={1}
                                                max={protectionLimits(isPremium).dailyLossPct}
                                                step={1}
                                                value={s.dailyLossPct}
                                                onChange={num('dailyLossPct')}
                                                disabled={running}
                                            />
                                            <small>
                                                {DAY_RESET_NOTE} Up to {protectionLimits(isPremium).dailyLossPct}%
                                                {isPremium ? '' : ' (Premium: up to 50%)'}. Each session also stops at{' '}
                                                {MAX_SESSION_RISK * 100}% of the balance at most.
                                            </small>
                                        </label>
                                        <label className='kapa-field'>
                                            <span>Maximum Deriv margin (%)</span>
                                            <input
                                                type='number'
                                                min={1}
                                                max={protectionLimits(isPremium).maxMargin}
                                                step={0.5}
                                                value={s.maxMargin}
                                                onChange={num('maxMargin')}
                                                disabled={running}
                                            />
                                            <small>
                                                KAPA AI doesn&apos;t trade when Deriv keeps more than this share of each
                                                stake (Deriv&apos;s public price keeps 1.4% to 2.35%; an app markup costs
                                                more). Lower it to refuse poor prices sooner.
                                            </small>
                                        </label>
                                    </div>
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
                                                            <option value='target'>Bold play to the target</option>
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
                                </div>
                                <div className='kapa-settings__side'>
                                    {halfRatios[halfKey] != null && (
                                        <p className={halfMargin > 0.03 ? 'kapa-warnbox' : 'kapa-dim'}>
                                            On your connection Deriv pays +{fmt(halfRatio * 100, 1)}% on {keyLabel(halfKey)}: it keeps{' '}
                                            {fmt(halfMargin * 100, 1)}% of each stake
                                            {halfMargin > 0.03
                                                ? ` (Deriv's public price keeps 2.35%). Every strategy loses faster at this price; an app markup set on developers.deriv.com is the usual cause.`
                                                : ", Deriv's normal price."}
                                        </p>
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
                                                        ? ` and about ${Math.round(plan.bust * 100)} stop at a loss, losing ${fmt(Math.abs(plan.bustAvg))} ${currency} on average`
                                                        : ''}
                                                    {Math.round(plan.hit * 100) + Math.round(plan.bust * 100) < 99
                                                        ? `; the other ${100 - Math.round(plan.hit * 100) - Math.round(plan.bust * 100)} end in between (a run of losses or the trade limit stops them with a small loss or gain).`
                                                        : '.'}{' '}
                                                    A session never loses more than its stop-loss ({fmt(s.stopLoss)}{' '}
                                                    {currency}).{' '}
                                                    Averaged over many sessions, that is {signed(plan.avg)} {currency} per
                                                    session.
                                                    {plan.contract &&
                                                        ` KAPA AI trades ${keyLabel(plan.contract)}, the contract Deriv pays best here.`}
                                                    {plan.avg < 0 &&
                                                        ' Every Deriv contract pays a little under its true odds, so no strategy makes the long-run average positive: KAPA AI keeps it as close to zero as possible and never lets one session lose more than its stop-loss.'}
                                                </p>
                                            </>
                                        ) : (
                                            <p className='kapa-plan__text'>{planNote || 'Computing the plan…'}</p>
                                        )}
                                    </div>
                                    <LabPanel
                                        api={derivApi}
                                        s={s}
                                        balance={balance}
                                        currency={currency}
                                        logged_in={logged_in}
                                    />
                                </div>
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
                        <KapaClose className='kapa-close--corner' onClick={() => setActivation(null)} />
                        <div className='kapa-modal__title'>KAPA ACTIVATED</div>
                        <div className='kapa-hero kapa-hero--art'>
                            <img src={activatedArt} alt='' />
                            <span className='kapa-hero__scan' aria-hidden />
                        </div>
                        <p className='kapa-modal__text'>
                            KAPA AI is loaded with {MARKETS[activation.sym]} · {keyLabel(activation.key)} (Deriv&apos;s
                            margin {fmt(activation.margin * 100, 1)}%). Take-profit {fmt(s.takeProfit)}, stop-loss{' '}
                            {fmt(s.stopLoss)} {currency}. {recoveryLine(activation.preset)}.
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
                            Load these settings
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
                <div className='kapa-mask' role='dialog' aria-modal aria-label={STOP_TITLES[result.kind]}>
                    <div className={classNames('kapa-modal kapa-modal--result', { 'kapa-modal--loss': result.pl < 0 })}>
                        <div className='kapa-result__media'>
                            <KapaClip win={result.pl >= 0} />
                        </div>
                        <KapaClose className='kapa-close--corner' onClick={kapaRun.closeResult} />
                        <div className='kapa-result'>
                            <span className={classNames('kapa-result__tag', { bad: result.kind !== 'tp' })}>
                                {STOP_TITLES[result.kind]}
                            </span>
                            <div className='kapa-result__h1'>KAPA AI</div>
                            <div className='kapa-result__h2'>
                                {result.kind === 'tp'
                                    ? 'hit a profit of'
                                    : result.pl > 0
                                      ? 'stopped with a profit of'
                                      : result.pl < 0
                                        ? 'stopped at a loss of'
                                        : 'stopped with no gain or loss'}
                            </div>
                            {result.pl !== 0 && (
                                <div className={classNames('kapa-result__amt', { bad: result.pl < 0 })}>
                                    <CountUp value={Math.abs(result.pl)} /> {currency}
                                </div>
                            )}
                            {/* Why it stopped, in full (the run bar can only show the beginning) */}
                            {result.kind !== 'tp' && <p className='kapa-result__why'>{result.reason}</p>}
                            <button className='kapa-btn kapa-btn--lime' type='button' onClick={kapaRun.closeResult}>
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
