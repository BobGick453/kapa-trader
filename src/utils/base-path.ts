/**
 * Path the app is served from, e.g. '/' or '/kapa-trader/' on GitHub Pages.
 * Set at build time with the PUBLIC_PATH environment variable.
 */
export const BASE_PATH = (() => {
    const p = process.env.PUBLIC_PATH || '/';
    return p.endsWith('/') ? p : `${p}/`;
})();

/** Router basename: BASE_PATH without its trailing slash ('' at the root). */
export const ROUTER_BASENAME = BASE_PATH.replace(/\/$/, '');

/** Absolute URL of the app's home page; also the OAuth redirect URL. */
export const getAppUrl = () => `${window.location.protocol}//${window.location.host}${BASE_PATH}`;
