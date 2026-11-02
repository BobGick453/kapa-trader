import React, { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A floating button that the user can drag anywhere on screen. On release it snaps to the
 * nearest side; its place is remembered for the next visit. A short tap still works as a click.
 */
type TSpot = { side: 'left' | 'right'; y: number }; // y: 0 (top) to 1 (bottom) of the free height

const EDGE = 12; // px from the screen edge
const TOP = 64; // keeps clear of the header
const DRAG_THRESHOLD = 6; // px of movement before a press becomes a drag

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const defaultBottomGap = () => (window.innerWidth >= 1280 ? 44 : 16); // the desktop footer is 36px tall

const readSpot = (key: string, fallback: TSpot): TSpot => {
    try {
        const s = JSON.parse(localStorage.getItem(key) || 'null');
        if (s && (s.side === 'left' || s.side === 'right') && typeof s.y === 'number' && s.y >= 0 && s.y <= 1) return s;
    } catch {
        /* storage unavailable: use the default place */
    }
    return fallback;
};

export const useFloating = (
    key: string,
    fallback: () => TSpot,
    size: number,
    bottomGap: () => number = defaultBottomGap
) => {
    const [spot, setSpot] = useState<TSpot>(() => readSpot(key, fallback()));
    const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
    const [, setViewport] = useState(0);
    const start = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
    const moved = useRef(false);
    const dragAt = useRef<{ x: number; y: number } | null>(null);

    // Re-place the button when the screen turns or resizes
    useEffect(() => {
        const onResize = () => setViewport(n => n + 1);
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, []);

    const freeHeight = () => Math.max(0, window.innerHeight - TOP - bottomGap() - size);

    const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
        if (e.button !== 0) return;
        const r = e.currentTarget.getBoundingClientRect();
        start.current = { px: e.clientX, py: e.clientY, x: r.left, y: r.top };
        moved.current = false;
        e.currentTarget.setPointerCapture?.(e.pointerId);
    }, []);

    const onPointerMove = useCallback(
        (e: React.PointerEvent<HTMLElement>) => {
            const s = start.current;
            if (!s) return;
            const dx = e.clientX - s.px;
            const dy = e.clientY - s.py;
            if (!moved.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
            moved.current = true;
            dragAt.current = {
                x: clamp(s.x + dx, 0, window.innerWidth - size),
                y: clamp(s.y + dy, TOP, window.innerHeight - bottomGap() - size),
            };
            setDrag(dragAt.current);
        },
        [size]
    );

    const onPointerUp = useCallback(() => {
        start.current = null;
        const d = dragAt.current;
        dragAt.current = null;
        if (d && moved.current) {
            const next: TSpot = {
                side: d.x + size / 2 < window.innerWidth / 2 ? 'left' : 'right',
                y: clamp((d.y - TOP) / (freeHeight() || 1), 0, 1),
            };
            setSpot(next);
            try {
                localStorage.setItem(key, JSON.stringify(next));
            } catch {
                /* the place lasts for this visit only */
            }
        }
        setDrag(null);
    }, [key, size]); // eslint-disable-line react-hooks/exhaustive-deps

    // A drag must not also count as a tap
    const onClickCapture = useCallback((e: React.MouseEvent) => {
        if (moved.current) {
            e.preventDefault();
            e.stopPropagation();
            moved.current = false;
        }
    }, []);

    const style: React.CSSProperties = drag
        ? { left: drag.x, top: drag.y, right: 'auto', bottom: 'auto', transition: 'none' }
        : {
              [spot.side]: `calc(${EDGE}px + env(safe-area-inset-${spot.side}, 0px))`,
              [spot.side === 'left' ? 'right' : 'left']: 'auto',
              top: TOP + spot.y * freeHeight(),
              bottom: 'auto',
          };

    return {
        style,
        dragging: Boolean(drag),
        handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onClickCapture },
    };
};
