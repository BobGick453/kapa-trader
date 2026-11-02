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
import {
    DerivLightBotBuilderIcon,
    DerivLightGoogleDriveIcon,
    DerivLightLocalDeviceIcon,
    DerivLightMyComputerIcon,
    DerivLightQuickStrategyIcon,
} from '@deriv/quill-icons/Illustration';
import { Localize, localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
/* [AI] - Analytics event tracking removed - see migrate-docs/MONITORING_PACKAGES.md for re-implementation guide */
/* [/AI] */
import DashboardBotList from './bot-list/dashboard-bot-list';

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
            icon: is_mobile ? (
                <DerivLightLocalDeviceIcon height='48px' width='48px' />
            ) : (
                <DerivLightMyComputerIcon height='48px' width='48px' />
            ),
            content: <Localize i18n_default_text='My computer' />,
            subtitle: <Localize i18n_default_text='Import from your device' />,
            accent: '#3b82f6',
            callback: () => {
                openFileLoader();
                /* [AI] - Analytics event tracking removed - see migrate-docs/MONITORING_PACKAGES.md for re-implementation guide */
                /* [/AI] */
            },
        },
        {
            id: 'google-drive',
            icon: <DerivLightGoogleDriveIcon height='48px' width='48px' />,
            content: <Localize i18n_default_text='Google Drive' />,
            subtitle: <Localize i18n_default_text='Load from Google Drive' />,
            accent: '#22c57a',
            callback: () => {
                openGoogleDriveDialog();
                /* [AI] - Analytics event tracking removed - see migrate-docs/MONITORING_PACKAGES.md for re-implementation guide */
                /* [/AI] */
            },
        },
        {
            id: 'bot-builder',
            icon: <DerivLightBotBuilderIcon height='48px' width='48px' />,
            content: <Localize i18n_default_text='Bot Builder' />,
            subtitle: <Localize i18n_default_text='Build blocks visually' />,
            accent: '#8b5cf6',
            callback: () => {
                setActiveTab(DBOT_TABS.BOT_BUILDER);
                /* [AI] - Analytics event tracking removed - see migrate-docs/MONITORING_PACKAGES.md for re-implementation guide */
                /* [/AI] */
            },
        },
        {
            id: 'quick-strategy',
            icon: <DerivLightQuickStrategyIcon height='48px' width='48px' />,
            content: <Localize i18n_default_text='Quick strategy' />,
            subtitle: <Localize i18n_default_text='Start with a template' />,
            accent: '#f59e0b',
            callback: () => {
                setActiveTab(DBOT_TABS.BOT_BUILDER);
                setFormVisibility(true);
                /* [AI] - Analytics event tracking removed - see migrate-docs/MONITORING_PACKAGES.md for re-implementation guide */
                /* [/AI] */
            },
        },
        {
            // Kapa: placeholder card, like the reference bot's; not wired to anything yet
            id: 'speed-bot',
            icon: (
                <span className='kapa-speedbot-icon' aria-hidden>
                    🤖
                </span>
            ),
            content: <Localize i18n_default_text='Speed Bot' />,
            subtitle: <Localize i18n_default_text='Coming soon' />,
            accent: '#ec4899',
            disabled: true,
            callback: () => {},
        },
    ];
    // Kapa: same order as the reference bot's dashboard carousel
    const ORDER = ['my-computer', 'google-drive', 'quick-strategy', 'speed-bot', 'bot-builder'];
    actions.sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id));

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
