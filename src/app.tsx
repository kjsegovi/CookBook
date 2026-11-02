import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { ArrowRight, BookOpen, Eye, EyeOff, Leaf, LockKeyhole, Mail } from 'lucide-react';
import { appUrl, configured, requireClient, supabase } from './lib/supabase';
import { selectHousehold } from './lib/api';
import { consentRequest } from './lib/consent';

type Mode = 'signin' | 'forgot' | 'recovery';
const Kitchen = lazy(() => import('./components/kitchen'));
const ConsentView = lazy(() => import('./components/kitchen').then(module => ({ default: module.ConsentView })));
function route() { return location.hash.startsWith('#/') ? location.hash.slice(1).split('?')[0] : '/'; }
export default function App() {
    const request = consentRequest(window.location.pathname + window.location.search, import.meta.env.BASE_URL);
    if (request.isConsent) return <Suspense fallback={<div className="loading-state" role="status">Opening authorization…</div>}><ConsentSession authorizationId={request.authorizationId} /></Suspense>;
    return <HouseholdApp />;
}
function ConsentSession({ authorizationId }: { authorizationId: string | null }) {
    const [session, setSession] = useState<Session | null>(null), [ready, setReady] = useState(!configured), [error, setError] = useState('');
    useEffect(() => {
        if (!supabase || !authorizationId) return;
        let active = true;
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, current) => { if (active) { setSession(current); setReady(true); } });
        supabase.auth.getSession().then(({ data, error }) => {
            if (!active) return;
            if (error) setError('Please sign in again to continue this authorization request.');
            setSession(data.session); setReady(true);
        }).catch(() => { if (active) { setError('Please sign in again to continue this authorization request.'); setReady(true); } });
        return () => { active = false; subscription.unsubscribe(); };
    }, [authorizationId]);
    if (!authorizationId) return <ConsentView authorizationId={null} />;
    if (!ready) return <div className="loading-state" role="status">Opening authorization…</div>;
    if (!session) return <>{error && <div className="alert error" role="alert">{error}</div>}<Login /></>;
    return <ConsentView key={session.user.id + authorizationId} authorizationId={authorizationId} />;
}
function HouseholdApp() {
    const [session, setSession] = useState<Session | null>(null), [ready, setReady] = useState(!configured);
    const [path, setPath] = useState(route), [recovery, setRecovery] = useState(new URLSearchParams(location.search).get('auth') === 'recovery');
    const [household, setHousehold] = useState<string | null>(null), [checking, setChecking] = useState(false), [error, setError] = useState('');
    useEffect(() => {
        const changeRoute = () => setPath(route());
        window.addEventListener('hashchange', changeRoute);
        if (!supabase) return () => window.removeEventListener('hashchange', changeRoute);
        let active = true;
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, current) => {
            if (!active) return;
            setSession(current); setReady(true);
            if (event === 'PASSWORD_RECOVERY') setRecovery(true);
            if (!current) { setHousehold(null); selectHousehold(''); }
        });
        supabase.auth.getSession().then(({ data, error }) => {
            if (!active) return;
            if (error) setError('Your sign-in session could not be restored. Please sign in again.');
            setSession(data.session); setReady(true);
        });
        return () => { active = false; subscription.unsubscribe(); window.removeEventListener('hashchange', changeRoute); };
    }, []);
    const userId = session?.user.id;
    useEffect(() => {
        if (!userId || !supabase) return;
        let active = true;
        setHousehold(null); selectHousehold(''); setChecking(true); setError('');
        supabase.from('household_members').select('household_id').eq('user_id', userId).maybeSingle().then(({ data, error }) => {
            if (!active) return;
            if (error) setError('Your household could not load. Please try again.');
            else if (data) { selectHousehold(data.household_id); setHousehold(data.household_id); }
            setChecking(false);
        });
        return () => { active = false; };
    }, [userId]);
    if (!ready || checking) return <div className="loading-state" role="status"><BookOpen /><h1>Opening your kitchen…</h1></div>;
    if (recovery) return <Login initialMode="recovery" canReset={!!session} onRecovered={() => { setRecovery(false); history.replaceState(null, '', appUrl()); setPath('/'); }} />;
    if (!session) return <Login />;
    if (error) return <div className="loading-state"><h1>Your kitchen couldn’t load</h1><p role="alert">{error}</p><button className="button" onClick={() => location.reload()}>Try again</button><button className="text-link" onClick={() => supabase?.auth.signOut()}>Sign out</button></div>;
    if (!household) return <Welcome onReady={id => { selectHousehold(id); setHousehold(id); }} />;
    return <Suspense fallback={<div className="loading-state" role="status"><BookOpen /><h1>Opening your kitchen…</h1></div>}><Kitchen key={session.user.id + household} userName={session.user.user_metadata.display_name || session.user.email || 'Your household'} initialPath={path} /></Suspense>;
}

function Login({ initialMode = 'signin', canReset = false, onRecovered }: { initialMode?: Mode; canReset?: boolean; onRecovered?: () => void }) {
    const [mode, setMode] = useState<Mode>(initialMode), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [showPassword, setShowPassword] = useState(false);
    useEffect(() => { window.scrollTo(0, 0); }, [mode]);
    const titles = { signin: 'Welcome to your kitchen.', forgot: 'A fresh start.', recovery: 'Choose a new password.' };
    const descriptions = { signin: 'Your keepers, your weekly plans, and a little less “what’s for dinner?”', forgot: 'Enter your email and we’ll send you a link to reset your password.', recovery: 'Use a password you haven’t used for this account before.' };
    const changeMode = (next: Mode) => { setMode(next); setError(''); setNotice(''); };
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); if (busy) return;
        setBusy(true); setError(''); setNotice('');
        const form = new FormData(event.currentTarget), email = String(form.get('email') || '').trim(), password = String(form.get('password') || '');
        try {
            const client = requireClient();
            if (mode === 'signin') {
                const { error } = await client.auth.signInWithPassword({ email, password });
                if (error) throw new Error(error.code === 'invalid_credentials' ? 'That email and password didn’t match. Please try again.' : error.message);
            } else if (mode === 'forgot') {
                const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: appUrl() + '?auth=recovery' });
                if (error) throw error;
                setNotice('If an account exists for that email, a password reset link is on its way.');
            } else {
                if (!canReset) throw new Error('Open the password reset link from your email first.');
                if (password !== String(form.get('confirmPassword') || '')) throw new Error('Your passwords don’t match. Please try again.');
                const { error } = await client.auth.updateUser({ password });
                if (error) throw error;
                onRecovered?.();
            }
        } catch (e) { setError(e instanceof Error ? e.message : 'We couldn’t complete that request. Please try again.'); }
        finally { setBusy(false); }
    };
    return <main className="auth-layout"><section className="auth-story"><a href="#/" className="brand auth-brand" aria-label="CookBook home"><span className="brand-icon"><BookOpen size={24} /></span><span>CookBook<span className="brand-dot">.</span></span></a><div className="auth-story-body"><span className="auth-eyebrow"><Leaf size={17} /> A place for your keepers</span><h1>Good food.{' '}<br />A little less{' '}<br /><em>figuring it out.</em></h1><p>Keep the recipes you love, plan what’s next, and make the most of what’s already in your kitchen.</p><div className="auth-recipe-note"><span className="note-label">A note for next time</span><p>“A little more lemon.<br />Definitely make extra.”</p><span className="note-leaf"><Leaf size={28} /></span></div></div><p className="auth-story-footer">Your household. Your recipes. All together.</p></section><section className="auth-form-panel" aria-labelledby="login-title"><div className="auth-form-wrap"><div className="auth-lock"><LockKeyhole size={22} /></div><h2 id="login-title">{titles[mode]}</h2><p className="auth-description">{descriptions[mode]}</p>{!configured && <p className="auth-setup-note" role="status">Sign-in will be available once your kitchen is connected.</p>}{error && <div className="alert error" role="alert">{error}</div>}{notice && <div className="auth-success" role="status"><Mail size={20} /><p>{notice}</p></div>}<form className="form-stack" onSubmit={submit} key={mode}>{mode !== 'recovery' && <label>Email address<input type="email" autoComplete="email" inputMode="email" name="email" maxLength={254} required placeholder="you@example.com" /></label>}{mode !== 'forgot' && <label>Password<div className="password-field"><input type={showPassword ? 'text' : 'password'} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} name="password" required minLength={mode === 'signin' ? 1 : 12} maxLength={128} placeholder={mode === 'signin' ? 'Your password' : 'At least 12 characters'} /><button className="icon-button" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button></div></label>}{mode === 'recovery' && <label>Confirm new password<input type="password" name="confirmPassword" autoComplete="new-password" required minLength={12} maxLength={128} /></label>}{mode === 'signin' && <button type="button" className="text-link forgot-password" onClick={() => changeMode('forgot')}>Forgot your password?</button>}<button className="button auth-submit" disabled={busy || mode === 'recovery' && !canReset}>{busy ? 'One moment…' : mode === 'signin' ? 'Sign in' : mode === 'forgot' ? 'Send reset link' : 'Save new password'}<ArrowRight size={18} /></button></form>{mode === 'signin' ? <p className="auth-switch">Accounts are created by the kitchen administrator.</p> : mode !== 'recovery' ? <p className="auth-switch"><button className="text-link" onClick={() => changeMode('signin')}>Back to sign in</button></p> : null}<p className="auth-privacy"><LockKeyhole size={13} /> Recipes stay private to your household.</p></div></section></main>;
}

function Welcome({ onReady }: { onReady: (id: string) => void }) {
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const run = async (name: string, params: Record<string, string>) => {
        setBusy(true); setError('');
        try { const { data, error } = await requireClient().rpc(name, params); if (error) throw error; onReady(data as string); }
        catch (e) { setError(e instanceof Error ? e.message : 'Your household could not be opened. Please try again.'); }
        finally { setBusy(false); }
    };
    return <main className="welcome-household"><BookOpen size={40} /><h1>A kitchen to call your own.</h1><p>Start a shared recipe collection, or join the household that invited you.</p>{error && <div role="alert" className="alert error">{error}</div>}<form className="form-stack" onSubmit={e => { e.preventDefault(); void run('create_household', { kitchen_name: String(new FormData(e.currentTarget).get('name')) }); }}><label>Kitchen name<input name="name" required maxLength={80} defaultValue="Our kitchen" /></label><button className="button" disabled={busy}>Create a kitchen <ArrowRight size={17} /></button></form><div className="dialog-divider"><span>Already invited?</span></div><form className="form-stack" onSubmit={e => { e.preventDefault(); void run('accept_household_invitation', { invitation_code: String(new FormData(e.currentTarget).get('code')).trim() }); }}><label>Invitation code<input name="code" required maxLength={128} autoComplete="off" placeholder="Paste the code from your household" /></label><button className="button secondary" disabled={busy}>Join your household</button></form><button className="text-link" onClick={() => supabase?.auth.signOut()}>Sign out</button></main>;
}
