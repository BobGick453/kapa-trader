import { useEffect, useState } from 'react';
import './kapa-splash.scss';

const hasSession = () => {
    try {
        return Boolean(JSON.parse(sessionStorage.getItem('auth_info') || 'null')?.access_token);
    } catch {
        return false;
    }
};
const loggingIn = () => {
    const p = new URLSearchParams(window.location.search);
    return p.has('code') || p.has('state') || hasSession();
};
const reducedMotion = () => {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
};

// The intro follows the reference bot's choreography (frame, grid floor, emblem, words, statement, progress line,
// status, exit), played at SPEED of its timing so the app is usable sooner. Keep in step with $speed in the SCSS.
const SPEED = 0.6;
const READY_AT = 4050 * SPEED; // the status line turns to "Ready" (never before the app is drawn and connected)
const EXIT_AFTER = 250 * SPEED; // the exit starts this long after "Ready"
const EXIT_MS = 700 * SPEED;

/**
 * Opening screen. It plays the intro, then leaves once the app underneath is ready: the page is drawn and, when this
 * tab is logging in, the Deriv account is shown. It never stays more than a few seconds and a tap skips it. Every
 * animation is CSS (transform and opacity, one SVG stroke), so it costs nothing to the app loading underneath.
 */
const KapaSplash = () => {
    const [ready, setReady] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const [gone, setGone] = useState(false);

    useEffect(() => {
        const start = Date.now();
        const min = reducedMotion() ? 300 : READY_AT;
        let done = false;
        const timers: ReturnType<typeof setTimeout>[] = [];
        const finish = () => {
            if (done) return;
            done = true;
            setReady(true);
            timers.push(setTimeout(() => setLeaving(true), EXIT_AFTER));
            timers.push(setTimeout(() => setGone(true), EXIT_AFTER + EXIT_MS));
        };
        const tick = setInterval(() => {
            const drawn = Boolean(document.querySelector('.dc-tabs__list--main__tabs'));
            if (!drawn) return;
            const connected = !loggingIn() || Boolean(document.querySelector('.acc-info__wrapper'));
            const t = Date.now() - start;
            // Ready, or the Deriv login is slow: the page itself shows its progress from here
            if ((connected && t >= min) || t > 5000) finish();
        }, 50);
        const cap = setTimeout(finish, 8000); // never hold the page longer than this
        return () => {
            clearInterval(tick);
            clearTimeout(cap);
            timers.forEach(clearTimeout);
        };
    }, []);

    if (gone) return null;
    return (
        <section
            className={`kapa-splash${leaving ? ' kapa-splash--out' : ''}${ready ? ' kapa-splash--ready' : ''}`}
            onClick={() => {
                setLeaving(true);
                setTimeout(() => setGone(true), EXIT_MS);
            }}
            role='presentation'
            aria-label='Kapa Trader is loading'
        >
            <div className='kapa-splash__grid' aria-hidden />
            <div className='kapa-splash__glow kapa-splash__glow--top' aria-hidden />
            <div className='kapa-splash__glow kapa-splash__glow--bottom' aria-hidden />
            <div className='kapa-splash__frame' aria-hidden>
                <span className='kapa-splash__corner kapa-splash__corner--tl' />
                <span className='kapa-splash__corner kapa-splash__corner--tr' />
                <span className='kapa-splash__corner kapa-splash__corner--bl' />
                <span className='kapa-splash__corner kapa-splash__corner--br' />
            </div>
            <div className='kapa-splash__content'>
                <p className='kapa-splash__edition'>DIGIT TRADING ON DERIV</p>
                <div className='kapa-splash__emblem' aria-hidden>
                    <span className='kapa-splash__orbit kapa-splash__orbit--outer' />
                    <span className='kapa-splash__orbit kapa-splash__orbit--inner' />
                    <span className='kapa-splash__sweep' />
                    <svg viewBox='0 0 120 120' focusable='false'>
                        <circle className='kapa-splash__coin' cx='60' cy='60' r='50' pathLength='420' />
                        <circle className='kapa-splash__coin-inner' cx='60' cy='60' r='41' pathLength='420' />
                    </svg>
                    <span className='kapa-splash__monogram'>KA</span>
                    <span className='kapa-splash__spark kapa-splash__spark--one' />
                    <span className='kapa-splash__spark kapa-splash__spark--two' />
                    <span className='kapa-splash__spark kapa-splash__spark--three' />
                </div>
                <div className='kapa-splash__lockup'>
                    <div className='kapa-splash__brand kapa-splash__brand--left'>
                        <span>KAPA</span>
                        <small>TRADER</small>
                    </div>
                    <span className='kapa-splash__cross' aria-hidden>
                        ×
                    </span>
                    <div className='kapa-splash__brand kapa-splash__brand--right'>
                        <span>AI</span>
                        <small>RULES-BASED</small>
                    </div>
                </div>
                <p className='kapa-splash__statement'>PLAN · EXECUTE · STOP ON TIME</p>
                <div className='kapa-splash__progress' aria-live='polite'>
                    <span className='kapa-splash__track'>
                        <span className='kapa-splash__fill' />
                    </span>
                    <span className='kapa-splash__status kapa-splash__status--wait'>CONNECTING TO DERIV</span>
                    <span className='kapa-splash__status kapa-splash__status--ready'>READY</span>
                </div>
            </div>
        </section>
    );
};

export default KapaSplash;
