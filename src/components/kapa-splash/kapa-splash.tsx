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

const EXIT_MS = 650;

/**
 * Opening screen. It shows what is really happening and leaves as soon as the app is ready:
 * the app is drawn, and, when this tab is logging in, the Deriv account is shown.
 * It never stays more than a few seconds and a tap skips it. The animation is pure CSS
 * (transform and opacity), so it costs nothing to the app loading underneath.
 */
const KapaSplash = () => {
    const [ready, setReady] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const [gone, setGone] = useState(false);

    useEffect(() => {
        const start = Date.now();
        let done = false;
        const timers: ReturnType<typeof setTimeout>[] = [];
        const finish = () => {
            if (done) return;
            done = true;
            setReady(true);
            timers.push(setTimeout(() => setLeaving(true), 300));
            timers.push(setTimeout(() => setGone(true), 300 + EXIT_MS));
        };
        const tick = setInterval(() => {
            const drawn = Boolean(document.querySelector('.dc-tabs__list--main__tabs'));
            if (!drawn) return;
            const connected = !loggingIn() || Boolean(document.querySelector('.acc-info__wrapper'));
            // Ready, or the Deriv login is slow: the page itself shows its progress from here
            if ((connected && Date.now() - start > 500) || Date.now() - start > 5000) finish();
        }, 100);
        const cap = setTimeout(finish, 8000); // never hold the page longer than this
        return () => {
            clearInterval(tick);
            clearTimeout(cap);
            timers.forEach(clearTimeout);
        };
    }, []);

    if (gone) return null;
    return (
        <div
            className={`kapa-splash${leaving ? ' kapa-splash--out' : ''}`}
            onClick={() => {
                setLeaving(true);
                setTimeout(() => setGone(true), EXIT_MS);
            }}
            role='presentation'
        >
            <div className='kapa-splash__glow kapa-splash__glow--a' />
            <div className='kapa-splash__glow kapa-splash__glow--b' />
            <div className='kapa-splash__floor' />
            <div className='kapa-splash__frame' aria-hidden>
                <i className='kapa-splash__edge kapa-splash__edge--t' />
                <i className='kapa-splash__edge kapa-splash__edge--r' />
                <i className='kapa-splash__edge kapa-splash__edge--b' />
                <i className='kapa-splash__edge kapa-splash__edge--l' />
                <i className='kapa-splash__corner kapa-splash__corner--tl' />
                <i className='kapa-splash__corner kapa-splash__corner--tr' />
                <i className='kapa-splash__corner kapa-splash__corner--bl' />
                <i className='kapa-splash__corner kapa-splash__corner--br' />
            </div>
            <div className='kapa-splash__in'>
                <div className='kapa-splash__tag'>Digit trading on Deriv</div>
                <div className='kapa-splash__emblem'>
                    <span className='kapa-splash__ring kapa-splash__ring--outer'>
                        <i />
                    </span>
                    <span className='kapa-splash__ring kapa-splash__ring--inner'>
                        <i />
                    </span>
                    <span className='kapa-splash__sweep' />
                    <svg className='kapa-splash__draw' viewBox='0 0 100 100' aria-hidden>
                        <circle cx='50' cy='50' r='34' pathLength='100' />
                    </svg>
                    <span className='kapa-splash__mark'>KA</span>
                    <i className='kapa-splash__spark kapa-splash__spark--1' />
                    <i className='kapa-splash__spark kapa-splash__spark--2' />
                    <i className='kapa-splash__spark kapa-splash__spark--3' />
                </div>
                <div className='kapa-splash__brand'>
                    <span className='kapa-splash__word kapa-splash__word--l'>KAPA</span>
                    <i className='kapa-splash__gem' aria-hidden />
                    <span className='kapa-splash__word kapa-splash__word--r'>TRADER</span>
                </div>
                <div className='kapa-splash__sub'>Plan · Execute · Stop on time</div>
                <div className={`kapa-splash__step${ready ? ' kapa-splash__step--ready' : ''}`} aria-live='polite'>
                    {ready ? 'Ready' : 'Connecting to Deriv…'}
                </div>
            </div>
        </div>
    );
};

export default KapaSplash;
