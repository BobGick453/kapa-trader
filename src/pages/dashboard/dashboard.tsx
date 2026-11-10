import React from 'react';
import classNames from 'classnames';
import { observer } from 'mobx-react-lite';
import brandConfig from '@/../brand.config.json';
import { generateOAuthURL } from '@/components/shared';
import { useApiBase } from '@/hooks/useApiBase';
import { useStore } from '@/hooks/useStore';
import { KAPA_NO_SESSION_AT_LOAD } from '@/stores/dashboard-store';
import { localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import OnboardTourHandler from '../tutorials/dbot-tours/onboarding-tour';
import Cards from './cards';

type TMobileIconGuide = {
    handleTabChange: (active_number: number) => void;
};

// handleTabChange stays in the props for callers; the template's Announcements panel that used it is not shown in Kapa
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const DashboardComponent = observer((_props: TMobileIconGuide) => {
    const { load_modal, dashboard, client } = useStore();
    const { dashboard_strategies } = load_modal;
    const { active_tab, active_tour } = dashboard;
    const has_dashboard_strategies = !!dashboard_strategies?.length;
    const { isDesktop } = useDevice();
    const { isAuthorizing } = useApiBase();
    // Visitors see a short "Not logged in" card; Kapa leaves out the template's guide panel and Announcements
    const show_login_notice = !client.is_logged_in && (KAPA_NO_SESSION_AT_LOAD || !isAuthorizing);
    const login = async () => {
        const url = await generateOAuthURL();
        if (url) window.location.replace(url);
    };

    return (
        <React.Fragment>
            <div
                className={classNames('tab__dashboard', {
                    'tab__dashboard--tour-active': active_tour,
                })}
            >
                <div className='tab__dashboard__content kapa-dash'>
                    <div className='kapa-dash__container'>
                        <header
                            className={classNames('kapa-dash__header', {
                                'kapa-dash__header--listed': isDesktop && has_dashboard_strategies,
                            })}
                        >
                            <div className='kapa-social'>
                                <a
                                    href={brandConfig.platform.social?.whatsapp || undefined}
                                    target='_blank'
                                    rel='noopener noreferrer'
                                    aria-label='WhatsApp'
                                    title={
                                        brandConfig.platform.social?.whatsapp ? 'WhatsApp' : 'WhatsApp link coming soon'
                                    }
                                    className='kapa-social__wa'
                                >
                                    <svg viewBox='0 0 24 24' width='22' height='22' fill='currentColor' aria-hidden>
                                        <path d='M12 2a10 10 0 0 0-8.7 14.9L2 22l5.2-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.2c0-.1-.2-.2-.4-.3z' />
                                    </svg>
                                </a>
                                <a
                                    href={brandConfig.platform.social?.telegram || undefined}
                                    target='_blank'
                                    rel='noopener noreferrer'
                                    aria-label='Telegram'
                                    title={
                                        brandConfig.platform.social?.telegram ? 'Telegram' : 'Telegram link coming soon'
                                    }
                                    className='kapa-social__tg'
                                >
                                    <svg viewBox='0 0 24 24' width='20' height='20' fill='currentColor' aria-hidden>
                                        <path d='M21.9 4.3 18.6 19.8c-.2 1.1-.9 1.4-1.8.9l-5-3.7-2.4 2.3c-.3.3-.5.5-1 .5l.3-5.1 9.3-8.4c.4-.4-.1-.6-.6-.2L5.9 13.3l-4.9-1.5c-1.1-.3-1.1-1.1.2-1.6L20.4 2.8c.9-.3 1.7.2 1.5 1.5z' />
                                    </svg>
                                </a>
                            </div>
                            {!has_dashboard_strategies && (
                                <h2 className='kapa-dash__title'>{localize('Load or build your bot')}</h2>
                            )}
                            <p className='kapa-dash__subtitle'>
                                {localize(
                                    'Import a bot from your computer or Google Drive, build it from scratch, or start with a quick strategy.'
                                )}
                            </p>
                        </header>
                        <Cards has_dashboard_strategies={has_dashboard_strategies} is_mobile={!isDesktop} />
                        {show_login_notice && (
                            <div className='kapa-notice kapa-login' role='status'>
                                <p>
                                    <b>{localize('Not logged in.')}</b>{' '}
                                    {localize('Log in to start trading and access all features.')}
                                </p>
                                <button type='button' className='kapa-btn kapa-notice__btn' onClick={login}>
                                    {localize('Log in')}
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            {/* the tour is for logged-in users (visitors see the login card instead) */}
            {active_tab === 0 && client.is_logged_in && <OnboardTourHandler is_mobile={!isDesktop} />}
        </React.Fragment>
    );
});

export default DashboardComponent;
