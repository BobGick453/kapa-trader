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

/**
 * Opening screen. It shows what is really happening and leaves as soon as the app is ready:
 * the app is drawn, and, when this tab is logging in, the Deriv account is shown.
 * It never stays more than a few seconds and a tap skips it.
 */
const KapaSplash = () => {
    const [step, setStep] = useState<'load' | 'deriv' | 'ready'>('load');
    const [leaving, setLeaving] = useState(false);
    const [gone, setGone] = useState(false);

    useEffect(() => {
        const start = Date.now();
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            setStep('ready');
            setTimeout(() => setLeaving(true), 350);
            setTimeout(() => setGone(true), 750);
        };
        const tick = setInterval(() => {
            const drawn = Boolean(document.querySelector('.dc-tabs__list--main__tabs'));
            if (!drawn) return;
            const login = loggingIn();
            const connected = !login || Boolean(document.querySelector('.acc-info__wrapper'));
            if (!connected) setStep('deriv');
            // Ready, or the Deriv login is slow: the page itself shows its progress from here
            if ((connected && Date.now() - start > 500) || Date.now() - start > 5000) finish();
        }, 100);
        const cap = setTimeout(finish, 8000); // never hold the page longer than this
        return () => {
            clearInterval(tick);
            clearTimeout(cap);
        };
    }, []);

    if (gone) return null;
    const text = step === 'ready' ? 'System ready' : step === 'deriv' ? 'Connecting to Deriv…' : 'Loading Kapa Trader…';
    return (
        <div
            className={`kapa-splash${leaving ? ' kapa-splash--out' : ''}`}
            onClick={() => {
                setLeaving(true);
                setTimeout(() => setGone(true), 400);
            }}
            role='presentation'
        >
            <span className='kapa-splash__corner kapa-splash__corner--tl' />
            <span className='kapa-splash__corner kapa-splash__corner--tr' />
            <span className='kapa-splash__corner kapa-splash__corner--bl' />
            <span className='kapa-splash__corner kapa-splash__corner--br' />
            <div className='kapa-splash__in'>
                <div className='kapa-splash__tag'>Digit trading on Deriv</div>
                <div className='kapa-splash__mark'>
                    <span>KA</span>
                </div>
                <div className='kapa-splash__name'>KAPA TRADER</div>
                <div className='kapa-splash__ai'>AI</div>
                <div className='kapa-splash__sub'>Plan · Execute · Stop on time</div>
                <div className='kapa-splash__line' />
                <div className={`kapa-splash__step${step === 'ready' ? ' kapa-splash__step--ready' : ''}`}>{text}</div>
            </div>
        </div>
    );
};

export default KapaSplash;
