import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { generateOAuthURL } from '@/components/shared';
import { api_base } from '@/external/bot-skeleton';
import { useStore } from '@/hooks/useStore';
import {
    DEFAULT_SETTINGS,
    estRatio,
    KapaEngine,
    MARKETS,
    PIP_SIZES,
    PRESETS,
    RatioCache,
    recoveryBarrier,
    simulate,
    TApi,
    TLiveContract,
    TPhase,
    TPlanResult,
    TPresetKey,
    TSettings,
    TStopKind,
    TTrade,
    TYPE_LABEL,
    validate,
    winProb,
} from './engine';
import './kapa-ai.scss';

const STORAGE_KEY = 'kapa_ai_settings';
const SCAN_MARKETS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];

const loadSettings = (): TSettings => {
    try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
    } catch {
        return DEFAULT_SETTINGS;
    }
};
const presetOf = (s: TSettings): TPresetKey | 'custom' =>
    (Object.keys(PRESETS) as TPresetKey[]).find(k => {
        const p = PRESETS[k];
        return p.ctype === s.ctype && p.barrier === s.barrier && p.recovery === s.recovery && p.recMode === s.recMode && p.martingale === s.martingale;
    }) ?? 'custom';

const fmt = (n: number, d = 2) => Number(n).toFixed(d);
const signed = (n: number) => `${n >= 0 ? '+' : ''}${fmt(n)}`;

type TScanCard = { sym: string; b: number; p: number; payout: number; ev: number; recent: number | null; n: number };
type TLog = { at: number; text: string; level: 'info' | 'success' | 'warn' | 'error' };

// The app's authorized connection, shaped for the engine
const derivApi: TApi = {
    send: req => (api_base.api as any).send(req),
    onMessage: () => (api_base.api as any).onMessage(),
};

const Ring = ({ busy, label, sub, onClick, disabled }: { busy: boolean; label: React.ReactNode; sub: string; onClick: () => void; disabled?: boolean }) => (
    <button className={classNames('kapa-ring', { 'kapa-ring--busy': busy })} onClick={onClick} disabled={disabled} type='button'>
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
    const logged_in = client.is_logged_in;
    const currency = (logged_in && client.currency) || 'USD';
    const balance = logged_in ? Number(client.balance) || 0 : 0;

    const [s, setS] = useState<TSettings>(loadSettings);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [plan, setPlan] = useState<TPlanResult | null>(null);
    const [planLive, setPlanLive] = useState(false);
    const [scanning, setScanning] = useState(false);
    const [scanMsg, setScanMsg] = useState('');
    const [cards, setCards] = useState<TScanCard[]>([]);
    const [activation, setActivation] = useState<TScanCard | null>(null);
    const [confirmReal, setConfirmReal] = useState(false);
    const [result, setResult] = useState<{ kind: TStopKind; pl: number } | null>(null);
    const [running, setRunning] = useState(false);
    const [status, setStatus] = useState<{ text: string; phase: TPhase }>({ text: 'KAPA AI is not running', phase: 'idle' });
    const [live, setLive] = useState<TLiveContract | null>(null);
    const [trades, setTrades] = useState<TTrade[]>([]);
    const [logs, setLogs] = useState<TLog[]>([]);
    const [panel, setPanel] = useState<'summary' | 'transactions' | 'journal'>('summary');
    const [error, setError] = useState('');

    const ratios = useRef(new RatioCache()).current;
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
    const num = (k: keyof TSettings) => (e: React.ChangeEvent<HTMLInputElement>) => update({ [k]: e.target.value === '' ? ('' as any) : +e.target.value } as Partial<TSettings>);

    const applyPreset = (k: TPresetKey) => {
        const p = PRESETS[k];
        update({ ctype: p.ctype, barrier: p.barrier, recovery: p.recovery, recMode: p.recMode, martingale: p.martingale, maxLosses: p.maxLosses, maxStake: Math.max(s.stopLoss, s.stake) });
    };

    const log = useCallback((text: string, level: TLog['level'] = 'info') => setLogs(prev => [{ at: Date.now(), text, level }, ...prev].slice(0, 400)), []);

    const engine = useMemo(
        () =>
            new KapaEngine(derivApi, () => currencyRef.current, () => balanceRef.current, ratios, {
                onStatus: (text, phase) => setStatus({ text, phase }),
                onContract: c => setLive(c),
                onTrade: t => setTrades(prev => [t, ...prev].slice(0, 500)),
                onLog: (text, level) => log(text, level),
                onStop: (reason, kind, pl) => {
                    setRunning(false);
                    if (kind === 'tp' || kind === 'sl' || kind === 'streak') setResult({ kind, pl });
                    setStatus(prev => (prev.phase === 'won' || prev.phase === 'lost' ? prev : { text: reason, phase: 'idle' }));
                },
            }),
        [ratios, log]
    );
    useEffect(() => () => engine.requestStop(), [engine]);

    // Session plan: re-simulate whenever settings, balance or known payouts change
    const recomputePlan = useCallback(() => {
        if (!(s.stake >= 0.35 && s.takeProfit > 0 && s.stopLoss > 0 && s.maxLosses >= 1)) return setPlan(null);
        const baseR = ratios.known(s.symbol, s.ctype, s.barrier, s.duration);
        const recR = ratios.known(s.symbol, s.ctype, recoveryBarrier(s), s.duration);
        setPlanLive(baseR != null && (s.recMode === 'none' || recR != null));
        setPlan(simulate(s, balance || 1000, baseR ?? estRatio(s.ctype, s.barrier), recR ?? estRatio(s.ctype, recoveryBarrier(s))));
    }, [s, balance, ratios]);
    useEffect(() => {
        const t = setTimeout(recomputePlan, 250);
        return () => clearTimeout(t);
    }, [recomputePlan]);

    // Fetch live payouts for the current strategy so the plan uses Deriv's real prices
    useEffect(() => {
        if (!logged_in || !api_base.api) return;
        let cancelled = false;
        (async () => {
            // The connection may still be authorizing right after login, so retry a few times
            for (let attempt = 0; attempt < 4 && !cancelled; attempt++) {
                try {
                    await ratios.get(derivApi, currency, s.symbol, s.ctype, s.barrier, s.duration);
                    if (s.recMode !== 'none') await ratios.get(derivApi, currency, s.symbol, s.ctype, recoveryBarrier(s), s.duration);
                    if (!cancelled) recomputePlan();
                    return;
                } catch {
                    await new Promise(r => setTimeout(r, 2000)); // the plan uses estimated payouts meanwhile
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [logged_in, currency, s.symbol, s.ctype, s.barrier, s.recovery, s.recMode, s.duration]); // eslint-disable-line react-hooks/exhaustive-deps

    const login = async () => {
        const url = await generateOAuthURL();
        if (url) window.location.replace(url);
    };

    const scan = async () => {
        if (scanning || running) return;
        const err = validate(s, balance);
        if (err) return setError(err);
        setError('');
        setScanning(true);
        setCards([]);
        setScanMsg('Scanning fresh synthetic-index ticks…');
        const found: TScanCard[] = [];
        const barriers = Array.from(new Set([s.barrier, 1, 2])).filter(b => b >= 0 && b <= 8);
        try {
            await Promise.all(
                SCAN_MARKETS.map(async sym => {
                    let digits: number[] = [];
                    try {
                        const h = await derivApi.send({ ticks_history: sym, count: 100, end: 'latest', style: 'ticks' });
                        const pip = h?.pip_size ?? PIP_SIZES[sym] ?? 2;
                        digits = (h?.history?.prices || []).map((p: number) => {
                            const str = Number(p).toFixed(pip);
                            return +str[str.length - 1];
                        });
                    } catch {
                        /* recent digits are optional */
                    }
                    await Promise.all(
                        barriers.map(async b => {
                            try {
                                const r = await ratios.get(derivApi, currency, sym, 'DIGITOVER', b, 1);
                                const p = winProb('DIGITOVER', b);
                                const payout = s.stake * (1 + r);
                                found.push({ sym, b, p, payout, ev: p * payout - s.stake, recent: digits.length ? digits.filter(d => d > b).length / digits.length : null, n: digits.length });
                            } catch (e: any) {
                                log(`Scan ${sym} Over ${b}: ${e?.message ?? e}`, 'warn');
                            }
                        })
                    );
                })
            );
            await new Promise(r => setTimeout(r, 800));
        } finally {
            setScanning(false);
        }
        found.sort((a, b) => b.ev - a.ev);
        const top = found.slice(0, 3);
        setCards(top);
        setScanMsg(top.length ? `${top.length} live markets compared.` : 'No prices returned. Check your connection and try again.');
        recomputePlan();
    };

    const pickCard = (c: TScanCard) => {
        update({ symbol: c.sym, ctype: 'DIGITOVER', barrier: c.b });
        setScanMsg(`${MARKETS[c.sym]} selected. Loading the strategy…`);
        setTimeout(() => setActivation(c), 500);
    };

    const start = () => {
        const err = validate(s, balance);
        if (err) return setError(err);
        if (run_panel.is_running) return setError('A Bot Builder strategy is running. Stop it before starting KAPA AI.');
        setError('');
        if (!client.is_virtual) return setConfirmReal(true);
        go();
    };
    const go = () => {
        setConfirmReal(false);
        setRunning(true);
        setResult(null);
        engine.run(s);
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

    const preset = presetOf(s);
    const recB = recoveryBarrier(s);
    const recoveryLine =
        s.recMode === 'recover'
            ? `Recovery: ${TYPE_LABEL[s.ctype]} ${recB} · wins back losses in one trade`
            : s.recMode === 'mult'
              ? `Recovery: ${TYPE_LABEL[s.ctype]} ${recB} · stake ×${s.martingale} after each loss`
              : 'Recovery: none · fixed stake';
    const tpPct = balance ? (s.takeProfit / balance) * 100 : null;
    const progress = { idle: 0, starting: 8, buying: 50, bought: 100, won: 100, lost: 100 }[status.phase];

    return (
        <div className='kapa-ai'>
            <div className='kapa-ai__scroll'>
                <section className='kapa-card'>
                    <div className='kapa-orb' aria-hidden>
                        KA<span className={classNames('kapa-orb__badge', { 'kapa-orb__badge--live': logged_in })}>{logged_in ? 'LIVE' : 'OFFLINE'}</span>
                    </div>
                    <div className='kapa-eyebrow'>KAPA AI · Premium</div>
                    <h2 className='kapa-title'>Activate Kapa</h2>
                    <p className='kapa-lede'>Set your stake, take-profit and stop-loss, check the session plan, then activate the scanner to compare live markets.</p>

                    {!logged_in && (
                        <div className='kapa-login'>
                            <p>Log in with your Deriv account to use KAPA AI.</p>
                            <button className='kapa-btn kapa-btn--gold' onClick={login} type='button'>
                                Log in with Deriv
                            </button>
                        </div>
                    )}

                    <label className='kapa-field'>
                        <span>Stake ({currency})</span>
                        <input type='number' inputMode='decimal' min={0.35} step={0.01} value={s.stake} onChange={num('stake')} disabled={running} />
                    </label>
                    <label className='kapa-field'>
                        <span>Take-profit ({currency})</span>
                        <input type='number' inputMode='decimal' min={0.01} step={0.01} value={s.takeProfit} onChange={num('takeProfit')} disabled={running} />
                        {tpPct != null && (
                            <small>
                                = {fmt(tpPct, tpPct < 10 ? 1 : 0)}% of your balance ({fmt(balance)} {currency})
                            </small>
                        )}
                    </label>
                    <label className='kapa-field'>
                        <span>Stop-loss ({currency})</span>
                        <input
                            type='number'
                            inputMode='decimal'
                            min={0.01}
                            step={0.01}
                            value={s.stopLoss}
                            onChange={e => update({ stopLoss: +e.target.value, ...(s.recMode !== 'none' ? { maxStake: Math.max(+e.target.value, s.stake) } : {}) })}
                            disabled={running}
                        />
                    </label>
                    <label className='kapa-field'>
                        <span>Strategy</span>
                        <select value={preset} onChange={e => e.target.value !== 'custom' && applyPreset(e.target.value as TPresetKey)} disabled={running}>
                            {(Object.keys(PRESETS) as TPresetKey[]).map(k => (
                                <option key={k} value={k}>
                                    {PRESETS[k].label}
                                </option>
                            ))}
                            {preset === 'custom' && <option value='custom'>Custom</option>}
                        </select>
                    </label>
                    <label className='kapa-field'>
                        <span>Market</span>
                        <select value={s.symbol} onChange={e => update({ symbol: e.target.value })} disabled={running}>
                            {Object.entries(MARKETS).map(([k, v]) => (
                                <option key={k} value={k}>
                                    {v}
                                </option>
                            ))}
                        </select>
                    </label>

                    <button className='kapa-link' type='button' onClick={() => setShowAdvanced(v => !v)}>
                        {showAdvanced ? 'Hide' : 'Show'} advanced settings
                    </button>
                    {showAdvanced && (
                        <div className='kapa-grid2'>
                            <label className='kapa-field'>
                                <span>Prediction (Over)</span>
                                <select value={s.barrier} onChange={e => update({ barrier: +e.target.value })} disabled={running}>
                                    {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(d => (
                                        <option key={d} value={d}>
                                            Over {d} · {fmt(winProb('DIGITOVER', d) * 100, 0)}%
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className='kapa-field'>
                                <span>Recovery prediction</span>
                                <select value={String(s.recovery)} onChange={e => update({ recovery: e.target.value === 'same' ? 'same' : +e.target.value })} disabled={running}>
                                    <option value='same'>Same</option>
                                    {[0, 1, 2, 3, 4, 5, 6, 7, 8].map(d => (
                                        <option key={d} value={d}>
                                            Over {d}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label className='kapa-field'>
                                <span>Recovery mode</span>
                                <select value={s.recMode} onChange={e => update({ recMode: e.target.value as TSettings['recMode'] })} disabled={running}>
                                    <option value='none'>None</option>
                                    <option value='mult'>Multiply stake</option>
                                    <option value='recover'>Win back losses</option>
                                </select>
                            </label>
                            <label className='kapa-field'>
                                <span>Multiplier</span>
                                <input type='number' min={1} step={0.1} value={s.martingale} onChange={num('martingale')} disabled={running} />
                            </label>
                            <label className='kapa-field'>
                                <span>Maximum stake</span>
                                <input type='number' min={0.35} step={0.01} value={s.maxStake} onChange={num('maxStake')} disabled={running} />
                            </label>
                            <label className='kapa-field'>
                                <span>Stop after N losses in a row</span>
                                <input type='number' min={1} step={1} value={s.maxLosses} onChange={num('maxLosses')} disabled={running} />
                            </label>
                            <label className='kapa-field'>
                                <span>Max trades (0 = no limit)</span>
                                <input type='number' min={0} step={1} value={s.maxRuns} onChange={num('maxRuns')} disabled={running} />
                            </label>
                            <label className='kapa-field'>
                                <span>Pause between trades (s)</span>
                                <input type='number' min={0} step={0.5} value={s.delay} onChange={num('delay')} disabled={running} />
                            </label>
                        </div>
                    )}

                    <div className='kapa-plan'>
                        <div className='kapa-plan__head'>
                            <span>Session plan</span>
                            <small>Simulated 4,000 times with {planLive ? "Deriv's live payouts" : 'estimated payouts'}</small>
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
                                        <b className={plan.avg >= 0 ? 'kapa-up' : 'kapa-down'}>{signed(plan.avg)}</b>
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
                                    Out of 100 sessions like this, about {Math.round(plan.hit * 100)} reach +{fmt(s.takeProfit)} {currency}
                                    {plan.bust > 0.005 ? ` and about ${Math.round(plan.bust * 100)} stop at a loss, losing ${fmt(Math.abs(plan.bustAvg))} ${currency} on average.` : '.'}{' '}
                                    Averaged over many sessions, that is {signed(plan.avg)} {currency} per session.
                                    {plan.avg < 0 && ' Changing the target, stake or stop-loss changes how often you reach the target; the long-run average stays negative.'}
                                </p>
                            </>
                        ) : (
                            <p className='kapa-plan__text'>Enter a stake, take-profit and stop-loss to see the plan.</p>
                        )}
                    </div>

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
                        sub={scanning ? 'Scanning live markets' : 'Ready to scan'}
                        onClick={scan}
                        disabled={!logged_in || running}
                    />
                    <div className='kapa-scanmsg'>{scanMsg}</div>

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
                            <p className='kapa-sig__rec'>{recoveryLine}</p>
                            <p>
                                Payout if won: <span className='kapa-up'>+{fmt(c.payout - s.stake)} {currency}</span> ({fmt(((c.payout - s.stake) / s.stake) * 100, 1)}%)
                            </p>
                            <p>
                                Expected result per trade: <span className={c.ev >= 0 ? 'kapa-up' : 'kapa-down'}>{signed(c.ev)} {currency}</span>
                            </p>
                            {c.recent != null && (
                                <p className='kapa-dim'>
                                    Last {c.n} ticks: Over {c.b} came up {fmt(c.recent * 100, 1)}% of the time. Past ticks don&apos;t predict the next one.
                                </p>
                            )}
                            <button className='kapa-use' type='button' onClick={() => pickCard(c)}>
                                Use this market
                            </button>
                        </div>
                    ))}
                </section>

                <section className='kapa-card kapa-card--panel'>
                    <div className='kapa-segs'>
                        {(['summary', 'transactions', 'journal'] as const).map(p => (
                            <button key={p} type='button' className={classNames({ on: panel === p })} onClick={() => setPanel(p)}>
                                {p[0].toUpperCase() + p.slice(1)}
                            </button>
                        ))}
                    </div>

                    {panel === 'summary' &&
                        (live ? (
                            <div className='kapa-cc'>
                                <div className={classNames('kapa-cc__top', { win: live.open ? (live.profit ?? 0) >= 0 : live.won })}>
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
                    <button className='kapa-link' type='button' disabled={running || !trades.length} onClick={() => (setTrades([]), setLive(null), setLogs([]))}>
                        Reset stats
                    </button>
                </section>
            </div>

            <div className='kapa-runbar'>
                <button className={classNames('kapa-runbtn', { 'kapa-runbtn--stop': running })} type='button' onClick={running ? stop : start} disabled={!logged_in}>
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

            {activation && (
                <div className='kapa-mask' role='dialog' aria-modal>
                    <div className='kapa-modal'>
                        <button className='kapa-modal__x' type='button' onClick={() => setActivation(null)} aria-label='Close'>
                            ✕
                        </button>
                        <div className='kapa-modal__title'>KAPA ACTIVATED</div>
                        <div className='kapa-hero'>
                            <div className='kapa-hero__ring' />
                            <div className='kapa-hero__big'>KA</div>
                            <div className='kapa-hero__online'>KAPA CORE ONLINE</div>
                        </div>
                        <p className='kapa-modal__text'>
                            KAPA AI is loaded with {MARKETS[activation.sym]} · Over {activation.b}. Stake {fmt(s.stake)}, take-profit {fmt(s.takeProfit)}, stop-loss {fmt(s.stopLoss)} {currency}. {recoveryLine}.
                        </p>
                        <button
                            className='kapa-btn kapa-btn--gold'
                            type='button'
                            onClick={() => {
                                setActivation(null);
                                log('KAPA AI strategy loaded. Review all settings and press Start when ready.', 'success');
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
                            KAPA AI will place real trades on {client.loginid}. Stake {fmt(s.stake)} {currency} ({fmt(balance ? (s.stake / balance) * 100 : 0, 0)}% of your balance), stop-loss {fmt(s.stopLoss)} {currency}.
                            {plan && ` The session plan gives about ${Math.round(plan.bust * 100)} chances in 100 of stopping at a loss.`} Every contract pays less than its true odds, so over many sessions the expected result is a loss.
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
                    <div className='kapa-modal kapa-modal--result'>
                        <div className='kapa-result__hero' />
                        <button className='kapa-modal__x' type='button' onClick={() => setResult(null)} aria-label='Close'>
                            ✕
                        </button>
                        <div className='kapa-result'>
                            <span className={classNames('kapa-result__tag', { bad: result.kind !== 'tp' })}>
                                {result.kind === 'tp' ? 'PROFIT TARGET REACHED' : result.kind === 'streak' ? 'LOSS LIMIT REACHED' : 'STOP-LOSS REACHED'}
                            </span>
                            <div className='kapa-result__h1'>KAPA AI</div>
                            <div className='kapa-result__h2'>{result.kind === 'tp' ? 'hit a profit of' : result.pl >= 0 ? 'stopped with a profit of' : 'stopped at a loss of'}</div>
                            <div className={classNames('kapa-result__amt', { bad: result.kind !== 'tp' })}>
                                {fmt(Math.abs(result.pl))} {currency}
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
