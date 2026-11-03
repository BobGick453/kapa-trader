/**
 * Automatic re-linking with Deriv.
 *
 * After the first successful "Log in with Deriv", this device remembers that it is linked.
 * On later visits without a session (new tab, browser restarted), the app sends the user
 * straight through Deriv's login page: when the Deriv account is already open in the browser,
 * Deriv sends them back at once, logged in. Logging out from the menu turns this off.
 */
const LINKED_KEY = 'kapa_deriv_linked';
const TRIED_KEY = 'kapa_autologin_tried';

const safe = <T>(fn: () => T, fallback: T): T => {
    try {
        return fn();
    } catch {
        return fallback;
    }
};

export const markDerivLinked = () => safe(() => localStorage.setItem(LINKED_KEY, '1'), undefined);
export const clearDerivLinked = () => safe(() => localStorage.removeItem(LINKED_KEY), undefined);

const hasSession = () =>
    safe(() => Boolean(JSON.parse(sessionStorage.getItem('auth_info') || 'null')?.access_token), false);

/**
 * Starts the Deriv login once per tab if this device was linked before and has no session.
 * Called before the app is drawn, so the page isn't loaded twice. Resolves true when leaving for Deriv.
 */
export const maybeAutoLogin = async (): Promise<boolean> => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('code') || params.has('error') || params.has('state')) return false; // returning from Deriv
    if (!safe(() => localStorage.getItem(LINKED_KEY) === '1', false) || hasSession()) return false;
    if (safe(() => sessionStorage.getItem(TRIED_KEY), null)) return false; // never loop if Deriv didn't log in
    safe(() => sessionStorage.setItem(TRIED_KEY, String(Date.now())), undefined);
    try {
        const { generateOAuthURL } = await import('@/components/shared/utils/config/config');
        const url = await generateOAuthURL();
        if (!url) return false;
        const msg = document.getElementById('kapa-boot-msg');
        if (msg) msg.textContent = 'Connecting to your Deriv account…';
        window.location.replace(url);
        return true;
    } catch {
        return false;
    }
};

/**
 * When the Deriv session has ended (no token in this tab), forgets the account details the template
 * keeps in localStorage. Otherwise the header shows "Demo account 0.00 USD" with no way to log in.
 */
export const clearStaleLogin = () => {
    const params = new URLSearchParams(window.location.search);
    if (params.has('code') || params.has('state')) return; // finishing a login right now
    if (hasSession()) return;
    safe(() => {
        ['active_loginid', 'accountsList', 'clientAccounts', 'authToken', 'account_type', 'callback_token'].forEach(k =>
            localStorage.removeItem(k)
        );
    }, undefined);
};
