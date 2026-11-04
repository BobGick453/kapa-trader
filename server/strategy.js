/**
 * KAPA AI Premium strategies. This file runs only on the server: the website never
 * receives these rules, it only receives the next trade to place.
 *
 * What the strategies rest on (and what they don't):
 * - Deriv's Volatility indices come from a random number generator: every last digit is equally
 *   likely and independent of the ones before. No pattern of past ticks says what comes next, so
 *   KAPA AI never "waits for a signal" in the digits. Its tests on live ticks (the scanner) show it.
 * - Every Deriv contract pays a little less than its true odds: on average each trade loses a small
 *   share of the stake (Deriv's margin: 1.4% on Over 1, 2.35% on Even/Odd, 10.7% on Matches, measured on
 *   Deriv's real prices). No staking system changes that average. What a strategy can
 *   change is how often a session reaches its take-profit before its stop-loss, how much is staked
 *   on the way (the average loss is the margin times the total staked) and how deep a bad run can go.
 * So KAPA AI, before each trade:
 * 1. trades 50% contracts (Even, Odd, Over 4, Under 5). A high-chance contract has a smaller margin per
 *    trade, but each win is small, so reaching a target takes far more stake and costs more in total:
 *    what counts is the margin divided by the payout, lowest on 50% contracts (tested on 300,000 real
 *    ticks with Deriv's real prices). Among those it picks the one Deriv pays best right now, and refuses
 *    to trade when even that one is priced much worse than usual;
 * 2. starts a recovery cycle only when every stake of the whole cycle fits under the stop-loss and
 *    the maximum stake, so a losing run ends at a known loss instead of a stake it can't afford;
 * 3. for Pegasus, stakes what one win needs to reach the take-profit ("bold play"). Dubins and
 *    Savage proved that, when every bet pays less than its odds, bold play gives the highest chance
 *    of reaching a goal before losing a budget; it also stakes the least in total on the way.
 *
 * The preset values below are defaults. Because this source code is public, other values can be
 * kept private in the PREMIUM_RULES secret (JSON: { "presets": {...}, "bots": {...} }).
 */

export const SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];

/** Contracts with the same chance, compared on Deriv's live payout. All settle after one tick. */
export const GROUPS = {
    half: ['DIGITEVEN', 'DIGITODD', 'DIGITOVER:4', 'DIGITUNDER:5'], // 50%
    high: ['DIGITOVER:1', 'DIGITUNDER:8'], // 80%
    low: ['DIGITOVER:5', 'DIGITUNDER:4'], // 40%
};

export const DEFAULT_PRESETS = {
    // Bold play towards the take-profit on the best-priced 50% contract
    pegasus: { mode: 'target', group: 'half', martingale: 1, maxLosses: 20 },
    // Stake ×2.1 after a loss (one win then covers the cycle), only for cycles that fit the stop-loss
    martingale: { mode: 'double', group: 'half', martingale: 2.1, maxLosses: 6 },
    // After a loss, the stake one win needs to get back every loss of the cycle plus the base profit
    recover: { mode: 'recover', group: 'half', martingale: 1, maxLosses: 6 },
};

/**
 * Below this expected result per 1 staked (a margin above 5%), KAPA AI doesn't trade. Deriv's public
 * price on 50% contracts keeps 2.35%; a connection that pays much less (for example because of an app
 * markup) makes every strategy lose several times faster, so KAPA AI stops and says why.
 */
export const MIN_EXPECTED = -0.05;

/** Settings of the Premium bots in the Free Bot library; only members receive them. */
export const DEFAULT_BOTS = {
    'under7-dalembert': { xml: 'dalembert', symbol: 'R_50', tradetype: 'evenodd', type: 'DIGITEVEN', stake: 1, unit: 1, profit: 5, loss: 15, maxStake: 5, duration: 1 },
    'odd-oscars': { xml: 'oscars_grind', symbol: 'R_25', tradetype: 'evenodd', type: 'DIGITODD', stake: 1, unit: 1, profit: 5, loss: 15, maxStake: 4, duration: 1 },
};

const PRESET_KEYS = ['pegasus', 'martingale', 'recover'];
const BOT_KEYS = ['under7-dalembert', 'odd-oscars'];
const MODES = ['target', 'double', 'recover', 'none'];

/** Premium rules for this deployment: PREMIUM_RULES when it is set and valid, otherwise the defaults. */
export const loadRules = env => {
    let custom = {};
    if (env?.PREMIUM_RULES) {
        try {
            custom = JSON.parse(env.PREMIUM_RULES);
        } catch {
            throw new Error('PREMIUM_RULES is not valid JSON');
        }
    }
    const presets = { ...DEFAULT_PRESETS };
    for (const k of PRESET_KEYS) {
        const p = custom.presets?.[k];
        if (!p) continue;
        const ok =
            MODES.includes(p.mode) &&
            Object.hasOwn(GROUPS, p.group) &&
            typeof p.martingale === 'number' && p.martingale >= 1 && p.martingale <= 5 &&
            Number.isInteger(p.maxLosses) && p.maxLosses >= 1 && p.maxLosses <= 20;
        if (!ok) throw new Error(`PREMIUM_RULES: invalid preset ${k}`);
        presets[k] = { mode: p.mode, group: p.group, martingale: p.martingale, maxLosses: p.maxLosses };
    }
    const bots = { ...DEFAULT_BOTS };
    for (const k of BOT_KEYS) if (custom.bots?.[k]) bots[k] = { ...DEFAULT_BOTS[k], ...custom.bots[k] }; // the website checks every field before use
    return { presets, bots };
};

const floor2 = n => Math.floor(n * 100 + 1e-9) / 100;
const ceil2 = n => Math.ceil(n * 100 - 1e-9) / 100;
const round2 = n => Math.round(n * 100) / 100;
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

// ---------- Contracts ----------
const KEY = /^(DIGITEVEN|DIGITODD|DIGITOVER:[0-8]|DIGITUNDER:[1-9])$/;
export const validKey = k => typeof k === 'string' && KEY.test(k);
export const contractOf = key => {
    const [type, b] = key.split(':');
    return { contract_type: type, barrier: b === undefined ? null : Number(b) };
};
/** True chance of winning: the last digit is uniformly random. */
export const winProb = key => {
    const { contract_type: t, barrier: b } = contractOf(key);
    if (t === 'DIGITEVEN' || t === 'DIGITODD') return 0.5;
    if (t === 'DIGITOVER') return (9 - b) / 10;
    return b / 10; // DIGITUNDER
};
/**
 * Deriv's margin by chance of winning, measured on its real prices (stake 10, 1 tick, the same on every
 * Volatility index, November 2026). Used only until Deriv's live quote for the contract is known.
 */
const MEASURED_MARGIN = { 0.9: 0.0136, 0.8: 0.0144, 0.7: 0.0172, 0.6: 0.0196, 0.5: 0.0235, 0.4: 0.0292, 0.3: 0.0385, 0.2: 0.0566, 0.1: 0.1071 };
/** Profit per 1 staked when Deriv hasn't quoted yet, from the measured margins. */
export const estRatio = key => {
    const p = winProb(key);
    return (1 - (MEASURED_MARGIN[Math.round(p * 10) / 10] ?? 0.03)) / p - 1;
};
const ratioOf = (key, ratios) => ratios[key] ?? estRatio(key);
/** Average result of 1 staked: chance × (1 + profit) − 1. Always below 0 on Deriv. */
export const expectedOf = (key, ratios) => winProb(key) * (1 + ratioOf(key, ratios)) - 1;
/** Among contracts with the same chance, the one Deriv pays best. */
export const bestOf = (keys, ratios) => keys.reduce((a, k) => (expectedOf(k, ratios) > expectedOf(a, ratios) + 1e-12 ? k : a));

/** Live payouts sent by the website (profit per 1 staked), keyed by contract. */
export const cleanRatios = r => {
    const out = {};
    if (r && typeof r === 'object')
        for (const [k, v] of Object.entries(r).slice(0, 40)) {
            const x = num(v, 0.01, 20);
            if (validKey(k) && x !== null) out[k] = x;
        }
    return out;
};

/** Validates settings sent by the website. Returns { settings } or { error }. Limits are enforced here, not in the browser. */
export const validateSettings = (body, presets = DEFAULT_PRESETS) => {
    const preset = body?.preset;
    let rules;
    if (preset === 'custom') {
        const c = body.custom || {};
        const barrier = int(c.barrier, 0, 8);
        const recovery = int(c.recovery, 0, 8);
        const mode = { none: 'none', mult: 'double', recover: 'recover', target: 'target' }[c.recMode];
        const martingale = num(c.martingale, 1, 5);
        if (barrier === null || recovery === null || !mode || martingale === null) return { error: 'Invalid custom strategy.' };
        // The user's own contracts: KAPA AI still sizes and limits every stake, but doesn't refuse their prices
        rules = { mode, base: [`DIGITOVER:${barrier}`], rec: [`DIGITOVER:${recovery}`], martingale, filter: false };
    } else if (Object.hasOwn(presets, preset)) {
        const p = presets[preset];
        rules = { mode: p.mode, base: GROUPS[p.group], rec: GROUPS[p.group], martingale: p.martingale, filter: true };
    } else return { error: 'Unknown strategy.' };

    const symbol = SYMBOLS.includes(body.symbol) ? body.symbol : null;
    const stake = num(body.stake, 0.35, 50000);
    const takeProfit = num(body.takeProfit, 0.01, 1e7);
    const stopLoss = num(body.stopLoss, 0.35, 1e7);
    const maxLosses = int(body.maxLosses ?? (Object.hasOwn(presets, preset) ? presets[preset].maxLosses : 6), 1, 20);
    const maxRuns = int(body.maxRuns ?? 0, 0, 10000);
    // The most of each stake the user accepts Deriv keeping on their connection (default 12%)
    const maxMargin = num(body.maxMargin ?? 12, 1, 50);
    if (!symbol) return { error: 'Unknown market.' };
    if (stake === null || takeProfit === null || stopLoss === null) return { error: 'Stake, take-profit and stop-loss are required.' };
    if (maxLosses === null || maxRuns === null) return { error: 'Invalid loss or trade limits.' };
    // A stake can never exceed the stop-loss: the server caps it even if the page asks for more
    const maxStake = Math.min(num(body.maxStake, 0.35, 1e7) ?? stopLoss, stopLoss);
    if (rules.mode !== 'target' && stake > maxStake) return { error: 'The stake must not exceed the stop-loss or the maximum stake.' };
    return { settings: { ...rules, preset, symbol, stake, takeProfit, stopLoss, maxStake, maxLosses, maxRuns, minExpected: -(maxMargin ?? 12) / 100 } };
};

export const freshState = () => ({ pl: 0, streak: 0, lost: 0, runs: 0 });

/** Stake of step i (0 = the first trade) of a recovery cycle, given what the cycle has lost so far. */
const stepStake = (s, i, lost, ratios) => {
    if (i === 0 || s.mode === 'none') return s.stake;
    if (s.mode === 'double') return s.stake * s.martingale ** i;
    // recover: one win gets back the cycle's losses plus what the first trade would have won
    const baseR = ratioOf(bestOf(s.base, ratios), ratios);
    const recR = ratioOf(bestOf(s.rec, ratios), ratios);
    return (lost + s.stake * baseR) / recR;
};

/**
 * How many trades a cycle may take: the most losses in a row whose stakes all fit under the
 * maximum stake and, together, under the room left above the stop-loss when the cycle began.
 */
export const cycleLength = (s, room, ratios) => {
    let lost = 0;
    let n = 0;
    while (n < s.maxLosses) {
        const st = ceil2(stepStake(s, n, lost, ratios));
        if (st > s.maxStake + 0.005 || lost + st > room + 0.005) break;
        lost += st;
        n++;
        if (s.mode === 'none') return s.maxLosses; // flat stake: every trade costs the same
    }
    return n;
};

/** Next trade for the current state, or the reason to stop. */
export const decide = (s, st, ratios) => {
    if (st.pl >= s.takeProfit) return { stop: 'tp', reason: `Take-profit reached: +${st.pl.toFixed(2)}` };
    if (st.pl <= -s.stopLoss + 0.005) return { stop: 'sl', reason: `Stop-loss reached: ${st.pl.toFixed(2)}` };
    if (s.maxRuns && st.runs >= s.maxRuns) return { stop: 'runs', reason: `Finished ${st.runs} trades` };
    const room = round2(s.stopLoss + st.pl); // what this session may still lose
    const recovering = st.streak > 0 && s.mode !== 'none' && s.mode !== 'target';
    const key = bestOf(recovering ? s.rec : s.base, ratios);
    if (s.filter && ratios[key] != null && expectedOf(key, ratios) < (s.minExpected ?? MIN_EXPECTED))
        return {
            stop: 'edge',
            reason: `Deriv pays only +${(ratioOf(key, ratios) * 100).toFixed(1)}% on this contract on your connection: Deriv keeps ${(-expectedOf(key, ratios) * 100).toFixed(1)}% of each stake, against 2.35% at Deriv's public price. This is above the limit set in KAPA AI's advanced settings (maximum Deriv margin), so KAPA AI didn't trade. Raise that limit to trade anyway, or check the app's markup on developers.deriv.com.`,
        };
    const r = ratioOf(key, ratios);
    let amount;
    if (s.mode === 'target') {
        if (st.streak >= s.maxLosses) return { stop: 'streak', reason: `${st.streak} losses in a row` };
        // Bold play: the stake one win needs to reach the take-profit, or everything left above the stop-loss
        const need = ceil2(Math.max(0.35, (s.takeProfit - st.pl) / r));
        amount = floor2(Math.min(need, s.maxStake, room));
    } else {
        // The cycle was planned on the room it started with: room now + what it has lost so far
        const len = cycleLength(s, round2(room + st.lost), ratios);
        if (len === 0)
            return { stop: 'sl', reason: 'Not enough room left above the stop-loss for a full trade cycle. Session ended to protect your capital.' };
        if (st.streak >= len)
            return {
                stop: 'streak',
                reason:
                    s.mode === 'none'
                        ? `${st.streak} losses in a row`
                        : `${st.streak} losses in a row: the recovery cycle that fits your stop-loss is used up. Session ended at a planned loss.`,
            };
        amount = ceil2(stepStake(s, recovering ? st.streak : 0, st.lost, ratios));
    }
    if (amount < 0.35) return { stop: 'sl', reason: 'Not enough room left above the stop-loss for the minimum stake.' };
    const c = contractOf(key);
    return { trade: { ...c, amount, symbol: s.symbol, duration: 1, duration_unit: 't', recovery: recovering } };
};

/** Applies a settled contract to the state. */
export const applyResult = (s, st, { buy_price, profit }) => {
    const won = profit > 0;
    const next = { ...st, runs: st.runs + 1, pl: round2(st.pl + profit) };
    if (won) Object.assign(next, { streak: 0, lost: 0 });
    else Object.assign(next, { streak: st.streak + 1, lost: round2(st.lost + buy_price) });
    return next;
};

/**
 * Monte Carlo of sessions with the same rules as live trading (decide / applyResult), bounded so it
 * fits the server's CPU budget. Digits are drawn uniformly, like Deriv's random number generator.
 */
export const simulate = (s, capital, ratios, budget = 150000) => {
    let hit = 0;
    let bust = 0;
    let sum = 0;
    let bustSum = 0;
    let used = 0;
    let sessions = 0;
    let staked = 0;
    const trades = [];
    const sim = { ...s, stopLoss: Math.min(s.stopLoss, capital) };
    while (sessions < 4000 && used < budget) {
        let st = freshState();
        let d = decide(sim, st, ratios);
        let n = 0;
        while (d.trade && n < 3000) {
            const key = d.trade.barrier === null ? d.trade.contract_type : `${d.trade.contract_type}:${d.trade.barrier}`;
            const won = Math.random() < winProb(key);
            const amt = d.trade.amount;
            staked += amt;
            st = applyResult(sim, st, { buy_price: amt, profit: won ? round2(amt * ratioOf(key, ratios)) : -amt });
            d = decide(sim, st, ratios);
            n++;
        }
        used += n + 1;
        sessions++;
        sum += st.pl;
        trades.push(n);
        if (d.stop === 'tp') hit++;
        else if (st.pl < 0) {
            bust++;
            bustSum += st.pl;
        }
    }
    trades.sort((a, b) => a - b);
    return {
        sessions,
        hit: hit / sessions,
        bust: bust / sessions,
        avg: sum / sessions,
        bustAvg: bust ? bustSum / bust : 0,
        median: trades[trades.length >> 1],
        staked: staked / sessions,
        contract: bestOf(s.base, ratios),
    };
};

// ---------- Live randomness check on Deriv's ticks ----------
const lgamma = x => {
    // Lanczos approximation
    const g = 7;
    const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1;
    let a = c[0];
    const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
};
/** Upper regularized gamma Q(a, x): the p-value of a chi-square statistic 2x with 2a degrees of freedom. */
const gammaQ = (a, x) => {
    if (x <= 0) return 1;
    if (x < a + 1) {
        let sum = 1 / a;
        let del = sum;
        for (let n = 1; n < 500; n++) {
            del *= x / (a + n);
            sum += del;
            if (Math.abs(del) < Math.abs(sum) * 1e-12) break;
        }
        return 1 - sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
    }
    let b = x + 1 - a;
    let cc = 1 / 1e-300;
    let d = 1 / b;
    let h = d;
    for (let i = 1; i < 500; i++) {
        const an = -i * (i - a);
        b += 2;
        d = an * d + b;
        if (Math.abs(d) < 1e-300) d = 1e-300;
        cc = b + an / cc;
        if (Math.abs(cc) < 1e-300) cc = 1e-300;
        d = 1 / d;
        const del = d * cc;
        h *= del;
        if (Math.abs(del - 1) < 1e-12) break;
    }
    return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
};

/**
 * Tests a run of last digits for patterns: are the ten digits equally frequent (chi-square), and
 * does a digit's parity follow the previous one's (serial test)? p-values well above 0.01 mean no
 * pattern was found: the digits behave like a fair random draw, so they can't be predicted.
 */
export const randomnessCheck = digits => {
    const n = digits.length;
    if (n < 50) return null;
    const counts = Array(10).fill(0);
    digits.forEach(d => counts[d]++);
    const e = n / 10;
    const chi = counts.reduce((a, c) => a + (c - e) ** 2 / e, 0);
    // Parity after parity: 2×2 table of (previous even/odd, next even/odd)
    const t = [
        [0, 0],
        [0, 0],
    ];
    for (let i = 1; i < n; i++) t[digits[i - 1] % 2][digits[i] % 2]++;
    const m = n - 1;
    let chi2 = 0;
    for (let a = 0; a < 2; a++)
        for (let b = 0; b < 2; b++) {
            const exp = ((t[a][0] + t[a][1]) * (t[0][b] + t[1][b])) / m;
            if (exp > 0) chi2 += (t[a][b] - exp) ** 2 / exp;
        }
    const after = [t[0][0] / Math.max(1, t[0][0] + t[0][1]), t[1][0] / Math.max(1, t[1][0] + t[1][1])];
    return {
        ticks: n,
        uniform_p: Math.round(gammaQ(4.5, chi / 2) * 1000) / 1000,
        serial_p: Math.round(gammaQ(0.5, chi2 / 2) * 1000) / 1000,
        even_after_even: Math.round(after[0] * 1000) / 1000,
        even_after_odd: Math.round(after[1] * 1000) / 1000,
    };
};

// ---------- Backtest on real Deriv ticks ----------
/** Did a 1-tick contract win, given the last digit of the exit tick? */
export const wins = (key, d) => {
    const { contract_type: t, barrier: b } = contractOf(key);
    if (t === 'DIGITEVEN') return d % 2 === 0;
    if (t === 'DIGITODD') return d % 2 === 1;
    if (t === 'DIGITOVER') return d > b;
    return d < b; // DIGITUNDER
};

/**
 * Replays real last digits, in order, through a strategy's own rules (decide / applyResult), one
 * session after another with the same take-profit and stop-loss, and with Deriv's real payouts.
 * Each tick settles one 1-tick contract, so consecutive trades use consecutive ticks.
 */
export const backtest = (s, digits, ratios) => {
    let st = freshState();
    let staked = 0;
    let trades = 0;
    let net = 0;
    let worst = 0;
    const done = { tp: 0, loss: 0, edge: 0 };
    let sessions = 0;
    for (let i = 0; i < digits.length; i++) {
        const d = decide(s, st, ratios);
        if (!d.trade) {
            sessions++;
            net = round2(net + st.pl);
            worst = Math.min(worst, st.pl);
            if (d.stop === 'tp') done.tp++;
            else if (d.stop === 'edge') {
                done.edge++;
                break; // poor prices: the strategy refuses to trade at all
            } else done.loss++;
            st = freshState();
            i--; // the next session starts on this same tick
            continue;
        }
        const { contract_type, barrier, amount } = d.trade;
        const key = barrier === null ? contract_type : `${contract_type}:${barrier}`;
        const won = wins(key, digits[i]);
        staked += amount;
        trades++;
        st = applyResult(s, st, { buy_price: amount, profit: won ? round2(amount * ratioOf(key, ratios)) : -amount });
    }
    return {
        sessions,
        tp: done.tp,
        loss: done.loss,
        refused: done.edge > 0,
        net: round2(net), // finished sessions only
        open: round2(st.pl), // the session still running when the ticks ran out
        worst: round2(worst),
        trades,
        staked: round2(staked),
    };
};

/** The strategies compared in the lab, as the server runs them (the reference bot's all-in method included). */
export const labStrategies = (presets, { stake, takeProfit, stopLoss, capital }) => {
    const base = { symbol: 'R_100', takeProfit, maxRuns: 0 };
    const preset = (k) => {
        const p = presets[k];
        return { ...base, mode: p.mode, base: GROUPS[p.group], rec: GROUPS[p.group], martingale: p.martingale, filter: true, stake, stopLoss, maxStake: stopLoss, maxLosses: p.maxLosses };
    };
    return {
        pegasus: preset('pegasus'),
        martingale: preset('martingale'),
        recover: preset('recover'),
        fixed: { ...base, mode: 'none', base: GROUPS.half, rec: GROUPS.half, martingale: 1, filter: false, stake, stopLoss, maxStake: stopLoss, maxLosses: 5 },
        // The reference bot: the whole balance on Over 1 every trade, until the target or the balance is gone
        reference: { ...base, mode: 'none', base: ['DIGITOVER:1'], rec: ['DIGITOVER:1'], martingale: 1, filter: false, stake: capital, stopLoss: capital, maxStake: capital, maxLosses: 20 },
    };
};
