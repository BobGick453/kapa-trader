import React, { useCallback, useState } from 'react';
import { adminApi, premiumEnabled } from '../premium/premium-api';
import './admin.scss';

type TEnt = { key: string; value: { plan: string; expiresAt: number; source: string; accounts?: string[] } };
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
    const [ents, setEnts] = useState<TEnt[] | null>(null);
    const [pays, setPays] = useState<TPay[] | null>(null);
    const [account, setAccount] = useState('');
    const [days, setDays] = useState(30);
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');

    const load = useCallback(async (sec: string) => {
        setError('');
        try {
            const [e, p] = await Promise.all([adminApi.entitlements(sec), adminApi.payments(sec)]);
            setEnts(e.entitlements);
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
        setEnts(null);
        setPays(null);
    };
    const doGrant = async () => {
        setMsg('');
        try {
            const r = await adminApi.grant(secret, account.trim(), days);
            setMsg(`Premium granted to ${account.trim()} until ${fmtDate(r.entitlement.expiresAt)}.`);
            setAccount('');
            load(secret);
        } catch (e: any) {
            setError(e?.message ?? 'Server error');
        }
    };
    const doRevoke = async (id: string) => {
        if (!window.confirm(`Remove Premium from ${id}?`)) return;
        try {
            await adminApi.revoke(secret, id);
            setMsg(`Premium removed from ${id}.`);
            load(secret);
        } catch (e: any) {
            setError(e?.message ?? 'Server error');
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
                    <p>Enter the admin secret to manage Premium memberships and payments.</p>
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

    const now = Date.now();
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
                        <small>Active members</small>
                        <b>
                            {
                                new Set(
                                    (ents || [])
                                        .filter(e => e.value.expiresAt > now)
                                        .map(e => (e.value.accounts || [e.key]).join())
                                ).size
                            }
                        </b>
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
                <h3>Grant Premium</h3>
                <div className='kapa-admin__grant'>
                    <input
                        placeholder='Deriv account ID, e.g. ROT90001'
                        value={account}
                        onChange={e => setAccount(e.target.value)}
                    />
                    <input
                        type='number'
                        min={1}
                        max={3650}
                        value={days}
                        onChange={e => setDays(+e.target.value)}
                        aria-label='Days'
                    />
                    <button type='button' className='kapa-admin__gold' onClick={doGrant} disabled={!account.trim()}>
                        Grant
                    </button>
                </div>
            </section>

            <section className='kapa-admin__card'>
                <h3>Members</h3>
                <div className='kapa-admin__table'>
                    <table>
                        <thead>
                            <tr>
                                <th>Account</th>
                                <th>Expires</th>
                                <th>Source</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {(ents || []).map(e => (
                                <tr key={e.key} className={e.value.expiresAt > now ? '' : 'expired'}>
                                    <td>{e.key}</td>
                                    <td>{fmtDate(e.value.expiresAt)}</td>
                                    <td>{e.value.source}</td>
                                    <td>
                                        <button
                                            type='button'
                                            className='kapa-admin__ghost'
                                            onClick={() => doRevoke(e.key)}
                                        >
                                            Revoke
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!ents?.length && <p className='kapa-admin__empty'>No members yet.</p>}
                </div>
            </section>

            <section className='kapa-admin__card'>
                <h3>Payments</h3>
                <div className='kapa-admin__table'>
                    <table>
                        <thead>
                            <tr>
                                <th>Date</th>
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
