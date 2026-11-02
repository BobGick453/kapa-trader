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

export const LIBRARY_BOTS: TLibraryBot[] = [
    {
        id: 'over1-steady',
        name: 'Kapa Over 1 Steady',
        description: 'Over 1 on Volatility 100 with a fixed stake. Wins about 8 times in 10, each win is small.',
        categories: ['digits'],
        premium: false,
        xml: 'martingale',
        data: {
            symbol: 'R_100',
            tradetype: 'overunder',
            type: 'DIGITOVER',
            prediction: 1,
            stake: 1,
            size: 1,
            profit: 5,
            loss: 10,
            duration: 1,
        },
    },
    {
        id: 'over2-martingale',
        name: 'Kapa Over 2 Martingale',
        description:
            'Over 2 with the stake multiplied by 2.2 after each loss and reset after a win. Small targets are often reached; a losing streak costs much more.',
        categories: ['digits'],
        premium: false,
        xml: 'martingale',
        data: {
            symbol: 'R_100',
            tradetype: 'overunder',
            type: 'DIGITOVER',
            prediction: 2,
            stake: 1,
            size: 2.2,
            profit: 5,
            loss: 30,
            duration: 1,
        },
    },
    {
        id: 'evenodd-martingale',
        name: 'Kapa Even/Odd Martingale',
        description:
            'Even on Volatility 50, doubling the stake after a loss. A 50% contract with a classic martingale.',
        categories: ['evenodd'],
        premium: false,
        xml: 'martingale',
        data: {
            symbol: 'R_50',
            tradetype: 'evenodd',
            type: 'DIGITEVEN',
            stake: 1,
            size: 2,
            profit: 5,
            loss: 30,
            duration: 1,
        },
    },
    {
        id: 'under7-dalembert',
        name: "Kapa D'Alembert Digits",
        description:
            "A digits bot with D'Alembert staking: one unit more after a loss, one unit less after a win. Gentler than martingale.",
        categories: ['digits', 'premium'],
        premium: true,
        xml: 'dalembert',
    },
    {
        id: 'odd-oscars',
        name: "Kapa Oscar's Grind Even/Odd",
        description:
            "An Even/Odd bot with Oscar's Grind: raises the stake only after wins, aiming for one unit of profit per cycle.",
        categories: ['evenodd', 'premium'],
        premium: true,
        xml: 'oscars_grind',
    },
];
