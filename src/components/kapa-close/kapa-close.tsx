import React from 'react';
import classNames from 'classnames';
import './kapa-close.scss';

/** The one circled "×" used to close Kapa windows: same size, same centred cross everywhere. */
const KapaClose = ({ onClick, className, label = 'Close' }: { onClick: () => void; className?: string; label?: string }) => (
    <button type='button' className={classNames('kapa-close', className)} onClick={onClick} aria-label={label} title={label}>
        <svg viewBox='0 0 24 24' width='16' height='16' aria-hidden>
            <path d='M6 6l12 12M18 6L6 18' fill='none' stroke='currentColor' strokeWidth='2.4' strokeLinecap='round' />
        </svg>
    </button>
);

export default KapaClose;
