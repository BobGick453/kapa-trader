import { configure } from 'mobx';
import ReactDOM from 'react-dom/client';
import { AuthWrapper } from './app/AuthWrapper';
// Removed AnalyticsInitializer import - analytics dependency removed
// See migrate-docs/ANALYTICS_IMPLEMENTATION_GUIDE.md for re-implementation
import { clearStaleLogin, maybeAutoLogin } from './utils/kapa-autologin';
import { installDiagnostics } from './utils/kapa-diagnostics';
import { performVersionCheck } from './utils/version-check';
import './styles/index.scss';

// Configure MobX to handle multiple instances in production builds
configure({ isolateGlobalState: true });

// Perform version check FIRST - before any other operations
performVersionCheck();

// A Deriv session that ended leaves account details behind; drop them so the Log in button shows
clearStaleLogin();
// Records what blocks the Deriv connection, shown in the KAPA AI login card
installDiagnostics();

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
    // A linked device without a session goes to Deriv first, before the app is drawn (it would be drawn
    // again on the way back); Deriv returns at once when the account is open in this browser.
    const render = () => ReactDOM.createRoot(document.getElementById('root')!).render(<AuthWrapper />);
    maybeAutoLogin().then(leaving => {
        if (!leaving) render();
        else setTimeout(render, 8000); // still here: the browser didn't leave, so show the app anyway
    }, render);
}
