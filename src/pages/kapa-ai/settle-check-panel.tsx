import { useRef, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import type { TApi } from './engine';
import {
    CHECK_CALLS,
    CHECK_DIGITS,
    CHECK_LOSS_LIMIT,
    CHECK_MIN_WINS,
    CHECK_SYMBOL,
    demoRefusal,
    runSettlementCheck,
    summarize,
    TCheckSummary,
    toCsv,
    TSettleRecord,
} from './settle-check';

const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
/** Kapa's browser tests run the check against a fake Deriv without the pauses real Deriv needs. */
const fastForTests = () => {
    try {
        return localStorage.getItem('kapa_test_fast') === '1' ? { paceMs: 20, pollMs: 120 } : {};
    } catch {
        return {};
    }
};

/** "Check JD100 'allow equals' on your demo account": a test of Deriv's settlement rule, demo money only. */
const SettleCheckPanel = observer(({ api, currency }: { api: TApi; currency: string }) => {
    const { client } = useStore();
    const [busy, setBusy] = useState(false);
    const [step, setStep] = useState('');
    const [records, setRecords] = useState<TSettleRecord[]>([]);
    const [summary, setSummary] = useState<TCheckSummary | null>(null);
    const [stopReason, setStopReason] = useState('');
    const [refusal, setRefusal] = useState('');
    const [copied, setCopied] = useState('');
    const stopRef = useRef(false);
    // The account flag the app got from Deriv (authorize / account list), read again before every buy
    const account = () => ({
        is_logged_in: client.is_logged_in,
        is_virtual: Boolean(client.is_virtual),
        loginid: client.loginid,
    });

    const start = async () => {
        const why = demoRefusal(account());
        setRefusal(why || '');
        if (why || busy) return;
        if (
            !window.confirm(
                `Run ${CHECK_CALLS} "Rise allow equals" and ${CHECK_DIGITS} "Digit matches" trades of 1 ${currency} on ${CHECK_SYMBOL}, with your demo money? It takes about 5 minutes and stops at a demo loss of ${CHECK_LOSS_LIMIT}.`
            )
        )
            return;
        stopRef.current = false;
        setBusy(true);
        setRecords([]);
        setSummary(null);
        setStopReason('');
        const res = await runSettlementCheck(
            api,
            currency,
            () => demoRefusal(account()),
            {
                onRecord: (_r, all) => setRecords([...all]),
                onStep: setStep,
            },
            () => stopRef.current,
            fastForTests()
        );
        setStopReason(res.stopReason);
        setSummary(summarize(res.records, res.finished, res.stopReason));
        setBusy(false);
        setStep('');
    };

    const copy = async () => {
        const csv = toCsv(records, client.loginid || '');
        try {
            await navigator.clipboard.writeText(csv);
            setCopied('Copied. Paste it in your message to Kapa.');
        } catch {
            // no clipboard access: download it instead
            const a = document.createElement('a');
            a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
            a.download = `kapa-jd100-check-${Date.now()}.csv`;
            a.click();
            setCopied('Saved as a CSV file. Send it to Kapa.');
        }
    };

    const s = summary;
    return (
        <div className='kapa-lab kapa-check-settle'>
            <div className='kapa-plan__head'>
                <span>Check JD100 &quot;allow equals&quot; on your demo account</span>
            </div>
            <p className='kapa-plan__text'>
                On Jump 100, about 3 in 10 one-tick moves end at exactly the same price. Deriv pays &quot;Rise allow
                equals&quot; like a normal Rise. If an equal exit were paid as a win, that contract would win more often
                than its price assumes. Deriv&apos;s public data can&apos;t show how a contract is settled, so this check
                buys {CHECK_CALLS} of them (1 {currency} each), then {CHECK_DIGITS} &quot;Digit matches&quot; to see which
                tick settles a digit contract, and records what Deriv pays.
            </p>
            <p className='kapa-plan__text'>
                <b>Demo money only.</b> This is a test of Deriv&apos;s settlement rule, not a strategy and not a promise:
                most likely it costs a little demo money. It refuses real-money accounts, stops at a demo loss of{' '}
                {CHECK_LOSS_LIMIT} or on any error, and sends nothing to the Kapa server.
            </p>
            <div className='kapa-check-settle__actions'>
                {busy ? (
                    <button className='kapa-btn kapa-btn--line' type='button' onClick={() => (stopRef.current = true)}>
                        Stop the check ({step})
                    </button>
                ) : (
                    <button className='kapa-btn kapa-btn--line kapa-check-settle__start' type='button' onClick={start}>
                        Run the check on my demo account
                    </button>
                )}
            </div>
            {refusal && (
                <div className='kapa-error' role='alert'>
                    {refusal}
                </div>
            )}
            {busy && (
                <p className='kapa-dim'>
                    {records.length} trades done · demo result{' '}
                    {records.reduce((a, r) => a + r.profit, 0).toFixed(2)} {currency}
                </p>
            )}
            {s && (
                <div className={`kapa-check-settle__result kapa-check-settle__result--${s.verdict.replace(' ', '-').toLowerCase()}`}>
                    <div className='kapa-check-settle__verdict'>{s.verdict}</div>
                    <p className='kapa-plan__text'>{s.why}</p>
                    {stopReason && <p className='kapa-dim'>The check stopped early: {stopReason}.</p>}
                    <div className='kapa-lab__table'>
                        <div className='kapa-lab__row'>
                            <span>Equal exits (exit price = entry price)</span>
                            <span>
                                {s.equal} of {s.calls}
                            </span>
                        </div>
                        <div className='kapa-lab__row'>
                            <span>Equal exits paid as wins</span>
                            <span>
                                {s.equalWon} of {s.equal}
                            </span>
                        </div>
                        <div className='kapa-lab__row'>
                            <span>Rise allow equals: trades won</span>
                            <span>
                                {s.wins} of {s.calls} ({pct(s.winRate)}, 95% range {pct(s.low, 0)}–{pct(s.high, 0)})
                            </span>
                        </div>
                        <div className='kapa-lab__row'>
                            <span>Average per trade</span>
                            <span>
                                {s.avgPerTrade >= 0 ? '+' : ''}
                                {pct(s.avgPerTrade)} of the stake
                            </span>
                        </div>
                        <div className='kapa-lab__row'>
                            <span>Digit matches: tick that settled them (1 = first tick after buying)</span>
                            <span>
                                {Object.keys(s.settleTicks).length
                                    ? Object.entries(s.settleTicks)
                                          .map(([k, v]) => `${k === 'unknown' ? 'unknown' : `tick ${k}`}: ${v}`)
                                          .join(' · ')
                                    : 'none run'}
                            </span>
                        </div>
                        <div className='kapa-lab__row'>
                            <span>Demo result of the whole check</span>
                            <span>
                                {s.pl >= 0 ? '+' : ''}
                                {s.pl.toFixed(2)} {currency}
                            </span>
                        </div>
                    </div>
                    <p className='kapa-dim'>
                        CONFIRMED needs every equal exit paid as a win and at least {CHECK_MIN_WINS} wins out of{' '}
                        {CHECK_CALLS}. Even then, Deriv can change its prices or rules at any time.
                    </p>
                    <button className='kapa-btn kapa-btn--line' type='button' onClick={copy} disabled={!records.length}>
                        Copy all {records.length} records (CSV) for Kapa
                    </button>
                    {copied && <p className='kapa-dim'>{copied}</p>}
                </div>
            )}
        </div>
    );
});

export default SettleCheckPanel;
