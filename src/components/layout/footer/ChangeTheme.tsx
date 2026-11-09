import { observer } from 'mobx-react-lite';
import useThemeSwitcher from '@/hooks/useThemeSwitcher';
import { LegacyThemeDarkIcon, LegacyThemeLightIcon } from '@deriv/quill-icons/Legacy';
import { useTranslations } from '@deriv-com/translations';
import { Tooltip } from '@deriv-com/ui';

const ChangeTheme = observer(() => {
    const { is_dark_mode_on, toggleTheme } = useThemeSwitcher();
    const { localize } = useTranslations();

    return (
        <Tooltip
            as='button'
            className='app-footer__icon app-footer__theme'
            tooltipContent={localize('Change theme')}
            onClick={toggleTheme}
        >
            {!is_dark_mode_on ? <LegacyThemeLightIcon iconSize='xs' /> : <LegacyThemeDarkIcon iconSize='xs' />}
            <span className='app-footer__theme-label'>{localize('Theme')}</span>
        </Tooltip>
    );
});

export default ChangeTheme;
