/**
 * KAPA AI Premium strategies. This file runs only on the server: the website never
 * receives these rules, it only receives the next trade to place.
 *
 * The values below are defaults. Because this source code is public, the real values can be
 * kept private in the PREMIUM_RULES secret (JSON: { "presets": {...}, "bots": {...} }),
 * which replaces them. See server/README.md.
 */

export const DEFAULT_PRESETS = {
    pegasus: { barrier: 1, recovery: 5, recMode: 'mult', martingale: 2.2, maxLosses: 4 },
    martingale: { barrier: 2, recovery: 4, recMode: 'mult', martingale: 2.2, maxLosses: 5 },
    recover: { barrier: 1, recovery: 5, recMode: 'recover', martingale: 1, maxLosses: 4 },
};

export const SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];

/** Settings of the Premium bots in the Free Bot library; only members receive them. */
export const DEFAULT_BOTS = {
    'under7-dalembert': { xml: 'dalembert', symbol: 'R_75', tradetype: 'overunder', type: 'DIGITUNDER', prediction: 7, stake: 1, unit: 1, profit: 5, loss: 25, duration: 1 },
    'odd-oscars': { xml: 'oscars_grind', symbol: 'R_25', tradetype: 'evenodd', type: 'DIGITODD', stake: 1, unit: 1, profit: 5, loss: 25, duration: 1 },
};

const PRESET_KEYS = ['pegasus', 'martingale', 'recover'];
const BOT_KEYS = ['under7-dalembert', 'odd-oscars'];

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
            Number.isInteger(p.barrier) && p.barrier >= 0 && p.barrier <= 8 &&
            Number.isInteger(p.recovery) && p.recovery >= 0 && p.recovery <= 8 &&
            ['mult', 'recover', 'none'].includes(p.recMode) &&
            typeof p.martingale === 'number' && p.martingale >= 1 && p.martingale <= 5 &&
            Number.isInteger(p.maxLosses) && p.maxLosses >= 1 && p.maxLosses <= 20;
        if (!ok) throw new Error(`PREMIUM_RULES: invalid preset ${k}`);
        presets[k] = { barrier: p.barrier, recovery: p.recovery, recMode: p.recMode, martingale: p.martingale, maxLosses: p.maxLosses };
    }
    const bots = { ...DEFAULT_BOTS };
    for (const k of BOT_KEYS) if (custom.bots?.[k]) bots[k] = { ...DEFAULT_BOTS[k], ...custom.bots[k] }; // the website checks every field before use
    return { presets, bots };
};

const floor2 = n => Math.floor(n * 100) / 100;
const round2 = n => Math.round(n * 100) / 100;
export const winProb = b => (9 - b) / 10; // DIGITOVER: the last digit is uniformly random
export const estRatio = b => 0.93 / winProb(b) - 1; // Deriv pays roughly 7% under fair odds
const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

/** Validates settings sent by the website. Returns { settings } or { error }. Limits are enforced here, not in the browser. */
export const validateSettings = (body, presets = DEFAULT_PRESETS) => {
    const preset = body?.preset;
    let rules;
    if (preset === 'custom') {
        const c = body.custom || {};
        const barrier = int(c.barrier, 0, 8);
        const recovery = int(c.recovery, 0, 8);
        const recMode = ['mult', 'recover', 'none'].includes(c.recMode) ? c.recMode : null;
        const martingale = num(c.martingale, 1, 5);
        if (barrier === null || recovery === null || !recMode || martingale === null) return { error: 'Invalid custom strategy.' };
        rules = { barrier, recovery, recMode, martingale };
    } else if (Object.hasOwn(presets, preset)) {
        const { maxLosses, ...r } = presets[preset];
        rules = r;
    } else return { error: 'Unknown strategy.' };

    const symbol = SYMBOLS.includes(body.symbol) ? body.symbol : null;
    const stake = num(body.stake, 0.35, 50000);
    const takeProfit = num(body.takeProfit, 0.01, 1e7);
    const stopLoss = num(body.stopLoss, 0.01, 1e7);
    const maxLosses = int(body.maxLosses ?? (Object.hasOwn(presets, preset) ? presets[preset].maxLosses : undefined), 1, 20);
    const maxRuns = int(body.maxRuns ?? 0, 0, 10000);
    if (!symbol) return { error: 'Unknown market.' };
    if (stake === null || takeProfit === null || stopLoss === null) return { error: 'Stake, take-profit and stop-loss are required.' };
    if (maxLosses === null || maxRuns === null) return { error: 'Invalid loss or trade limits.' };
    // A stake can never exceed the stop-loss: the server caps it even if the page asks for more
    const maxStake = Math.min(num(body.maxStake, stake, 1e7) ?? stopLoss, stopLoss);
    if (stake > maxStake) return { error: 'Stake must not exceed the stop-loss.' };
    return { settings: { ...rules, preset, symbol, stake, takeProfit, stopLoss, maxStake, maxLosses, maxRuns } };
};

export const cleanRatios = r => ({ base: num(r?.base, 0.01, 20), rec: num(r?.rec, 0.01, 20) });

export const freshState = s => ({ pl: 0, streak: 0, recLosses: 0, nextStake: s.stake, runs: 0 });

/** Next trade for the current state, or the reason to stop. */
export const decide = (s, st, ratios) => {
    if (st.pl >= s.takeProfit) return { stop: 'tp', reason: `Take-profit reached: +${st.pl.toFixed(2)}` };
    if (st.pl <= -s.stopLoss) return { stop: 'sl', reason: `Stop-loss hit: ${st.pl.toFixed(2)}` };
    if (st.streak >= s.maxLosses) return { stop: 'streak', reason: `${st.streak} losses in a row` };
    if (s.maxRuns && st.runs >= s.maxRuns) return { stop: 'runs', reason: `Finished ${st.runs} trades` };
    const recovering = st.streak > 0 && s.recMode !== 'none';
    const barrier = recovering ? s.recovery : s.barrier;
    let want = st.nextStake;
    if (recovering && s.recMode === 'recover') {
        const recR = ratios.rec ?? estRatio(s.recovery);
        const baseR = ratios.base ?? estRatio(s.barrier);
        want = Math.ceil(((st.recLosses + s.stake * baseR) / recR) * 100) / 100;
    }
    const amount = floor2(Math.min(want, s.maxStake, s.stopLoss + st.pl));
    if (amount < 0.35) return { stop: 'sl', reason: 'Not enough room left under the stop-loss for the minimum stake' };
    return { trade: { contract_type: 'DIGITOVER', barrier, amount, symbol: s.symbol, duration: 1, duration_unit: 't', recovery: recovering, capped: amount < want - 0.01 } };
};

/** Applies a settled contract to the state. */
export const applyResult = (s, st, { buy_price, profit }) => {
    const won = profit > 0;
    const next = { ...st, runs: st.runs + 1, pl: round2(st.pl + profit) };
    if (won) Object.assign(next, { streak: 0, recLosses: 0, nextStake: s.stake });
    else Object.assign(next, { streak: st.streak + 1, recLosses: round2(st.recLosses - profit), nextStake: s.recMode === 'mult' ? buy_price * s.martingale : s.stake });
    return next;
};

/** Monte Carlo of a session, bounded so it fits a Worker's CPU budget. */
export const simulate = (s, capital, ratios, budget = 150000) => {
    const baseR = ratios.base ?? estRatio(s.barrier);
    const recR = ratios.rec ?? estRatio(s.recovery);
    const baseP = winProb(s.barrier);
    const recP = winProb(s.recovery);
    let hit = 0;
    let bust = 0;
    let sum = 0;
    let bustSum = 0;
    let used = 0;
    let sessions = 0;
    const trades = [];
    while (sessions < 4000 && used < budget) {
        let pl = 0;
        let streak = 0;
        let lost = 0;
        let stake = s.stake;
        let n = 0;
        let end = 'open';
        for (; n < 2000; n++) {
            if (pl >= s.takeProfit) {
                end = 'tp';
                break;
            }
            if (pl <= -s.stopLoss || streak >= s.maxLosses) {
                end = 'loss';
                break;
            }
            if (s.maxRuns && n >= s.maxRuns) break;
            const rec = streak > 0 && s.recMode !== 'none';
            let st = s.recMode === 'recover' && rec ? (lost + s.stake * baseR) / recR : s.recMode === 'mult' ? stake : s.stake;
            st = floor2(Math.min(st, s.maxStake, capital + pl, s.stopLoss + pl));
            if (st < 0.35) {
                end = 'loss';
                break;
            }
            if (Math.random() < (rec ? recP : baseP)) {
                pl += st * (rec ? recR : baseR);
                streak = 0;
                lost = 0;
                stake = s.stake;
            } else {
                pl -= st;
                streak++;
                lost += st;
                stake = st * s.martingale;
            }
        }
        used += n + 1;
        sessions++;
        sum += pl;
        trades.push(n);
        if (end === 'tp') hit++;
        else if (end === 'loss' && pl < 0) {
            bust++;
            bustSum += pl;
        }
    }
    trades.sort((a, b) => a - b);
    return { sessions, hit: hit / sessions, bust: bust / sessions, avg: sum / sessions, bustAvg: bust ? bustSum / bust : 0, median: trades[trades.length >> 1] };
};
