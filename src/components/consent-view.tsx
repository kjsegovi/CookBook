import { useEffect, useRef, useState } from 'react';
import { BookOpen } from 'lucide-react';
import type { OAuthAuthorizationDetails } from '@supabase/supabase-js';
import { appUrl, requireClient } from '../lib/supabase';
import { Action } from './kitchen-ui';

export default function ConsentView({ authorizationId }: { authorizationId: string | null }) {
    const [details, setDetails] = useState<OAuthAuthorizationDetails | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState(''), [redirect, setRedirect] = useState('');
    const inFlight = useRef(false);
    useEffect(() => {
        if (!authorizationId) return;
        let active = true;
        const load = async () => {
            try {
                const { data, error } = await requireClient().auth.oauth.getAuthorizationDetails(authorizationId);
                if (!active) return;
                if (error) throw error;
                if ('redirect_url' in data) { window.location.assign(data.redirect_url); return; }
                new URL(data.redirect_uri);
                setDetails(data);
            } catch { if (active) setError('Please restart authorization from your client to try again.'); }
        };
        void load();
        return () => { active = false; };
    }, [authorizationId]);
    const decide = async (approve: boolean) => {
        if (!authorizationId || !details || inFlight.current) return;
        inFlight.current = true; setBusy(true); setError('');
        try {
            const oauth = requireClient().auth.oauth;
            const { data, error } = await (approve ? oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true }) : oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true }));
            if (error) throw error;
            setRedirect(data.redirect_url);
            setResult('You can close this window and return to ' + details.client.name + '.');
        } catch { setError('Please restart authorization from your client to try again.'); }
        finally { inFlight.current = false; setBusy(false); }
    };
    return <main className="consent-view"><BookOpen aria-hidden="true" /><h1>{authorizationId ? 'Connect to CookBook' : 'This authorization link is incomplete'}</h1>{!authorizationId ? <a className="text-link" href={appUrl()}>Back home</a> : <>{error && <div className="alert error" role="alert">{error}</div>}<div aria-live="polite">{result && <><p>{result}</p><a className="button" href={redirect}>Return to {details?.client.name}</a></>}</div>{!result && (details ? <><h2>{details.client.name}</h2><p>Redirect host: <strong>{new URL(details.redirect_uri).host}</strong></p><h3>Requested scopes</h3>{details.scope.trim() ? <ul>{details.scope.trim().split(/\s+/).map(scope => <li key={scope}>{scope.replace(/[_:]/g, ' ')}</li>)}</ul> : <p>No scopes requested.</p>}<div className="inline-actions"><Action disabled={busy} onClick={() => void decide(true)}>Approve</Action><Action secondary disabled={busy} onClick={() => void decide(false)}>Deny</Action></div></> : !error && <p role="status">Loading authorization details…</p>)}</>}</main>;
}
