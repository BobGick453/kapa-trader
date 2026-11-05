import React, { useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { BOTS, TClassicKey } from '../kapa-ai/classic';
import { load } from '@/external/bot-skeleton';
import { save_types } from '@/external/bot-skeleton/constants/save-type';
import { useStore } from '@/hooks/useStore';
import { addDynamicBlockToDOM } from '@/utils/xml-dom-quick-strategy';
import { fetchPremiumBot, refreshEntitlement } from '../premium/premium-api';
import { openPremium, usePremium } from '../premium/use-premium';
import { LIBRARY_BOTS, TBotCategory, TBotData, TLibraryBot } from './bots';
import './free-bot.scss';

const FILTERS: { key: 'all' | TBotCategory; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'digits', label: 'Digits' },
    { key: 'premium', label: 'Premium' },
    { key: 'evenodd', label: 'Even/Odd' },
];

const XML_LOADERS = {
    martingale: () => import('../../xml/martingale_max-stake.xml'),
    dalembert: () => import('../../xml/dalembert_max-stake.xml'),
    oscars_grind: () => import('../../xml/oscars_grind_max-stake.xml'),
};

const SYMBOLS = ['R_10', 'R_25', 'R_50', 'R_75', 'R_100', '1HZ10V', '1HZ25V', '1HZ50V', '1HZ75V', '1HZ100V'];
const isNum = (v: unknown, lo: number, hi: number) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const optNum = (v: unknown, lo: number, hi: number) => v === undefined || isNum(v, lo, hi);

/** Checks bot settings before they go into the XML, whether they came from this file or from the server. */
const checkData = (d: any): d is TBotData =>
    Boolean(d) &&
    SYMBOLS.includes(d.symbol) &&
    ['overunder', 'evenodd'].includes(d.tradetype) &&
    ['DIGITOVER', 'DIGITUNDER', 'DIGITEVEN', 'DIGITODD'].includes(d.type) &&
    optNum(d.prediction, 0, 9) &&
    isNum(d.stake, 0.35, 50000) &&
    optNum(d.size, 1, 10) &&
    optNum(d.unit, 0.01, 1000) &&
    isNum(d.profit, 0.01, 1e6) &&
    isNum(d.loss, 0.01, 1e6) &&
    optNum(d.maxStake, 0.35, 1e6) &&
    isNum(d.duration, 1, 10);

/** Fills a template strategy XML with the bot's settings, as Quick strategy does, and loads it into Bot Builder. */
const loadBot = async (bot: TLibraryBot, d: TBotData) => {
    const xml = (await XML_LOADERS[bot.xml]()).default as string;
    const dom = window.Blockly.utils.xml.textToDom(xml);
    if (d.prediction !== undefined) addDynamicBlockToDOM('PREDICTION', 'last_digit_prediction', 'digits', dom);

    const setNumber = (key: string, value: number) =>
        dom.querySelectorAll(`value[strategy_value="${key}"]`).forEach((el: Element) => {
            el.innerHTML = `<shadow type="math_number"><field name="NUM">${value}</field></shadow>`;
        });
    const setDropdown = (name: string, value: string) =>
        dom.querySelectorAll(`field[name="${name.toUpperCase()}_LIST"]`).forEach((el: Element) => {
            el.innerHTML = value;
        });

    setDropdown('market', 'synthetic_index');
    setDropdown('submarket', 'random_index');
    setDropdown('symbol', d.symbol);
    setDropdown('tradetypecat', 'digits');
    setDropdown('tradetype', d.tradetype);
    setDropdown('type', 'both');
    setDropdown('purchase', d.type);
    setDropdown('durationtype', 't');
    setNumber('duration', d.duration);
    setNumber('stake', d.stake);
    setNumber('profit', d.profit);
    setNumber('loss', d.loss);
    if (d.size !== undefined) setNumber('size', d.size);
    if (d.maxStake !== undefined) setNumber('max_stake', d.maxStake);
    if (d.unit !== undefined)
        ['alembert_unit', 'dalembert_unit', 'oscar_unit'].forEach(k => setNumber(k, d.unit as number));
    if (d.prediction !== undefined) setNumber('last_digit_prediction', d.prediction);

    await load({
        block_string: window.Blockly.Xml.domToText(dom),
        file_name: bot.name,
        workspace: window.Blockly.derivWorkspace,
        from: save_types.UNSAVED,
        drop_event: null,
        strategy_id: null,
        showIncompatibleStrategyDialog: null,
    });
};

type TFreeBotProps = { handleTabChange: (tab: number) => void };

// Tested with KAPA AI's engine on 300,000 real ticks, Deriv's real prices, take-profit 5, stop-loss 50
const CLASSIC_CARDS: { key: TClassicKey; name: string; tested: string }[] = [
    { key: 'switcher', name: 'Digit Switcher', tested: 'Target reached in 82.5% of sessions · average −0.77 per session · worst −34' },
    { key: 'printer', name: 'Dollar Printer', tested: 'Target reached in 87.1% of sessions · average −1.07 per session · worst −50' },
    { key: 'goldoe', name: 'Gold Premium Odd/Even', tested: 'Target reached in 83.8% of sessions · average −0.86 per session · worst −36' },
    { key: 'profitmaker', name: 'Profit Maker', tested: 'Target reached in 86.8% of sessions · average −0.92 per session · worst −50' },
];

/** Loads a classic bot into KAPA AI (the page reads it on opening) and switches to the KAPA AI tab. */
const runInKapa = (key: TClassicKey) => {
    const detail = { symbol: 'R_100', preset: key, stake: 1 };
    try {
        sessionStorage.setItem('kapa_pending_market', JSON.stringify(detail));
    } catch {
        /* the event below still works when KAPA AI is already open */
    }
    window.dispatchEvent(new CustomEvent('kapa:use-market', { detail }));
};

const FreeBot = observer(({ handleTabChange }: TFreeBotProps) => {
    const { run_panel } = useStore();
    const premium = usePremium();
    const [filter, setFilter] = useState<'all' | TBotCategory>('all');
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');

    const shown = LIBRARY_BOTS.filter(b => filter === 'all' || b.categories.includes(filter));

    const onLoad = async (bot: TLibraryBot) => {
        if (bot.premium && premium.status !== 'active') return openPremium();
        if (run_panel.is_running) return setError('Stop the running bot before loading another one.');
        setError('');
        setBusy(bot.id);
        let switched = false;
        try {
            // Premium bot settings come from the server, which checks the membership first
            const data = bot.premium ? await fetchPremiumBot(bot.id) : bot.data;
            if (!checkData(data)) throw new Error('its settings are invalid');
            handleTabChange(DBOT_TABS.BOT_BUILDER);
            switched = true;
            await new Promise(r => setTimeout(r, 300)); // let Bot Builder's workspace become visible first
            await loadBot(bot, data);
        } catch (e: any) {
            if (e?.status === 402) refreshEntitlement();
            setError(`Couldn't load ${bot.name}: ${e?.message ?? e}`);
            if (switched) handleTabChange(DBOT_TABS.FREE_BOT);
        } finally {
            setBusy(null);
        }
    };

    return (
        <div className='free-bot'>
            <section className='free-bot__hero'>
                <h2>Bot Library</h2>
                <p>Choose a bot and load it into Bot Builder. Review its settings there, then press Run.</p>
            </section>
            <div className='free-bot__filters' role='tablist'>
                {FILTERS.map(f => (
                    <button
                        key={f.key}
                        type='button'
                        role='tab'
                        aria-selected={filter === f.key}
                        className={classNames({ on: filter === f.key })}
                        onClick={() => setFilter(f.key)}
                    >
                        {f.label}
                    </button>
                ))}
            </div>
            {error && <div className='free-bot__error'>{error}</div>}
            <h3 className='free-bot__section'>Classic bots, rebuilt · run in KAPA AI</h3>
            <p className='free-bot__intro'>
                Digit Switcher, Dollar Printer, Gold Odd/Even and Profit Maker, rebuilt with KAPA AI&apos;s protections:
                every recovery cycle fits your stop-loss, and the stake after a loss is the one that wins the cycle back.
                The originals risk 1,000 to win 10. Results below: 300,000 real Deriv ticks, Deriv&apos;s real prices,
                take-profit 5 and stop-loss 50.
            </p>
            <div className='free-bot__list'>
                {CLASSIC_CARDS.map(c => (
                    <article key={c.key} className='free-bot__card'>
                        <div className='free-bot__title'>
                            <h3>{c.name}</h3>
                            <span className='free-bot__badge free-bot__badge--ai'>KAPA AI</span>
                        </div>
                        <p>{BOTS[c.key].about}</p>
                        <small>{c.tested}</small>
                        <button type='button' className='free-bot__load' onClick={() => runInKapa(c.key)}>
                            Run in KAPA AI
                        </button>
                    </article>
                ))}
            </div>
            <h3 className='free-bot__section'>Bot Builder bots</h3>
            <div className='free-bot__list'>
                {shown.map(bot => {
                    const locked = bot.premium && premium.status !== 'active';
                    return (
                        <article key={bot.id} className='free-bot__card'>
                            <div className='free-bot__title'>
                                <h3>{bot.name}</h3>
                                {bot.premium && <span className='free-bot__badge'>PREMIUM</span>}
                            </div>
                            <p>{bot.description}</p>
                            <small>
                                {bot.data
                                    ? `Stake ${bot.data.stake} · take-profit ${bot.data.profit} · stop-loss ${bot.data.loss} · ${bot.data.symbol}`
                                    : 'Settings are sent to Premium members when the bot loads.'}
                            </small>
                            <button
                                type='button'
                                className={classNames('free-bot__load', { locked })}
                                onClick={() => onLoad(bot)}
                                disabled={busy !== null}
                            >
                                {busy === bot.id ? 'Loading…' : locked ? '🔒 Unlock with Premium' : 'Load Bot'}
                            </button>
                        </article>
                    );
                })}
            </div>
        </div>
    );
});

export default FreeBot;
