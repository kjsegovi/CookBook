import { useEffect, useId, useRef, useState } from 'react';
import { Copy, Download, ExternalLink, ListChecks, RefreshCw } from 'lucide-react';
import type { ShoppingItem } from '../lib/domain';
import { request } from '../lib/api';
import { appUrl } from '../lib/supabase';
import { remindersHandoff, remindersReturnId, REMINDERS_SHORTCUT, type RemindersEnvelope, type RemindersStatus } from '../lib/reminders';

export default function RemindersSync({ items, household, busy, onUpdated }: { items: ShoppingItem[]; household: string; busy: boolean; onUpdated: () => Promise<void> }) {
    const storageKey = 'cookbook-reminders-list:' + household, pendingKey = 'cookbook-reminders-pending:' + household;
    const [list, setList] = useState(() => { try { return localStorage.getItem(storageKey) || 'Groceries'; } catch { return 'Groceries'; } });
    const [pending, setPending] = useState<string | null>(() => remindersReturnId(location.hash) || (() => { try { return localStorage.getItem(pendingKey); } catch { return null; } })());
    const [envelope, setEnvelope] = useState<RemindersEnvelope>(), [preparing, setPreparing] = useState(false);
    const [message, setMessage] = useState(''), [error, setError] = useState(''), [copiedText, setCopiedText] = useState('');
    const inFlight = useRef(false), id = useId();
    const handoff = envelope ? remindersHandoff(envelope) : undefined;
    const validList = !!list.trim() && list.trim().length <= 100;
    const ready = !busy && !preparing && validList && items.length > 0;
    const copied = handoff?.text === copiedText;
    const remember = () => { try { localStorage.setItem(storageKey, list.trim()); } catch { /* Works without browser storage. */ } };
    useEffect(() => {
        const returned = () => { const id = remindersReturnId(location.hash); if (id) setPending(id); };
        window.addEventListener('hashchange', returned);
        return () => window.removeEventListener('hashchange', returned);
    }, []);
    useEffect(() => {
        if (!pending || busy) return;
        let active = true, checking = false, completed = false;
        const deadline = Date.now() + 15 * 60000;
        const check = async () => {
            if (checking || completed) return;
            if (Date.now() >= deadline) {
                completed = true; setPending(null); setEnvelope(undefined);
                try { localStorage.removeItem(pendingKey); } catch { /* Optional storage. */ }
                setMessage('This sync has no final confirmation. Tap Sync groceries to retry; any checkmarks already saved are kept.');
                return;
            }
            checking = true;
            try {
                const status = await request<RemindersStatus>('reminders/status?id=' + encodeURIComponent(pending));
                if (!active) return;
                if (status.phase === 'complete') {
                    completed = true;
                    setError(''); setEnvelope(undefined); setPending(null);
                    try { localStorage.removeItem(pendingKey); } catch { /* Optional storage. */ }
                    setMessage(`Synced ${status.count} ${status.count === 1 ? 'grocery' : 'groceries'} with Reminders.${status.skipped ? ` ${status.skipped} changed or removed ${status.skipped === 1 ? 'item was' : 'items were'} skipped; sync again for the latest list.` : ''}`);
                    await onUpdated();
                } else if (status.phase === 'finishing') {
                    setMessage('Checkmarks reached CookBook. Shortcuts is still finishing the Reminders updates; return to Shortcuts if it needs your attention.');
                    await onUpdated();
                }
            } catch (e) { if (active) setError(e instanceof Error ? e.message : 'Could not check this sync. Try again.'); }
            finally { checking = false; }
        };
        void check();
        const interval = window.setInterval(() => { if (document.visibilityState === 'visible') void check(); }, 5000);
        const focus = () => void check(); window.addEventListener('focus', focus);
        return () => { active = false; clearInterval(interval); window.removeEventListener('focus', focus); };
    }, [pending, pendingKey, busy, onUpdated]);
    const start = async () => {
        if (!ready || inFlight.current) return;
        inFlight.current = true; setPreparing(true); setError(''); setMessage('Preparing your grocery sync…'); setEnvelope(undefined); setCopiedText('');
        try {
            const next = await request<RemindersEnvelope>('reminders/begin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ list: list.trim(), returnUrl: appUrl() }) });
            remember(); setEnvelope(next); setPending(next.scope.id);
            try { localStorage.setItem(pendingKey, next.scope.id); } catch { /* Return links also identify the sync. */ }
            setMessage('Ready. Open Shortcuts below to exchange checkmarks. This connection expires in 15 minutes.');
        } catch (e) { setError(e instanceof Error ? e.message : 'Could not prepare this sync. Try again.'); setMessage(''); }
        finally { inFlight.current = false; setPreparing(false); }
    };
    const copy = async () => {
        if (!handoff || busy) return;
        setError('');
        try { await navigator.clipboard.writeText(handoff.text); setCopiedText(handoff.text); setMessage('Grocery sync copied. Open Shortcuts below to finish.'); }
        catch { setError('Clipboard access wasn’t available. Allow it in your browser and try again.'); }
    };
    const expired = !!envelope && envelope.scope.expiresAt <= Date.now();
    return <section className="reminders-sync" aria-labelledby={id + '-title'}>
        <div className="reminders-heading"><ListChecks size={23} aria-hidden="true" /><div><h2 id={id + '-title'}>Keep groceries in sync</h2><p>Exchange checkmarks with your Apple Reminders grocery list.</p></div></div>
        <div className="reminders-controls"><label htmlFor={id + '-list'}>Reminders list name<input id={id + '-list'} value={list} maxLength={100} disabled={busy || preparing} onChange={event => { setList(event.target.value); setEnvelope(undefined); setMessage(''); setError(''); }} onBlur={remember} placeholder="Groceries" aria-describedby={id + '-hint'} /></label><button className="button secondary" disabled={!ready} onClick={() => void start()}><RefreshCw size={16} />{preparing ? 'Preparing sync…' : 'Sync groceries'}</button></div>
        <p id={id + '-hint'} className="reminders-hint">Use the exact, unique name of an existing regular list. {items.length ? 'Checked items sync too.' : 'Add a grocery to start.'}</p>
        {handoff && !expired && <div className="reminders-handoff">{handoff.clipboard && <><p className="reminders-hint">This list uses your clipboard because it is too long for a link.</p><button className="button secondary" disabled={busy} onClick={() => void copy()}><Copy size={16} />{copied ? 'Copy again' : 'Copy grocery sync'}</button></>}{(!handoff.clipboard || copied) && <a className="button" href={handoff.url}><ExternalLink size={16} />Open Shortcuts to sync</a>}</div>}
        {expired && <p className="reminders-hint">This connection expired. Tap Sync groceries to prepare a fresh one.</p>}
        <div aria-live="polite">{message && <p className="reminders-status" role="status">{message}</p>}{error && <p className="alert error" role="alert">{error}</p>}</div>
        <details className="reminders-setup"><summary>Install or update the two-way Shortcut</summary><ol>
            <li><a className="text-link" href={import.meta.env.BASE_URL + 'shortcuts/CookBook%20Groceries.shortcut'} download="CookBook Groceries.shortcut"><Download size={15} />Download the two-way CookBook Groceries Shortcut</a>. Open it in Apple Shortcuts and add it. Replace the previous version if you installed it already. Keep the name <strong>{REMINDERS_SHORTCUT}</strong>.</li>
            <li>Enter your grocery list’s exact name above. If two lists have that name, rename your grocery list so it is unique.</li>
            <li>Tap <strong>Sync groceries</strong>, then <strong>Open Shortcuts to sync</strong>. Allow Apple’s Reminders and website-connection prompts. When it finishes, Shortcuts returns here and CookBook confirms the result.</li>
        </ol><p>Checkmarks travel both ways for linked CookBook groceries, including unchecking an item. If both sides change a checkmark, CookBook’s change wins. Amounts and notes come from CookBook. Items changed or removed during a run wait for the next sync.</p><p>Only reminders carrying a CookBook marker are linked. Unfinished reminders from the old Shortcut are upgraded automatically. Other reminders stay as they are; manually added Reminders items are not imported, and deleting a CookBook grocery does not delete its reminder.</p><p>Keep the marker in each reminder’s notes. Sync replaces linked reminder titles and notes. Recording pantry purchases still uses <strong>Add purchases to pantry</strong>; items already purchased cannot be reopened by Reminders.</p><p>Each connection expires after 15 minutes and permits only this grocery sync. No login token or password is sent to Shortcuts. Long-list sync data stays on your clipboard until replaced. Sync runs when you tap it; it does not run continuously in the background.</p></details>
    </section>;
}
