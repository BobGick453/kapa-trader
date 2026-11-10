// The 4 Free Bots replayed on the 300,000 real ticks: the reference bots exactly as their XML runs, and Kapa's
// improved XML (src/pages/free-bot/xml/*.xml) with the same rules as its blocks. Usage:
//   node qa/real/freebots-bt.mjs            → table: original vs improved, public price and marked-up price
//   node qa/real/freebots-bt.mjs --sweep    → also the improved bots under other settings
// Price model: each contract pays round2(stake × payout/ask of Deriv's real quote at stake 10). "Marked-up"
// pays 5.5% less (what a demo account received through an app with a markup, see STRATEGIES.md).
// One session = one Run of the bot in Bot Builder: it starts flat and ends when the bot stops (take-profit,
// stop-loss or its own guard). Sessions follow each other on each of the 10 tick series.
import fs from 'fs';

const d = JSON.parse(fs.readFileSync(new URL('./real-2026-11-04.json', import.meta.url)));
const PUB = Object.fromEntries(
    Object.entries(d.quotes.R_100)
        .filter(([x]) => x.endsWith('|10|1'))
        .map(([x, v]) => [x.split('|')[0], v.payout / v.ask])
);
const MARK = Object.fromEntries(Object.entries(PUB).map(([x, m]) => [x, m * 0.945]));
const SERIES = Object.values(d.ticks).map(t => [...t.digits].map(Number));
const r2 = x => Math.round((x + 1e-9) * 100) / 100;
const fl2 = x => Math.floor((x + 1e-9) * 100) / 100;
const win = (k, x) => {
    const [t, b] = k.split(':');
    if (t === 'DIGITEVEN') return x % 2 === 0;
    if (t === 'DIGITODD') return x % 2 === 1;
    return t === 'DIGITOVER' ? x > +b : x < +b;
};

/* ---------------- reference bots, as their XML runs ---------------- */

// Digit Switcher Bot / GOLD PREMIUM ODD AND EVEN share the "Daily Profit's System" money management:
// Profit tracked by the bot; after a loss, from loss #MartiStart, Stake += Stake × Factor while
// LossCount ≤ Level, then back to the first stake; stop when Profit ≥ TP or Profit ≤ −SL (checked after a trade).
class DailyProfitMM {
    constructor(o) { Object.assign(this, o); this.stake = o.first; this.lc = 0; this.pl = 0; this.done = null; }
    result(won, profit) {
        this.pl = r2(this.pl + profit);
        if (won) { this.lc = 0; this.stake = this.first; }
        else {
            this.lc++;
            if (this.level > 0 && this.start > 0 && this.lc >= this.start) {
                if (this.lc <= this.level) this.stake = this.stake + this.stake * this.factor;
                else this.stake = this.first;
            }
        }
        if (this.pl >= this.tp) this.done = 'tp';
        else if (this.pl <= -this.sl) this.done = 'sl';
    }
}
// Digit Switcher entry: Under 5 after an even digit; from 2 losses in a row it buys Over 5 (losses 2-5) or
// Under 5 (6-9+) on the parity the table asks for, and its last line buys Under 5 after any even digit.
const switcherOrder = (h, lc) => {
    if (!h.length) return null;
    const ev = h[h.length - 1] % 2 === 0;
    const table = [[8, false, 'DIGITUNDER:5'], [7, true, 'DIGITUNDER:5'], [6, false, 'DIGITUNDER:5'], [5, true, 'DIGITUNDER:5'],
        [4, false, 'DIGITOVER:5'], [3, true, 'DIGITOVER:5'], [2, false, 'DIGITOVER:5'], [1, true, 'DIGITOVER:5']];
    for (const [n, par, k] of table) if (lc > n && ev === par) return k;
    return ev ? 'DIGITUNDER:5' : null;
};
// Gold entry: at least Min% of the last Period digits share a parity and the last digit has it (follow).
const goldOrder = (h, period = 5, minPct = 80) => {
    if (h.length < period) return null;
    const even = h.slice(-period).filter(x => x % 2 === 0).length;
    const ePct = Math.round((even * 100) / period * 100) / 100, oPct = Math.round(((period - even) * 100) / period * 100) / 100;
    const last = h[h.length - 1];
    if (ePct >= minPct && last % 2 === 0) return 'DIGITEVEN';
    if (oPct >= minPct && last % 2 === 1) return 'DIGITODD';
    return null;
};
class RefSwitcher extends DailyProfitMM {
    constructor() { super({ tp: 10, sl: 1000, first: 1, factor: 1.1, level: 12, start: 2 }); }
    order(h) { const k = switcherOrder(h, this.lc); return k && [k, this.stake]; }
}
class RefGold extends DailyProfitMM {
    constructor() { super({ tp: 1000, sl: 1000, first: 1, factor: 1.2, level: 10, start: 1 }); }
    order(h) { const k = goldOrder(h); return k && [k, this.stake]; }
}
// Profit Maker Bot: Over 2; after a loss Over 4 with the lost stake × 2.2, no level cap. Its limits read
// Bot Builder's total profit: take-profit 5 checked after a win, stop-loss 1000 checked after a loss.
class RefProfitMaker {
    constructor() { this.stake = 1; this.loss = 0; this.pl = 0; this.done = null; }
    order() { return [this.loss === 0 ? 'DIGITOVER:2' : 'DIGITOVER:4', this.stake]; }
    result(won, profit) {
        this.pl = r2(this.pl + profit);
        if (won) { this.stake = 1; this.loss = 0; if (this.pl >= 5) this.done = 'tp'; }
        else { this.loss++; this.stake = Math.abs(profit) * 2.2; if (this.pl < 0 && -this.pl >= 1000) this.done = 'sl'; }
    }
}
// Dollar Printer: waits until ≥90% of the last 15 digits are above 0, then (the flag is never cleared) buys on
// every tick: Over 0, and after a loss Over 5 until a win. Stake after a loss = Total Lost × 100/80; it keeps
// that stake after a win that leaves Total Lost above 0. Take-profit 10 on Bot Builder's total profit, no stop-loss.
class RefPrinter {
    constructor() { this.s1 = true; this.tl = 0; this.cl = 0; this.stake = 1; this.armed = false; this.pl = 0; this.done = null; }
    order(h) {
        if (h.length < 15) return null;
        if (!this.armed) {
            const w = h.slice(-15), p1 = (w.filter(x => x > 0).length * 100) / 15, p5 = (w.filter(x => x > 5).length * 100) / 15;
            if ((this.s1 && p1 >= 90) || (!this.s1 && p5 >= 40)) this.armed = true;
        }
        return this.armed ? [this.s1 ? 'DIGITOVER:0' : 'DIGITOVER:5', Math.max(0.35, this.stake)] : null;
    }
    result(won, profit, amount) {
        this.pl = r2(this.pl + profit);
        if (!won) { this.tl += amount; if (this.cl > 0) this.cl = 0; if (this.s1) this.s1 = false; }
        else { this.tl -= profit; if (this.tl < 0) this.tl = 0; if (!this.s1) this.s1 = true; }
        if (this.tl > 0) { this.cl++; if (this.cl === 1) this.stake = (this.tl * (100 / 80)) / 1; }
        else { this.cl = 0; this.stake = 0.35; }
        if (this.stake < 1) this.stake = 1;
        if (this.pl >= 10) this.done = 'tp';
    }
}

/* ---------------- Kapa's improved XML, block for block ---------------- */

// Kapa guard (every improved bot): the bot counts its own profit (one Run = one session). The stop-loss is capped
// at 25% of the balance (not binding here: 25% of the 10,000 demo balance is above every stop-loss tested). Before each trade the next stake is rounded to cents; a stake above Max Stake or above
// the room left before the stop-loss (Stop Loss + Profit) is never placed: the cycle is over, so the bot goes back
// to the first stake if that fits, else it stops. The martingale level is cut to the losses whose stakes fit,
// all together, under the stop-loss and Max Stake. So a session never ends below −Stop Loss.
const fitLevel = (first, factor, start, level, sl, maxStake) => {
    // longest losing run whose stakes, added up, fit under the stop-loss, none above Max Stake
    let s = first, cum = first, n = 0;
    if (start <= 0) return 0;
    while (n < level) {
        const next = n + 1 >= start ? r2(s + s * factor) : s;
        if (cum + next > sl + 1e-9 || next > maxStake + 1e-9) break;
        cum = r2(cum + next); s = next; n++;
    }
    return n;
};
class KapaGuard {
    constructor(o) {
        Object.assign(this, o);
        this.first = Math.max(0.35, o.first); this.stake = this.first; this.pl = 0; this.done = null;
        this.maxStake = Math.max(this.first, Math.min(Math.abs(o.maxStake), o.sl));
    }
    room() { return r2(this.sl + this.pl); }
    // the stake the bot will place next, or null when it must stop
    guard(next) {
        next = r2(next);
        if (next < 0.35) next = 0.35;
        if (next > this.maxStake || next > this.room()) { this.resetCycle(); next = this.first; }
        if (next > this.room()) { this.done = 'sl'; return null; }
        return next;
    }
    checkEnd() {
        if (this.pl >= this.tp) this.done = 'tp';
        else if (this.room() < 0.35) this.done = 'sl';
    }
}
class KapaDailyProfit extends KapaGuard {
    constructor(o) { super(o); this.lc = 0; this.level = fitLevel(this.first, o.factor, o.start, o.level, o.sl, this.maxStake); }
    resetCycle() {} // the loss count keeps counting (the entry rule reads it); the stake restarts
    result(won, profit) {
        this.pl = r2(this.pl + profit);
        let next = this.stake;
        if (won) { this.lc = 0; next = this.first; }
        else {
            this.lc++;
            if (this.start > 0 && this.lc >= this.start) next = this.lc <= this.level ? this.stake + this.stake * this.factor : this.first;
        }
        this.checkEnd();
        if (!this.done) { const s = this.guard(next); if (s !== null) this.stake = s; }
    }
}
const DEF = {
    switcher: { tp: 10, sl: 50, first: 1, factor: 1.1, level: 12, start: 2, maxStake: 25 },
    gold: { tp: 10, sl: 50, first: 1, factor: 1.2, level: 10, start: 1, maxStake: 25, period: 5, minPct: 80 },
    profitmaker: { tp: 5, sl: 50, first: 1, factor: 2.2, level: 10, start: 1, maxStake: 25 },
    printer: { tp: 10, sl: 50, first: 1, p1: 0, p2: 5, ticks: 15, splits: 1, winPct: 80, level: 5, maxStake: 25 },
};
class KapaSwitcher extends KapaDailyProfit {
    constructor(o = {}) { super({ ...DEF.switcher, ...o }); }
    order(h) { const k = switcherOrder(h, this.lc); return k && [k, this.stake]; }
}
class KapaGold extends KapaDailyProfit {
    constructor(o = {}) { super({ ...DEF.gold, ...o }); }
    order(h) { const k = goldOrder(h, this.period, this.minPct); return k && [k, this.stake]; }
}
// Profit Maker: Over 2 (Prediction Number), after a loss Over 4 with the lost stake × Martingale Factor, the
// cycle cut to the losses that fit; the bot counts its own profit instead of Bot Builder's running total.
class KapaProfitMaker extends KapaGuard {
    constructor(o = {}) { super({ ...DEF.profitmaker, ...o }); this.loss = 0; this.level = fitLevel(this.first, this.factor - 1, 1, this.level, this.sl, this.maxStake); }
    resetCycle() {}
    order() { return [this.loss === 0 ? `DIGITOVER:${this.pred ?? 2}` : 'DIGITOVER:4', this.stake]; }
    result(won, profit, amount) {
        this.pl = r2(this.pl + profit);
        let next;
        if (won) { this.loss = 0; next = this.first; }
        else { this.loss++; next = this.loss <= this.level ? amount * this.factor : this.first; }
        this.checkEnd();
        if (!this.done) { const s = this.guard(next); if (s !== null) this.stake = s; }
    }
}
// Dollar Printer: Over 0 when ≥90% of the last 15 digits are above 0, checked before every trade; after a loss
// Over 5 when ≥40% of them are above 5. Stake after a loss = Total Lost × (100 / % Win Per Stake) / Mart Splits,
// at most Martingale Level recovery trades in a row, then the loss is accepted and the cycle restarts.
class KapaPrinter extends KapaGuard {
    constructor(o = {}) {
        super({ ...DEF.printer, ...o }); this.s1 = true; this.tl = 0; this.rec = 0;
        // recovery trades whose stakes, with the first one, fit under the stop-loss and Max Stake
        let cum = this.first, n = 0;
        while (n < this.level) {
            const next = Math.max(this.first, r2((cum * (100 / this.winPct)) / this.splits));
            if (cum + next > this.sl + 1e-9 || next > this.maxStake + 1e-9) break;
            cum = r2(cum + next); n++;
        }
        this.level = n;
    }
    resetCycle() { this.tl = 0; this.rec = 0; this.s1 = true; }
    order(h) {
        if (h.length < this.ticks) return null;
        const w = h.slice(-this.ticks), p = this.s1 ? this.p1 : this.p2;
        const pct = (w.filter(x => x > p).length * 100) / this.ticks;
        return pct >= (9 - p) * 10 ? [`DIGITOVER:${p}`, this.stake] : null;
    }
    result(won, profit, amount) {
        this.pl = r2(this.pl + profit);
        if (!won) { this.tl = r2(this.tl + amount); this.s1 = false; this.rec++; }
        else { this.tl = Math.max(0, r2(this.tl - profit)); if (this.tl === 0) { this.s1 = true; this.rec = 0; } }
        let next = this.tl > 0 ? (this.tl * (100 / this.winPct)) / this.splits : this.first;
        if (this.rec > this.level) { this.resetCycle(); next = this.first; }
        if (next < this.first) next = this.first;
        this.checkEnd();
        if (!this.done) { const s = this.guard(next); if (s !== null) this.stake = s; }
    }
}

/* ---------------- runner ---------------- */

export const run = (make, R, { cap = 10000 } = {}) => {
    let ses = 0, tp = 0, net = 0, worst = 0, maxStake = 0, busts = 0, trades = 0, overSL = 0;
    for (const D of SERIES) {
        let b = make();
        for (let i = 0; i < D.length; i++) {
            if (b.done || b.pl <= -cap) {
                ses++; net += b.pl; worst = Math.min(worst, b.pl); tp += b.done === 'tp'; busts += b.pl <= -cap;
                if (b.sl && b.pl < -b.sl - 1e-9) overSL++;
                b = make();
            }
            const o = b.order(D.slice(Math.max(0, i - 30), i));
            if (!o) continue;
            const [k, s] = o, a = Math.min(r2(s), r2(cap + b.pl));
            maxStake = Math.max(maxStake, a); trades++;
            const w = win(k, D[i]);
            b.result(w, w ? r2(r2(a * R[k]) - a) : -a, a);
        }
    }
    return { ses, tp: tp / ses, avg: net / ses, worst, maxStake, busts, trades: trades / ses, overSL };
};

const fmt = (name, pn, r) =>
    `${name.padEnd(34)} ${pn.padEnd(10)} sessions ${String(r.ses).padStart(6)}  target ${(r.tp * 100).toFixed(1).padStart(5)}%  avg ${r.avg.toFixed(2).padStart(8)}  worst ${r.worst.toFixed(0).padStart(7)}  biggest stake ${r.maxStake.toFixed(0).padStart(5)}  trades/session ${r.trades.toFixed(0).padStart(4)}${r.busts ? `  account emptied ${r.busts}` : ''}${r.overSL ? `  past stop-loss ${r.overSL}` : ''}`;

if (import.meta.url === `file://${process.argv[1]}`) {
    const rows = [
        ['Digit Switcher Bot (reference)', () => new RefSwitcher()],
        ['Digit Switcher Bot (Kapa)', () => new KapaSwitcher()],
        ['Dollar Printer (reference)', () => new RefPrinter()],
        ['Dollar Printer (Kapa)', () => new KapaPrinter()],
        ['Gold Premium Odd/Even (reference)', () => new RefGold()],
        ['Gold Premium Odd/Even (Kapa)', () => new KapaGold()],
        ['Profit Maker Bot (reference)', () => new RefProfitMaker()],
        ['Profit Maker Bot (Kapa)', () => new KapaProfitMaker()],
    ];
    for (const [name, make] of rows) for (const [pn, R] of [['public', PUB], ['marked-up', MARK]]) console.log(fmt(name, pn, run(make, R)));
    if (process.argv.includes('--sweep')) {
        const Cls = { switcher: KapaSwitcher, gold: KapaGold, profitmaker: KapaProfitMaker, printer: KapaPrinter };
        for (const [key, C] of Object.entries(Cls))
            for (const tp of [5, 10]) for (const sl of [25, 50, 100]) for (const maxStake of [10, 25, 50]) for (const extra of key === 'printer' ? [{ p1: 0 }, { p1: 1 }, { level: 3 }] : [{}]) {
                const o = { tp, sl, maxStake, ...extra };
                console.log(fmt(`${key} ${JSON.stringify(o)}`, 'public', run(() => new C(o), PUB)));
            }
    }
}
