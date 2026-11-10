import { useState } from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import { DBOT_TABS } from '@/constants/bot-contents';
import { load } from '@/external/bot-skeleton';
import { save_types } from '@/external/bot-skeleton/constants/save-type';
import { useStore } from '@/hooks/useStore';
import type { TClassicKey } from '../kapa-ai/classic';
import { FILTERS, FREE_BOTS, TBotFilter, TFreeBot } from './bots';
import './free-bot.scss';

type TFreeBotProps = { handleTabChange: (tab: number) => void };

const signed = (x: number) => (x < 0 ? `−${Math.abs(x).toFixed(2)}` : `+${x.toFixed(2)}`);
const result = ([target, average, worst]: [number, number, number]) =>
    `target ${target.toFixed(1)}% · average ${signed(average)} · worst −${Math.abs(worst)}`;

/**
 * Loads a classic bot into KAPA AI (the page reads it on opening) and switches to the KAPA AI tab. With
 * apexRecovery, KAPA AI loads the Premium Apex recovery (computed on the server); without Premium, Start asks for it.
 */
const runInKapa = (key: TClassicKey, apexRecovery = false) => {
    const detail = { symbol: 'R_100', preset: key, stake: 1, ...(apexRecovery ? { apexRecovery: true } : {}) };
    try {
        sessionStorage.setItem('kapa_pending_market', JSON.stringify(detail));
    } catch {
        /* the event below still works when KAPA AI is already open */
    }
    window.dispatchEvent(new CustomEvent('kapa:use-market', { detail }));
};

const FreeBot = observer(({ handleTabChange }: TFreeBotProps) => {
    const { run_panel } = useStore();
    const [filter, setFilter] = useState<'All' | TBotFilter>('All');
    const [busy, setBusy] = useState<string | null>(null);
    const [error, setError] = useState('');

    const shown = filter === 'All' ? FREE_BOTS : FREE_BOTS.filter(b => b.filters.includes(filter));

    /** Puts the bot's XML into Bot Builder, as the reference's "Load Bot" does. */
    const onLoad = async (bot: TFreeBot) => {
        if (run_panel.is_running) return setError('Stop the running bot before loading another one.');
        setError('');
        setBusy(bot.id);
        let switched = false;
        try {
            const xml = (await bot.xml()).default;
            handleTabChange(DBOT_TABS.BOT_BUILDER);
            switched = true;
            await new Promise(r => setTimeout(r, 300)); // let Bot Builder's workspace become visible first
            const res = await load({
                block_string: xml,
                file_name: bot.name,
                workspace: window.Blockly.derivWorkspace,
                from: save_types.UNSAVED,
                drop_event: null,
                strategy_id: null,
                showIncompatibleStrategyDialog: null,
            });
            if (res?.error) throw new Error(res.error);
        } catch (e: any) {
            setError(`Couldn't load ${bot.title}: ${e?.message ?? e}`);
            if (switched) handleTabChange(DBOT_TABS.FREE_BOT);
        } finally {
            setBusy(null);
        }
    };

    return (
        <section className='free-bot'>
            <div className='free-bot__container'>
                <header className='free-bot__head'>
                    <h1>Bot Library</h1>
                    <p>Choose a bot and load it into Bot Builder.</p>
                </header>
                <div className='free-bot__filters' role='group' aria-label='Filter bots'>
                    {FILTERS.map(f => (
                        <button
                            key={f}
                            type='button'
                            className={classNames('free-bot__filter', { 'free-bot__filter--active': filter === f })}
                            aria-pressed={filter === f}
                            onClick={() => setFilter(f)}
                        >
                            {f}
                        </button>
                    ))}
                </div>
                {error && <div className='free-bot__error'>{error}</div>}
                <div className='free-bot__grid'>
                    {shown.map(bot => (
                        <article key={bot.id} className='free-bot__card' data-bot={bot.id}>
                            <div className='free-bot__content'>
                                <h2>{bot.title}</h2>
                                <p>{bot.description}</p>
                                <small className='free-bot__tested'>
                                    Bot Builder, {bot.defaults}: target reached in {bot.tested.target.toFixed(1)}% of
                                    sessions · average {signed(bot.tested.average)} · worst session −
                                    {Math.abs(bot.tested.worst)}
                                </small>
                            </div>
                            <button
                                type='button'
                                className='free-bot__btn'
                                onClick={() => onLoad(bot)}
                                disabled={busy !== null}
                            >
                                {busy === bot.id ? 'Loading…' : 'Load Bot'}
                            </button>
                            <div className='free-bot__ai'>
                                <button
                                    type='button'
                                    className='free-bot__btn free-bot__btn--ai'
                                    onClick={() => runInKapa(bot.classic)}
                                    disabled={busy !== null}
                                >
                                    Run in KAPA AI
                                </button>
                                <button
                                    type='button'
                                    className='free-bot__btn free-bot__btn--apex'
                                    onClick={() => runInKapa(bot.classic, true)}
                                    disabled={busy !== null}
                                    title='KAPA AI with the Apex recovery, a Premium option'
                                >
                                    Apex recovery <span className='free-bot__badge'>PREMIUM</span>
                                </button>
                            </div>
                            <small className='free-bot__tested free-bot__tested--ai'>
                                KAPA AI, take-profit 5 / stop-loss 50 · free recovery: {result(bot.kapa.free)} · Apex
                                (Premium): {result(bot.kapa.apex)}
                            </small>
                        </article>
                    ))}
                </div>
                <details className='free-bot__how'>
                    <summary>How these numbers were measured</summary>
                    <p>
                        Each bot&apos;s rules were replayed on 300,000 real Deriv ticks with Deriv&apos;s real prices
                        (one Run = one session): the Bot Builder version at the default settings shown, and the KAPA AI
                        version with take-profit 5 and stop-loss 50, with its free recovery or with KAPA Apex, the
                        Premium recovery computed on Kapa&apos;s server. The originals reach their target more often
                        only because they risk far more: up to 1,517 lost in one session for Digit Switcher, and a
                        10,000 account emptied 44 times for Dollar Printer, which had no stop-loss. Kapa&apos;s versions
                        never place a stake past the stop-loss or above Max Stake.
                    </p>
                    <p>
                        No bot wins in the long run: the digits are random and every contract pays a little less than
                        its odds. The average per session is what a session costs on average.
                    </p>
                </details>
            </div>
        </section>
    );
});

export default FreeBot;
