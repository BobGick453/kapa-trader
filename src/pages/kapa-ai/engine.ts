/**
 * KAPA AI trade runner. It places the contracts a strategy asks for, through the app's
 * authorized Deriv connection, and reports each result back to the strategy.
 *
 * Two kinds of strategy ("policy") drive it:
 * - the free fixed-stake strategy, which runs here in the browser;
 * - the Premium strategies, which run on the Kapa server (see premium-api.ts). Their rules
 *   are not in this file or anywhere in the website: the server only sends the next trade.
 */

export type TContractType = 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITMATCH' | 'DIGITDIFF';
export type TRecoveryMode = 'none' | 'mult' | 'recover' | 'target';
export type TPresetKey = 'pegasus' | 'martingale' | 'recover' | 'fixed';
export type TStrategy = TPresetKey | 'custom';

/** Rules the user writes for the "Custom" strategy (Premium). The server checks and runs them. */
export type TCustomRules = { barrier: number; recovery: number; recMode: TRecoveryMode; martingale: number };

export type TSettings = {
    strategy: TStrategy;
    symbol: string;
    stake: number;
    maxStake: number;
    takeProfit: number;
    stopLoss: number;
    maxLosses: number | null; // null: the strategy's own limit
    maxRuns: number;
    delay: number;
    /** Daily loss limit, in % of the balance at the first session of the day (Deriv account, this device) */
    dailyLossPct: number;
    custom: TCustomRules;
};

export const STRATEGIES: Record<TPresetKey, { label: string; premium: boolean }> = {
    pegasus: { label: 'Pegasus · bold play, best chance to reach the take-profit', premium: true },
    martingale: { label: 'Steady · ×2.1 recovery cycles that fit the stop-loss', premium: true },
    recover: { label: 'Exact recovery · one win gets the cycle back', premium: true },
    fixed: { label: 'Even/Odd · fixed stake, lowest Deriv margin', premium: false },
};
export const PREMIUM_PRESETS = (Object.keys(STRATEGIES) as TPresetKey[]).filter(k => STRATEGIES[k].premium);

// ---------- Contracts, keyed 'DIGITEVEN' or 'DIGITOVER:4' ----------
/** 50% contracts: Deriv's margin is smallest on these, so KAPA AI's strategies trade the best-paid one. */
export const HALF_KEYS = ['DIGITEVEN', 'DIGITODD', 'DIGITOVER:4', 'DIGITUNDER:5'];
export const contractKey = (type: TContractType, barrier: number | null | undefined) =>
    barrier === null || barrier === undefined || !needsBarrier(type) ? type : `${type}:${barrier}`;
export const parseKey = (key: string): { type: TContractType; barrier: number | null } => {
    const [t, b] = key.split(':');
    return { type: t as TContractType, barrier: b === undefined ? null : Number(b) };
};
/** True chance of winning a 1-tick digit contract: the last digit is uniformly random. */
export const chanceOf = (key: string) => {
    const { type, barrier: b } = parseKey(key);
    if (type === 'DIGITEVEN' || type === 'DIGITODD') return 0.5;
    if (type === 'DIGITOVER') return (9 - (b ?? 0)) / 10;
    if (type === 'DIGITUNDER') return (b ?? 0) / 10;
    if (type === 'DIGITMATCH') return 0.1;
    return 0.9; // DIGITDIFF
};
export const contractLabel = (type: TContractType, barrier?: number | null) =>
    `${TYPE_LABEL[type]}${needsBarrier(type) && barrier !== null && barrier !== undefined ? ` ${barrier}` : ''}`;
export const keyLabel = (key: string) => {
    const { type, barrier } = parseKey(key);
    return contractLabel(type, barrier);
};
/** Profit per 1 staked before Deriv has quoted: a cautious guess (7% under fair odds). */
export const estRatioOf = (key: string) => 0.93 / chanceOf(key) - 1;
/** Average result of 1 staked. Always below 0: Deriv pays a little less than the true odds. */
export const expectedOf = (key: string, ratios: TPayoutRatios) =>
    chanceOf(key) * (1 + (ratios[key] ?? estRatioOf(key))) - 1;
export const bestOf = (keys: string[], ratios: TPayoutRatios) =>
    keys.reduce((a, k) => (expectedOf(k, ratios) > expectedOf(a, ratios) + 1e-12 ? k : a));

/** The free strategy: the same stake every time, on the best-paid 50% contract. */
const FIXED = { maxLosses: 5 };
/** A session may risk at most this share of the balance, so one bad session can't empty the account. */
export const MAX_SESSION_RISK = 0.25;

export const DEFAULT_SETTINGS: TSettings = {
    strategy: 'fixed',
    symbol: 'R_100',
    stake: 1,
    maxStake: 50,
    takeProfit: 10,
    stopLoss: 50,
    maxLosses: null,
    maxRuns: 0,
    delay: 1,
    dailyLossPct: 30,
    custom: { barrier: 4, recovery: 4, recMode: 'none', martingale: 2.1 },
};

export const MARKETS: Record<string, string> = {
    R_10: 'Volatility 10 Index',
    R_25: 'Volatility 25 Index',
    R_50: 'Volatility 50 Index',
    R_75: 'Volatility 75 Index',
    R_100: 'Volatility 100 Index',
    '1HZ10V': 'Volatility 10 (1s) Index',
    '1HZ25V': 'Volatility 25 (1s) Index',
    '1HZ50V': 'Volatility 50 (1s) Index',
    '1HZ75V': 'Volatility 75 (1s) Index',
    '1HZ100V': 'Volatility 100 (1s) Index',
};
export const SCAN_MARKETS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100'];

export const TYPE_LABEL: Record<TContractType, string> = {
    DIGITOVER: 'Over',
    DIGITUNDER: 'Under',
    DIGITEVEN: 'Even',
    DIGITODD: 'Odd',
    DIGITMATCH: 'Matches',
    DIGITDIFF: 'Differs',
};

export const needsBarrier = (t: TContractType) => ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(t);

/** True chance of winning Over b: the last digit of a synthetic index is uniformly random. */
export const overChance = (b: number) => (9 - b) / 10;
/** Profit per 1 staked before Deriv has quoted: Deriv pays roughly 7% under fair odds. */
export const estRatio = (b: number) => 0.93 / overChance(b) - 1;

export const round2 = (n: number) => Math.round(n * 100) / 100;
const floor2 = (n: number) => Math.floor(n * 100) / 100;

/** Reads saved settings, dropping anything from older versions that no longer fits. */
export const sanitizeSettings = (raw: any): TSettings => {
    const s = { ...DEFAULT_SETTINGS, ...(raw && typeof raw === 'object' ? raw : {}) };
    if (!(s.strategy in STRATEGIES) && s.strategy !== 'custom') s.strategy = 'fixed';
    if (!MARKETS[s.symbol]) s.symbol = DEFAULT_SETTINGS.symbol;
    s.custom = { ...DEFAULT_SETTINGS.custom, ...(raw?.custom || {}) };
    if (s.maxLosses !== null && !(Number.isInteger(s.maxLosses) && s.maxLosses >= 1)) s.maxLosses = null;
    if (!(s.dailyLossPct >= 1 && s.dailyLossPct <= 100)) s.dailyLossPct = DEFAULT_SETTINGS.dailyLossPct;
    if (!['none', 'mult', 'recover', 'target'].includes(s.custom.recMode)) s.custom.recMode = 'none';
    return s;
};

export type TApi = {
    send: (req: Record<string, unknown>) => Promise<any>;
    onMessage: () => { subscribe: (cb: (msg: any) => void) => { unsubscribe: () => void } };
};

export const buildProposal = (
    currency: string,
    symbol: string,
    t: TContractType,
    b: number | null,
    duration: number,
    amount: number
) => {
    const req: Record<string, unknown> = {
        proposal: 1,
        amount: round2(amount),
        basis: 'stake',
        contract_type: t,
        currency,
        duration,
        duration_unit: 't',
        underlying_symbol: symbol,
    };
    if (needsBarrier(t) && b !== null) req.barrier = String(b);
    return req;
};

/** Deriv's live payout for a contract on a market (profit per 1 staked), cached for five minutes. */
export class RatioCache {
    private cache = new Map<string, { r: number; at: number }>();

    known(sym: string, key: string) {
        return this.cache.get(`${sym}|${key}`)?.r ?? null;
    }

    /** Every live payout known for a market, keyed by contract. */
    knownAll(sym: string, keys: string[] = HALF_KEYS): TPayoutRatios {
        const out: TPayoutRatios = {};
        keys.forEach(k => {
            const r = this.known(sym, k);
            if (r !== null) out[k] = r;
        });
        return out;
    }

    note(sym: string, key: string, ask: number, payout: number) {
        if (ask > 0 && payout > ask) this.cache.set(`${sym}|${key}`, { r: (payout - ask) / ask, at: Date.now() });
    }

    async get(api: TApi, currency: string, sym: string, key: string) {
        const c = this.cache.get(`${sym}|${key}`);
        if (c && Date.now() - c.at < 5 * 60 * 1000) return c.r;
        const { type, barrier } = parseKey(key);
        const res = await api.send(buildProposal(currency, sym, type, barrier, 1, 10));
        if (res?.error) throw new Error(res.error.message);
        this.note(sym, key, +res.proposal.ask_price, +res.proposal.payout);
        return this.known(sym, key) ?? estRatioOf(key);
    }
}

export type TPlanResult = {
    hit: number;
    bust: number;
    avg: number;
    bustAvg: number;
    median: number;
    staked?: number;
    contract?: string;
};

/** Session plan for the free fixed-stake strategy. Premium plans are simulated by the server. */
export const simulateFixed = (
    s: TSettings,
    capital: number,
    ratios: TPayoutRatios,
    sessions = 4000,
    maxTrades = 3000
): TPlanResult => {
    const key = bestOf(HALF_KEYS, ratios);
    const p = chanceOf(key);
    const ratio = ratios[key] ?? estRatioOf(key);
    const maxLosses = s.maxLosses ?? FIXED.maxLosses;
    let hit = 0;
    let bust = 0;
    let sum = 0;
    let bustSum = 0;
    let staked = 0;
    const trades: number[] = [];
    for (let k = 0; k < sessions; k++) {
        let pl = 0;
        let streak = 0;
        let n = 0;
        let end = 'open';
        for (; n < maxTrades; n++) {
            if (pl >= s.takeProfit) {
                end = 'tp';
                break;
            }
            if (pl <= -s.stopLoss || streak >= maxLosses) {
                end = 'loss';
                break;
            }
            if (s.maxRuns && n >= s.maxRuns) break;
            const st = floor2(Math.min(s.stake, capital + pl, s.stopLoss + pl));
            if (st < 0.35) {
                end = 'loss';
                break;
            }
            staked += st;
            if (Math.random() < p) {
                pl += st * ratio;
                streak = 0;
            } else {
                pl -= st;
                streak++;
            }
        }
        sum += pl;
        trades.push(n);
        if (end === 'tp') hit++;
        else if (pl < 0) {
            bust++;
            bustSum += pl;
        }
    }
    trades.sort((a, b) => a - b);
    return {
        hit: hit / sessions,
        bust: bust / sessions,
        avg: sum / sessions,
        bustAvg: bust ? bustSum / bust : 0,
        median: trades[trades.length >> 1],
        staked: staked / sessions,
        contract: key,
    };
};

export const validate = (s: TSettings, balance: number) => {
    const bold = s.strategy === 'pegasus' || (s.strategy === 'custom' && s.custom.recMode === 'target');
    if (!bold && !(s.stake >= 0.35)) return 'Minimum stake is 0.35.';
    if (!(s.takeProfit > 0)) return 'Set a take-profit above 0.';
    if (!(s.stopLoss >= 0.35)) return "Set a stop-loss of at least 0.35. KAPA AI won't run without one.";
    if (!bold && s.stake > s.stopLoss) return 'The stake must not be larger than the stop-loss.';
    if (!bold && !(s.maxStake >= s.stake)) return 'Maximum stake must be at least the initial stake.';
    if (!bold && s.stake > balance) return 'Stake is larger than your balance.';
    if (balance > 0 && s.stopLoss > balance * MAX_SESSION_RISK + 0.005)
        return `Your stop-loss is ${Math.round((s.stopLoss / balance) * 100)}% of your balance. KAPA AI risks at most ${MAX_SESSION_RISK * 100}% per session (${(balance * MAX_SESSION_RISK).toFixed(2)}), so one bad session can never empty your account.`;
    return null;
};

// ---------- Daily loss limit (per Deriv account, on this device) ----------
type TDay = { date: string; start: number; pl: number };
const today = () => new Date().toISOString().slice(0, 10);
const dayKey = (loginid: string) => `kapa_day_${loginid}`;
export const readDay = (loginid: string, balance: number): TDay => {
    try {
        const d = JSON.parse(localStorage.getItem(dayKey(loginid)) || 'null');
        if (d?.date === today() && d.start > 0 && Number.isFinite(d.pl)) return d;
    } catch {
        /* storage unavailable: today starts now */
    }
    return { date: today(), start: balance, pl: 0 };
};
export const addDayResult = (loginid: string, balance: number, pl: number) => {
    const d = readDay(loginid, balance);
    d.pl = round2(d.pl + pl);
    try {
        localStorage.setItem(dayKey(loginid), JSON.stringify(d));
    } catch {
        /* the limit then covers this visit only */
    }
};
/** What may still be lost today, or 0 when the day's limit is reached. */
export const dailyRoom = (s: TSettings, loginid: string, balance: number) => {
    const d = readDay(loginid, balance);
    return Math.max(0, round2((d.start * s.dailyLossPct) / 100 + d.pl));
};

export type TStopKind = 'tp' | 'sl' | 'streak' | 'user' | 'runs' | 'error' | 'edge';

/** One order from a strategy. */
export type TOrder = {
    contract_type: TContractType;
    barrier: number | null;
    amount: number;
    symbol: string;
    duration: number;
    recovery: boolean;
    capped?: boolean;
};
export type TDecision = { trade?: TOrder; stop?: TStopKind; reason?: string };
export type TContractResult = { contract_id: number; buy_price: number; profit: number };
/** Deriv's live payouts (profit per 1 staked), keyed by contract ('DIGITEVEN', 'DIGITOVER:4'…). */
export type TPayoutRatios = Record<string, number>;

/** A strategy: says what to trade first, then what to trade after each settled contract. */
export type TPolicy = {
    start: () => Promise<TDecision>;
    next: (result: TContractResult, ratios: TPayoutRatios) => Promise<TDecision>;
};

/** The free fixed-stake strategy, decided here in the browser: same stake, best-paid 50% contract. */
export const fixedPolicy = (s: TSettings, initial: TPayoutRatios): TPolicy => {
    const st = { pl: 0, streak: 0, runs: 0 };
    const ratios: TPayoutRatios = { ...initial };
    const maxLosses = s.maxLosses ?? FIXED.maxLosses;
    const decide = (): TDecision => {
        if (st.pl >= s.takeProfit) return { stop: 'tp', reason: `Take-profit reached: +${st.pl.toFixed(2)}` };
        if (st.pl <= -s.stopLoss) return { stop: 'sl', reason: `Stop-loss reached: ${st.pl.toFixed(2)}` };
        if (st.streak >= maxLosses) return { stop: 'streak', reason: `${st.streak} losses in a row` };
        if (s.maxRuns && st.runs >= s.maxRuns) return { stop: 'runs', reason: `Finished ${st.runs} trades` };
        const amount = floor2(Math.min(s.stake, s.stopLoss + st.pl));
        if (amount < 0.35)
            return { stop: 'sl', reason: 'Not enough room left above the stop-loss for the minimum stake' };
        const { type, barrier } = parseKey(bestOf(HALF_KEYS, ratios));
        return {
            trade: { contract_type: type, barrier, amount, symbol: s.symbol, duration: 1, recovery: false },
        };
    };
    return {
        start: async () => decide(),
        next: async (r, live) => {
            Object.assign(ratios, live);
            st.runs++;
            st.pl = round2(st.pl + r.profit);
            st.streak = r.profit > 0 ? 0 : st.streak + 1;
            return decide();
        },
    };
};

export type TTrade = {
    id: number;
    time: number;
    symbol: string;
    type: TContractType;
    barrier: number | null;
    stake: number;
    payout: number;
    profit: number;
    won: boolean;
    entry?: string;
    exit?: string;
    recovery: boolean;
    longcode?: string;
};

export type TLiveContract = {
    id: number;
    symbol: string;
    type: TContractType;
    barrier: number | null;
    stake: number;
    bid?: number;
    potential?: number;
    profit?: number;
    ticks: number;
    tickNow: number;
    open: boolean;
    won?: boolean;
};

export type TPhase = 'idle' | 'starting' | 'buying' | 'bought' | 'won' | 'lost';

export type TEngineEvents = {
    onStatus: (text: string, phase: TPhase) => void;
    onContract: (c: TLiveContract) => void;
    onTrade: (t: TTrade, sessionPl: number) => void;
    onLog: (text: string, level: 'info' | 'success' | 'warn' | 'error') => void;
    onStop: (reason: string, kind: TStopKind, sessionPl: number) => void;
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const ALLOWED_TYPES: TContractType[] = ['DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD', 'DIGITMATCH', 'DIGITDIFF'];

/** Runs one session: asks the strategy for each trade until it says stop, an error occurs or the user presses Stop. */
export class KapaEngine {
    running = false;
    private stopRequested = false;
    private sessionPl = 0;

    constructor(
        private api: TApi,
        private currency: () => string,
        private balance: () => number,
        private ev: TEngineEvents
    ) {}

    requestStop() {
        this.stopRequested = true;
    }

    async run(
        policy: TPolicy,
        opts: { name: string; delay: number; stake: number; takeProfit: number; stopLoss: number; symbol: string }
    ) {
        if (this.running) return;
        Object.assign(this, { running: true, stopRequested: false, sessionPl: 0 });
        this.ev.onStatus('Bot is starting', 'starting');
        this.ev.onLog(
            `KAPA AI started · ${opts.name} on ${opts.symbol} · stake ${opts.stake} · take-profit ${opts.takeProfit} · stop-loss ${opts.stopLoss}`,
            'success'
        );
        const stop = (reason: string, kind: TStopKind) => {
            this.running = false;
            this.ev.onLog(`Stopped: ${reason}`, kind === 'tp' ? 'success' : 'warn');
            this.ev.onStop(reason, kind, this.sessionPl);
        };
        let d: TDecision;
        try {
            d = await policy.start();
        } catch (e: any) {
            return stop(e?.message ?? String(e), 'error');
        }
        while (this.running) {
            if (this.stopRequested) return stop('Stopped by you', 'user');
            if (d.stop || !d.trade) return stop(d.reason || 'Session finished', d.stop || 'runs');
            const o = d.trade;
            if (
                !ALLOWED_TYPES.includes(o.contract_type) ||
                (needsBarrier(o.contract_type) && !(Number.isInteger(o.barrier) && o.barrier! >= 0 && o.barrier! <= 9)) ||
                !MARKETS[o.symbol] ||
                !(o.duration >= 1 && o.duration <= 10)
            )
                return stop('Unexpected order from the strategy', 'error');
            try {
                // Never stake more than the balance, whatever the strategy asks
                const amount = floor2(Math.min(o.amount, this.balance()));
                if (amount < 0.35) return stop('Balance too low for the next stake', 'sl');
                if (o.capped)
                    this.ev.onLog(`Recovery stake capped at ${amount} by the maximum stake or the stop-loss`, 'warn');
                this.ev.onStatus(
                    o.recovery ? `Recovery · ${contractLabel(o.contract_type, o.barrier)}` : 'Buying contract',
                    'buying'
                );
                const prop = await this.api.send(
                    buildProposal(this.currency(), o.symbol, o.contract_type, o.barrier, o.duration, amount)
                );
                if (prop?.error) throw new Error(prop.error.message);
                const ask = +prop.proposal.ask_price;
                const ratio = ask > 0 ? (+prop.proposal.payout - ask) / ask : undefined;
                const buyRes = await this.api.send({ buy: prop.proposal.id, price: prop.proposal.ask_price });
                if (buyRes?.error) throw new Error(buyRes.error.message);
                const c = buyRes.buy;
                this.ev.onLog(`Bought #${c.contract_id} for ${c.buy_price}: ${c.longcode ?? ''}`, 'info');
                this.ev.onStatus('Contract bought', 'bought');
                const live: TLiveContract = {
                    id: c.contract_id,
                    symbol: o.symbol,
                    type: o.contract_type,
                    barrier: o.barrier,
                    stake: +c.buy_price,
                    potential: +c.payout,
                    ticks: o.duration,
                    tickNow: 0,
                    open: true,
                };
                this.ev.onContract(live);
                const poc = await this.settle(c.contract_id, live);
                const profit = this.record(o, c, poc);
                if (this.running && opts.delay) await sleep(opts.delay * 1000);
                d = await policy.next(
                    { contract_id: c.contract_id, buy_price: +poc.buy_price, profit },
                    ratio ? { [contractKey(o.contract_type, o.barrier)]: ratio } : {}
                );
            } catch (e: any) {
                this.ev.onLog(`Trade error: ${e?.message ?? e}`, 'error');
                return stop(`Error: ${e?.message ?? e}`, 'error');
            }
        }
    }

    private settle(contractId: number, live: TLiveContract): Promise<any> {
        return new Promise((resolve, reject) => {
            let done = false;
            let subId: string | null = null;
            const finish = (poc: any) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                sub.unsubscribe();
                if (subId) this.api.send({ forget: subId }).catch(() => {});
                resolve(poc);
            };
            const handle = (raw: any) => {
                const msg = raw?.data ?? raw;
                const poc = msg?.proposal_open_contract;
                if (done || !poc || poc.contract_id !== contractId) return;
                if (msg.subscription?.id) subId = msg.subscription.id;
                if (poc.is_sold) return finish(poc);
                this.ev.onContract({
                    ...live,
                    bid: poc.bid_price != null ? +poc.bid_price : undefined,
                    potential: poc.payout != null ? +poc.payout : live.potential,
                    profit: poc.profit != null ? +poc.profit : undefined,
                    tickNow: (poc.tick_stream || []).length,
                });
            };
            const sub = this.api.onMessage().subscribe(handle);
            // A tick contract settles within seconds; give up after two minutes and point to Deriv's reports
            const timer = setTimeout(() => {
                if (done) return;
                done = true;
                sub.unsubscribe();
                reject(new Error('No result for the open contract. Check Reports on Deriv.'));
            }, 120000);
            this.api
                .send({ proposal_open_contract: 1, contract_id: contractId, subscribe: 1 })
                .then((first: any) => {
                    if (first?.error) {
                        if (!done) {
                            done = true;
                            clearTimeout(timer);
                            sub.unsubscribe();
                            reject(new Error(first.error.message));
                        }
                        return;
                    }
                    handle(first);
                })
                .catch((e: any) => {
                    if (!done) {
                        done = true;
                        clearTimeout(timer);
                        sub.unsubscribe();
                        reject(e);
                    }
                });
        });
    }

    private record(o: TOrder, c: any, poc: any) {
        const profit = +poc.profit;
        const won = profit > 0;
        const stake = +poc.buy_price;
        this.sessionPl = round2(this.sessionPl + profit);
        const t: TTrade = {
            id: c.contract_id,
            time: (poc.sell_time || Date.now() / 1000) * 1000,
            symbol: o.symbol,
            type: o.contract_type,
            barrier: o.barrier,
            stake,
            payout: +(poc.sell_price ?? 0),
            profit,
            won,
            entry: poc.entry_tick_display_value ?? poc.entry_spot_display_value,
            exit: poc.exit_tick_display_value ?? poc.exit_spot_display_value,
            recovery: o.recovery,
            longcode: c.longcode,
        };
        this.ev.onContract({
            id: t.id,
            symbol: o.symbol,
            type: o.contract_type,
            barrier: o.barrier,
            stake,
            bid: t.payout,
            potential: +(poc.payout ?? t.payout),
            profit,
            ticks: o.duration,
            tickNow: o.duration,
            open: false,
            won,
        });
        this.ev.onTrade(t, this.sessionPl);
        this.ev.onLog(
            `${won ? 'Won' : 'Lost'} #${t.id}: ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} · session ${this.sessionPl.toFixed(2)}`,
            won ? 'success' : 'error'
        );
        this.ev.onStatus(won ? 'Won' : 'Lost', won ? 'won' : 'lost');
        return profit;
    }
}
