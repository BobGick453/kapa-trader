/**
 * Classic bots with KAPA Apex recovery (Premium). The four classic bots (Digit Switcher, Dollar Printer,
 * Gold Odd/Even, Profit Maker) keep their public entry rules, which also run in the website for their free
 * version. What is Premium, and stays here on the server, is the recovery: after a loss, KAPA Apex picks the
 * contract and the stake with the highest chance of still reaching the take-profit, never past the stop-loss.
 * The website sends its state after each loss and receives the next trade (see /classic/recover).
 */
import { applyResult, contractOf, decide, freshState, validateSettings, wins } from './strategy.js';

export const CLASSIC_BOTS = ['switcher', 'printer', 'goldoe', 'profitmaker'];

/** Entry rules of the bots (public: the same as the free version in the website). Null: wait for a later tick. */
const ENTRY = {
    // Under 5 after an even digit
    switcher: d => (d.length && d[d.length - 1] % 2 === 0 ? 'DIGITUNDER:5' : null),
    // Over 1 when at least 12 of the last 15 digits were above 1
    printer: d => (d.length >= 15 && d.slice(-15).filter(x => x > 1).length >= 12 ? 'DIGITOVER:1' : null),
    // Even when at least 4 of the last 5 digits are even and the last one is even; Odd likewise
    goldoe: d => {
        if (d.length < 5) return null;
        const even = d.slice(-5).filter(x => x % 2 === 0).length;
        const last = d[d.length - 1];
        if (even >= 4 && last % 2 === 0) return 'DIGITEVEN';
        if (even <= 1 && last % 2 === 1) return 'DIGITODD';
        return null;
    },
    profitmaker: () => 'DIGITOVER:2',
};

const round2c = n => Math.round(n * 100) / 100;

/** Settings of a classic bot with Apex recovery: KAPA Apex's own validation, plus the bot. */
export const classicSettings = (body, presets) => {
    const bot = CLASSIC_BOTS.includes(body?.bot) ? body.bot : null;
    if (!bot) return { error: 'Unknown classic bot.' };
    const v = validateSettings({ ...body, preset: 'apex' }, presets);
    if (v.error) return v;
    if (v.settings.stake > v.settings.maxStake) return { error: 'The stake must not exceed the stop-loss or the maximum stake.' };
    return { settings: { ...v.settings, bot } };
};

/** Next step of a classic bot with Apex recovery: an entry trade, a recovery trade, { wait } or a stop. */
export const classicDecide = (s, st, ratios, digits) => {
    if (st.pl >= s.takeProfit) return { stop: 'tp', reason: `Take-profit reached: +${st.pl.toFixed(2)}` };
    if (st.pl <= -s.stopLoss + 0.005) return { stop: 'sl', reason: `Stop-loss reached: ${st.pl.toFixed(2)}` };
    if (st.streak > 0) return decide(s, st, ratios); // after a loss: KAPA Apex until the next win
    const room = round2c(s.stopLoss + st.pl);
    if (s.stake > s.maxStake + 0.005 || s.stake > room + 0.005)
        return { stop: 'sl', reason: 'Not enough room left above the stop-loss for a full trade cycle. Session ended to protect your capital.' };
    const key = ENTRY[s.bot](digits);
    if (!key) return { wait: true };
    return { trade: { ...contractOf(key), amount: Math.ceil(s.stake * 100 - 1e-9) / 100, symbol: s.symbol, duration: 1, duration_unit: 't', recovery: false } };
};

/** Validates the state the website sends with a recovery request. */
export const cleanState = x => {
    const ok = v => typeof v === 'number' && Number.isFinite(v);
    if (!x || !ok(x.pl) || !Number.isInteger(x.streak) || x.streak < 1 || x.streak > 1000 || !ok(x.lost) || x.lost < 0) return null;
    return { pl: round2c(x.pl), streak: x.streak, lost: round2c(x.lost), runs: Number.isInteger(x.runs) && x.runs >= 0 ? x.runs : 0 };
};

const classicKeyOf = t => (t.barrier === null ? t.contract_type : `${t.contract_type}:${t.barrier}`);
const classicRatio = (key, ratios, est) => ratios[key] ?? est(key);

/** Session plan for a classic bot with Apex recovery, on random digits like Deriv's generator (CPU-bounded). */
export const simulateClassic = (s, ratios, est, budget = 150000) => {
    let hit = 0;
    let bust = 0;
    let sum = 0;
    let bustSum = 0;
    let used = 0;
    let sessions = 0;
    let staked = 0;
    const trades = [];
    while (sessions < 2000 && used < budget) {
        let st = freshState();
        const digits = Array.from({ length: 30 }, () => Math.floor(Math.random() * 10));
        let n = 0;
        let d;
        for (let i = 0; i < 20000; i++) {
            d = classicDecide(s, st, ratios, digits.slice(-30));
            const next = Math.floor(Math.random() * 10);
            digits.push(next);
            used++;
            if (d.wait) continue;
            if (!d.trade) break;
            const key = classicKeyOf(d.trade);
            const amt = d.trade.amount;
            staked += amt;
            st = applyResult(s, st, { buy_price: amt, profit: wins(key, next) ? round2c(amt * classicRatio(key, ratios, est)) : -amt });
            n++;
        }
        sessions++;
        sum += st.pl;
        trades.push(n);
        if (d?.stop === 'tp') hit++;
        else if (st.pl < 0) {
            bust++;
            bustSum += st.pl;
        }
    }
    trades.sort((a, b) => a - b);
    return { sessions, hit: hit / sessions, bust: bust / sessions, avg: sum / sessions, bustAvg: bust ? bustSum / bust : 0, median: trades[trades.length >> 1], staked: staked / sessions };
};

/** Replays real last digits, in order, through a classic bot with Apex recovery, one session after another. */
export const backtestClassic = (s, digits, ratios, est) => {
    let st = freshState();
    let sessions = 0;
    let tp = 0;
    let net = 0;
    let worst = 0;
    let trades = 0;
    for (let i = 0; i < digits.length; i++) {
        const d = classicDecide(s, st, ratios, digits.slice(Math.max(0, i - 30), i));
        if (d.wait) continue;
        if (!d.trade) {
            sessions++;
            net = round2c(net + st.pl);
            worst = Math.min(worst, st.pl);
            if (d.stop === 'tp') tp++;
            if (d.stop === 'edge') break;
            st = freshState();
            i--; // the next session starts on this same tick
            continue;
        }
        const key = classicKeyOf(d.trade);
        const a = d.trade.amount;
        trades++;
        st = applyResult(s, st, { buy_price: a, profit: wins(key, digits[i]) ? round2c(a * classicRatio(key, ratios, est)) : -a });
    }
    return { sessions, tp, net, worst, trades };
};
