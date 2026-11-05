// TODO: Complete MobX integration for popup functionality
// Some code is kept commented out pending popup integration
import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import GoogleDrive from '@/components/load-modal/google-drive';
import Dialog from '@/components/shared_ui/dialog';
import MobileFullPageModal from '@/components/shared_ui/mobile-full-page-modal';
import Text from '@/components/shared_ui/text';
import { DBOT_TABS } from '@/constants/bot-contents';
import { useStore } from '@/hooks/useStore';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
/* [AI] - Analytics event tracking removed - see migrate-docs/MONITORING_PACKAGES.md for re-implementation guide */
/* [/AI] */
import DashboardBotList from './bot-list/dashboard-bot-list';

/** Neon outline icons for the dashboard tiles (in the tile's accent colour). */
const TileIcon = ({ kind }: { kind: 'computer' | 'drive' | 'builder' | 'quick' | 'speed' }) => {
    const p = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
    return (
        <svg className='kapa-tile__svg' viewBox='0 0 32 32' width='34' height='34' aria-hidden>
            {kind === 'computer' && (
                <>
                    <rect x='4' y='6' width='24' height='16' rx='2' {...p} />
                    <path d='M12 27h8M16 22v5M16 17v-7M13 13l3-3 3 3' {...p} />
                </>
            )}
            {kind === 'drive' && (
                <>
                    <path d='M9 23h14a5 5 0 0 0 .6-9.96A7 7 0 0 0 10.2 12 5.5 5.5 0 0 0 9 23z' {...p} />
                    <path d='M16 14v6M13 17h6' {...p} />
                </>
            )}
            {kind === 'builder' && (
                <>
                    <circle cx='16' cy='16' r='4' {...p} />
                    <circle cx='16' cy='16' r='1.2' {...p} />
                    <rect x='4' y='4' width='5' height='5' rx='1' {...p} />
                    <rect x='23' y='4' width='5' height='5' rx='1' {...p} />
                    <rect x='4' y='23' width='5' height='5' rx='1' {...p} />
                    <rect x='23' y='23' width='5' height='5' rx='1' {...p} />
                    <path d='M9 9l4 4M23 9l-4 4M9 23l4-4M23 23l-4-4' {...p} />
                </>
            )}
            {kind === 'quick' && (
                <>
                    <path d='M5 27h22' {...p} />
                    <rect x='6' y='19' width='3.5' height='6' rx='0.8' {...p} />
                    <rect x='11.5' y='15' width='3.5' height='10' rx='0.8' {...p} />
                    <rect x='17' y='11' width='3.5' height='14' rx='0.8' {...p} />
                    <rect x='22.5' y='6' width='3.5' height='19' rx='0.8' {...p} />
                    <path d='M7 14l6-5 4 3 8-7' {...p} />
                </>
            )}
            {kind === 'speed' && (
                <>
                    <rect x='6' y='10' width='20' height='15' rx='4' {...p} />
                    <circle cx='12' cy='17' r='2' {...p} />
                    <circle cx='20' cy='17' r='2' {...p} />
                    <path d='M13 22h6M16 10V6M16 6h0M3 16v4M29 16v4' {...p} />
                    <circle cx='16' cy='5' r='1.2' {...p} />
                </>
            )}
        </svg>
    );
};

type TCardProps = {
    has_dashboard_strategies: boolean;
    is_mobile: boolean;
};

type TCardArray = {
    id: string;
    icon: React.ReactElement;
    content: React.ReactElement;
    subtitle?: React.ReactElement;
    accent?: string;
    disabled?: boolean;
    callback: () => void;
};

const Cards = observer(({ is_mobile, has_dashboard_strategies }: TCardProps) => {
    const { dashboard, load_modal, quick_strategy } = useStore();
    const { toggleLoadModal, setActiveTabIndex } = load_modal;
    const { isDesktop } = useDevice();
    const { onCloseDialog, dialog_options, is_dialog_open, setActiveTab, setPreviewOnPopup } = dashboard;
    const { setFormVisibility } = quick_strategy;

    const openFileLoader = () => {
        toggleLoadModal();
        setActiveTabIndex(is_mobile ? 0 : 1);
        setActiveTab(DBOT_TABS.BOT_BUILDER);
    };

    const openGoogleDriveDialog = () => {
        const google_drive_tab_index = isDesktop ? 2 : 1;
        toggleLoadModal();
        setActiveTabIndex(google_drive_tab_index); // Google Drive tab index
        setActiveTab(DBOT_TABS.BOT_BUILDER);
    };

    const actions: TCardArray[] = [
        {
            id: 'my-computer',
            icon: <TileIcon kind='computer' />,
            content: <Localize i18n_default_text='My computer' />,
            subtitle: <Localize i18n_default_text='Import from your device' />,
            accent: '#3b82f6',
            callback: openFileLoader,
        },
        {
            id: 'google-drive',
            icon: <TileIcon kind='drive' />,
            content: <Localize i18n_default_text='Google Drive' />,
            subtitle: <Localize i18n_default_text='Load from Google Drive' />,
            accent: '#22c57a',
            callback: openGoogleDriveDialog,
        },
        {
            id: 'bot-builder',
            icon: <TileIcon kind='builder' />,
            content: <Localize i18n_default_text='Bot Builder' />,
            subtitle: <Localize i18n_default_text='Build blocks visually' />,
            accent: '#8b5cf6',
            callback: () => setActiveTab(DBOT_TABS.BOT_BUILDER),
        },
        {
            id: 'quick-strategy',
            icon: <TileIcon kind='quick' />,
            content: <Localize i18n_default_text='Quick strategy' />,
            subtitle: <Localize i18n_default_text='Start with a template' />,
            accent: '#f59e0b',
            callback: () => {
                setActiveTab(DBOT_TABS.BOT_BUILDER);
                setFormVisibility(true);
            },
        },
        {
            // KAPA AI's own trade engine: one contract per tick, with Kapa's stop-loss and daily limits
            id: 'speed-bot',
            icon: <TileIcon kind='speed' />,
            content: <Localize i18n_default_text='Speed Bot' />,
            subtitle: <Localize i18n_default_text='High-speed trading engine' />,
            accent: '#ec4899',
            callback: () => setActiveTab(DBOT_TABS.KAPA_AI),
        },
    ];

    return React.useMemo(
        () => (
            <div
                className={classNames('tab__dashboard__table', {
                    'tab__dashboard__table--minimized': has_dashboard_strategies && is_mobile,
                })}
            >
                <div
                    className={classNames('tab__dashboard__table__tiles', {
                        'tab__dashboard__table__tiles--minimized': has_dashboard_strategies && is_mobile,
                    })}
                    id='tab__dashboard__table__tiles'
                >
                    {actions.map(icons => {
                        const { icon, content, callback, id, subtitle, accent, disabled } = icons;
                        return (
                            <div
                                key={id}
                                className={classNames('tab__dashboard__table__block', 'kapa-tile', {
                                    'tab__dashboard__table__block--minimized': has_dashboard_strategies && is_mobile,
                                    'kapa-tile--disabled': disabled,
                                })}
                                style={{ '--kapa-accent': accent } as React.CSSProperties}
                            >
                                <div
                                    className={classNames('tab__dashboard__table__images', {
                                        'tab__dashboard__table__images--minimized': has_dashboard_strategies,
                                    })}
                                    width='8rem'
                                    height='8rem'
                                    icon={icon}
                                    id={id}
                                    onClick={() => {
                                        callback();
                                    }}
                                >
                                    {icon}
                                </div>
                                <Text color='prominent' size={is_mobile ? 'xxs' : 'xs'} weight='bold'>
                                    {content}
                                </Text>
                                {subtitle && <span className='kapa-tile__sub'>{subtitle}</span>}
                                <button
                                    type='button'
                                    className='kapa-tile__open'
                                    onClick={() => callback()}
                                    disabled={disabled}
                                >
                                    {disabled ? (
                                        <Localize i18n_default_text='SOON' />
                                    ) : (
                                        <Localize i18n_default_text='OPEN →' />
                                    )}
                                </button>
                            </div>
                        );
                    })}

                    {!isDesktop ? (
                        <Dialog
                            title={dialog_options.title}
                            is_visible={is_dialog_open}
                            onCancel={onCloseDialog}
                            is_mobile_full_width
                            className='dc-dialog__wrapper--google-drive'
                            has_close_icon
                        >
                            <GoogleDrive />
                        </Dialog>
                    ) : (
                        <MobileFullPageModal
                            is_modal_open={is_dialog_open}
                            className='load-strategy__wrapper'
                            header={localize('Load strategy')}
                            onClickClose={() => {
                                setPreviewOnPopup(false);
                                onCloseDialog();
                            }}
                            height_offset='80px'
                        >
                            <div label='Google Drive' className='google-drive-label'>
                                <GoogleDrive />
                            </div>
                        </MobileFullPageModal>
                    )}
                </div>
                <DashboardBotList />
            </div>
        ),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [is_dialog_open, has_dashboard_strategies]
    );
});

export default Cards;
