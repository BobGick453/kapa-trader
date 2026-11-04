/**
 * Strategy lab: everything here comes from Deriv's real servers, through the app's own connection.
 * - the last ticks of a market (their last digits are what digit contracts settle on);
 * - Deriv's real price for every 1-tick digit contract;
 * - statistical tests of the "signals" digit bots rely on, measured on those real ticks.
 * The strategies themselves are replayed on these ticks by the Kapa server (labBacktest).
 */
import { buildProposal, chanceOf, keyLabel, parseKey, TApi } from './engine';

export const LAB_KEYS = [
    'DIGITEVEN',
    'DIGITODD',
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map(b => `DIGITOVER:${b}`),
    ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map(b => `DIGITUNDER:${b}`),
    'DIGITMATCH:5',
    'DIGITDIFF:5',
];

export type TQuote = { key: string; label: string; p: number; ratio: number; expected: number };
export type TSignal = {
    rule: string;
    contract: string;
    seen: number;
    won: number;
    rate: number;
    fair: number;
    low: number;
    high: number;
    expected: number | null; // average result per 1 staked with Deriv's real payout, at the measured win rate
};
export type TLabData = {
    symbol: string;
    digits: number[];
    from: number;
    to: number;
    counts: number[];
    uniform_p: number;
    serial_p: number;
    quotes: TQuote[];
    ratios: Record<string, number>;
    signals: TSignal[];
};

// ---------- statistics ----------
const lgamma = (x: number): number => {
    const c = [
        0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
        12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
    ];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1;
    let a = c[0];
    const t = x + 7.5;
    for (let i = 1; i < 9; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
};
/** p-value of a chi-square statistic with k degrees of freedom. */
export const chiSquareP = (chi: number, k: number) => {
    const a = k / 2;
    const x = chi / 2;
    if (x <= 0) return 1;
    if (x < a + 1) {
        let sum = 1 / a;
        let del = sum;
        for (let n = 1; n < 500; n++) {
            del *= x / (a + n);
            sum += del;
            if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
        }
        return Math.max(0, 1 - sum * Math.exp(-x + a * Math.log(x) - lgamma(a)));
    }
    let b = x + 1 - a;
    let c = 1e300;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i < 500; i++) {
        const an = -i * (i - a);
        b += 2;
        d = an * d + b;
        if (Math.abs(d) < 1e-300) d = 1e-300;
        c = b + an / c;
        if (Math.abs(c) < 1e-300) c = 1e-300;
        d = 1 / d;
        const del = d * c;
        h *= del;
        if (Math.abs(del - 1) < 1e-12) break;
    }
    return Math.min(1, Math.exp(-x + a * Math.log(x) - lgamma(a)) * h);
};
/** 95% Wilson interval of a win rate. */
const wilson = (won: number, n: number) => {
    if (!n) return [0, 1];
    const z = 1.96;
    const p = won / n;
    const den = 1 + (z * z) / n;
    const mid = (p + (z * z) / (2 * n)) / den;
    const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
    return [Math.max(0, mid - half), Math.min(1, mid + half)];
};

const winsWith = (key: string, d: number) => {
    const { type, barrier: b } = parseKey(key);
    if (type === 'DIGITEVEN') return d % 2 === 0;
    if (type === 'DIGITODD') return d % 2 === 1;
    if (type === 'DIGITOVER') return d > (b as number);
    if (type === 'DIGITUNDER') return d < (b as number);
    if (type === 'DIGITMATCH') return d === b;
    return d !== b;
};

/**
 * The "signals" digit bots and sellers use, tested on real ticks: how often the contract really won
 * right after the signal, against its normal chance.
 */
export const testSignals = (digits: number[], ratios: Record<string, number>): TSignal[] => {
    const rules: { rule: string; contract: (i: number) => string | null; label: string }[] = [
        {
            rule: 'Even after 3 odd digits in a row',
            label: 'DIGITEVEN',
            contract: i => (i >= 3 && [1, 2, 3].every(k => digits[i - k] % 2 === 1) ? 'DIGITEVEN' : null),
        },
        {
            rule: 'Odd after 3 even digits in a row',
            label: 'DIGITODD',
            contract: i => (i >= 3 && [1, 2, 3].every(k => digits[i - k] % 2 === 0) ? 'DIGITODD' : null),
        },
        {
            rule: 'Over 4 after 3 low digits (0–4) in a row',
            label: 'DIGITOVER:4',
            contract: i => (i >= 3 && [1, 2, 3].every(k => digits[i - k] <= 4) ? 'DIGITOVER:4' : null),
        },
        {
            rule: 'Even when even digits were under 40% of the last 20',
            label: 'DIGITEVEN',
            contract: i => {
                if (i < 20) return null;
                let e = 0;
                for (let k = 1; k <= 20; k++) if (digits[i - k] % 2 === 0) e++;
                return e < 8 ? 'DIGITEVEN' : null;
            },
        },
        {
            rule: 'Over 1 after the last digit was 0 or 1',
            label: 'DIGITOVER:1',
            contract: i => (i >= 1 && digits[i - 1] <= 1 ? 'DIGITOVER:1' : null),
        },
    ];
    return rules.map(r => {
        let seen = 0;
        let won = 0;
        for (let i = 0; i < digits.length; i++) {
            const key = r.contract(i);
            if (!key) continue;
            seen++;
            if (winsWith(key, digits[i])) won++;
        }
        const rate = seen ? won / seen : 0;
        const [low, high] = wilson(won, seen);
        const ratio = ratios[r.label];
        return {
            rule: r.rule,
            contract: keyLabel(r.label),
            seen,
            won,
            rate,
            fair: chanceOf(r.label),
            low,
            high,
            expected: ratio != null && seen ? rate * (1 + ratio) - 1 : null,
        };
    });
};

const lastDigit = (price: number, pip: number) => {
    const t = Number(price).toFixed(pip);
    return Number(t[t.length - 1]);
};

/** Fetches the last ticks and every digit contract's price from Deriv, and analyses them. */
export const collectLab = async (
    api: TApi,
    currency: string,
    symbol: string,
    onStep: (text: string) => void
): Promise<TLabData> => {
    onStep('Downloading the last 5,000 ticks from Deriv…');
    const h = await api.send({ ticks_history: symbol, count: 5000, end: 'latest', style: 'ticks' });
    if (h?.error) throw new Error(h.error.message);
    const prices: number[] = (h?.history?.prices || []).map(Number);
    const times: number[] = (h?.history?.times || []).map(Number);
    if (prices.length < 100) throw new Error('Deriv returned too few ticks. Try again in a moment.');
    const pip = Number.isInteger(h?.pip_size) ? h.pip_size : Math.max(...prices.map(p => (String(p).split('.')[1] || '').length));
    const digits = prices.map(p => lastDigit(p, pip));

    onStep("Asking Deriv for the price of every digit contract…");
    const quotes: TQuote[] = [];
    const ratios: Record<string, number> = {};
    for (let i = 0; i < LAB_KEYS.length; i += 4) {
        const batch = LAB_KEYS.slice(i, i + 4);
        const res = await Promise.all(
            batch.map(k => {
                const { type, barrier } = parseKey(k);
                return api.send(buildProposal(currency, symbol, type, barrier, 1, 10)).catch((e: any) => ({ error: e }));
            })
        );
        res.forEach((r: any, j) => {
            const ask = Number(r?.proposal?.ask_price);
            const pay = Number(r?.proposal?.payout);
            if (!r?.error && ask > 0 && pay > ask) {
                const key = batch[j];
                const ratio = (pay - ask) / ask;
                const p = chanceOf(key);
                ratios[key] = ratio;
                quotes.push({ key, label: keyLabel(key), p, ratio, expected: p * (1 + ratio) - 1 });
            }
        });
    }
    if (!quotes.length) throw new Error("Deriv didn't return prices. Check that you are logged in and try again.");
    quotes.sort((a, b) => b.expected - a.expected);

    onStep('Testing the ticks for patterns…');
    const counts = Array(10).fill(0);
    digits.forEach(d => counts[d]++);
    const e = digits.length / 10;
    const chi = counts.reduce((a, c) => a + (c - e) ** 2 / e, 0);
    // Does a digit's parity depend on the previous one's? (2×2 test)
    const t = [
        [0, 0],
        [0, 0],
    ];
    for (let i = 1; i < digits.length; i++) t[digits[i - 1] % 2][digits[i] % 2]++;
    const m = digits.length - 1;
    let chi2 = 0;
    for (let a = 0; a < 2; a++)
        for (let b = 0; b < 2; b++) {
            const exp = ((t[a][0] + t[a][1]) * (t[0][b] + t[1][b])) / m;
            if (exp > 0) chi2 += (t[a][b] - exp) ** 2 / exp;
        }
    return {
        symbol,
        digits,
        from: times[0] || 0,
        to: times[times.length - 1] || 0,
        counts,
        uniform_p: chiSquareP(chi, 9),
        serial_p: chiSquareP(chi2, 1),
        quotes,
        ratios,
        signals: testSignals(digits, ratios),
    };
};
