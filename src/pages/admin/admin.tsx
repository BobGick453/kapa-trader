import React, { useCallback, useState } from 'react';
import { adminApi, premiumEnabled } from '../premium/premium-api';
import './admin.scss';

type TCode = { set: boolean; source: 'admin' | 'secret' | null; updatedAt: number | null; ready: boolean };
type TPay = {
    key: string;
    value: {
        status: string;
        amount: number;
        currency: string;
        method?: string;
        accounts: string[];
        createdAt: number;
        paidAt?: number;
        reason?: string;
    };
};

const SECRET_KEY = 'kapa_admin_secret';
const fmtDate = (t?: number) => (t ? new Date(t).toLocaleString() : '—');

const AdminPage = () => {
    const [secret, setSecret] = useState(() => {
        try {
            return sessionStorage.getItem(SECRET_KEY) || '';
        } catch {
            return '';
        }
    });
    const [input, setInput] = useState('');
    const [codeInfo, setCodeInfo] = useState<TCode | null>(null);
    const [pays, setPays] = useState<TPay[] | null>(null);
    const [newCode, setNewCode] = useState('');
    const [confirmCode, setConfirmCode] = useState('');
    const [showCode, setShowCode] = useState(false);
    const [saving, setSaving] = useState(false);
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');

    const load = useCallback(async (sec: string) => {
        setError('');
        try {
            const [c, p] = await Promise.all([adminApi.code(sec), adminApi.payments(sec)]);
            setCodeInfo(c);
            setPays(p.payments.sort((a: TPay, b: TPay) => b.value.createdAt - a.value.createdAt));
            return true;
        } catch (err: any) {
            setError(err?.message ?? 'Server error');
            return false;
        }
    }, []);

    React.useEffect(() => {
        if (secret) load(secret);
    }, [secret, load]);

    const unlock = async () => {
        if (await load(input)) {
            try {
                sessionStorage.setItem(SECRET_KEY, input); // this tab only; closing it signs out
            } catch {
                /* still works for this visit */
            }
            setSecret(input);
            try {
                localStorage.setItem('kapa_owner', '1'); // shows the Admin tab on this device from now on
            } catch {
                /* the tab stays reachable at #admin */
            }
            document.body.classList.add('kapa-owner');
            setInput('');
        }
    };
    const lock = () => {
        try {
            sessionStorage.removeItem(SECRET_KEY);
        } catch {
            /* nothing stored */
        }
        setSecret('');
        setCodeInfo(null);
        setPays(null);
    };
    const clean = (c: string) => c.replace(/[\s-]+/g, '').toUpperCase();
    const codeError = (() => {
        const c = clean(newCode);
        if (!c) return '';
        if (c.length < 8) return 'At least 8 characters (spaces and dashes not counted).';
        if (!/^[A-Z0-9_.@#!*+=]+$/.test(c)) return 'Use letters, digits or _ . @ # ! * + =';
        if (confirmCode && clean(confirmCode) !== c) return 'The two codes are different.';
        return '';
    })();
    const saveCode = async () => {
        if (codeError || !newCode || clean(confirmCode) !== clean(newCode)) return;
        const warn = codeInfo?.set
            ? 'Change the Premium code? Everyone using the current code, you included, must enter the new one.'
            : 'Save this Premium code?';
        if (!window.confirm(warn)) return;
        setSaving(true);
        setMsg('');
        setError('');
        try {
            const r = await adminApi.setCode(secret, newCode);
            setCodeInfo(c => ({ ...(c as TCode), set: true, source: 'admin', updatedAt: r.updatedAt }));
            setMsg(
                'New Premium code saved. Enter it in KAPA AI to unlock Premium on your devices, and send it to paying customers.'
            );
            setNewCode('');
            setConfirmCode('');
        } catch (e: any) {
            setError(e?.message ?? 'Server error');
        } finally {
            setSaving(false);
        }
    };

    if (!premiumEnabled()) {
        return (
            <div className='kapa-admin'>
                <section className='kapa-admin__card'>
                    <h2>Admin Dashboard</h2>
                    <p>
                        The Premium server isn&apos;t connected yet. Deploy it (see server/README.md on the
                        platform-source branch), then rebuild the site with its address in KAPA_API_URL.
                    </p>
                </section>
            </div>
        );
    }

    if (!secret) {
        return (
            <div className='kapa-admin'>
                <section className='kapa-admin__card kapa-admin__card--login'>
                    <h2>Admin Dashboard</h2>
                    <p>Enter the admin secret to change the Premium code and see payments.</p>
                    <input
                        type='password'
                        placeholder='Admin secret'
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && unlock()}
                        autoComplete='off'
                    />
                    <button type='button' className='kapa-admin__gold' onClick={unlock} disabled={!input}>
                        Unlock
                    </button>
                    {error && <p className='kapa-admin__error'>{error}</p>}
                </section>
            </div>
        );
    }

    return (
        <div className='kapa-admin'>
            <section className='kapa-admin__card'>
                <div className='kapa-admin__row'>
                    <h2>Admin Dashboard</h2>
                    <button type='button' className='kapa-admin__ghost' onClick={lock}>
                        Lock
                    </button>
                </div>
                <div className='kapa-admin__kpis'>
                    <div>
                        <small>Premium code</small>
                        <b>{codeInfo?.set ? 'Set' : 'Not set'}</b>
                    </div>
                    <div>
                        <small>Paid payments</small>
                        <b>{(pays || []).filter(p => p.value.status === 'paid').length}</b>
                    </div>
                    <div>
                        <small>Revenue</small>
                        <b>
                            {(pays || [])
                                .filter(p => p.value.status === 'paid')
                                .reduce((a, p) => a + p.value.amount, 0)
                                .toLocaleString()}{' '}
                            {pays?.[0]?.value.currency || 'XOF'}
                        </b>
                    </div>
                </div>
                {msg && <p className='kapa-admin__msg'>{msg}</p>}
                {error && <p className='kapa-admin__error'>{error}</p>}
            </section>

            <section className='kapa-admin__card'>
                <h3>Premium code</h3>
                <p className='kapa-admin__help'>
                    {codeInfo?.set
                        ? `A code is active${codeInfo.updatedAt ? ` since ${fmtDate(codeInfo.updatedAt)}` : ' (from the PREMIUM_CODE secret)'}. For security the code is never shown again, so keep it somewhere safe.`
                        : 'No code yet: nobody can unlock Premium. Choose one below.'}
                </p>
                <p className='kapa-admin__help'>
                    Changing the code locks Premium for everyone who used the old one, you included, until they enter
                    the new code. Use it when a subscription ends, then send the new code to customers who paid.
                </p>
                {codeInfo && !codeInfo.ready && (
                    <p className='kapa-admin__error'>
                        The server has no SESSION_KEY yet, so the code can&apos;t be saved.
                    </p>
                )}
                <div className='kapa-admin__code'>
                    <input
                        type={showCode ? 'text' : 'password'}
                        placeholder='New code (8+ characters)'
                        value={newCode}
                        onChange={e => setNewCode(e.target.value)}
                        autoComplete='new-password'
                        spellCheck={false}
                        aria-label='New Premium code'
                    />
                    <input
                        type={showCode ? 'text' : 'password'}
                        placeholder='Type it again'
                        value={confirmCode}
                        onChange={e => setConfirmCode(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && saveCode()}
                        autoComplete='new-password'
                        spellCheck={false}
                        aria-label='Confirm the new Premium code'
                    />
                    <label className='kapa-admin__show'>
                        <input type='checkbox' checked={showCode} onChange={e => setShowCode(e.target.checked)} /> Show
                    </label>
                    <button
                        type='button'
                        className='kapa-admin__gold'
                        onClick={saveCode}
                        disabled={saving || !newCode || !!codeError || clean(confirmCode) !== clean(newCode)}
                    >
                        {saving ? 'Saving…' : codeInfo?.set ? 'Change code' : 'Save code'}
                    </button>
                </div>
                {codeError && <p className='kapa-admin__error'>{codeError}</p>}
                <p className='kapa-admin__help'>
                    Spaces, dashes and letter case don&apos;t matter when the code is typed: &quot;ABCD-1234-XYZ&quot;
                    and &quot;abcd 1234 xyz&quot; are the same code.
                </p>
            </section>

            <section className='kapa-admin__card'>
                <h3>Payments</h3>
                <p className='kapa-admin__help'>
                    When a payment shows &quot;paid&quot;, send the Premium code to that customer. They give you the
                    payment reference shown on their screen.
                </p>
                <div className='kapa-admin__table'>
                    <table>
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Reference</th>
                                <th>Accounts</th>
                                <th>Amount</th>
                                <th>Method</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            {(pays || []).map(p => (
                                <tr key={p.key}>
                                    <td>{fmtDate(p.value.createdAt)}</td>
                                    <td className='kapa-admin__ref'>{p.key}</td>
                                    <td>{p.value.accounts.join(', ')}</td>
                                    <td>
                                        {p.value.amount.toLocaleString()} {p.value.currency}
                                    </td>
                                    <td>{p.value.method || '—'}</td>
                                    <td className={`st-${p.value.status}`}>{p.value.status}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!pays?.length && <p className='kapa-admin__empty'>No payments yet.</p>}
                </div>
            </section>
        </div>
    );
};

export default AdminPage;
