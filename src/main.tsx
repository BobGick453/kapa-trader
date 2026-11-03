import { configure } from 'mobx';
import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
// Removed AnalyticsInitializer import - analytics dependency removed
// See migrate-docs/ANALYTICS_IMPLEMENTATION_GUIDE.md for re-implementation
import { clearStaleLogin } from './utils/kapa-autologin';
import { performVersionCheck } from './utils/version-check';
import './styles/index.scss';

// Configure MobX to handle multiple instances in production builds
configure({ isolateGlobalState: true });

// Perform version check FIRST - before any other operations
performVersionCheck();

// A Deriv session that ended leaves account details behind; drop them so the Log in button shows
clearStaleLogin();

// Removed AnalyticsInitializer() call - analytics dependency removed

// Never run inside another website's frame (clickjacking). GitHub Pages can't send a frame-ancestors header,
// so the page checks for itself and refuses to render when framed.
if (window.top !== window.self) {
    try {
        window.top!.location.replace(window.location.href);
    } catch {
        /* a sandboxed frame can't be escaped; the page simply stays empty */
    }
} else {
    ReactDOM.createRoot(document.getElementById('root')!).render(<AuthWrapper />);
}
