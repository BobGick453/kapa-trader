/**
 * Classic bots: the four Free Bot strategies of the reference bot (Digit Switcher, Dollar Printer,
 * Gold Premium Odd/Even, Profit Maker), rebuilt for KAPA AI's engine and made safer.
 *
 * Kept from the originals: their contracts and their entry rules (follow the last digit, wait for a
 * run of recent ticks, switch contract after a loss). Tested on 300,000 real Deriv ticks, those entry
 * rules win at the contract's normal chance: they neither help nor hurt.
 * Changed, because the originals risk 1,000 to win 10:
 * - every recovery cycle is planned so that all its stakes fit under the stop-loss and the maximum
 *   stake; a losing run ends at a known loss instead of a stake the account can't follow;
 * - after a loss the stake is the one that wins the whole cycle back in one trade (exact recovery),
 *   instead of a blind multiplier;
 * - Dollar Printer's first contract is Over 1 instead of Over 0: per unit of possible profit, Over 0
 *   costs 14% of the stake at Deriv's prices and Over 1 6%;
 * - Profit Maker recovers on the best-paid 50% contract instead of always Over 4.
 */
import type { TDecision, TPayoutRatios } from './engine';

export type TClassicKey = 'switcher' | 'printer' | 'goldoe' | 'profitmaker';
export const CLASSIC_KEYS: TClassicKey[] = ['switcher', 'printer', 'goldoe', 'profitmaker'];
export const isClassic = (k: string): k is TClassicKey => (CLASSIC_KEYS as string[]).includes(k);

type TBot = {
    /** Contract to buy now, from the last digits (most recent last), or null to wait for the next tick */
    base: (d: number[]) => string | null;
    rec: (d: number[]) => string | null;
    sizing: 'recover' | 'double';
    mult: number;
    maxLosses: number;
    /** contract used to plan a cycle before the entry rule has picked one */
    planBase: string;
    planRec: string;
};

const HALF = ['DIGITEVEN', 'DIGITODD', 'DIGITOVER:4', 'DIGITUNDER:5'];
const parity = (d: number[]) => (d.length ? (d[d.length - 1] % 2 === 0 ? 'DIGITEVEN' : 'DIGITODD') : null);
const runOf5 = (d: number[]) => {
    if (d.length < 5) return null;
    const last5 = d.slice(-5);
    const even = last5.filter(x => x % 2 === 0).length;
    const last = d[d.length - 1];
    if (even >= 4 && last % 2 === 0) return 'DIGITEVEN';
    if (even <= 1 && last % 2 === 1) return 'DIGITODD';
    return null;
};

export const BOTS: Record<TClassicKey, TBot & { label: string; about: string }> = {
    switcher: {
        label: 'Digit Switcher · follows the last digit, exact recovery',
        about: 'Buys Even after an even digit and Odd after an odd one. After a loss, the stake that wins the cycle back; up to 8 losses in a row when they fit the stop-loss.',
        base: parity,
        rec: parity,
        sizing: 'recover',
        mult: 1,
        maxLosses: 8,
        planBase: 'DIGITEVEN',
        planRec: 'DIGITEVEN',
    },
    printer: {
        label: 'Dollar Printer · Over 1, recovery Over 5',
        about: 'Over 1 when at least 12 of the last 15 digits were above 1; after a loss, Over 5 with the stake that wins the cycle back. Up to 8 losses in a row when they fit the stop-loss.',
        base: d => (d.length >= 15 && d.slice(-15).filter(x => x > 1).length >= 12 ? 'DIGITOVER:1' : null),
        rec: () => 'DIGITOVER:5',
        sizing: 'recover',
        mult: 1,
        maxLosses: 8,
        planBase: 'DIGITOVER:1',
        planRec: 'DIGITOVER:5',
    },
    goldoe: {
        label: 'Gold Odd/Even · runs of 5, ×2.1 recovery',
        about: 'Even when at least 4 of the last 5 digits were even and the last one is even (Odd likewise); stake ×2.1 after a loss, up to 6 losses in a row when they fit the stop-loss.',
        base: runOf5,
        rec: runOf5,
        sizing: 'double',
        mult: 2.1,
        maxLosses: 6,
        planBase: 'DIGITEVEN',
        planRec: 'DIGITEVEN',
    },
    profitmaker: {
        label: 'Profit Maker · Over 2, recovery on 50%',
        about: 'Over 2; after a loss, the best-paid 50% contract with the stake that wins the cycle back. Up to 8 losses in a row when they fit the stop-loss.',
        base: () => 'DIGITOVER:2',
        rec: () => null, // chosen from live prices below
        sizing: 'recover',
        mult: 1,
        maxLosses: 8,
        planBase: 'DIGITOVER:2',
        planRec: 'DIGITUNDER:5',
    },
};

// ---------- contracts and prices ----------
const chance = (key: string) => {
    const [t, b] = key.split(':');
    if (t === 'DIGITEVEN' || t === 'DIGITODD') return 0.5;
    return t === 'DIGITOVER' ? (9 - Number(b)) / 10 : Number(b) / 10;
};
const MARGIN: Record<string, number> = { '0.9': 0.0136, '0.8': 0.0144, '0.7': 0.0172, '0.6': 0.0196, '0.5': 0.0235, '0.4': 0.0292 };
const ratioOf = (key: string, r: TPayoutRatios) => {
    if (r[key] != null) return r[key];
    const p = chance(key);
    return (1 - (MARGIN[String(Math.round(p * 10) / 10)] ?? 0.03)) / p - 1;
};
const bestHalf = (r: TPayoutRatios) =>
    HALF.reduce((a, k) => (chance(k) * (1 + ratioOf(k, r)) > chance(a) * (1 + ratioOf(a, r)) + 1e-12 ? k : a));
const ceil2 = (n: number) => Math.ceil(n * 100 - 1e-9) / 100;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type TClassicSettings = { stake: number; takeProfit: number; stopLoss: number; maxStake: number; maxLosses: number | null };
export type TClassicState = { pl: number; streak: number; lost: number; runs: number };
export const freshClassic = (): TClassicState => ({ pl: 0, streak: 0, lost: 0, runs: 0 });

const stepStake = (bot: TBot, s: TClassicSettings, i: number, lost: number, baseKey: string, recKey: string, r: TPayoutRatios) => {
    if (i === 0) return s.stake;
    if (bot.sizing === 'double') return s.stake * bot.mult ** i;
    return (lost + s.stake * ratioOf(baseKey, r)) / ratioOf(recKey, r);
};

/** Longest run of losses whose stakes all fit under the maximum stake and the room at the cycle's start. */
const cycleLength = (bot: TBot, s: TClassicSettings, room: number, baseKey: string, recKey: string, r: TPayoutRatios) => {
    const max = Math.min(s.maxLosses ?? bot.maxLosses, bot.maxLosses);
    let lost = 0;
    let n = 0;
    while (n < max) {
        const st = ceil2(stepStake(bot, s, n, lost, baseKey, recKey, r));
        if (st > s.maxStake + 0.005 || lost + st > room + 0.005) break;
        lost += st;
        n++;
    }
    return n;
};

export type TClassicDecision = TDecision | { wait: true };

/** Next trade for a classic bot, a reason to stop, or { wait } until a later tick fits its entry rule. */
export const classicDecide = (
    k: TClassicKey,
    s: TClassicSettings,
    st: TClassicState,
    r: TPayoutRatios,
    digits: number[]
): TClassicDecision => {
    const bot = BOTS[k];
    if (st.pl >= s.takeProfit) return { stop: 'tp', reason: `Take-profit reached: +${st.pl.toFixed(2)}` };
    if (st.pl <= -s.stopLoss + 0.005) return { stop: 'sl', reason: `Stop-loss reached: ${st.pl.toFixed(2)}` };
    const room = round2(s.stopLoss + st.pl);
    const recRule = k === 'profitmaker' ? () => bestHalf(r) : bot.rec;
    const len = cycleLength(bot, s, round2(room + st.lost), bot.planBase, k === 'profitmaker' ? bestHalf(r) : bot.planRec, r);
    if (len === 0)
        return { stop: 'sl', reason: 'Not enough room left above the stop-loss for a full trade cycle. Session ended to protect your capital.' };
    if (st.streak >= len)
        return {
            stop: 'streak',
            reason: `${st.streak} losses in a row: the recovery cycle that fits your stop-loss is used up. Session ended at a planned loss.`,
        };
    const recovering = st.streak > 0;
    const key = recovering ? recRule(digits) : bot.base(digits);
    if (!key) return { wait: true };
    const baseKey = k === 'switcher' || k === 'goldoe' ? key : bot.planBase;
    const amount = ceil2(stepStake(bot, s, recovering ? st.streak : 0, st.lost, baseKey, key, r));
    if (amount < 0.35) return { stop: 'sl', reason: 'Not enough room left above the stop-loss for the minimum stake.' };
    const [type, b] = key.split(':');
    return {
        trade: {
            contract_type: type as any,
            barrier: b === undefined ? null : Number(b),
            amount,
            symbol: '',
            duration: 1,
            recovery: recovering,
        },
    };
};

export const applyClassic = (st: TClassicState, buy: number, profit: number): TClassicState =>
    profit > 0
        ? { pl: round2(st.pl + profit), streak: 0, lost: 0, runs: st.runs + 1 }
        : { pl: round2(st.pl + profit), streak: st.streak + 1, lost: round2(st.lost + buy), runs: st.runs + 1 };

/**
 * A classic bot as a KAPA AI strategy. Before each trade it reads the market's last digits from Deriv;
 * when the entry rule asks to wait, it checks again on the next ticks (up to two minutes).
 */
export const classicPolicy = (
    k: TClassicKey,
    s: TClassicSettings & { symbol: string },
    initial: TPayoutRatios,
    lastDigits: () => Promise<number[]>
) => {
    let st = freshClassic();
    const ratios: TPayoutRatios = { ...initial };
    const decide = async (): Promise<TDecision> => {
        for (let i = 0; i < 120; i++) {
            const d = classicDecide(k, s, st, ratios, await lastDigits());
            if (!('wait' in d)) return d.trade ? { trade: { ...d.trade, symbol: s.symbol } } : d;
            await new Promise(r => setTimeout(r, 1000));
        }
        return { stop: 'runs', reason: 'No entry signal for two minutes. Session ended.' };
    };
    return {
        start: decide,
        next: async (r: { buy_price: number; profit: number }, live: TPayoutRatios) => {
            Object.assign(ratios, live);
            st = applyClassic(st, r.buy_price, r.profit);
            return decide();
        },
    };
};

/** Session plan for a classic bot: sessions simulated on random digits, like Deriv's generator. */
export const simulateClassic = (k: TClassicKey, s: TClassicSettings, ratios: TPayoutRatios, sessions = 2000) => {
    let hit = 0;
    let bust = 0;
    let sum = 0;
    let bustSum = 0;
    const lens: number[] = [];
    for (let n = 0; n < sessions; n++) {
        let st = freshClassic();
        const digits: number[] = Array.from({ length: 30 }, () => Math.floor(Math.random() * 10));
        let trades = 0;
        for (let i = 0; i < 20000; i++) {
            const d = classicDecide(k, s, st, ratios, digits.slice(-30));
            const next = Math.floor(Math.random() * 10);
            if ('wait' in d) {
                digits.push(next);
                continue;
            }
            if (!d.trade) {
                if (d.stop === 'tp') hit++;
                else if (st.pl < 0) {
                    bust++;
                    bustSum += st.pl;
                }
                break;
            }
            const { contract_type: t, barrier: b, amount } = d.trade;
            const won =
                t === 'DIGITEVEN' ? next % 2 === 0 : t === 'DIGITODD' ? next % 2 === 1 : t === 'DIGITOVER' ? next > (b as number) : next < (b as number);
            const key = b === null ? t : `${t}:${b}`;
            st = applyClassic(st, amount, won ? round2(amount * ratioOf(key, ratios)) : -amount);
            digits.push(next);
            trades++;
        }
        sum += st.pl;
        lens.push(trades);
    }
    lens.sort((a, b) => a - b);
    return {
        hit: hit / sessions,
        bust: bust / sessions,
        avg: sum / sessions,
        bustAvg: bust ? bustSum / bust : 0,
        median: lens[lens.length >> 1],
    };
};
