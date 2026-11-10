/**
 * Free Bot library: the reference bot's 4 bots, same names, order, filters and settings fields, rebuilt by Kapa
 * as Bot Builder XML (xml/generate.py) with a stop-loss that holds. "Load Bot" puts the XML into Bot Builder;
 * "Run in KAPA AI" opens the same entry rule as a classic bot in KAPA AI.
 *
 * `kapa` quotes qa/real/classic-bt2.mjs (KAPA AI's classic bots, take-profit 5 / stop-loss 50, public price).
 * `tested` quotes qa/real/freebots-bt.mjs: the XML's rules replayed on 300,000 real Deriv ticks with Deriv's
 * real prices, at the bot's default settings. Change the numbers only by re-running it.
 */
import type { TClassicKey } from '../kapa-ai/classic';

export type TBotFilter = 'Digits' | 'Premium' | 'Even/Odd';

export type TFreeBot = {
    id: string;
    /** name given to the strategy in Bot Builder */
    name: string;
    /** card title, as the reference shows it */
    title: string;
    description: string;
    filters: TBotFilter[];
    xml: () => Promise<{ default: string }>;
    classic: TClassicKey;
    defaults: string;
    /** the XML in Bot Builder, at its default settings */
    tested: { target: number; average: number; worst: number };
    /** the classic bot in KAPA AI, take-profit 5 / stop-loss 50: own (free) recovery and Apex recovery (Premium) */
    kapa: { free: [number, number, number]; apex: [number, number, number] };
};

export const FILTERS: ('All' | TBotFilter)[] = ['All', 'Digits', 'Premium', 'Even/Odd'];

export const FREE_BOTS: TFreeBot[] = [
    {
        id: 'digit_switcher',
        name: 'Digit Switcher Bot',
        title: 'Digit Switcher Bot (1)',
        description:
            'Digit-state bot: Under 5 after an even digit, Over 5 or Under 5 after losses. Its martingale fits your stop-loss.',
        filters: ['Digits'],
        xml: () => import('./xml/digit_switcher_bot.xml'),
        classic: 'switcher',
        defaults: 'stake 1 · take-profit 10 · stop-loss 50',
        tested: { target: 78.4, average: -1.39, worst: -50 },
        kapa: { free: [71.8, -0.57, -19], apex: [90.0, -0.46, -50] },
    },
    {
        id: 'dollar_printer',
        name: 'Dollar Printer',
        title: 'Dollar Printer (1)',
        description:
            'Over 0 when 90% of the last 15 digits are above 0, Over 5 to win back a loss. Now with a real stop-loss.',
        filters: ['Digits', 'Premium'],
        xml: () => import('./xml/dollar_printer.xml'),
        classic: 'printer',
        defaults: 'stake 1 · take-profit 10 · stop-loss 50',
        tested: { target: 78.5, average: -1.44, worst: -50 },
        kapa: { free: [87.2, -1.08, -50], apex: [89.9, -0.54, -50] },
    },
    {
        id: 'gold_premium_odd_even',
        name: 'GOLD PREMIUM ODD AND EVEN',
        title: 'Gold Premium Odd And Even',
        description:
            'Odd/even bot: follows a parity when 4 of the last 5 digits share it. Target 10 instead of 1,000, real stop-loss.',
        filters: ['Premium', 'Even/Odd'],
        xml: () => import('./xml/gold_premium_odd_and_even.xml'),
        classic: 'goldoe',
        defaults: 'stake 1 · take-profit 10 · stop-loss 50',
        tested: { target: 79.0, average: -1.91, worst: -50 },
        kapa: { free: [83.8, -0.86, -36], apex: [90.0, -0.47, -50] },
    },
    {
        id: 'profit_maker',
        name: 'Profit Maker Bot',
        title: 'Profit Maker Bot (1)',
        description:
            'Over 2, then Over 4 with the stake ×2.2 after a loss. Every recovery stake fits under your stop-loss.',
        filters: ['Premium'],
        xml: () => import('./xml/profit_maker_bot.xml'),
        classic: 'profitmaker',
        defaults: 'stake 1 · take-profit 5 · stop-loss 50',
        tested: { target: 87.9, average: -1.09, worst: -50 },
        kapa: { free: [86.8, -0.92, -50], apex: [90.3, -0.35, -50] },
    },
];
