import React, { useEffect, useRef, useState } from 'react';
import { api_base } from '@/external/bot-skeleton';
import { CONNECTION_STATUS } from '@/external/bot-skeleton/services/api/observables/connection-status-stream';
import { useApiBase } from '@/hooks/useApiBase';
import './kapa-ticker.scss';

// The Volatility indices Kapa trades, in Deriv's order
const MARKETS: [string, string][] = [
    ['R_10', 'Volatility 10'],
    ['R_25', 'Volatility 25'],
    ['R_50', 'Volatility 50'],
    ['R_75', 'Volatility 75'],
    ['R_100', 'Volatility 100'],
    ['1HZ10V', 'Volatility 10 (1s)'],
    ['1HZ25V', 'Volatility 25 (1s)'],
    ['1HZ50V', 'Volatility 50 (1s)'],
    ['1HZ75V', 'Volatility 75 (1s)'],
    ['1HZ100V', 'Volatility 100 (1s)'],
];
const SYMBOLS = MARKETS.map(([s]) => s);
const REFRESH_MS = 1000; // the page redraws the prices at most once a second

type TQuote = { text: string; dir: 'up' | 'down' | '' };
type TTick = { symbol?: string; underlying_symbol?: string; quote?: number; pip_size?: number };

/**
 * Header ticker (desktop): the last price of each Volatility index, live from Deriv. One `ticks`
 * subscription on the app's own connection; it is dropped when the ticker is not shown or the tab is hidden.
 * Prices only: no signals and no advice. The arrow compares with the real previous tick.
 */
const KapaTicker = () => {
    const { connectionStatus } = useApiBase();
    const [quotes, setQuotes] = useState<Record<string, TQuote>>({});
    const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');

    useEffect(() => {
        const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
    }, []);

    const last = useRef<Record<string, number>>({});

    useEffect(() => {
        const api = api_base.api as any;
        if (!visible || connectionStatus !== CONNECTION_STATUS.OPENED || !api?.send || !api?.onMessage) return;
        let id: string | null = null;
        let closed = false;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const pending: Record<string, TQuote> = {};

        const flush = () => {
            timer = null;
            if (closed) return;
            const next = { ...pending };
            Object.keys(pending).forEach(k => delete pending[k]);
            setQuotes(q => ({ ...q, ...next }));
        };
        const onTick = (tick?: TTick) => {
            const sym = tick?.symbol || tick?.underlying_symbol;
            if (!sym || typeof tick?.quote !== 'number' || !SYMBOLS.includes(sym)) return;
            const pip = Number.isInteger(tick.pip_size) ? (tick.pip_size as number) : 2;
            const prev = last.current[sym];
            last.current[sym] = tick.quote;
            const dir = prev === undefined || prev === tick.quote ? '' : tick.quote > prev ? 'up' : 'down';
            pending[sym] = { text: tick.quote.toFixed(pip), dir };
            if (!timer) timer = setTimeout(flush, REFRESH_MS);
        };

        // Only this ticker asks for several symbols in one `ticks` request, so its messages are easy to tell apart
        const sub = api.onMessage().subscribe(({ data }: { data: any }) => {
            if (data?.msg_type !== 'tick' || !Array.isArray(data?.echo_req?.ticks)) return;
            if (id && data.subscription?.id && data.subscription.id !== id) return;
            onTick(data.tick);
        });
        api.send({ ticks: SYMBOLS, subscribe: 1 })
            .then((res: any) => {
                if (res?.error) return;
                id = res?.subscription?.id ?? null;
                if (closed && id) api.send({ forget: id }).catch(() => undefined);
            })
            .catch(() => undefined);

        return () => {
            closed = true;
            sub?.unsubscribe?.();
            if (timer) clearTimeout(timer);
            if (id && api_base.api === api) api.send({ forget: id }).catch(() => undefined);
        };
    }, [visible, connectionStatus]);

    const items = (copy: number) =>
        MARKETS.map(([sym, name]) => {
            const q = quotes[sym];
            return (
                <span key={`${copy}-${sym}`} className='kapa-ticker__item' aria-hidden={copy > 0 || undefined}>
                    <i className={`kapa-ticker__dot${q ? ' kapa-ticker__dot--live' : ''}`} />
                    <b>{name}</b>
                    {q && (
                        <em className={q.dir ? `kapa-ticker__q--${q.dir}` : undefined}>
                            {q.text}
                            {q.dir === 'up' && <span aria-label='up'> ▲</span>}
                            {q.dir === 'down' && <span aria-label='down'> ▼</span>}
                        </em>
                    )}
                </span>
            );
        });

    return (
        <div className='kapa-ticker' role='marquee' aria-label='Live prices of the Volatility indices on Deriv'>
            <span className='kapa-ticker__badge'>Markets</span>
            <div className='kapa-ticker__viewport'>
                <div className='kapa-ticker__track'>
                    {items(0)}
                    {items(1)}
                </div>
            </div>
        </div>
    );
};

export default React.memo(KapaTicker);
