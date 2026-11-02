/**
 * Path the app is served from, e.g. '/' or '/kapa-trader/' on GitHub Pages.
 * Set at build time with the PUBLIC_PATH environment variable.
 */
export const BASE_PATH = (() => {
    const p = process.env.PUBLIC_PATH || '/';
    return p.endsWith('/') ? p : `${p}/`;
})();

/**
 * Router basename. It keeps the trailing slash so the address stays /kapa-trader/#tab:
 * without it, switching tabs produced /kapa-trader#tab, which some hosts don't serve on reload.
 */
export const ROUTER_BASENAME = BASE_PATH;

/** Absolute URL of the app's home page; also the OAuth redirect URL. */
export const getAppUrl = () => `${window.location.protocol}//${window.location.host}${BASE_PATH}`;
