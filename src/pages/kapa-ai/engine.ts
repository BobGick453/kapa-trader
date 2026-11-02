/**
 * KAPA AI trading engine: digit-contract strategies with optional recovery,
 * a Monte Carlo session plan, and a trade loop with hard risk limits.
 * UI-free; it talks to Deriv through the app's authorized api_base connection.
 */

export type TContractType = 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD' | 'DIGITMATCH' | 'DIGITDIFF';
export type TRecoveryMode = 'none' | 'mult' | 'recover';

export type TSettings = {
    symbol: string;
    ctype: TContractType;
    barrier: number;
    recovery: number | 'same';
    recMode: TRecoveryMode;
    martingale: number;
    duration: number;
    stake: number;
    maxStake: number;
    takeProfit: number;
    stopLoss: number;
    maxLosses: number;
    maxRuns: number;
    delay: number;
};

export type TPresetKey = 'pegasus' | 'martingale' | 'recover' | 'fixed';

export const PRESETS: Record<TPresetKey, { label: string } & Pick<TSettings, 'ctype' | 'barrier' | 'recovery' | 'recMode' | 'martingale' | 'maxLosses'>> = {
    pegasus: { label: 'Over 1 · recovery ×2.2 on Over 5', ctype: 'DIGITOVER', barrier: 1, recovery: 5, recMode: 'mult', martingale: 2.2, maxLosses: 4 },
    martingale: { label: 'Over 2 · recovery ×2.2 on Over 4', ctype: 'DIGITOVER', barrier: 2, recovery: 4, recMode: 'mult', martingale: 2.2, maxLosses: 5 },
    recover: { label: 'Over 1 · recovery on Over 5, sized to win back losses', ctype: 'DIGITOVER', barrier: 1, recovery: 5, recMode: 'recover', martingale: 1, maxLosses: 4 },
    fixed: { label: 'Over 1 · fixed stake, no recovery', ctype: 'DIGITOVER', barrier: 1, recovery: 'same', recMode: 'none', martingale: 1, maxLosses: 3 },
};

export const DEFAULT_SETTINGS: TSettings = {
    symbol: 'R_100',
    ...PRESETS.pegasus,
    duration: 1,
    stake: 1,
    maxStake: 50,
    takeProfit: 10,
    stopLoss: 50,
    maxRuns: 0,
    delay: 1,
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

export const TYPE_LABEL: Record<TContractType, string> = {
    DIGITOVER: 'Over',
    DIGITUNDER: 'Under',
    DIGITEVEN: 'Even',
    DIGITODD: 'Odd',
    DIGITMATCH: 'Matches',
    DIGITDIFF: 'Differs',
};

// Decimal places per market, for reading last digits when a response omits pip_size
export const PIP_SIZES: Record<string, number> = { R_10: 3, R_25: 3, R_50: 4, R_75: 4, R_100: 2 };

export const needsBarrier = (t: TContractType) => ['DIGITOVER', 'DIGITUNDER', 'DIGITMATCH', 'DIGITDIFF'].includes(t);
export const recoveryBarrier = (s: Pick<TSettings, 'barrier' | 'recovery'>) => (s.recovery === 'same' ? s.barrier : s.recovery);

/** True chance of winning: the last digit of a synthetic index is uniformly random. */
export const winProb = (t: TContractType, b: number) => {
    switch (t) {
        case 'DIGITOVER':
            return (9 - b) / 10;
        case 'DIGITUNDER':
            return b / 10;
        case 'DIGITMATCH':
            return 0.1;
        case 'DIGITDIFF':
            return 0.9;
        default:
            return 0.5;
    }
};

/** Profit per 1 staked before Deriv has quoted the contract: Deriv pays roughly 7% under fair odds. */
export const estRatio = (t: TContractType, b: number) => 0.93 / winProb(t, b) - 1;

export const round2 = (n: number) => Math.round(n * 100) / 100;
const floor2 = (n: number) => Math.floor(n * 100) / 100;

export type TApi = {
    send: (req: Record<string, unknown>) => Promise<any>;
    onMessage: () => { subscribe: (cb: (msg: any) => void) => { unsubscribe: () => void } };
};

export const buildProposal = (currency: string, symbol: string, t: TContractType, b: number, duration: number, amount: number) => {
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
    if (needsBarrier(t)) req.barrier = String(b);
    return req;
};

/** Live profit-per-stake ratios quoted by Deriv, cached for five minutes. */
export class RatioCache {
    private cache = new Map<string, { r: number; at: number }>();
    private key = (sym: string, t: TContractType, b: number, d: number) => `${sym}|${t}|${needsBarrier(t) ? b : ''}|${d}`;

    note(sym: string, t: TContractType, b: number, d: number, ask: number, payout: number) {
        if (ask > 0 && payout > ask) this.cache.set(this.key(sym, t, b, d), { r: (payout - ask) / ask, at: Date.now() });
    }

    known(sym: string, t: TContractType, b: number, d: number) {
        return this.cache.get(this.key(sym, t, b, d))?.r ?? null;
    }

    async get(api: TApi, currency: string, sym: string, t: TContractType, b: number, d: number) {
        const c = this.cache.get(this.key(sym, t, b, d));
        if (c && Date.now() - c.at < 5 * 60 * 1000) return c.r;
        const res = await api.send(buildProposal(currency, sym, t, b, d, 10));
        if (res?.error) throw new Error(res.error.message);
        this.note(sym, t, b, d, +res.proposal.ask_price, +res.proposal.payout);
        return this.known(sym, t, b, d) ?? estRatio(t, b);
    }
}

export type TPlanResult = { hit: number; bust: number; avg: number; bustAvg: number; median: number };

/** Simulates many sessions of the given settings with true win chances and the given payout ratios. */
export const simulate = (
    s: TSettings,
    capital: number,
    baseR: number,
    recR: number,
    sessions = 4000,
    maxTrades = 3000
): TPlanResult => {
    const baseP = winProb(s.ctype, s.barrier);
    const recP = winProb(s.ctype, recoveryBarrier(s));
    let hit = 0;
    let bust = 0;
    let sum = 0;
    let bustSum = 0;
    const trades: number[] = [];
    for (let k = 0; k < sessions; k++) {
        let pl = 0;
        let streak = 0;
        let lost = 0;
        let stake = s.stake;
        let n = 0;
        let end = 'open';
        for (; n < maxTrades; n++) {
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
        sum += pl;
        trades.push(n);
        if (end === 'tp') hit++;
        else if (end === 'loss' && pl < 0) {
            bust++;
            bustSum += pl;
        }
    }
    trades.sort((a, b) => a - b);
    return { hit: hit / sessions, bust: bust / sessions, avg: sum / sessions, bustAvg: bust ? bustSum / bust : 0, median: trades[trades.length >> 1] };
};

export const validate = (s: TSettings, balance: number) => {
    if (!(s.stake >= 0.35)) return 'Minimum stake is 0.35.';
    if (!(s.takeProfit > 0)) return 'Set a take-profit above 0.';
    if (!(s.stopLoss > 0)) return "Set a stop-loss above 0. KAPA AI won't run without one.";
    if (!(s.maxStake >= s.stake)) return 'Maximum stake must be at least the initial stake.';
    if (s.stake > balance) return 'Stake is larger than your balance.';
    return null;
};

export type TTrade = {
    id: number;
    time: number;
    symbol: string;
    type: TContractType;
    barrier: number;
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
    barrier: number;
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
export type TStopKind = 'tp' | 'sl' | 'streak' | 'user' | 'runs' | 'error';

export type TEngineEvents = {
    onStatus: (text: string, phase: TPhase) => void;
    onContract: (c: TLiveContract) => void;
    onTrade: (t: TTrade, sessionPl: number) => void;
    onLog: (text: string, level: 'info' | 'success' | 'warn' | 'error') => void;
    onStop: (reason: string, kind: TStopKind, sessionPl: number) => void;
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Runs one session: buys contracts until take-profit, stop-loss, loss streak, max trades, an error or Stop. */
export class KapaEngine {
    running = false;
    private stopRequested = false;
    private sessionPl = 0;
    private lossStreak = 0;
    private recLosses = 0;
    private nextStake = 0;
    private runs = 0;

    constructor(
        private api: TApi,
        private currency: () => string,
        private balance: () => number,
        private ratios: RatioCache,
        private ev: TEngineEvents
    ) {}

    requestStop() {
        this.stopRequested = true;
    }

    async run(s: TSettings) {
        if (this.running) return;
        Object.assign(this, { running: true, stopRequested: false, sessionPl: 0, lossStreak: 0, recLosses: 0, nextStake: s.stake, runs: 0 });
        this.ev.onStatus('Bot is starting', 'starting');
        this.ev.onLog(
            `KAPA AI started · ${TYPE_LABEL[s.ctype]} ${s.barrier} on ${s.symbol} · stake ${s.stake} · take-profit ${s.takeProfit} · stop-loss ${s.stopLoss}`,
            'success'
        );
        await sleep(300);
        const stop = (reason: string, kind: TStopKind) => {
            this.running = false;
            this.ev.onLog(`Stopped: ${reason}`, kind === 'tp' ? 'success' : 'warn');
            this.ev.onStop(reason, kind, this.sessionPl);
        };
        while (this.running) {
            if (this.stopRequested) return stop('Stopped by you', 'user');
            if (this.sessionPl >= s.takeProfit) return stop(`Take-profit reached: +${this.sessionPl.toFixed(2)}`, 'tp');
            if (this.sessionPl <= -s.stopLoss) return stop(`Stop-loss hit: ${this.sessionPl.toFixed(2)}`, 'sl');
            if (this.lossStreak >= s.maxLosses) return stop(`${this.lossStreak} losses in a row`, 'streak');
            if (s.maxRuns && this.runs >= s.maxRuns) return stop(`Finished ${this.runs} trades`, 'runs');

            const recovering = this.lossStreak > 0 && s.recMode !== 'none';
            const barrier = recovering ? recoveryBarrier(s) : s.barrier;
            try {
                let want = this.nextStake;
                if (recovering && s.recMode === 'recover') {
                    // One win on the recovery contract returns everything lost since the last win, plus one normal win
                    const recR = await this.ratios.get(this.api, this.currency(), s.symbol, s.ctype, barrier, s.duration);
                    const baseR = this.ratios.known(s.symbol, s.ctype, s.barrier, s.duration) ?? estRatio(s.ctype, s.barrier);
                    want = Math.ceil(((this.recLosses + s.stake * baseR) / recR) * 100) / 100;
                }
                // Never stake more than the cap, the balance, or what's left before the stop-loss
                const stake = floor2(Math.min(want, s.maxStake, this.balance(), s.stopLoss + this.sessionPl));
                if (stake < 0.35) return stop('Not enough room left under the stop-loss for the minimum stake', 'sl');
                if (stake < want - 0.01) this.ev.onLog(`Recovery stake capped at ${stake} (wanted ${want}) by maximum stake, balance or stop-loss`, 'warn');

                this.ev.onStatus(recovering ? `Recovery · ${TYPE_LABEL[s.ctype]} ${barrier}` : 'Buying contract', 'buying');
                const prop = await this.api.send(buildProposal(this.currency(), s.symbol, s.ctype, barrier, s.duration, stake));
                if (prop?.error) throw new Error(prop.error.message);
                this.ratios.note(s.symbol, s.ctype, barrier, s.duration, +prop.proposal.ask_price, +prop.proposal.payout);
                const buyRes = await this.api.send({ buy: prop.proposal.id, price: prop.proposal.ask_price });
                if (buyRes?.error) throw new Error(buyRes.error.message);
                const c = buyRes.buy;
                this.ev.onLog(`Bought #${c.contract_id} for ${c.buy_price}: ${c.longcode ?? ''}`, 'info');
                this.ev.onStatus('Contract bought', 'bought');
                const live: TLiveContract = { id: c.contract_id, symbol: s.symbol, type: s.ctype, barrier, stake: +c.buy_price, potential: +c.payout, ticks: s.duration, tickNow: 0, open: true };
                this.ev.onContract(live);
                const poc = await this.settle(c.contract_id, live);
                this.record(s, c, poc, barrier, recovering);
            } catch (e: any) {
                this.ev.onLog(`Trade error: ${e?.message ?? e}`, 'error');
                return stop(`Error: ${e?.message ?? e}`, 'error');
            }
            if (this.running && s.delay) await sleep(s.delay * 1000);
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

    private record(s: TSettings, c: any, poc: any, barrier: number, recovery: boolean) {
        const profit = +poc.profit;
        const won = profit > 0;
        const stake = +poc.buy_price;
        this.runs++;
        this.sessionPl = round2(this.sessionPl + profit);
        if (won) {
            this.lossStreak = 0;
            this.recLosses = 0;
            this.nextStake = s.stake;
        } else {
            this.lossStreak++;
            this.recLosses = round2(this.recLosses - profit);
            this.nextStake = s.recMode === 'mult' ? stake * s.martingale : s.stake;
        }
        const t: TTrade = {
            id: c.contract_id,
            time: (poc.sell_time || Date.now() / 1000) * 1000,
            symbol: s.symbol,
            type: s.ctype,
            barrier,
            stake,
            payout: +(poc.sell_price ?? 0),
            profit,
            won,
            entry: poc.entry_tick_display_value ?? poc.entry_spot_display_value,
            exit: poc.exit_tick_display_value ?? poc.exit_spot_display_value,
            recovery,
            longcode: c.longcode,
        };
        this.ev.onContract({ id: t.id, symbol: s.symbol, type: s.ctype, barrier, stake, bid: t.payout, potential: +(poc.payout ?? t.payout), profit, ticks: s.duration, tickNow: s.duration, open: false, won });
        this.ev.onTrade(t, this.sessionPl);
        this.ev.onLog(`${won ? 'Won' : 'Lost'} #${t.id}: ${profit >= 0 ? '+' : ''}${profit.toFixed(2)} · session ${this.sessionPl.toFixed(2)}`, won ? 'success' : 'error');
        this.ev.onStatus(won ? 'Won' : 'Lost', won ? 'won' : 'lost');
    }
}
