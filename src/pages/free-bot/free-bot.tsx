import React, { useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { load } from '@/external/bot-skeleton';
import { save_types } from '@/external/bot-skeleton/constants/save-type';
import { useStore } from '@/hooks/useStore';
import { addDynamicBlockToDOM } from '@/utils/xml-dom-quick-strategy';
import { openPremium, usePremium } from '../premium/use-premium';
import { LIBRARY_BOTS, TBotCategory, TLibraryBot } from './bots';
import './free-bot.scss';

const FILTERS: { key: 'all' | TBotCategory; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'digits', label: 'Digits' },
    { key: 'premium', label: 'Premium' },
    { key: 'evenodd', label: 'Even/Odd' },
];

const XML_LOADERS = {
    martingale: () => import('../../xml/martingale.xml'),
    dalembert: () => import('../../xml/dalembert.xml'),
    oscars_grind: () => import('../../xml/oscars_grind.xml'),
};

/** Fills a template strategy XML with the bot's settings, as Quick strategy does, and loads it into Bot Builder. */
const loadBot = async (bot: TLibraryBot) => {
    const xml = (await XML_LOADERS[bot.xml]()).default as string;
    const dom = window.Blockly.utils.xml.textToDom(xml);
    const d = bot.data;
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
    if (d.unit !== undefined) ['alembert_unit', 'dalembert_unit', 'oscar_unit'].forEach(k => setNumber(k, d.unit as number));
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
        try {
            handleTabChange(DBOT_TABS.BOT_BUILDER);
            await new Promise(r => setTimeout(r, 300)); // let Bot Builder's workspace become visible first
            await loadBot(bot);
        } catch (e: any) {
            setError(`Couldn't load ${bot.name}: ${e?.message ?? e}`);
            handleTabChange(DBOT_TABS.FREE_BOT);
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
                    <button key={f.key} type='button' role='tab' aria-selected={filter === f.key} className={classNames({ on: filter === f.key })} onClick={() => setFilter(f.key)}>
                        {f.label}
                    </button>
                ))}
            </div>
            {error && <div className='free-bot__error'>{error}</div>}
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
                                Stake {bot.data.stake} · take-profit {bot.data.profit} · stop-loss {bot.data.loss} · {bot.data.symbol}
                            </small>
                            <button type='button' className={classNames('free-bot__load', { locked })} onClick={() => onLoad(bot)} disabled={busy !== null}>
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
