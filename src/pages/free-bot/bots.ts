/**
 * Kapa bot library: each entry fills one of the template's strategy XML files
 * (the same way Quick strategy does) and loads it into Bot Builder.
 * Premium bots carry no settings here: the server sends them to members only.
 */

export type TBotCategory = 'digits' | 'evenodd' | 'premium';

export type TBotData = {
    symbol: string;
    tradetype: 'overunder' | 'evenodd';
    type: 'DIGITOVER' | 'DIGITUNDER' | 'DIGITEVEN' | 'DIGITODD';
    prediction?: number;
    stake: number;
    size?: number;
    unit?: number;
    profit: number;
    loss: number;
    /** Stake ceiling: above it the next stake goes back to the initial one (Bot Builder's "max stake") */
    maxStake?: number;
    duration: number;
};

export type TLibraryBot = {
    id: string;
    name: string;
    description: string;
    categories: TBotCategory[];
    premium: boolean;
    xml: 'martingale' | 'dalembert' | 'oscars_grind';
    data?: TBotData; // absent for Premium bots
};

// Every bot trades a 50% contract (Even, Odd or Under 5): Deriv's margin is smallest on those (about
// 2.5% of the stake against about 7% on Over 1). Each has a loss limit and a stake ceiling, so a losing
// run ends at a known loss: Bot Builder checks the limit after each trade, so a session can lose at most
// the limit plus one stake. Chances below come from 20,000 simulated sessions with Deriv's usual payout.
export const LIBRARY_BOTS: TLibraryBot[] = [
    {
        id: 'even-steady',
        name: 'Kapa Even Steady',
        description:
            'Even on Volatility 100, the same stake every trade. Lowest risk per trade: reaches +3 in about 2 sessions out of 3 and never loses more than about 11.',
        categories: ['digits', 'evenodd'],
        premium: false,
        xml: 'martingale',
        data: {
            symbol: 'R_100',
            tradetype: 'evenodd',
            type: 'DIGITEVEN',
            stake: 1,
            size: 1,
            profit: 3,
            loss: 10,
            maxStake: 1,
            duration: 1,
        },
    },
    {
        id: 'under5-martingale',
        name: 'Kapa Under 5 Recovery',
        description:
            'Under 5 (a 50% contract), stake ×2.1 after a loss so one win covers the run, at most 4 losses in a row before going back to 1. Reaches +3 in about 8 sessions out of 10; a bad run costs up to about 26.',
        categories: ['digits'],
        premium: false,
        xml: 'martingale',
        data: {
            symbol: 'R_100',
            tradetype: 'overunder',
            type: 'DIGITUNDER',
            prediction: 5,
            stake: 1,
            size: 2.1,
            profit: 3,
            loss: 16.7,
            maxStake: 9.3,
            duration: 1,
        },
    },
    {
        id: 'evenodd-martingale',
        name: 'Kapa Even/Odd Recovery',
        description:
            'Even on Volatility 50, stake ×2.1 after a loss, at most 4 losses in a row before going back to 1. Aims for +5: reached in about 3 sessions out of 4; a bad run costs up to about 26.',
        categories: ['evenodd'],
        premium: false,
        xml: 'martingale',
        data: {
            symbol: 'R_50',
            tradetype: 'evenodd',
            type: 'DIGITEVEN',
            stake: 1,
            size: 2.1,
            profit: 5,
            loss: 16.7,
            maxStake: 9.3,
            duration: 1,
        },
    },
    {
        id: 'under7-dalembert',
        name: "Kapa D'Alembert Even",
        description:
            "Even with D'Alembert staking: one unit more after a loss, one less after a win, capped at 5. Much gentler than doubling: reaches +5 in about 7 sessions out of 10, a bad run stops near 20.",
        categories: ['evenodd', 'premium'],
        premium: true,
        xml: 'dalembert',
    },
    {
        id: 'odd-oscars',
        name: "Kapa Oscar's Grind Odd",
        description:
            "Odd with Oscar's Grind: the stake rises only after a win and each cycle aims for one unit of profit, capped at 4. Reaches +5 in about 7 sessions out of 10, a bad run stops near 19.",
        categories: ['evenodd', 'premium'],
        premium: true,
        xml: 'oscars_grind',
    },
];
