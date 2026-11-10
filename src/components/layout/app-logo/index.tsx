// Updated to use brand configuration from brand.config.json
// Logo is now customizable for white-labeling
import brandConfig from '@/../brand.config.json';
import { localize } from '@deriv-com/translations';
import { useDevice } from '@deriv-com/ui';
import { BASE_PATH } from '@/utils/base-path';
import { BrandLogo } from './BrandLogo';
import './app-logo.scss';

/** On phones the logo shows only to visitors (logged in, the account switcher takes its place), like the reference bot. */
export const AppLogo = ({ showOnMobile = false }: { showOnMobile?: boolean }) => {
    const { isDesktop } = useDevice();

    // Get logo configuration from brand.config.json
    const logoConfig = brandConfig.platform.logo;
    // '/' means the app's home, which may be a sub-folder (e.g. GitHub Pages)
    const logoUrl = logoConfig.link_url && logoConfig.link_url !== '/' ? logoConfig.link_url : BASE_PATH;

    if (!isDesktop && !showOnMobile) return null;

    return (
        <a
            href={logoUrl}
            className={`app-header__logo${isDesktop ? '' : ' app-header__logo--mobile'}`}
            aria-label={localize('Home')}
        >
            {/* [AI] Use configurable brand logo from brand.config.json */}
            <BrandLogo width={120} height={32} fill='var(--text-general)' />
            {/* [/AI] */}
        </a>
    );
};
