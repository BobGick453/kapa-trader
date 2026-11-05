import { useState } from 'react';
import { labBacktest, premiumEnabled, TBacktest } from '../premium/premium-api';
import { MARKETS, TApi, TSettings } from './engine';
import { collectLab, TLabData } from './lab';

const fmt = (n: number, d = 2) => Number(n).toFixed(d);
const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
const signed = (n: number) => `${n >= 0 ? '+' : ''}${fmt(n)}`;
const time = (t: number) => (t ? new Date(t * 1000).toLocaleString() : '');

const NAMES: Record<string, string> = {
    apex: 'KAPA Apex (computed best)',
    pegasus: 'Pegasus (bold play)',
    martingale: 'Steady (×2.1, cycles that fit)',
    recover: 'Exact recovery',
    fixed: 'Even/Odd fixed stake (free)',
    reference: 'All the balance on Over 1 (reference bot)',
};

type TProps = { api: TApi; s: TSettings; balance: number; currency: string; logged_in: boolean };

/** Tests the strategies on Deriv's real ticks and real prices, and shows the evidence. */
const LabPanel = ({ api, s, balance, currency, logged_in }: TProps) => {
    const [busy, setBusy] = useState(false);
    const [step, setStep] = useState('');
    const [error, setError] = useState('');
    const [data, setData] = useState<TLabData | null>(null);
    const [bt, setBt] = useState<Record<string, TBacktest> | null>(null);

    const run = async () => {
        setBusy(true);
        setError('');
        setData(null);
        setBt(null);
        try {
            const d = await collectLab(api, currency, s.symbol, setStep);
            setData(d);
            if (premiumEnabled()) {
                setStep('Replaying the ticks through every strategy on the Kapa server…');
                const capital = balance > 0 ? balance : 1000;
                const r = await labBacktest({
                    digits: d.digits.join(''),
                    ratios: d.ratios,
                    stake: s.stake,
                    takeProfit: s.takeProfit,
                    stopLoss: Math.min(s.stopLoss, capital),
                    capital,
                });
                setBt(r.results);
            }
        } catch (e: any) {
            setError(e?.message ?? 'The test failed. Try again.');
        } finally {
            setBusy(false);
            setStep('');
        }
    };

    const random = data ? data.uniform_p >= 0.01 && data.serial_p >= 0.01 : null;
    const anySignal = data?.signals.some(g => g.seen >= 30 && (g.low > g.fair || g.high < g.fair));

    return (
        <div className='kapa-lab'>
            <div className='kapa-plan__head'>
                <span>Strategy lab · real Deriv data</span>
            </div>
            <p className='kapa-plan__text'>
                Downloads the last 5,000 real ticks of {MARKETS[s.symbol]} and Deriv&apos;s real price for every digit
                contract, tests the ticks for patterns, then replays every strategy on those ticks with your
                take-profit and stop-loss. Nothing is traded.
            </p>
            <button className='kapa-btn kapa-btn--line' type='button' onClick={run} disabled={busy || !logged_in}>
                {!logged_in ? 'Log in with Deriv to run the test' : busy ? step || 'Testing…' : 'Run the test on real Deriv data'}
            </button>
            {error && <div className='kapa-error'>{error}</div>}

            {data && (
                <>
                    <h5>1 · The ticks</h5>
                    <p className='kapa-plan__text'>
                        {data.digits.length.toLocaleString()} real ticks, {time(data.from)} → {time(data.to)}.
                    </p>
                    <div className='kapa-lab__digits'>
                        {data.counts.map((c, d) => (
                            <div key={d}>
                                <i style={{ height: `${Math.min(100, (c / data.digits.length) * 500)}%` }} />
                                <b>{d}</b>
                                <small>{pct(c / data.digits.length, 1)}</small>
                            </div>
                        ))}
                    </div>
                    <p className='kapa-plan__text'>
                        Each digit should come up 10% of the time. Digits test p = {fmt(data.uniform_p, 3)}, sequence
                        test p = {fmt(data.serial_p, 3)}.{' '}
                        {random
                            ? 'No pattern: the digits behave like a fair random draw, so the next digit cannot be predicted from the past.'
                            : 'Unusual result for this sample (it happens by chance about 1 time in 100). Run the test again later: a real pattern would come back.'}
                    </p>

                    <h5>2 · The signals digit bots use, measured</h5>
                    <div className='kapa-lab__table'>
                        <div className='kapa-lab__row kapa-lab__row--head'>
                            <span>Signal</span>
                            <span>Seen</span>
                            <span>Won</span>
                            <span>Normal</span>
                        </div>
                        {data.signals.map(g => (
                            <div className='kapa-lab__row' key={g.rule}>
                                <span>{g.rule}</span>
                                <span>{g.seen}</span>
                                <span>
                                    {pct(g.rate)}
                                    <small>
                                        {' '}
                                        ({pct(g.low, 0)}–{pct(g.high, 0)})
                                    </small>
                                </span>
                                <span>{pct(g.fair, 0)}</span>
                            </div>
                        ))}
                    </div>
                    <p className='kapa-plan__text'>
                        In brackets: where the true win rate lies with 95% confidence.{' '}
                        {anySignal
                            ? 'One signal falls outside its normal chance on this sample. With several signals tested, one can do so by chance; run the test again on new ticks before trusting it.'
                            : 'Every signal wins at its normal chance: waiting for them gives no advantage.'}
                    </p>

                    <h5>3 · Deriv&apos;s real prices</h5>
                    <div className='kapa-lab__table'>
                        <div className='kapa-lab__row kapa-lab__row--head'>
                            <span>Contract</span>
                            <span>Chance</span>
                            <span>Pays</span>
                            <span>Margin</span>
                        </div>
                        {data.quotes.map((q, i) => (
                            <div className={`kapa-lab__row${i === 0 ? ' kapa-lab__row--best' : ''}`} key={q.key}>
                                <span>{q.label}</span>
                                <span>{pct(q.p, 0)}</span>
                                <span>+{pct(q.ratio)}</span>
                                <span className={q.expected < -0.06 ? 'kapa-down' : undefined}>{pct(-q.expected)}</span>
                            </div>
                        ))}
                    </div>
                    <p className='kapa-plan__text'>
                        The margin is what Deriv keeps on average from each stake. Best terms: {data.quotes[0].label},{' '}
                        {pct(-data.quotes[0].expected)} per trade. KAPA AI trades the best-paid contract among those
                        with the same chance.
                    </p>
                </>
            )}

            {bt && (
                <>
                    <h5>4 · The strategies replayed on these ticks</h5>
                    <p className='kapa-plan__text'>
                        Sessions one after another, take-profit {fmt(s.takeProfit)}, stop-loss {fmt(s.stopLoss)}{' '}
                        {currency}, Deriv&apos;s real payouts.
                    </p>
                    <div className='kapa-lab__table'>
                        <div className='kapa-lab__row kapa-lab__row--head'>
                            <span>Strategy</span>
                            <span>Target hit</span>
                            <span>Per session</span>
                            <span>Total</span>
                        </div>
                        {Object.entries(bt).map(([k, r]) => (
                            <div className='kapa-lab__row' key={k}>
                                <span>
                                    {NAMES[k] ?? k}
                                    <small>
                                        {' '}
                                        {r.refused
                                            ? 'refused: prices too poor'
                                            : `${r.sessions} sessions, worst ${signed(r.worst)}`}
                                    </small>
                                </span>
                                <span>{r.sessions ? pct(r.tp / r.sessions, 0) : '–'}</span>
                                <span className={r.net >= 0 ? 'kapa-up' : 'kapa-down'}>
                                    {r.sessions ? signed(r.net / r.sessions) : '–'}
                                </span>
                                <span className={r.net >= 0 ? 'kapa-up' : 'kapa-down'}>{signed(r.net)}</span>
                            </div>
                        ))}
                    </div>
                    <p className='kapa-plan__text'>
                        These are real ticks, so a strategy can come out ahead or behind on one sample by luck. Over
                        many samples, the average per session tends to Deriv&apos;s margin times what was staked. Run
                        the test several times and on other markets: what holds every time is real.
                    </p>
                </>
            )}
        </div>
    );
};

export default LabPanel;
