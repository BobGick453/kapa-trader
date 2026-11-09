import React, { useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { keyLabel, MARKETS, PREMIUM_PRESETS, SCAN_MARKETS, STRATEGIES, TPresetKey } from '@/pages/kapa-ai/engine';
import { refreshEntitlement, scanMarkets, TScanRow } from '@/pages/premium/premium-api';
import { openPremium, usePremium } from '@/pages/premium/use-premium';
import KapaClose from '@/components/kapa-close/kapa-close';
import { useFloating } from './use-floating';
import './kapa-orb.scss';

const isDesktop = () => window.innerWidth >= 1280;

// Words for the connection state shown on the scanner's status pill (the same state as the orb's badge)
const STATE_LABEL = { live: 'Live', connecting: 'Connecting', reconnecting: 'Reconnecting', offline: 'Offline' } as const;

/** Floating "AI" orb with the live connection state; opens the KAPA Live Scanner. A risk-warning button sits on the left. */
const KapaOrb = observer(() => {
    const { client } = useStore();
    const { connectionStatus } = useApiBase();
    const premium = usePremium();
    const isPremium = premium.status === 'active';
    const [wasOpen, setWasOpen] = useState(false);
    const [open, setOpen] = useState(false);
    const [risk, setRisk] = useState(false);
    const [preset, setPreset] = useState<TPresetKey>('martingale');
    const [stake, setStake] = useState(1);
    const [all, setAll] = useState(true);
    const [single, setSingle] = useState('R_100');
    const [busy, setBusy] = useState(false);
    const [rows, setRows] = useState<TScanRow[] | null>(null);
    const [scanned, setScanned] = useState<TPresetKey>('martingale');
    const [error, setError] = useState('');
    // Both buttons float over every page and can be dragged. Until they are moved, CSS keeps them at the
    // bottom corners above the footer and the Run bars (kapa-orb.scss)
    const orbFloat = useFloating('kapa_orb_spot', window.innerWidth <= 599 ? 52 : 60);
    const riskFloat = useFloating('kapa_risk_spot', isDesktop() ? 38 : 36);

    if (connectionStatus === CONNECTION_STATUS.OPENED && !wasOpen) setWasOpen(true);
    const state =
        connectionStatus === CONNECTION_STATUS.OPENED
            ? 'live'
            : connectionStatus === CONNECTION_STATUS.UNKNOWN
              ? 'connecting'
              : wasOpen
                ? 'reconnecting'
                : 'offline';
    const live = state === 'live';
    const currency = (client.is_logged_in && client.currency) || 'USD';
    const description =
        'Compares the synthetic indices on Deriv’s live payouts: the best-paid contract has the smallest Deriv margin. It also tests the last 1,000 ticks of each market for patterns. The scan runs on the KAPA AI server.';

    const scan = async () => {
        if (!isPremium) {
            setOpen(false);
            return openPremium();
        }
        if (!(stake >= 0.35)) return setError('Minimum stake is 0.35.');
        setError('');
        setBusy(true);
        setRows(null);
        try {
            const res = await scanMarkets(preset, currency, all ? undefined : [single]);
            setRows(res.rows);
            setScanned(preset);
            if (!res.rows.length) setError('Deriv returned no prices. Try again in a moment.');
        } catch (e: any) {
            setError(e?.message ?? 'The scan failed. Try again.');
            if (e?.status === 402) refreshEntitlement();
        } finally {
            setBusy(false);
        }
    };

    const sendToKapa = (r: TScanRow) => {
        const detail = {
            symbol: r.symbol,
            preset: scanned,
            stake,
            ratios: r.ratios,
        };
        try {
            sessionStorage.setItem('kapa_pending_market', JSON.stringify(detail)); // picked up when KAPA AI mounts
        } catch {
            /* the event below still works when KAPA AI is already open */
        }
        window.dispatchEvent(new CustomEvent('kapa:use-market', { detail }));
        setOpen(false);
    };

    return (
        <>
            <button
                type='button'
                className={classNames('kapa-fab-orb', `kapa-fab-orb--${state}`, {
                    'kapa-fab--dragging': orbFloat.dragging,
                })}
                style={orbFloat.style}
                {...orbFloat.handlers}
                onClick={() => setOpen(true)}
                aria-label={`KAPA Live Scanner, ${state}. Drag to move.`}
            >
                <span className='kapa-fab-orb__halo' aria-hidden />
                <span className='kapa-fab-orb__arc' aria-hidden />
                <span className='kapa-fab-orb__label'>AI</span>
                <span className='kapa-fab-orb__dot' aria-hidden />
                <span className='kapa-fab-orb__badge'>{state.toUpperCase()}</span>
            </button>
            <button
                type='button'
                className={classNames('kapa-fab-risk', { 'kapa-fab--dragging': riskFloat.dragging })}
                style={riskFloat.style}
                {...riskFloat.handlers}
                onClick={() => setRisk(true)}
                aria-label='Risk warning. Drag to move.'
            >
                <svg viewBox='0 0 24 24' width='18' height='18' aria-hidden>
                    <path d='M12 2.8 22.6 21H1.4z' fill='currentColor' strokeLinejoin='round' />
                    <path d='M12 9.5v5.2M12 17.6v.1' stroke='#fff8e6' strokeWidth='2.2' strokeLinecap='round' />
                </svg>
            </button>

            {open && (
                <div className='kapa-scan-mask' onClick={e => e.target === e.currentTarget && setOpen(false)}>
                    <div className='kapa-scan' role='dialog' aria-modal aria-label='KAPA Live Scanner'>
                        <div className='kapa-scan__head'>
                            <span className='kapa-scan__logo' aria-hidden>
                                KA
                            </span>
                            <div className='kapa-scan__titles'>
                                <small className='kapa-scan__eyebrow'>Live price comparison</small>
                                <b>KAPA LIVE SCANNER</b>
                            </div>
                            <span className={`kapa-scan__pill kapa-scan__pill--${state}`} role='status'>
                                <i aria-hidden />
                                {STATE_LABEL[state]}
                            </span>
                            <KapaClose className='kapa-scan__x' onClick={() => setOpen(false)} label='Close scanner' />
                        </div>
                        <div className='kapa-scan__body'>
                            <section className='kapa-scan__box'>
                                <label className='kapa-scan__f kapa-scan__f--strategy'>
                                    <span>Scanner strategy</span>
                                    <select value={preset} onChange={e => setPreset(e.target.value as TPresetKey)}>
                                        {PREMIUM_PRESETS.map(k => (
                                            <option key={k} value={k}>
                                                {STRATEGIES[k].label}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className='kapa-scan__f'>
                                    <span>Initial stake</span>
                                    <input
                                        type='number'
                                        min={0.35}
                                        step={0.01}
                                        value={stake}
                                        onChange={e => setStake(+e.target.value)}
                                    />
                                </label>
                                <label className='kapa-scan__f'>
                                    <span>Duration</span>
                                    <select disabled value='1'>
                                        <option value='1'>1 tick · Fixed</option>
                                    </select>
                                </label>
                                <label className='kapa-scan__switch'>
                                    <input type='checkbox' checked={all} onChange={e => setAll(e.target.checked)} />
                                    <i aria-hidden />
                                    <span>Scan All Markets</span>
                                </label>
                                {!all && (
                                    <label className='kapa-scan__f kapa-scan__f--wide'>
                                        <span>Market</span>
                                        <select value={single} onChange={e => setSingle(e.target.value)}>
                                            {SCAN_MARKETS.map(m => (
                                                <option key={m} value={m}>
                                                    {MARKETS[m]}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                )}
                                <div className={classNames('kapa-scan__status', { 'kapa-scan__status--off': !live })}>
                                    <i aria-hidden />
                                    {live ? 'Live Deriv market data is available.' : 'Market data is offline or stale.'}
                                </div>
                            </section>

                            <section className='kapa-scan__result'>
                                {!rows && !busy && (
                                    <>
                                        <h4>Ready to inspect live conditions</h4>
                                        <p>{description}</p>
                                    </>
                                )}
                                {busy && <h4>Scanning live markets…</h4>}
                                {rows?.map((r, i) => (
                                    <div key={r.symbol} className={classNames('kapa-scan__row', { best: i === 0 })}>
                                        <div className='kapa-scan__row-head'>
                                            <b>{MARKETS[r.symbol]}</b>
                                            {i === 0 && <span>BEST TERMS</span>}
                                        </div>
                                        <div className='kapa-scan__grid'>
                                            <div>
                                                <small>Win chance</small>
                                                <b>{(r.win_chance * 100).toFixed(0)}%</b>
                                            </div>
                                            <div>
                                                <small>Payout</small>
                                                <b>+{(r.payout * 100).toFixed(1)}%</b>
                                            </div>
                                            <div>
                                                <small>Deriv margin</small>
                                                <b className={r.tradable ? undefined : 'down'}>{(r.margin * 100).toFixed(1)}%</b>
                                            </div>
                                        </div>
                                        <p>
                                            Best-paid contract: {keyLabel(r.contract)}.
                                            {!r.tradable && ' Priced worse than usual: KAPA AI won’t trade it now.'}{' '}
                                            {r.randomness &&
                                                `Last ${r.randomness.ticks} ticks: ${
                                                    r.randomness.uniform_p >= 0.01 && r.randomness.serial_p >= 0.01
                                                        ? 'no pattern found'
                                                        : 'an unusual run, which happens by chance about 1 time in 100'
                                                } (randomness tests p=${r.randomness.uniform_p.toFixed(2)} and ${r.randomness.serial_p.toFixed(2)}).`}
                                        </p>
                                        <button type='button' onClick={() => sendToKapa(r)}>
                                            Use in KAPA AI
                                        </button>
                                    </div>
                                ))}
                                {error && <p className='kapa-scan__error'>{error}</p>}
                            </section>
                            <p className='kapa-scan__note'>
                                Win chance is the true probability of the contract. The digits come from Deriv&apos;s random
                                number generator: past ticks never predict the next one, so KAPA AI compares prices, not
                                patterns. This scanner never places trades.
                            </p>
                        </div>
                        <div className='kapa-scan__foot'>
                            <button type='button' onClick={() => setOpen(false)}>
                                Cancel
                            </button>
                            <button type='button' className='primary' onClick={scan} disabled={busy}>
                                {!isPremium ? '🔒 Scan Markets · Premium' : busy ? 'Scanning…' : 'Scan Markets'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {risk && (
                <div
                    className='kapa-risk'
                    role='dialog'
                    aria-modal
                    aria-label='Risk warning'
                    onClick={() => setRisk(false)}
                >
                    <div className='kapa-risk__box' onClick={e => e.stopPropagation()}>
                        <div className='kapa-risk__head'>
                            <span className='kapa-risk__icon' aria-hidden>
                                <svg viewBox='0 0 24 24' width='22' height='22'>
                                    <path d='M12 3.2 21.8 20H2.2z' fill='currentColor' strokeLinejoin='round' />
                                    <path d='M12 9.6v4.6M12 16.9v.1' stroke='#fffbeb' strokeWidth='2.1' strokeLinecap='round' />
                                </svg>
                            </span>
                            <b>Risk warning</b>
                            <KapaClose className='kapa-close--light' onClick={() => setRisk(false)} label='Close risk warning' />
                        </div>
                        <p>
                            Deriv offers complex derivatives, such as options and contracts for difference
                            (&quot;CFDs&quot;). These products may not be suitable for all clients, and trading them
                            puts you at risk. Please make sure that you understand the following risks before trading
                            Deriv products: a) you may lose some or all of the money you invest in the trade, b) if your
                            trade involves currency conversion, exchange rates will affect your profit and loss. You
                            should never trade with borrowed money or with money that you cannot afford to lose.
                        </p>
                        <p>
                            Synthetic indices are random. No bot, scanner or strategy can predict the next tick, and
                            every contract pays less than its true odds.
                        </p>
                        <button type='button' className='kapa-risk__close' onClick={() => setRisk(false)}>
                            Close
                        </button>
                    </div>
                </div>
            )}
        </>
    );
});

export default KapaOrb;
