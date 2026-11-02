import React, { useMemo, useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { api_base } from '@/external/bot-skeleton';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { MARKETS, PIP_SIZES, PRESETS, RatioCache, recoveryBarrier, TApi, TPresetKey, winProb } from '@/pages/kapa-ai/engine';
import { premiumEnabled } from '@/pages/premium/premium-api';
import { openPremium, usePremium } from '@/pages/premium/use-premium';
import './kapa-orb.scss';

const SCAN_MARKETS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];
const api: TApi = {
    send: req => (api_base.api as any).send(req),
    onMessage: () => (api_base.api as any).onMessage(),
};
const ratios = new RatioCache();

type TRow = { sym: string; p: number; ret: number; ev: number; recent: number | null; n: number; recRet: number | null };

/** Floating "AI" orb with the live connection state; opens the KAPA Live Scanner. A risk-warning button sits on the left. */
const KapaOrb = observer(() => {
    const { client } = useStore();
    const { connectionStatus } = useApiBase();
    const premium = usePremium();
    const isPremium = !premiumEnabled() || premium.status === 'active';
    const [wasOpen, setWasOpen] = useState(false);
    const [open, setOpen] = useState(false);
    const [risk, setRisk] = useState(false);
    const [preset, setPreset] = useState<TPresetKey>('martingale');
    const [stake, setStake] = useState(1);
    const [all, setAll] = useState(true);
    const [single, setSingle] = useState('R_100');
    const [busy, setBusy] = useState(false);
    const [rows, setRows] = useState<TRow[] | null>(null);
    const [error, setError] = useState('');

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
    const p = PRESETS[preset];
    const recB = recoveryBarrier(p);
    const currency = (client.is_logged_in && client.currency) || 'USD';

    const description = useMemo(
        () =>
            `Scan active synthetic indices for one qualified Over ${p.barrier} market. ${
                p.recMode === 'none' ? 'The strategy keeps a fixed stake.' : `The loaded strategy switches to Over ${recB} recovery after a loss.`
            }`,
        [p, recB]
    );

    const scan = async () => {
        if (!isPremium) {
            setOpen(false);
            return openPremium();
        }
        if (!live || !api_base.api) return setError('Market data is offline. Wait for the LIVE badge, then scan again.');
        if (!(stake >= 0.35)) return setError('Minimum stake is 0.35.');
        setError('');
        setBusy(true);
        setRows(null);
        const out: TRow[] = [];
        await Promise.all(
            (all ? SCAN_MARKETS : [single]).map(async sym => {
                try {
                    const r = await ratios.get(api, currency, sym, 'DIGITOVER', p.barrier, 1);
                    const rr = p.recMode !== 'none' ? await ratios.get(api, currency, sym, 'DIGITOVER', recB, 1) : null;
                    let digits: number[] = [];
                    try {
                        const h = await api.send({ ticks_history: sym, count: 100, end: 'latest', style: 'ticks' });
                        const pip = h?.pip_size ?? PIP_SIZES[sym] ?? 2;
                        digits = (h?.history?.prices || []).map((x: number) => {
                            const t = Number(x).toFixed(pip);
                            return +t[t.length - 1];
                        });
                    } catch {
                        /* recent frequency is optional */
                    }
                    const prob = winProb('DIGITOVER', p.barrier);
                    out.push({
                        sym,
                        p: prob,
                        ret: r,
                        ev: prob * (1 + r) - 1,
                        recent: digits.length ? digits.filter(d => d > p.barrier).length / digits.length : null,
                        n: digits.length,
                        recRet: rr,
                    });
                } catch {
                    /* skip markets Deriv didn't price */
                }
            })
        );
        out.sort((a, b) => b.ev - a.ev);
        setRows(out);
        setBusy(false);
        if (!out.length) setError('Deriv returned no prices. Try again in a moment.');
    };

    const sendToKapa = (sym: string) => {
        const detail = { symbol: sym, preset, stake };
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
            <button type='button' className={classNames('kapa-fab-orb', `kapa-fab-orb--${state}`)} onClick={() => setOpen(true)} aria-label={`KAPA Live Scanner, ${state}`}>
                AI
                <span className='kapa-fab-orb__badge'>{state.toUpperCase()}</span>
            </button>
            <button type='button' className='kapa-fab-risk' onClick={() => setRisk(true)} aria-label='Risk warning'>
                <svg viewBox='0 0 24 24' width='22' height='22' fill='none' stroke='currentColor' strokeWidth='2' aria-hidden>
                    <path d='M12 3l10 18H2z' />
                    <path d='M12 10v5M12 18h.01' />
                </svg>
            </button>

            {open && (
                <div className='kapa-scan' role='dialog' aria-modal aria-label='KAPA Live Scanner'>
                    <div className='kapa-scan__head'>
                        <span className='kapa-scan__logo'>KA</span>
                        <b>KAPA LIVE SCANNER</b>
                        <button type='button' className='kapa-scan__x' onClick={() => setOpen(false)} aria-label='Close'>
                            ✕
                        </button>
                    </div>
                    <div className='kapa-scan__body'>
                        <section className='kapa-scan__box'>
                            <label>
                                <span>Scanner strategy</span>
                                <select value={preset} onChange={e => setPreset(e.target.value as TPresetKey)}>
                                    {(Object.keys(PRESETS) as TPresetKey[]).map(k => (
                                        <option key={k} value={k}>
                                            {PRESETS[k].label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label>
                                <span>Initial stake</span>
                                <input type='number' min={0.35} step={0.01} value={stake} onChange={e => setStake(+e.target.value)} />
                            </label>
                            <label>
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
                                <label>
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
                                <div key={r.sym} className={classNames('kapa-scan__row', { best: i === 0 })}>
                                    <div className='kapa-scan__row-head'>
                                        <b>{MARKETS[r.sym]}</b>
                                        {i === 0 && <span>BEST PRICE</span>}
                                    </div>
                                    <div className='kapa-scan__grid'>
                                        <div>
                                            <small>Win chance</small>
                                            <b>{(r.p * 100).toFixed(0)}%</b>
                                        </div>
                                        <div>
                                            <small>Payout</small>
                                            <b>+{(r.ret * 100).toFixed(1)}%</b>
                                        </div>
                                        <div>
                                            <small>Avg. per trade</small>
                                            <b className={r.ev >= 0 ? 'up' : 'down'}>{(r.ev * 100).toFixed(1)}%</b>
                                        </div>
                                    </div>
                                    <p>
                                        {r.recRet != null && `Recovery Over ${recB} pays +${(r.recRet * 100).toFixed(0)}%. `}
                                        {r.recent != null && `Last ${r.n} ticks: Over ${p.barrier} came up ${(r.recent * 100).toFixed(0)}% of the time.`}
                                    </p>
                                    <button type='button' onClick={() => sendToKapa(r.sym)}>
                                        Use in KAPA AI
                                    </button>
                                </div>
                            ))}
                            {error && <p className='kapa-scan__error'>{error}</p>}
                        </section>
                        <p className='kapa-scan__note'>
                            Win chance is the true probability of the contract. Recent frequency describes the latest ticks only and doesn&apos;t predict the next one. This scanner never places trades.
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
            )}

            {risk && (
                <div className='kapa-risk' role='dialog' aria-modal aria-label='Risk warning' onClick={() => setRisk(false)}>
                    <div className='kapa-risk__box' onClick={e => e.stopPropagation()}>
                        <div className='kapa-risk__head'>
                            <span aria-hidden>⚠</span>
                            <b>Risk warning</b>
                            <button type='button' onClick={() => setRisk(false)} aria-label='Close'>
                                ✕
                            </button>
                        </div>
                        <p>
                            Deriv offers complex derivatives, such as options and contracts for difference (&quot;CFDs&quot;). These products may not be suitable for all clients, and trading them puts you at risk. Please make
                            sure that you understand the following risks before trading Deriv products: a) you may lose some or all of the money you invest in the trade, b) if your trade involves currency conversion,
                            exchange rates will affect your profit and loss. You should never trade with borrowed money or with money that you cannot afford to lose.
                        </p>
                        <p>Synthetic indices are random. No bot, scanner or strategy can predict the next tick, and every contract pays less than its true odds.</p>
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
