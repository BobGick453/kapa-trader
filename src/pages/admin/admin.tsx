import React, { useCallback, useState } from 'react';
import { adminApi, premiumEnabled, TAdminOverview } from '../premium/premium-api';
import './admin.scss';

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
        until?: number;
        reason?: string;
    };
};

const SECRET_KEY = 'kapa_admin_secret';
const fmtDate = (t?: number | null) => (t ? new Date(t).toLocaleString() : '—');
const fmtDay = (t?: number | null) => (t ? new Date(t).toLocaleDateString() : '—');
const SOURCE: Record<string, string> = { payment: 'Payment', gift: 'Gift code', admin: 'Admin', code: 'Old shared code' };

const AdminPage = () => {
    const [secret, setSecret] = useState(() => {
        try {
            return sessionStorage.getItem(SECRET_KEY) || '';
        } catch {
            return '';
        }
    });
    const [input, setInput] = useState('');
    const [ov, setOv] = useState<TAdminOverview | null>(null);
    const [pays, setPays] = useState<TPay[] | null>(null);
    const [account, setAccount] = useState('');
    const [days, setDays] = useState('');
    const [giftLabel, setGiftLabel] = useState('');
    const [giftUses, setGiftUses] = useState('1');
    const [newGift, setNewGift] = useState<{ code: string; label: string } | null>(null);
    const [wa, setWa] = useState('');
    const [tg, setTg] = useState('');
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState('');
    const [error, setError] = useState('');

    const load = useCallback(async (sec: string) => {
        setError('');
        try {
            const [o, p] = await Promise.all([adminApi.overview(sec), adminApi.payments(sec)]);
            setOv(o);
            setWa(o.contact.whatsapp);
            setTg(o.contact.telegram);
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
        setOv(null);
        setPays(null);
    };
    /** Runs an admin action, shows its message, then reloads the lists. */
    const act = async (fn: () => Promise<unknown>, done: string) => {
        setBusy(true);
        setMsg('');
        setError('');
        try {
            await fn();
            setMsg(done);
            await load(secret);
        } catch (e: any) {
            setError(e?.message ?? 'Server error');
        } finally {
            setBusy(false);
        }
    };
    const activate = () =>
        act(
            () => adminApi.activate(secret, account.trim(), days ? Math.floor(+days) : undefined),
            `Premium switched on for ${account.trim().toUpperCase()} (${days || ov?.days || 30} days, added to any days left).`
        ).then(() => {
            setAccount('');
            setDays('');
        });
    const revoke = (acc: string) => {
        if (!window.confirm(`End Premium now for ${acc}?`)) return;
        act(() => adminApi.revoke(secret, acc), `Premium ended for ${acc}.`);
    };
    const createGift = async () => {
        setBusy(true);
        setMsg('');
        setError('');
        try {
            const r = await adminApi.createGift(secret, { label: giftLabel.trim() || 'Gift', maxUses: Math.max(1, Math.floor(+giftUses || 1)) });
            setNewGift({ code: r.code, label: r.gift.label });
            setGiftLabel('');
            setGiftUses('1');
            await load(secret);
        } catch (e: any) {
            setError(e?.message ?? 'Server error');
        } finally {
            setBusy(false);
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
                    <p>Enter the admin secret to manage Premium accounts, gift codes and payments.</p>
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

    const active = (ov?.entitlements || []).filter(e => e.active);
    const ended = (ov?.entitlements || []).filter(e => !e.active);
    const paid = (pays || []).filter(p => p.value.status === 'paid');
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
                        <small>Premium accounts</small>
                        <b>{active.length}</b>
                    </div>
                    <div>
                        <small>Paid payments</small>
                        <b>{paid.length}</b>
                    </div>
                    <div>
                        <small>Revenue</small>
                        <b>
                            {paid.reduce((a, p) => a + p.value.amount, 0).toLocaleString()}{' '}
                            {pays?.[0]?.value.currency || ov?.payments.currency || 'XOF'}
                        </b>
                    </div>
                </div>
                {ov && !ov.ready && (
                    <p className='kapa-admin__error'>The server has no SESSION_KEY yet: gift codes can&apos;t be made.</p>
                )}
                {msg && <p className='kapa-admin__msg'>{msg}</p>}
                {error && <p className='kapa-admin__error'>{error}</p>}
            </section>

            <section className='kapa-admin__card'>
                <h3>Premium accounts</h3>
                <p className='kapa-admin__help'>
                    Premium belongs to a Deriv account for {ov?.days ?? 30} days and ends by itself. It starts after a
                    payment confirmed by CinetPay, a gift code, or here. Switching it on for an account that already
                    has Premium adds the days to its end date.
                </p>
                <div className='kapa-admin__code'>
                    <input
                        placeholder='Deriv account ID (CR1234567, VRTC1234567…)'
                        value={account}
                        onChange={e => setAccount(e.target.value)}
                        spellCheck={false}
                        aria-label='Deriv account ID'
                    />
                    <input
                        type='number'
                        min={1}
                        max={366}
                        placeholder={`Days (${ov?.days ?? 30})`}
                        value={days}
                        onChange={e => setDays(e.target.value)}
                        aria-label='Days of Premium'
                    />
                    <button type='button' className='kapa-admin__gold' onClick={activate} disabled={busy || !account.trim()}>
                        Switch Premium on
                    </button>
                </div>
                <div className='kapa-admin__table'>
                    <table>
                        <thead>
                            <tr>
                                <th>Accounts</th>
                                <th>Until</th>
                                <th>Since</th>
                                <th>From</th>
                                <th>Status</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {[...active, ...ended].map(e => (
                                <tr key={e.accounts.join(',')}>
                                    <td className='kapa-admin__ref'>{e.accounts.join(', ')}</td>
                                    <td>{fmtDay(e.until)}</td>
                                    <td>{fmtDay(e.since)}</td>
                                    <td>
                                        {SOURCE[e.source] || e.source}
                                        {e.ref ? ` · ${e.ref}` : ''}
                                    </td>
                                    <td className={e.active ? 'st-paid' : 'st-failed'}>
                                        {e.active ? 'active' : e.revokedAt ? 'revoked' : 'ended'}
                                    </td>
                                    <td>
                                        {e.active && (
                                            <button
                                                type='button'
                                                className='kapa-admin__ghost'
                                                onClick={() => revoke(e.accounts[0])}
                                                disabled={busy}
                                            >
                                                End now
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!ov?.entitlements.length && <p className='kapa-admin__empty'>No Premium accounts yet.</p>}
                </div>
            </section>

            <section className='kapa-admin__card'>
                <h3>Gift codes</h3>
                <p className='kapa-admin__help'>
                    Each use of a gift code gives {ov?.days ?? 30} days of Premium to the Deriv account that enters it
                    (once per account). The code is shown only once, right after you make it: copy it before leaving
                    this page.
                </p>
                <div className='kapa-admin__code'>
                    <input
                        placeholder='Name (for you): e.g. Friends, Promo November'
                        value={giftLabel}
                        onChange={e => setGiftLabel(e.target.value)}
                        aria-label='Gift code name'
                    />
                    <input
                        type='number'
                        min={1}
                        max={10000}
                        value={giftUses}
                        onChange={e => setGiftUses(e.target.value)}
                        aria-label='How many uses'
                        title='How many people can use it'
                    />
                    <button type='button' className='kapa-admin__gold' onClick={createGift} disabled={busy || !ov?.ready}>
                        Make a gift code
                    </button>
                </div>
                {newGift && (
                    <p className='kapa-admin__msg kapa-admin__newcode'>
                        New code ({newGift.label}): <b>{newGift.code}</b>{' '}
                        <button type='button' className='kapa-admin__ghost' onClick={() => navigator.clipboard?.writeText(newGift.code)}>
                            Copy
                        </button>
                    </p>
                )}
                <div className='kapa-admin__table'>
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>Ends with</th>
                                <th>Used</th>
                                <th>Days</th>
                                <th>Made</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {(ov?.gifts || []).map(g => (
                                <tr key={g.id}>
                                    <td>{g.label}</td>
                                    <td className='kapa-admin__ref'>…{g.hint}</td>
                                    <td>
                                        {g.uses} / {g.maxUses}
                                    </td>
                                    <td>{g.days}</td>
                                    <td>{fmtDay(g.createdAt)}</td>
                                    <td>
                                        <button
                                            type='button'
                                            className='kapa-admin__ghost'
                                            disabled={busy}
                                            onClick={() =>
                                                act(
                                                    () => adminApi.disableGift(secret, g.id, !g.disabled),
                                                    g.disabled ? `${g.label}: switched on again.` : `${g.label}: switched off.`
                                                )
                                            }
                                        >
                                            {g.disabled ? 'Switch on' : 'Switch off'}
                                        </button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!ov?.gifts.length && <p className='kapa-admin__empty'>No gift codes yet.</p>}
                </div>
            </section>

            <section className='kapa-admin__card'>
                <h3>Contact for buyers</h3>
                <p className='kapa-admin__help'>
                    {ov?.payments.configured
                        ? `Payments by CinetPay are on (${ov.payments.price.toLocaleString()} ${ov.payments.currency}). These links are shown as well.`
                        : 'Payments by CinetPay are not set up: visitors who want Premium are sent to this WhatsApp number (with their Deriv account ID in the message). Without a number, they see "Premium purchase opens soon".'}
                </p>
                <div className='kapa-admin__code'>
                    <input
                        placeholder='WhatsApp number with country code, e.g. 2250700000000'
                        value={wa}
                        onChange={e => setWa(e.target.value)}
                        inputMode='tel'
                        aria-label='WhatsApp number'
                    />
                    <input
                        placeholder='Telegram username (optional)'
                        value={tg}
                        onChange={e => setTg(e.target.value)}
                        aria-label='Telegram username'
                    />
                    <button
                        type='button'
                        className='kapa-admin__gold'
                        disabled={busy}
                        onClick={() => act(() => adminApi.saveContact(secret, { whatsapp: wa, telegram: tg }), 'Contact saved.')}
                    >
                        Save
                    </button>
                </div>
            </section>

            <section className='kapa-admin__card'>
                <h3>Payments</h3>
                <p className='kapa-admin__help'>
                    A payment marked &quot;paid&quot; has switched Premium on for the buyer&apos;s Deriv accounts by
                    itself. Nothing to send.
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
                                <th>Premium until</th>
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
                                    <td>{fmtDay(p.value.until)}</td>
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
