import React, { useEffect, useState } from 'react';
import './kapa-splash.scss';

const STEPS = ['Initializing Kapa AI', 'Connecting to Deriv…', 'System ready'];

/** Opening screen shown for a moment on every visit, like the reference bot's. Tap to skip. */
const KapaSplash = () => {
    const [step, setStep] = useState(0);
    const [leaving, setLeaving] = useState(false);
    const [gone, setGone] = useState(false);

    useEffect(() => {
        const timers = [
            setTimeout(() => setStep(1), 900),
            setTimeout(() => setStep(2), 1800),
            setTimeout(() => setLeaving(true), 2500),
            setTimeout(() => setGone(true), 3000),
        ];
        return () => timers.forEach(clearTimeout);
    }, []);

    if (gone) return null;
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
                <div className={`kapa-splash__step${step === 2 ? ' kapa-splash__step--ready' : ''}`}>{STEPS[step]}</div>
            </div>
        </div>
    );
};

export default KapaSplash;
