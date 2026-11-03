import React, { useEffect, useRef, useState } from 'react';
import lossPoster from './media/kapa-loss.jpg';
import lossVideo from './media/kapa-loss.mp4';
import lossWebm from './media/kapa-loss.webm';
import winPoster from './media/kapa-win.jpg';
import winVideo from './media/kapa-win.mp4';
import winWebm from './media/kapa-win.webm';

const prefersReducedMotion = () => {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
};

/** Kapa robot animation for the session result: celebrating after a profit, worried after a loss. */
export const KapaClip = ({ win }: { win: boolean }) => {
    const ref = useRef<HTMLVideoElement>(null);
    const [still] = useState(prefersReducedMotion);
    useEffect(() => {
        const v = ref.current;
        if (!v || still) return;
        v.muted = true; // some browsers only autoplay muted videos
        v.play().catch(() => {
            /* autoplay refused: the poster image stays */
        });
    }, [win, still]);
    if (still) return <img src={win ? winPoster : lossPoster} alt='' />;
    return (
        <video
            ref={ref}
            key={win ? 'win' : 'loss'}
            poster={win ? winPoster : lossPoster}
            autoPlay
            muted
            loop
            playsInline
            preload='auto'
            aria-hidden
            disablePictureInPicture
        >
            <source src={win ? winVideo : lossVideo} type='video/mp4' />
            <source src={win ? winWebm : lossWebm} type='video/webm' />
        </video>
    );
};

/** Counts a number up from 0 for the result amount. */
export const useCountUp = (target: number, ms = 900) => {
    const [value, setValue] = useState(prefersReducedMotion() ? target : 0);
    useEffect(() => {
        if (prefersReducedMotion()) return setValue(target);
        let raf = 0;
        const start = performance.now();
        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / ms);
            setValue(target * (1 - Math.pow(1 - t, 3)));
            if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [target, ms]);
    return value;
};

/** The result amount, counting up when the dialog opens. */
export const CountUp = ({ value }: { value: number }) => <>{useCountUp(value).toFixed(2)}</>;
