/**
 * Settlement check on a DEMO account: does Deriv pay "Rise allow equals" (CALLE, 1 tick) on Jump 100 as a win
 * when the exit price equals the entry price, and which tick settles a 1-tick digit contract?
 *
 * Why: on public data about 30% of JD100's 1-tick moves are exactly 0, and CALLE is paid like a strict Rise. If an
 * equal exit is paid as a win, CALLE would win about 65% of the time. Deriv's public API shows prices, not how a
 * contract is settled, so only real settled contracts can tell. This is a test of Deriv's rule with demo money: it
 * is not a strategy and promises nothing.
 *
 * It runs only in the browser, on the user's own demo connection, and refuses any account that is not a demo
 * account (checked before the start and again before every buy). Nothing is sent to the Kapa server.
 */
import { isDemoAccount } from '@/utils/account-helpers';
import type { TApi } from './engine';

export const CHECK_SYMBOL = 'JD100';
export const CHECK_CALLS = 100;
export const CHECK_DIGITS = 50;
export const CHECK_LOSS_LIMIT = 30;
/** CONFIRMED needs at least this many wins out of the 100 CALLE trades (break-even at Deriv's price is about 51.2) */
export const CHECK_MIN_WINS = 58;

export type TSettleRecord = {
    n: number;
    kind: 'CALLE' | 'DIGITMATCH';
    contract_id: number;
    predicted: number | null; // DIGITMATCH: the last digit seen before buying
    purchase_time: number | null;
    entry_spot: string;
    entry_time: number | null;
    exit_spot: string;
    exit_time: number | null;
    buy_price: number;
    payout: number;
    profit: number;
    status: string;
    equal: boolean | null; // CALLE: exit equal to entry
    settle_digit: number | null; // DIGITMATCH: last digit of the exit spot
    settle_tick: number | null; // DIGITMATCH: which tick after the purchase gave the exit spot (1 = the first)
};

export type TVerdict = 'CONFIRMED' | 'NOT CONFIRMED' | 'INCONCLUSIVE';
export type TCheckSummary = {
    calls: number;
    wins: number;
    winRate: number;
    low: number;
    high: number;
    avgPerTrade: number; // per 1 staked
    equal: number;
    equalWon: number;
    digits: number;
    settleTicks: Record<string, number>; // "1" → count
    pl: number;
    verdict: TVerdict;
    why: string;
};

/** Why this account may not run the check, or null when it is a demo account. */
export const demoRefusal = (acc: { is_logged_in?: boolean; is_virtual?: boolean; loginid?: string }) => {
    if (!acc.is_logged_in) return 'Log in with Deriv first.';
    if (!acc.is_virtual || !acc.loginid || !isDemoAccount(acc.loginid))
        return `This check only runs on a demo account (virtual money). The account in use${acc.loginid ? ` (${acc.loginid})` : ''} is a real-money account, so nothing will be bought. Switch to your demo account in the header, then try again.`;
    return null;
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
const lastDigit = (v: string | number, pip: number) => {
    const t = Number(v).toFixed(pip);
    return Number(t[t.length - 1]);
};
/** 95% range of a proportion (Wilson). */
export const wilson = (k: number, n: number) => {
    if (!n) return [0, 0];
    const z = 1.96;
    const p = k / n;
    const d = 1 + (z * z) / n;
    const c = (p + (z * z) / (2 * n)) / d;
    const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
    return [Math.max(0, c - h), Math.min(1, c + h)];
};

export const summarize = (records: TSettleRecord[], finished: boolean, stopReason = ''): TCheckSummary => {
    const calls = records.filter(r => r.kind === 'CALLE');
    const wins = calls.filter(r => r.profit > 0).length;
    const eq = calls.filter(r => r.equal);
    const equalWon = eq.filter(r => r.profit > 0).length;
    const [low, high] = wilson(wins, calls.length);
    const digits = records.filter(r => r.kind === 'DIGITMATCH');
    const settleTicks: Record<string, number> = {};
    digits.forEach(r => {
        const k = r.settle_tick === null ? 'unknown' : String(r.settle_tick);
        settleTicks[k] = (settleTicks[k] || 0) + 1;
    });
    const staked = calls.reduce((a, r) => a + r.buy_price, 0);
    const avgPerTrade = staked ? calls.reduce((a, r) => a + r.profit, 0) / staked : 0;
    const pl = Math.round(records.reduce((a, r) => a + r.profit, 0) * 100) / 100;
    let verdict: TVerdict = 'INCONCLUSIVE';
    let why: string;
    if (eq.length >= 5 && equalWon === 0) {
        verdict = 'NOT CONFIRMED';
        why = `Deriv paid all ${eq.length} equal exits as losses: "allow equals" does not turn ties into wins here, so there is no advantage.`;
    } else if (eq.length >= 5 && equalWon === eq.length && calls.length >= CHECK_CALLS) {
        if (wins >= CHECK_MIN_WINS) {
            verdict = 'CONFIRMED';
            why = `Deriv paid all ${eq.length} equal exits as wins, and ${wins} of ${calls.length} trades won. This confirms the settlement rule on demo money; it says nothing certain about the future (Deriv can change its prices or rules at any time).`;
        } else {
            verdict = 'NOT CONFIRMED';
            why = `Deriv paid the equal exits as wins, but only ${wins} of ${calls.length} trades won (at least ${CHECK_MIN_WINS} were needed): not enough to show an advantage.`;
        }
    } else if (eq.length < 5) {
        why = `Only ${eq.length} equal exits were seen: too few to know how Deriv pays them${finished ? '' : ' (the check stopped early)'}.`;
    } else if (equalWon === eq.length) {
        why = `The ${eq.length} equal exits seen were paid as wins, but the check stopped after ${calls.length} of ${CHECK_CALLS} trades${stopReason ? ` (${stopReason})` : ''}.`;
    } else {
        why = `Deriv paid ${equalWon} of ${eq.length} equal exits as wins and the others as losses: the rule is not clear. Send the records to Kapa.`;
    }
    return { calls: calls.length, wins, winRate: calls.length ? wins / calls.length : 0, low, high, avgPerTrade, equal: eq.length, equalWon, digits: digits.length, settleTicks, pl, verdict, why };
};

const CSV_COLS: (keyof TSettleRecord)[] = [
    'n',
    'kind',
    'contract_id',
    'predicted',
    'purchase_time',
    'entry_spot',
    'entry_time',
    'exit_spot',
    'exit_time',
    'buy_price',
    'payout',
    'profit',
    'status',
    'equal',
    'settle_digit',
    'settle_tick',
];
export const toCsv = (records: TSettleRecord[], account: string) =>
    [`# Kapa settlement check on ${CHECK_SYMBOL}, demo account ${account}, ${new Date().toISOString()}`, CSV_COLS.join(',')]
        .concat(records.map(r => CSV_COLS.map(k => (r[k] === null || r[k] === undefined ? '' : String(r[k]))).join(',')))
        .join('\n');

export type TCheckEvents = {
    onRecord: (r: TSettleRecord, all: TSettleRecord[]) => void;
    onStep: (text: string) => void;
};

/**
 * Runs the check: CHECK_CALLS CALLE trades, then CHECK_DIGITS DIGITMATCH trades, one at a time with a pause, stake 1.
 * `demo` returns why the current account may not trade (null when it is a demo account); it is asked again before
 * every buy. Stops at CHECK_LOSS_LIMIT of demo loss, on any error, or when `stopped()` says so.
 */
export const runSettlementCheck = async (
    api: TApi,
    currency: string,
    demo: () => string | null,
    ev: TCheckEvents,
    stopped: () => boolean,
    opts: { calls?: number; digits?: number; paceMs?: number; pollMs?: number } = {}
): Promise<{ records: TSettleRecord[]; finished: boolean; stopReason: string }> => {
    const records: TSettleRecord[] = [];
    const nCalls = opts.calls ?? CHECK_CALLS;
    const nDigits = opts.digits ?? CHECK_DIGITS;
    const pace = opts.paceMs ?? 1200;
    const pollMs = opts.pollMs ?? 700;
    let pl = 0;
    const send = async (req: Record<string, unknown>) => {
        const r = await api.send(req);
        if (r?.error) throw new Error(r.error.message || r.error.code || 'Deriv error');
        return r;
    };
    const ticksBetween = async (from: number, to: number) => {
        const h = await send({ ticks_history: CHECK_SYMBOL, start: from, end: to, style: 'ticks', count: 50 });
        const prices = h?.history?.prices || [];
        const times = h?.history?.times || [];
        return { pip: Number.isInteger(h?.pip_size) ? h.pip_size : 2, ticks: prices.map((p: number, i: number) => ({ q: p, t: times[i] })) };
    };
    const one = async (kind: 'CALLE' | 'DIGITMATCH', n: number) => {
        const refusal = demo();
        if (refusal) throw new Error(refusal);
        let predicted: number | null = null;
        let pip = 2;
        if (kind === 'DIGITMATCH') {
            const last = await send({ ticks_history: CHECK_SYMBOL, count: 1, end: 'latest', style: 'ticks' });
            pip = Number.isInteger(last?.pip_size) ? last.pip_size : 2;
            predicted = lastDigit(last.history.prices[last.history.prices.length - 1], pip);
        }
        const prop = await send({
            proposal: 1,
            amount: 1,
            basis: 'stake',
            contract_type: kind,
            currency,
            duration: 1,
            duration_unit: 't',
            underlying_symbol: CHECK_SYMBOL,
            ...(kind === 'DIGITMATCH' ? { barrier: String(predicted) } : {}),
        });
        if (+prop.proposal.ask_price > 1.005) throw new Error(`Deriv asked ${prop.proposal.ask_price} for a stake of 1: not bought.`);
        if (demo()) throw new Error(demo() as string); // the account could have changed while asking the price
        const buy = await send({ buy: prop.proposal.id, price: prop.proposal.ask_price });
        const id = buy.buy.contract_id;
        let poc: any = null;
        for (let i = 0; i < 90; i++) {
            await sleep(pollMs);
            const r = await send({ proposal_open_contract: 1, contract_id: id });
            if (r?.proposal_open_contract?.is_sold) {
                poc = r.proposal_open_contract;
                break;
            }
        }
        if (!poc) throw new Error(`No result for contract #${id} after a minute. Check Reports on Deriv.`);
        const entry = String(poc.entry_tick_display_value ?? poc.entry_spot_display_value ?? poc.entry_tick ?? poc.entry_spot ?? '');
        const exit = String(poc.exit_tick_display_value ?? poc.exit_spot_display_value ?? poc.exit_tick ?? poc.sell_spot ?? '');
        const rec: TSettleRecord = {
            n,
            kind,
            contract_id: id,
            predicted,
            purchase_time: num(poc.purchase_time ?? poc.date_start),
            entry_spot: entry,
            entry_time: num(poc.entry_tick_time ?? poc.entry_spot_time),
            exit_spot: exit,
            exit_time: num(poc.exit_tick_time ?? poc.sell_spot_time),
            buy_price: +poc.buy_price,
            payout: +(poc.payout ?? 0),
            profit: +poc.profit,
            status: String(poc.status ?? (+poc.profit > 0 ? 'won' : 'lost')),
            equal: kind === 'CALLE' && entry !== '' && exit !== '' ? Number(entry) === Number(exit) : null,
            settle_digit: kind === 'DIGITMATCH' && exit !== '' ? lastDigit(exit, pip) : null,
            settle_tick: null,
        };
        // Which tick after the purchase settled the digit contract: count the ticks from the purchase to the exit
        if (kind === 'DIGITMATCH' && rec.purchase_time && rec.exit_time) {
            try {
                const { ticks } = await ticksBetween(rec.purchase_time - 2, rec.exit_time + 2);
                const after = ticks.filter((t: { t: number }) => t.t > (rec.purchase_time as number));
                const i = after.findIndex((t: { t: number }) => t.t === rec.exit_time);
                rec.settle_tick = i >= 0 ? i + 1 : null;
            } catch {
                /* left unknown */
            }
        }
        records.push(rec);
        pl = Math.round((pl + rec.profit) * 100) / 100;
        ev.onRecord(rec, records);
    };
    try {
        for (let i = 1; i <= nCalls + nDigits; i++) {
            if (stopped()) return { records, finished: false, stopReason: 'stopped by you' };
            if (pl - 1 < -CHECK_LOSS_LIMIT)
                return { records, finished: false, stopReason: `the demo loss reached ${CHECK_LOSS_LIMIT}` };
            const kind = i <= nCalls ? 'CALLE' : 'DIGITMATCH';
            ev.onStep(`${kind === 'CALLE' ? 'Rise allow equals' : 'Digit matches'} · trade ${i} of ${nCalls + nDigits}`);
            await one(kind, i);
            if (pl <= -CHECK_LOSS_LIMIT) return { records, finished: false, stopReason: `the demo loss reached ${CHECK_LOSS_LIMIT}` };
            await sleep(pace);
        }
    } catch (e: any) {
        return { records, finished: false, stopReason: `error: ${e?.message ?? e}` };
    }
    return { records, finished: true, stopReason: '' };
};
