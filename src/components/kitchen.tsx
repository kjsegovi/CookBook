'use client';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { BookOpen, Plus, Search, ArrowUpRight, ArrowLeft, ArrowRight, Heart, Clock3, SlidersHorizontal, CalendarDays, Leaf, ShoppingBasket, Refrigerator, X, Check, Link2, Upload, Printer, Settings, RefreshCw, ChefHat, Trash2, Pencil, MoreHorizontal, Download, CheckCircle2, CircleHelp, Utensils, Snowflake, Copy } from 'lucide-react';
import { availability, autoLeftovers, blankRecipe, canonical, convert, formatAmount, fraction, initialState, parseIngredient, requirements, reserved, uid, weekEnd, type State, type Recipe, type PantryItem, type PlanEntry, type PreparedBatch, type ShoppingItem, type ImportDraft } from '@/lib/domain';
import { ApiError, getSnapshot, saveCommand, importRecipe, uploadPhoto, photoUrl } from '@/lib/api';
import HouseholdSettings from './household-settings';
import RemindersSync from './reminders-sync';
import type { OAuthAuthorizationDetails } from '@supabase/supabase-js';
import { appUrl, requireClient } from '@/lib/supabase';

export function ConsentView({ authorizationId }: { authorizationId: string | null }) {
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

type Modal = {
    type: string;
    data?: any;
} | null;
type Commit = (type: string, payload: any) => Promise<boolean>;
const field = (data: FormData, key: string) => String(data.get(key) ?? '');
const amount = (v: string) => v.trim() === '' ? null : fraction(v);
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function addDays(value: string, n: number) { const d = new Date(value + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function startWeek(value: string, starts = 1) { const d = new Date(value + 'T12:00:00Z'); return addDays(value, -((d.getUTCDay() - starts + 7) % 7)); }
const shortDate = (value: string, options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) => new Date(value + 'T12:00:00Z').toLocaleDateString('en-US', { ...options, timeZone: 'UTC' });
function Action({ children, secondary = false, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    secondary?: boolean;
}) { return <button className={secondary ? 'button secondary' : 'button'} {...props}>{children}</button>; }
function IconButton({ label, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    label: string;
}) { return <button className="icon-button" aria-label={label} title={label} {...props}>{children}</button>; }
function Empty({ title, children, action, icon = <BookOpen /> }: {
    title: string;
    children: ReactNode;
    action?: ReactNode;
    icon?: ReactNode;
}) { return <div className="empty"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{children}</p>{action}</div>; }
function Photo({ recipe, className = '' }: {
    recipe: Pick<Recipe, 'image' | 'title'>;
    className?: string;
}) { const [failed, setFailed] = useState(false), [source, setSource] = useState(''); useEffect(() => { let active = true; setFailed(false); setSource(''); photoUrl(recipe.image).then(url => { if(active) setSource(url); }).catch(() => { if(active) setFailed(true); }); return () => { active = false; }; }, [recipe.image]); return <div className={'recipe-photo ' + className}>{source && !failed ? <img src={source} alt={recipe.title} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)}/> : <div className="photo-placeholder"><Utensils aria-hidden="true"/><span>No photo yet</span></div>}</div>; }
function Dialog({ title, children, onClose, busy }: {
    title: string;
    children: ReactNode;
    onClose: () => void;
    busy: boolean;
}) { const ref = useRef<HTMLDialogElement>(null), id = useId(); useEffect(() => { ref.current?.showModal(); return () => { ref.current?.close(); }; }, []); return <dialog ref={ref} className="dialog" aria-labelledby={id} onCancel={e => { e.preventDefault(); if (!busy)
    onClose(); }} onClick={e => { if (e.target === e.currentTarget && !busy)
    onClose(); }}><div className="dialog-head"><h2 id={id}>{title}</h2><IconButton label="Close dialog" disabled={busy} onClick={onClose}><X /></IconButton></div>{children}</dialog>; }
function SectionHead({ title, link, children }: {
    title: string;
    link?: string;
    children?: ReactNode;
}) { return <div className="section-head"><h2>{title}</h2>{link ? <a className="text-link" href={link.startsWith('/') ? '#' + link : link}>View all <ArrowRight size={16}/></a> : children}</div>; }
function RecipeCard({ recipe, state, onFavorite }: {
    recipe: Recipe;
    state: State;
    onFavorite: () => void;
}) { const ready = availability(state, recipe, state.settings.servings).every(i => i.status === 'ready'); return <article className="recipe-card"><a href={'#/recipes/' + recipe.id} className="photo-link" aria-label={'Open ' + recipe.title}><Photo recipe={recipe}/></a><button className={'favorite ' + (recipe.favorite ? 'selected' : '')} aria-label={(recipe.favorite ? 'Remove ' : 'Add ') + recipe.title + (recipe.favorite ? ' from favorites' : ' to favorites')} aria-pressed={recipe.favorite} onClick={onFavorite}><Heart size={18} fill={recipe.favorite ? 'currentColor' : 'none'}/></button><div className="recipe-card-body"><h3><a href={'#/recipes/' + recipe.id}>{recipe.title}</a></h3><span className="category-label">{recipe.category}</span><div className="recipe-meta"><span><Clock3 size={14}/>{recipe.prepMinutes + recipe.cookMinutes ? recipe.prepMinutes + recipe.cookMinutes + ' min' : 'Time not set'}</span><span>{recipe.servings} servings</span></div>{ready && <span className="ready-label"><Check size={13}/> Pantry ready</span>}{recipe.wantToTry && <span className="try-label">Want to try</span>}</div></article>; }
export default function Kitchen({ userName, initialPath, householdId }: {
    householdId: string;
    userName: string;
    initialPath: string;
}) {
    const [state, setState] = useState<State | null>(null), [revision, setRevision] = useState(0), [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false), [modal, setModal] = useState<Modal>(null);
    const revisionRef = useRef(0), inFlight = useRef(false), pathname = initialPath;
    const pendingNavigation = useRef<string | null>(null), leaving = useRef(false);
    const navigate = useCallback((href: string) => {
        if (inFlight.current) {
            pendingNavigation.current ??= href;
            setNotice('Finishing your save before opening the next page…');
            return;
        }
        if (leaving.current) return;
        const destination = pendingNavigation.current ?? href;
        pendingNavigation.current = null;
        leaving.current = true;
        window.location.assign(destination.startsWith('/') ? '#' + destination : destination);
    }, []);
    const finishSave = (saved: boolean) => {
        inFlight.current = false;
        setBusy(false);
        if (saved && pendingNavigation.current) navigate(pendingNavigation.current);
        else {
            pendingNavigation.current = null;
            if (!saved) setNotice('');
        }
    };
    const [week, setWeek] = useState(() => startWeek(today()));
    const load = useCallback(async () => { try {
        const data = await getSnapshot();
        setState(data.state);
        setRevision(data.revision);
        revisionRef.current = data.revision;
        setError('');
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load your kitchen. Try again.');
    } }, []);
    useEffect(() => { load(); const focus = () => { if (!inFlight.current)
        load(); }; const restore = (event: PageTransitionEvent) => { if (event.persisted) { leaving.current = false; pendingNavigation.current = null; if (!inFlight.current) load(); } }; window.addEventListener('focus', focus); window.addEventListener('pageshow', restore); return () => { window.removeEventListener('focus', focus); window.removeEventListener('pageshow', restore); }; }, [load]);
    useEffect(() => {
        const deferNavigation = (event: MouseEvent) => {
            if (!inFlight.current || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
            if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
            const destination = new URL(anchor.href, window.location.href);
            if (destination.origin !== window.location.origin || !destination.hash.startsWith('#/')) return;
            event.preventDefault();
            pendingNavigation.current = destination.href;
            setNotice('Finishing your save before opening the next page…');
        };
        document.addEventListener('click', deferNavigation, true);
        return () => document.removeEventListener('click', deferNavigation, true);
    }, []);
    useEffect(() => { if (state)
        setWeek(w => startWeek(w, state.settings.weekStartsOn)); }, [state?.settings.weekStartsOn]);
    useEffect(() => { leaving.current = false; setNotice(''); window.scrollTo(0, 0); document.getElementById('main')?.focus({ preventScroll: true }); }, [pathname]);
    const commit: Commit = async (type, payload) => { if (inFlight.current)
        return false; inFlight.current = true; setBusy(true); setError(''); let saved = false; try {
        let data;
        try { data = await saveCommand(type, payload, uid(), revisionRef.current); }
        catch (e) { if (e instanceof ApiError && e.status === 409) await load(); throw e; }
        setState(data.state);
        setRevision(data.revision);
        revisionRef.current = data.revision;
        setNotice('Saved to your kitchen.');
        saved = true;
        return true;
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Could not save. Try again.');
        return false;
    }
    finally {
        finishSave(saved);
    } };
    const importUrl = async (url: string) => { if (inFlight.current)
        return; inFlight.current = true; setBusy(true); setError(''); let saved = false; try {
        let data;
        try { data = await importRecipe(url, uid(), revisionRef.current); }
        catch (e) { if (e instanceof ApiError && e.status === 409) await load(); throw e; }
        setState(data.state);
        setRevision(data.revision);
        revisionRef.current = data.revision;
        setModal(null);
        saved = true;
        navigate('/drafts/' + (data.draftId ?? data.state.drafts.at(-1)?.id));
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'This link could not be imported.');
    }
    finally {
        finishSave(saved);
    } };
    const favorite = (r: Recipe) => commit('recipe.save', { ...r, favorite: !r.favorite });
    const openRecipe = () => navigate('/recipes/new');
    const s = state ?? initialState(), section = pathname.split('/')[1] || 'home', recipeId = pathname.split('/')[2];
    const recipes = s.recipes, weekEntries = s.plan.filter(p => p.date >= week && p.date <= weekEnd(week)).sort((a, b) => a.date.localeCompare(b.date));
    const batchList = s.batches.filter(b => b.remaining > 0);
    const close = () => setModal(null);
    const recipeEditor = section === 'recipes' && (recipeId === 'new' || !!recipeId && pathname.endsWith('/edit'));
    const draft = section === 'drafts' ? s.drafts.find(d => d.id === recipeId) : undefined;
    const recipe = recipes.find(r => r.id === recipeId);
    const topTitle = section === 'home' ? 'Your kitchen, all together.' : section === 'recipes' ? 'Your recipe library' : section === 'plan' ? 'A good week starts here.' : section === 'pantry' ? 'What’s in your kitchen' : section === 'shopping' ? 'A little less to think about.' : section === 'settings' ? 'Your kitchen settings' : 'Recipe draft';
    return <><a className="skip-link" href="#main" onClick={event => { event.preventDefault(); const main = document.getElementById('main'); main?.focus(); main?.scrollIntoView(); }}>Skip to content</a><header className="site-header"><div className="header-inner"><a className="brand" href="#/" aria-label="CookBook home"><span className="brand-icon"><BookOpen size={23}/></span><span>CookBook<span className="brand-dot">.</span></span></a><nav className="desktop-nav" aria-label="Main navigation">{[['recipes', 'View all recipes', BookOpen], ['plan', 'Meal plan', CalendarDays], ['pantry', 'Pantry', Refrigerator], ['shopping', 'Shopping', ShoppingBasket]].map(([key, label, Icon]: any) => <a key={key} href={'#/' + key} className={section === key ? 'active' : ''} aria-current={section === key ? 'page' : undefined}>{label}</a>)}</nav><div className="header-actions"><IconButton label="Refresh kitchen" onClick={load} disabled={busy}><RefreshCw size={18}/></IconButton><a className={'icon-button ' + (section === 'settings' ? 'active' : '')} href="#/settings" aria-label="Kitchen settings"><Settings size={19}/></a><span className="avatar" title={userName}>{userName.slice(0, 1).toUpperCase()}</span></div></div></header>
 <nav className="mobile-nav" aria-label="Mobile navigation">{[['', 'Home', BookOpen], ['recipes', 'Recipes', Utensils], ['plan', 'Plan', CalendarDays], ['pantry', 'Pantry', Refrigerator], ['shopping', 'Shop', ShoppingBasket]].map(([key, label, Icon]: any) => <a key={key} href={'#/' + key} className={(section === (key || 'home')) ? 'active' : ''} aria-current={section === (key || 'home') ? 'page' : undefined}><Icon size={20}/><span>{label}</span></a>)}</nav>
 <main id="main" tabIndex={-1} className="main-shell"><div className="alerts" aria-live="polite">{error && <div role="alert" className="alert error"><span>{error}</span><IconButton label="Dismiss error" onClick={() => setError('')}><X size={17}/></IconButton></div>}{notice && !error && <div className="notice" role="status"><CheckCircle2 size={16}/>{notice}</div>}</div>
 {!state ? <div className="loading-state"><BookOpen /><h1>{error ? 'Your kitchen couldn’t load' : 'Opening your kitchen…'}</h1><p>{error ? 'Check your connection or sign in again.' : 'Getting your recipes and plans ready.'}</p><Action onClick={load} secondary>Try again</Action></div> : recipeEditor ? <RecipeEditor key={recipe?.id ?? 'new'} recipe={recipe ?? { ...blankRecipe(), servings: s.settings.servings }} state={s} busy={busy} commit={commit} onError={setError} onSaved={r => navigate('/recipes/' + r.id)}/> : draft ? <RecipeEditor key={draft.id} recipe={draft.recipe} draft={draft} state={s} busy={busy} commit={commit} onError={setError} onSaved={r => navigate('/recipes/' + r.id)}/> : section === 'recipes' && recipeId && recipe ? <RecipeDetail recipe={recipe} state={s} busy={busy} onEdit={() => navigate('/recipes/' + recipe.id + '/edit')} onDeleted={() => navigate('/recipes')} onFavorite={() => favorite(recipe)} onCook={() => setModal({ type: 'cook', data: { recipe } })} onPlan={() => setModal({ type: 'plan', data: { recipeId: recipe.id } })} commit={commit}/> : section === 'recipes' && recipeId || section === 'drafts' && !draft ? <Empty title="This recipe isn’t here" action={<a className="button" href="#/recipes">Back to recipes</a>}>It may have been removed by someone in your household.</Empty> : <>
 <div className="page-head"><div><h1>{topTitle}</h1><p>{section === 'home' ? 'Recipes to keep. Meals to look forward to.' : section === 'recipes' ? `${recipes.length} recipes, ready for whatever sounds good.` : section === 'plan' ? 'Plan a fresh meal, cook a bigger batch, save some for later.' : section === 'pantry' ? 'A clear view of what you have, down to the last half bottle.' : section === 'shopping' ? 'Your week’s ingredients, minus what you already have.' : section === 'settings' ? 'Make CookBook fit the way your household cooks.' : ''}</p></div><div className="head-actions">{['home', 'recipes'].includes(section) && <><Action secondary onClick={() => setModal({ type: 'import' })}><Link2 size={17}/>Import a link</Action><Action onClick={openRecipe}><Plus size={18}/>Add recipe</Action></>}{section === 'plan' && <Action onClick={() => setModal({ type: 'plan', data: { date: week } })}><Plus size={18}/>Add a meal</Action>}{section === 'pantry' && <Action onClick={() => setModal({ type: 'pantry' })}><Plus size={18}/>Add ingredient</Action>}{section === 'shopping' && <Action onClick={() => setModal({ type: 'shopping' })}><Plus size={18}/>Add item</Action>}</div></div>
 {section === 'home' ? <div className="home-layout"><div className="home-primary">{s.drafts.length > 0 && <div className="draft-banner"><div><strong>{s.drafts.length} {s.drafts.length === 1 ? 'recipe is' : 'recipes are'} waiting for review</strong><p>Finish importing, then make them yours.</p></div><a href={'#/drafts/' + s.drafts[0].id} className="text-link">Review drafts <ArrowRight size={17}/></a></div>}<SectionHead title="Recently added" link="/recipes"/>{recipes.length ? <div className="recipe-grid home-grid">{[...recipes].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 6).map(r => <RecipeCard key={r.id} recipe={r} state={s} onFavorite={() => favorite(r)}/>)}</div> : <div className="welcome-panel"><div className="welcome-mark"><BookOpen size={44}/><Leaf size={24}/></div><h2>A place for your keepers.</h2><p>That weeknight favorite. The sauce you always come back to. Start your collection with a recipe you love.</p><Action onClick={() => setModal({ type: 'import' })}><Link2 size={17}/>Import your first recipe</Action><button className="text-link" onClick={openRecipe}>Or write one yourself <ArrowRight size={16}/></button></div>}<div className="browse-section"><SectionHead title="Find something good" link="/recipes"/><div className="category-links">{s.settings.categories.map(c => <a href={'#/recipes?category=' + encodeURIComponent(c)} key={c}>{c}<ArrowUpRight size={16}/></a>)}<a href="#/recipes?status=try">Want to try <ArrowUpRight size={16}/></a></div></div></div><aside className="home-aside"><section><SectionHead title="This week" link="/plan"/><div className="aside-date">{shortDate(week)} – {shortDate(weekEnd(week))}</div>{weekEntries.length ? <div className="compact-meals">{weekEntries.slice(0, 5).map(p => <a key={p.id} href="#/plan" className="compact-meal"><span className="day-block">{shortDate(p.date, { weekday: 'short' })}<strong>{p.date.slice(-2)}</strong></span><span><strong>{recipes.find(r => r.id === p.recipeId)?.title ?? 'Saved meal'}</strong><small>{p.slot} · {p.kind === 'leftover' ? 'Leftovers' : p.cookServings + ' servings to cook'}{p.done ? ' · Done' : ''}</small></span></a>)}</div> : <div className="aside-empty"><CalendarDays size={26}/><p>A little planning goes a long way.</p><a className="text-link" href="#/plan">Plan your week <ArrowRight size={15}/></a></div>}</section><section className="leftover-section"><SectionHead title="Good for another meal"/>{batchList.length ? <div className="batch-list">{batchList.map(b => <button className="batch-row" key={b.id} onClick={() => setModal({ type: 'batch', data: b })}><span className="batch-icon">{b.location === 'Freezer' ? <Snowflake size={19}/> : <Refrigerator size={19}/>}</span><span><strong>{b.title}</strong><small>{b.remaining} portions · {b.location}</small></span><ArrowUpRight size={16}/></button>)}</div> : <div className="aside-empty small"><p>Cook a little extra. Your future self will thank you.</p></div>}</section><div className="assistant-note"><Leaf size={20}/><div><strong>A little less waste.</strong><p>Your recipes, pantry, and saved portions work together to make the next meal easier.</p></div></div></aside></div> : section === 'recipes' ? <Library state={s} favorite={favorite} drafts={s.drafts} onImport={() => setModal({ type: 'import' })}/> : section === 'plan' ? <><WeekPicker week={week} setWeek={setWeek} starts={s.settings.weekStartsOn}/><div className="week-grid">{Array.from({ length: 7 }, (_, i) => addDays(week, i)).map(date => <section className={'plan-day ' + (date === today() ? 'today' : '')} key={date}><div className="day-heading"><h2>{shortDate(date, { weekday: 'short' })}<span>{Number(date.slice(-2))}</span></h2><IconButton label={'Add meal for ' + shortDate(date)} onClick={() => setModal({ type: 'plan', data: { date } })}><Plus size={17}/></IconButton></div>{['Breakfast', 'Lunch', 'Dinner', 'Snack'].map(slot => <div className="meal-slot" key={slot}><h3>{slot}</h3>{s.plan.filter(p => p.date === date && p.slot === slot).map(p => <PlanCard key={p.id} entry={p} state={s} busy={busy} onEdit={() => setModal({ type: 'plan', data: p })} onCook={() => setModal({ type: 'cook', data: { recipe: s.recipes.find(r => r.id === p.recipeId), entry: p } })} onEat={() => setModal({ type: 'eat', data: { entry: p, batch: s.batches.find(b => b.id === p.batchId) } })} commit={commit}/>)}<button className="slot-add" onClick={() => setModal({ type: 'plan', data: { date, slot } })} aria-label={'Add ' + slot.toLowerCase() + ' for ' + shortDate(date)}><Plus size={14}/><span>Add</span></button></div>)}</section>)}</div><section className="saved-portions"><SectionHead title="Portions for later"/>{batchList.length ? <div className="leftover-grid">{batchList.map(b => <div className="leftover-item" key={b.id}><Photo recipe={s.recipes.find(r => r.id === b.recipeId) ?? { image: '', title: b.title }}/><div><h3>{b.title}</h3><p>{b.remaining} portions left · {reserved(s, b.id)} assigned</p><small>{b.location} · Cooked {shortDate(b.preparedAt.slice(0, 10))}</small><div className="inline-actions"><button className="text-link" onClick={() => setModal({ type: 'plan', data: { kind: 'leftover', batchId: b.id, recipeId: b.recipeId } })}>Plan a meal</button><button className="text-link" onClick={() => setModal({ type: 'batch', data: b })}>Manage portions</button></div></div></div>)}</div> : <Empty title="Make room for leftovers" icon={<Refrigerator />}>When you cook a larger batch, its saved portions will appear here.</Empty>}</section></> : section === 'pantry' ? <Pantry state={s} onEdit={p => setModal({ type: 'pantry', data: p })} onAliases={p => setModal({ type: 'alias', data: p })} commit={commit} busy={busy}/> : section === 'shopping' ? <Shopping refresh={load} household={householdId} state={s} week={week} setWeek={setWeek} commit={commit} busy={busy} onEdit={p => setModal({ type: 'shopping', data: p })} onPurchase={() => setModal({ type: 'purchase' })}/> : section === 'settings' ? <SettingsPage state={s} commit={commit} busy={busy}/> : <Empty title="Page not found" action={<a className="button" href="#/">Back home</a>}>Open your recipe library or return to your kitchen.</Empty>}
 </>}
 <footer className="site-footer"><a href="#/" className="footer-brand">CookBook.</a><span>A little planning. A lot of good food.</span><a href="#/settings">Kitchen settings</a></footer></main>
 {modal && state && <Dialog title={modal.type === 'import' ? 'Bring a recipe home' : modal.type === 'pantry' ? 'Your ingredient' : modal.type === 'plan' ? 'Plan a meal' : modal.type === 'cook' ? 'Cook & save some for later' : modal.type === 'batch' ? 'Manage saved portions' : modal.type === 'eat' ? 'Eat leftovers' : modal.type === 'shopping' ? 'Shopping item' : modal.type === 'purchase' ? 'Add purchases to your pantry' : 'Ingredient names & aliases'} onClose={close} busy={busy}>
 {error && <div role="alert" className="alert error dialog-error">{error}</div>}
 {modal.type === 'import' ? <ImportForm busy={busy} onImport={importUrl} onText={async () => { const r = blankRecipe(); const id = uid(); if (await commit('draft.save', { id, recipe: r, text: '', warnings: ['Paste recipe text below, then use the connected assistant or fill in the recipe manually.'] })) {
            close();
            navigate('/drafts/' + id);
        } }}/> : modal.type === 'pantry' ? <PantryForm item={modal.data} busy={busy} commit={commit} onDone={close}/> : modal.type === 'alias' ? <AliasForm item={modal.data} busy={busy} commit={commit} onDone={close}/> : modal.type === 'plan' ? <PlanForm initial={modal.data ?? {}} state={s} busy={busy} commit={commit} onDone={close}/> : modal.type === 'cook' ? <CookForm recipe={modal.data.recipe} entry={modal.data.entry} state={s} busy={busy} commit={commit} onDone={close}/> : modal.type === 'batch' ? <BatchForm batch={modal.data} state={s} busy={busy} commit={commit} onDone={close} onEat={() => setModal({ type: 'eat', data: { batch: modal.data } })}/> : modal.type === 'eat' ? <EatForm {...modal.data} busy={busy} state={s} commit={commit} onDone={close}/> : modal.type === 'shopping' ? <ShoppingForm item={modal.data} busy={busy} commit={commit} onDone={close}/> : modal.type === 'purchase' ? <PurchaseForm state={s} busy={busy} commit={commit} onDone={close}/> : null}
 </Dialog>}
 </>;
}
function Library({ state, favorite, drafts, onImport }: {
    state: State;
    favorite: (r: Recipe) => void;
    drafts: ImportDraft[];
    onImport: () => void;
}) {
    const [query, setQuery] = useState(''), [category, setCategory] = useState(''), [tags, setTags] = useState(''), [status, setStatus] = useState(''), [maxTime, setMaxTime] = useState(''), [stock, setStock] = useState(''), [sort, setSort] = useState('recent'), [filters, setFilters] = useState(false);
    useEffect(() => { const sync = () => { const q = new URLSearchParams(window.location.hash.split('?')[1] || ''); setCategory(q.get('category') ?? ''); setStatus(q.get('status') ?? ''); }; sync(); window.addEventListener('hashchange', sync); return () => window.removeEventListener('hashchange', sync); }, []);
    const result = state.recipes.filter(r => (!query || [r.title, r.description, ...r.ingredients.map(i => i.name), ...r.tags].join(' ').toLowerCase().includes(query.toLowerCase())) && (!category || r.category === category) && (!tags || tags.split(',').every(t => r.tags.some(x => x.toLowerCase() === t.trim().toLowerCase()))) && (!status || (status === 'try' ? r.wantToTry : status === 'favorites' ? r.favorite : state.batches.some(b => b.recipeId === r.id))) && (!maxTime || (r.prepMinutes + r.cookMinutes > 0 && r.prepMinutes + r.cookMinutes <= Number(maxTime))) && (!stock || availability(state, r, state.settings.servings).every(i => i.status === 'ready'))).sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'time' ? (a.prepMinutes + a.cookMinutes) - (b.prepMinutes + b.cookMinutes) : b.createdAt.localeCompare(a.createdAt));
    const controls = <><label>Category<select value={category} onChange={e => setCategory(e.target.value)}><option value="">All categories</option>{[...new Set([...state.settings.categories, ...state.recipes.map(r => r.category)])].map(c => <option key={c}>{c}</option>)}</select></label><label>Collection<select value={status} onChange={e => setStatus(e.target.value)}><option value="">All recipes</option><option value="try">Want to try</option><option value="favorites">Favorites</option><option value="cooked">Tried & cooked</option></select></label><label>Tags<input value={tags} onChange={e => setTags(e.target.value)} placeholder="quick, vegetarian"/></label><label>Time<select value={maxTime} onChange={e => setMaxTime(e.target.value)}><option value="">Any cooking time</option><option value="15">Up to 15 minutes</option><option value="30">Up to 30 minutes</option><option value="60">Up to 1 hour</option></select></label><label>Pantry<select value={stock} onChange={e => setStock(e.target.value)}><option value="">Any availability</option><option value="ready">Ready for {state.settings.servings} servings</option></select></label><button className="text-link reset-filters" onClick={() => { setCategory(''); setTags(''); setStatus(''); setMaxTime(''); setStock(''); }}>Clear filters</button></>;
    return <>{drafts.length > 0 && <section className="drafts-list"><h2>Waiting for review <span className="count">{drafts.length}</span></h2>{drafts.map(d => <a href={'#/drafts/' + d.id} key={d.id}>{d.recipe.title || 'Untitled recipe draft'}<ArrowRight size={16}/></a>)}</section>}<div className="library-toolbar"><div className="search-field"><Search size={19}/><input aria-label="Search recipes" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find a recipe, ingredient, or tag…"/></div><Action secondary onClick={() => setFilters(true)}><SlidersHorizontal size={17}/>Filters</Action><label className="sort-label"><span className="sr-only">Sort recipes</span><select value={sort} onChange={e => setSort(e.target.value)}><option value="recent">Recently added</option><option value="title">A to Z</option><option value="time">Cooking time</option></select></label></div><div className="filter-row">{controls}</div><div className="results-note">{result.length} {result.length === 1 ? 'recipe' : 'recipes'}{tags ? ' · all listed tags must match' : ''}</div>{result.length ? <div className="recipe-grid">{result.map(r => <RecipeCard key={r.id} recipe={r} state={state} onFavorite={() => favorite(r)}/>)}</div> : <Empty title={state.recipes.length ? 'Nothing quite matches' : 'Your collection starts here'} action={<Action secondary onClick={onImport}><Link2 size={17}/>Import a recipe</Action>}>{state.recipes.length ? 'Try another search or clear a filter.' : 'Save a recipe link, or add one of your own.'}</Empty>}{filters && <Dialog title="Find your next meal" onClose={() => setFilters(false)} busy={false}><div className="filter-drawer">{controls}<Action onClick={() => setFilters(false)}>Show {result.length} {result.length === 1 ? 'recipe' : 'recipes'}</Action></div></Dialog>}</>;
}
function WeekPicker({ week, setWeek, starts = 1 }: {
    week: string;
    setWeek: (s: string) => void;
    starts?: number;
}) { return <div className="week-picker"><IconButton label="Previous week" onClick={() => setWeek(addDays(week, -7))}><ArrowLeft size={18}/></IconButton><h2>{shortDate(week)} – {shortDate(weekEnd(week))}</h2><IconButton label="Next week" onClick={() => setWeek(addDays(week, 7))}><ArrowRight size={18}/></IconButton><button className="text-link" onClick={() => setWeek(startWeek(today(), starts))}>This week</button></div>; }
function PlanCard({ entry: p, state, busy, onEdit, onCook, onEat, commit }: {
    entry: PlanEntry;
    state: State;
    busy: boolean;
    onEdit: () => void;
    onCook: () => void;
    onEat: () => void;
    commit: Commit;
}) { const recipe = state.recipes.find(r => r.id === p.recipeId), batch = state.batches.find(b => b.id === p.batchId); return <article className={'plan-card ' + (p.done ? 'completed' : '')}><a href={'#/recipes/' + p.recipeId}>{recipe?.title ?? batch?.title ?? 'Saved meal'}</a><p>{p.kind === 'leftover' ? <><Refrigerator size={13}/> {p.eatServings} leftover portions{p.auto && <span className="auto-tag">Auto</span>}</> : <><ChefHat size={13}/> Cook {p.cookServings} · eat {p.eatServings}</>}</p>{p.note && <small>{p.note}</small>}{p.done ? <span className="done-label"><Check size={13}/>{p.kind === 'cook' ? 'Cooked' : 'Eaten'}</span> : <><button className="text-link" disabled={busy || p.kind === 'leftover' && !batch} onClick={p.kind === 'cook' ? onCook : onEat}>{p.kind === 'cook' ? 'Mark as cooked' : batch ? 'Eat leftovers' : 'Cook batch first'}</button><div className="plan-card-actions"><IconButton label={'Edit ' + (recipe?.title ?? 'meal')} onClick={onEdit}><Pencil size={14}/></IconButton><IconButton label={'Remove ' + (recipe?.title ?? 'meal') + ' from plan'} disabled={busy} onClick={() => commit('plan.delete', { id: p.id })}><X size={14}/></IconButton></div></>}</article>; }
function Pantry({ state, onEdit, onAliases, commit, busy }: {
    state: State;
    onEdit: (p: PantryItem) => void;
    onAliases: (p?: any) => void;
    commit: Commit;
    busy: boolean;
}) { const [q, setQ] = useState(''), [location, setLocation] = useState(''); const items = state.pantry.filter(p => (!q || p.name.toLowerCase().includes(q.toLowerCase())) && (!location || p.location === location)).sort((a, b) => a.name.localeCompare(b.name)); return <><div className="library-toolbar"><div className="search-field"><Search size={18}/><input aria-label="Search pantry ingredients" placeholder="Find an ingredient…" value={q} onChange={e => setQ(e.target.value)}/></div><label><span className="sr-only">Storage location</span><select value={location} onChange={e => setLocation(e.target.value)}><option value="">All locations</option>{['Pantry', 'Fridge', 'Freezer'].map(x => <option key={x}>{x}</option>)}</select></label><Action secondary onClick={() => onAliases()}>Ingredient aliases</Action></div>{items.length ? <div className="inventory-table"><div className="inventory-table-head"><span>Ingredient</span><span>Amount on hand</span><span>Location</span><span className="sr-only">Actions</span></div>{items.map(p => <div className="inventory-row" key={p.id}><div><strong>{p.name}</strong>{p.note && <small>{p.note}</small>}</div><span className={p.amount === 0 ? 'out-of-stock' : 'amount'}>{formatAmount(p.amount, p.unit)}</span><span className="location-label">{p.location}</span><div className="inline-actions"><IconButton label={'Edit ' + p.name} onClick={() => onEdit(p)}><Pencil size={17}/></IconButton><IconButton label={'Remove ' + p.name} disabled={busy} onClick={() => commit('pantry.delete', { id: p.id })}><Trash2 size={16}/></IconButton></div></div>)}</div> : <Empty title={state.pantry.length ? 'No ingredients match' : 'What have you got?'} icon={<Refrigerator />}>Add ingredients and their amounts to see what you can cook and what you need to buy.</Empty>}{state.ingredients.length > 0 && <section className="alias-list"><SectionHead title="Ingredient names"/>{state.ingredients.map(i => <button key={i.id} onClick={() => onAliases(i)}><strong>{i.name}</strong><span>{i.aliases.join(', ') || 'No aliases'}</span><Pencil size={15}/></button>)}</section>}<p className="helper-note"><CircleHelp size={16}/> Cups and spoons use US measures. Package sizes and weight-to-volume conversions need your review.</p></>; }
function Shopping({ state, week, setWeek, commit, busy, onEdit, onPurchase, household, refresh }: {
    refresh: () => Promise<void>;
    household: string;
    state: State;
    week: string;
    setWeek: (s: string) => void;
    commit: Commit;
    busy: boolean;
    onEdit: (p: ShoppingItem) => void;
    onPurchase: () => void;
}) { useEffect(()=>{if(state.shoppingWeek)setWeek(state.shoppingWeek);},[]); const items = state.shopping, [showDone, setShowDone] = useState(true), checked = items.filter(x => x.checked && !x.addedToPantry).length; const groups = [...new Set(items.filter(x => showDone || !x.checked).map(x => x.group))]; return <><WeekPicker week={week} setWeek={setWeek} starts={state.settings.weekStartsOn}/>{state.shoppingWeek&&week!==state.shoppingWeek&&<div className="alert warning shopping-week-notice" role="status">You’re viewing the list for {shortDate(state.shoppingWeek)} – {shortDate(weekEnd(state.shoppingWeek))}. Update from plan to build the list for {shortDate(week)} – {shortDate(weekEnd(week))}. Manual additions and unpurchased quantity overrides are kept.</div>}<div className="shopping-tools"><div><strong>{items.filter(x => !x.checked).length} {items.filter(x=>!x.checked).length===1?'item':'items'} to pick up</strong><p>{state.shoppingWeek ? 'Current list: ' + shortDate(state.shoppingWeek) + ' – ' + shortDate(weekEnd(state.shoppingWeek)) : 'Build a list from your meal plan, or add items yourself.'}</p></div><div className="inline-actions"><Action secondary disabled={busy} onClick={() => commit('shopping.generate', { week })}><RefreshCw size={16}/>{state.shoppingWeek&&week!==state.shoppingWeek?'Build '+shortDate(week)+' list':'Update from plan'}</Action><Action disabled={busy || !checked} onClick={onPurchase}><Check size={17}/>Add purchases to pantry{checked ? ' (' + checked + ')' : ''}</Action></div></div><RemindersSync items={items} household={household} busy={busy} onUpdated={refresh}/>{items.length > 0 && <label className="checkbox-label"><input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)}/>Show checked items</label>}{groups.map(group => <section className="shopping-group" key={group}><h2>{group}</h2>{items.filter(x => x.group === group && (showDone || !x.checked)).map(item => <div className={'shopping-row ' + (item.checked ? 'checked' : '')} key={item.id}><label className="shopping-check"><input type="checkbox" disabled={busy || item.addedToPantry} checked={item.checked} onChange={e => commit('shopping.toggle', { id: item.id, checked: e.target.checked })}/><span><strong>{item.name}</strong><small>{item.note}{item.override&&!item.manual ? ' · Your quantity override' : ''}{item.addedToPantry ? ' · Added to pantry' : ''}</small></span></label><span className="amount">{item.amount === null ? 'Check amount' : formatAmount(item.amount, item.unit)}{item.uncertain && <span className="check-label">Check pantry</span>}</span><IconButton label={'Edit ' + item.name} disabled={item.addedToPantry} onClick={() => onEdit(item)}><Pencil size={17}/></IconButton><IconButton label={'Remove ' + item.name + ' from shopping'} disabled={busy} onClick={() => commit('shopping.delete', { id: item.id })}><X size={17}/></IconButton></div>)}</section>)}{!items.length && <Empty title="Shop for what’s missing" icon={<ShoppingBasket />} action={<Action secondary disabled={busy} onClick={() => commit('shopping.generate', { week })}>Build this week’s list <ArrowRight size={17}/></Action>}>Choose meals for the week. We’ll combine ingredients and subtract what’s already in your pantry.</Empty>}<p className="helper-note"><Leaf size={16}/>Leftover meals don’t add ingredients again. Update from plan whenever your meals or pantry change.</p></>; }
function RecipeDetail({ recipe: r, state, busy, onEdit, onDeleted, onFavorite, onCook, onPlan, commit }: {
    recipe: Recipe;
    state: State;
    busy: boolean;
    onEdit: () => void;
    onDeleted: () => void;
    onFavorite: () => void;
    onCook: () => void;
    onPlan: () => void;
    commit: Commit;
}) { const [servings, setServings] = useState(r.servings), [cooking, setCooking] = useState(false), [checks, setChecks] = useState<string[]>([]); const status = availability(state, r, servings), history = state.batches.filter(b => b.recipeId === r.id).sort((a, b) => b.preparedAt.localeCompare(a.preparedAt)); const toggle = (id: string) => setChecks(v => v.includes(id) ? v.filter(x => x !== id) : [...v, id]); return <div className={'recipe-detail ' + (cooking ? 'cooking-view' : '')}><div className="detail-top"><a className="text-link" href="#/recipes"><ArrowLeft size={16}/>Your recipes</a><div className="inline-actions"><IconButton label="Print recipe" onClick={() => window.print()}><Printer size={18}/></IconButton><IconButton label="Edit recipe" onClick={onEdit}><Pencil size={18}/></IconButton><IconButton label={r.favorite ? 'Remove from favorites' : 'Add to favorites'} onClick={onFavorite}><Heart size={18} fill={r.favorite ? 'currentColor' : 'none'}/></IconButton></div></div><div className="detail-intro"><div><h1>{r.title}</h1><span className="category-label">{r.category}{r.wantToTry ? ' · Want to try' : ''}</span>{r.description && <p className="description">{r.description}</p>}<div className="detail-meta"><span><Clock3 size={17}/>Prep {r.prepMinutes} min</span><span><ChefHat size={17}/>Cook {r.cookMinutes} min</span><span><Utensils size={17}/>{r.servings} original servings</span></div>{r.sourceUrl && <a className="text-link" href={r.sourceUrl} target="_blank" rel="noreferrer">{r.author ? 'Recipe from ' + r.author : 'Original recipe'}<ArrowUpRight size={16}/></a>}<div className="tag-list">{r.tags.map(t => <span key={t}>{t}</span>)}</div><div className="detail-actions"><Action onClick={onPlan}><CalendarDays size={17}/>Add to meal plan</Action><Action secondary onClick={() => setCooking(!cooking)}><BookOpen size={17}/>{cooking ? 'Exit cooking view' : 'Cooking view'}</Action></div></div><Photo recipe={r}/></div><div className="recipe-content"><section className="ingredients-panel"><div className="section-head"><h2>Ingredients</h2><label className="serving-input">Servings<input type="number" min="0.25" step="0.25" max="1000000" value={servings} onChange={e => { const n = Number(e.target.value); if (n > 0)
    setServings(n); }}/></label></div><p className="muted">{servings === r.servings ? 'Original recipe amounts.' : (servings / r.servings).toFixed(2) + '× the original recipe.'}</p>{r.ingredients.map((i, index) => <div key={i.id}>{i.group && i.group !== r.ingredients[index - 1]?.group && <h3 className="ingredient-group">{i.group}</h3>}<label className={'ingredient-line ' + (checks.includes(i.id) ? 'crossed' : '')}><input type="checkbox" checked={checks.includes(i.id)} onChange={() => toggle(i.id)}/><span><strong>{i.amount === null ? '' : formatAmount(i.amount * servings / r.servings, i.unit) + ' '}</strong>{i.name}{i.note && <small>{i.note}</small>}{i.amount === null && <small>Amount to review · {i.raw || 'as needed'}</small>}</span></label></div>)}<div className="pantry-summary"><strong><Leaf size={16}/>In your pantry</strong><p>{status.every(x => x.status === 'ready') ? 'You have the ingredients for these servings.' : status.filter(x => x.status !== 'ready').map(x => x.name + (x.status === 'check' ? ' (check amount)' : '')).join(', ') + ' need a look.'}</p></div></section><section className="instructions"><h2>Let’s make it</h2>{r.steps.map((step, i) => <label className={'instruction ' + (checks.includes('step' + i) ? 'crossed' : '')} key={i}><input type="checkbox" checked={checks.includes('step' + i)} onChange={() => toggle('step' + i)}/><span className="step-number">{i + 1}</span><span>{step}</span></label>)}<div className="cook-complete"><ChefHat size={27}/><div><h3>Made something good?</h3><p>Record what you used and save any portions for another day.</p></div><Action onClick={onCook}>Mark as cooked <Check size={17}/></Action></div>{r.notes && <section className="personal-notes"><h2>Your kitchen notes</h2><p>{r.notes}</p></section>}<section className="cook-history"><SectionHead title="Cooking history"/>{history.length ? history.map(b => <p key={b.id}>{shortDate(b.preparedAt.slice(0, 10))} · Cooked {b.cookedServings} servings · {b.remaining} remaining</p>) : <p className="muted">Your first cook is still to come.</p>}</section></section></div><button className="danger-link" disabled={busy} onClick={async () => { if (window.confirm('Delete ' + r.title + '? This cannot be undone.'))
    if (await commit('recipe.delete', { id: r.id }))
        onDeleted(); }}>Delete recipe</button></div>; }
function RecipeEditor({ recipe, draft, state, busy, commit, onSaved, onError }: {
    recipe: Recipe;
    draft?: ImportDraft;
    state: State;
    busy: boolean;
    commit: Commit;
    onSaved: (r: Recipe) => void;
    onError: (s: string) => void;
}) {
    const [r, setR] = useState<Recipe>(() => structuredClone(recipe)), [sourceText, setSourceText] = useState(draft?.text ?? ''), [ingredientText, setIngredientText] = useState(''), [uploading, setUploading] = useState(false), [dirty, setDirty] = useState(false);
    const set = (key: keyof Recipe, value: any) => { setDirty(true); setR(old => ({ ...old, [key]: value })); };
    const ownDraftSave = useRef(false);
    const external = recipe.updatedAt !== r.updatedAt;
    useEffect(() => { if (ownDraftSave.current && external) {
        setR(structuredClone(recipe));
        setDirty(false);
        ownDraftSave.current = false;
    } }, [recipe.updatedAt]);
    const save = async (e: FormEvent) => { e.preventDefault(); const payload = { ...r, expectedUpdatedAt: state.recipes.some(x => x.id === r.id) ? r.updatedAt : undefined }; if (await commit('recipe.save', payload)) {
        setDirty(false);
        onSaved(r);
    } };
    const saveDraft = async () => { ownDraftSave.current = true; if (await commit('draft.save', { id: draft?.id, recipe: r, text: sourceText, warnings: draft?.warnings ?? [], expectedUpdatedAt: draft ? r.updatedAt : undefined })) {
        setDirty(false);
    }
    else
        ownDraftSave.current = false; };
    const upload = async (file: File) => { setUploading(true); try {
        const data = await uploadPhoto(file);
        set('image', data.url);
    }
    catch (e) {
        onError(e instanceof Error ? e.message : 'Photo upload failed.');
    }
    finally {
        setUploading(false);
    } };
    const changeIngredient = (id: string, key: string, value: any) => set('ingredients', r.ingredients.map(i => i.id === id ? { ...i, [key]: value } : i));
    return <div className="recipe-editor"><a href="#/recipes" className="text-link"><ArrowLeft size={17}/>Back to recipes</a><div className="page-head"><div><h1>{draft ? 'Make this recipe yours' : state.recipes.some(x => x.id === r.id) ? 'Edit your recipe' : 'A new recipe to keep'}</h1><p>{draft ? 'Review the imported details before adding it to your library.' : 'A few good details make it easy to cook again.'}</p></div></div>{external && <div className="alert warning"><span>A newer version is available. Reload it before saving{dirty ? ' (your unsaved changes will be replaced)' : ''}.</span><button className="text-link" onClick={() => { setR(structuredClone(recipe)); setSourceText(draft?.text ?? ''); setDirty(false); }}>Load latest version</button></div>}{draft && <section className="import-review"><h2>Import review</h2>{draft.warnings.map((w, i) => <p key={i}>{w}</p>)}<label>Recipe text or transcript<textarea rows={5} value={sourceText} onChange={e => { setSourceText(e.target.value); setDirty(true); }} placeholder="Paste the source recipe or video transcript here…"/></label><div className="inline-actions"><Action secondary disabled={busy || external} onClick={saveDraft}>Save draft & source text</Action><button className="text-link" onClick={async () => { try {
        await navigator.clipboard.writeText(`Use CookBook to read import draft ${draft.id}. Turn its source text into a recipe draft. Preserve the source, photo, and stated quantities; flag missing details. Save a review-only draft.`);
    }
    catch {
        onError('Could not copy. Ask the assistant to finish draft ' + draft.id + '.');
    } }}><Copy size={16}/>Copy request for assistant</button></div><p className="muted">After your assistant finishes, refresh this page and load the latest version. Your draft stays private.</p></section>}
 <form onSubmit={save}><div className="editor-intro"><div className="form-stack"><label>Recipe name<input required maxLength={200} value={r.title} onChange={e => set('title', e.target.value)} placeholder="What are we making?"/></label><label>A little about it<textarea rows={3} value={r.description} onChange={e => set('description', e.target.value)} placeholder="The version you like, when to make it…"/></label><div className="form-grid thirds"><label>Original servings<input required type="number" step="any" min="0.25" max="1000000" value={r.servings} onChange={e => set('servings', Number(e.target.value))}/></label><label>Prep minutes<input type="number" min="0" max="1000000" value={r.prepMinutes} onChange={e => set('prepMinutes', Number(e.target.value))}/></label><label>Cook minutes<input type="number" min="0" max="1000000" value={r.cookMinutes} onChange={e => set('cookMinutes', Number(e.target.value))}/></label></div></div><div className="editor-photo"><Photo recipe={r}/><label className="upload-button"><Upload size={16}/>{uploading ? 'Uploading…' : 'Upload a photo'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={e => { if (e.target.files?.[0])
        upload(e.target.files[0]); }}/></label><label>Photo link<input type="url" value={r.image.startsWith('photo:') ? '' : r.image} onChange={e => set('image', e.target.value)} placeholder="https://…"/></label></div></div><div className="form-grid"><label>Category<select value={r.category} onChange={e => set('category', e.target.value)}>{[...new Set([...state.settings.categories, r.category])].map(x => <option key={x}>{x}</option>)}</select></label><label>Tags, separated by commas<input value={r.tags.join(', ')} onChange={e => set('tags', e.target.value.split(',').map(x => x.trimStart()))} placeholder="quick, freezer friendly"/></label><label>Original recipe or video link<input type="url" value={r.sourceUrl} onChange={e => set('sourceUrl', e.target.value)} placeholder="https://…"/></label><label>Recipe author or creator<input value={r.author} onChange={e => set('author', e.target.value)}/></label></div><div className="inline-actions flags"><label className="checkbox-label"><input type="checkbox" checked={r.wantToTry} onChange={e => set('wantToTry', e.target.checked)}/>Want to try</label><label className="checkbox-label"><input type="checkbox" checked={r.favorite} onChange={e => set('favorite', e.target.checked)}/>Favorite</label></div>
 <section className="editor-section"><SectionHead title="Ingredients"/><p className="muted">Use the original recipe quantities. Leave an amount blank when it’s not specified.</p><div className="ingredient-entry-head"><span>Ingredient</span><span>Amount</span><span>Unit</span><span>Group / preparation</span></div>{r.ingredients.map(i => <div className="ingredient-entry" key={i.id}><label><span className="sr-only">Ingredient name</span><input required value={i.name} onChange={e => changeIngredient(i.id, 'name', e.target.value)} placeholder="e.g. basmati rice"/></label><label><span className="sr-only">Amount for {i.name || 'ingredient'}</span><input inputMode="decimal" type="number" min="0" step="any" value={i.amount ?? ''} onChange={e => changeIngredient(i.id, 'amount', e.target.value === '' ? null : Number(e.target.value))} placeholder="As needed"/></label><label><span className="sr-only">Unit for {i.name || 'ingredient'}</span><input value={i.unit} onChange={e => changeIngredient(i.id, 'unit', e.target.value)} placeholder="g, cups…"/></label><div className="ingredient-extra"><label><span className="sr-only">Ingredient group</span><input value={i.group} onChange={e => changeIngredient(i.id, 'group', e.target.value)} placeholder="Group, e.g. sauce"/></label><label><span className="sr-only">Preparation note</span><input value={i.note} onChange={e => changeIngredient(i.id, 'note', e.target.value)} placeholder="Preparation note"/></label></div><IconButton label={'Remove ' + (i.name || 'ingredient')} onClick={() => set('ingredients', r.ingredients.filter(x => x.id !== i.id))} type="button"><X size={17}/></IconButton>{i.raw && i.amount === null && <small className="raw-line">Original: {i.raw}</small>}</div>)}<Action type="button" secondary onClick={() => set('ingredients', [...r.ingredients, { id: uid(), name: '', amount: null, unit: '', group: '', note: '', raw: '' }])}><Plus size={16}/>Add ingredient</Action><details className="paste-ingredients"><summary>Paste an ingredient list</summary><label>One ingredient per line<textarea rows={4} value={ingredientText} onChange={e => setIngredientText(e.target.value)} placeholder={'2 cups basmati rice\n1/2 tsp salt\n3 eggs'}/></label><Action secondary type="button" onClick={() => { set('ingredients', [...r.ingredients, ...ingredientText.split('\n').map(x => x.trim()).filter(Boolean).map(parseIngredient)]); setIngredientText(''); }}>Add these ingredients</Action></details></section>
 <section className="editor-section"><h2>Instructions</h2><label>Separate each step with a blank line<textarea required rows={10} value={r.steps.join('\n\n')} onChange={e => set('steps', e.target.value.split(/\n\s*\n/))} placeholder={'Start with the first step.\n\nThen add the next step.'}/></label></section><section className="editor-section"><h2>Your kitchen notes</h2><label>What would you tell yourself next time?<textarea rows={4} value={r.notes} onChange={e => set('notes', e.target.value)} placeholder="A little more lemon, a smaller pan, a variation worth keeping…"/></label></section><div className="editor-save"><a className="button secondary" href="#/recipes">Cancel</a>{draft && <Action type="button" secondary disabled={busy || uploading || external} onClick={saveDraft}>Keep as draft</Action>}<Action disabled={busy || uploading || external} type="submit">{busy ? 'Saving…' : draft ? 'Save to recipe library' : 'Save recipe'}<Check size={17}/></Action></div></form></div>;
}
function ImportForm({ busy, onImport, onText }: {
    busy: boolean;
    onImport: (s: string) => void;
    onText: () => void;
}) { return <><p className="dialog-description">Paste a recipe-page or YouTube link. We’ll bring in the details and photo that are available, then you can review everything.</p><form onSubmit={e => { e.preventDefault(); onImport(field(new FormData(e.currentTarget), 'url')); }} className="form-stack"><label>Recipe or video link<input autoFocus required type="url" name="url" placeholder="https://…"/></label><Action disabled={busy} type="submit"><Link2 size={17}/>{busy ? 'Reading the source…' : 'Import recipe'}</Action></form><div className="dialog-divider"><span>Have the recipe text instead?</span></div><Action secondary disabled={busy} onClick={onText}>Start a draft from text <ArrowRight size={17}/></Action><p className="muted">Video transcripts aren’t always accessible. You can paste one into the draft and ask your connected assistant to finish it.</p></>; }
function PantryForm({ item, busy, commit, onDone }: {
    item?: PantryItem;
    busy: boolean;
    commit: Commit;
    onDone: () => void;
}) { const [invalid, setInvalid] = useState(''); return <form className="form-stack" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget), v = field(f, 'amount'), n = amount(v); if (v && n === null) {
    setInvalid('Use a number or fraction, such as 1/2. Leave blank for on hand.');
    return;
} if (await commit('pantry.save', { id: item?.id, name: field(f, 'name'), amount: n, unit: field(f, 'unit'), location: field(f, 'location'), note: field(f, 'note'), __expected: item ? JSON.stringify(item) : undefined }))
    onDone(); }}><label>Ingredient<input required autoFocus name="name" defaultValue={item?.name} placeholder="e.g. basmati rice"/></label><div className="form-grid"><label>Amount<input name="amount" inputMode="decimal" defaultValue={item?.amount ?? ''} placeholder="500, 3, or 1/2"/></label><label>Unit<input name="unit" defaultValue={item?.unit} placeholder="g, eggs, bottle…"/></label></div><p className="muted">Leave the amount blank to record “on hand.” Use a blank unit for individual items such as eggs.</p>{invalid && <p role="alert" className="field-error">{invalid}</p>}<label>Location<select name="location" defaultValue={item?.location ?? 'Pantry'}>{['Pantry', 'Fridge', 'Freezer'].map(x => <option key={x}>{x}</option>)}</select></label><label>Note<textarea rows={2} name="note" defaultValue={item?.note} placeholder="Package size or anything to remember"/></label><Action type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save ingredient'}</Action></form>; }
function AliasForm({ item, busy, commit, onDone }: {
    item?: any;
    busy: boolean;
    commit: Commit;
    onDone: () => void;
}) { return <form className="form-stack" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); if (await commit('ingredient.save', { id: item?.id, name: field(f, 'name'), aliases: field(f, 'aliases') }))
    onDone(); }}><p>Tell CookBook when different ingredient names mean the same thing. Keep different ingredients, such as fresh tomatoes and tomato paste, separate.</p><label>Ingredient name<input autoFocus required name="name" defaultValue={item?.name} placeholder="e.g. scallions"/></label><label>Other names, separated by commas<textarea rows={3} name="aliases" defaultValue={item?.aliases.join(', ')} placeholder="green onions, spring onions"/></label><Action disabled={busy} type="submit">Save ingredient names</Action></form>; }
function PlanForm({ initial, state, busy, commit, onDone }: {
    initial: Partial<PlanEntry>;
    state: State;
    busy: boolean;
    commit: Commit;
    onDone: () => void;
}) { const [kind, setKind] = useState(initial.kind ?? 'cook'), [recipeId, setRecipeId] = useState(initial.recipeId ?? state.recipes[0]?.id ?? ''), [cooked, setCooked] = useState(initial.cookServings ?? state.settings.servings), [eaten, setEaten] = useState(initial.eatServings ?? state.settings.servings); const options = [...state.batches.filter(b => b.remaining > 0).map(b => ({ id: b.id, title: b.title, available: b.remaining - reserved(state, b.id, initial.id), location: b.location })), ...state.plan.filter(p => p.kind === 'cook' && !p.done && p.id !== initial.id && p.cookServings > p.eatServings).map(p => ({ id: p.id, title: state.recipes.find(r => r.id === p.recipeId)?.title ?? 'Planned batch', available: p.cookServings - p.eatServings - reserved(state, p.id, initial.id), location: 'Planned ' + shortDate(p.date) }))]; return <form className="form-stack" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); if (await commit('plan.save', { ...initial, kind, recipeId, date: field(f, 'date'), slot: field(f, 'slot'), batchId: field(f, 'batchId'), cookServings: cooked, eatServings: eaten, note: field(f, 'note'), __expected: initial.id ? JSON.stringify(initial) : undefined }))
    onDone(); }}><div className="segmented"><button type="button" className={kind === 'cook' ? 'selected' : ''} onClick={() => setKind('cook')}><ChefHat size={16}/>Cook a recipe</button><button type="button" className={kind === 'leftover' ? 'selected' : ''} onClick={() => setKind('leftover')}><Refrigerator size={16}/>Eat leftovers</button></div><div className="form-grid"><label>Date<input required type="date" name="date" defaultValue={initial.date ?? today()}/></label><label>Meal<select name="slot" defaultValue={initial.slot ?? 'Dinner'}>{['Breakfast', 'Lunch', 'Dinner', 'Snack'].map(x => <option key={x}>{x}</option>)}</select></label></div>{kind === 'cook' ? <><label>Recipe<select required value={recipeId} onChange={e => setRecipeId(e.target.value)}><option value="">Choose a recipe</option>{state.recipes.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label><div className="form-grid"><label>Servings to cook<input required type="number" min="0.25" step="0.25" value={cooked} onChange={e => setCooked(Number(e.target.value))}/></label><label>Servings to eat now<input required type="number" min="0" step="0.25" max={cooked} value={eaten} onChange={e => setEaten(Number(e.target.value))}/></label></div><PortionStrip cooked={cooked} eaten={eaten}/></> : <><label>Prepared or planned batch<select required name="batchId" defaultValue={initial.batchId ?? ''}><option value="">Choose a batch</option>{options.map(b => <option value={b.id} key={b.id}>{b.title} · {b.available} unassigned · {b.location}</option>)}</select></label><label>Portions for this meal<input required type="number" step="0.25" min="0.25" value={eaten} onChange={e => setEaten(Number(e.target.value))}/></label>{!options.length && <p className="muted">Plan a larger cooking batch or cook a recipe first. Its saved portions will appear here.</p>}</>}<label>Meal note<input name="note" defaultValue={initial.note} placeholder="Anything to remember"/></label><Action disabled={busy} type="submit">{busy ? 'Saving…' : 'Save meal'}</Action></form>; }
function PortionStrip({ cooked, eaten }: {
    cooked: number;
    eaten: number;
}) { return <div className="portion-summary"><div className="portion-bar" aria-hidden="true"><span style={{ width: Math.min(100, Math.max(0, eaten / Math.max(1, cooked) * 100)) + '%' }}/></div><div><span><strong>{eaten}</strong> to eat now</span><span><strong>{Math.max(0, cooked - eaten)}</strong> for later</span></div></div>; }
function AutoLeftoverNote({ state, entry, remaining }: {
    state: State;
    entry?: PlanEntry;
    remaining: number;
}) { const batchId = entry?.id ?? '', meals = autoLeftovers(state, batchId, remaining, entry?.date ?? today()), assigned = meals.reduce((n, m) => n + m.portions, 0), unplanned = Math.max(0, Math.round((remaining - reserved(state, batchId) - assigned) * 100) / 100), slot = entry?.slot ?? 'Dinner'; if (!meals.length)
    return <p className="muted">{remaining > 0 ? 'Auto leftovers are off in Kitchen settings, or these portions are already planned.' : 'Nothing left over from this meal.'}</p>; return <div className="portion-summary auto-leftovers"><div className="leftover-days">{meals.map(m => <span key={m.date}>{shortDate(m.date, { weekday: 'short', month: 'short', day: 'numeric' })}<strong>{m.portions}</strong></span>)}</div><p>{`Planned as ${slot} leftovers: ${meals.length} ${meals.length === 1 ? 'meal' : 'meals'}${unplanned ? `, ${unplanned} more ${unplanned === 1 ? 'portion' : 'portions'} left unplanned` : ''}.`}</p></div>; }
function CookForm({ recipe, entry, state: latestState, busy, commit, onDone }: {
    recipe: Recipe;
    entry?: PlanEntry;
    state: State;
    busy: boolean;
    commit: Commit;
    onDone: () => void;
}) { const state = useRef(latestState).current; const [cooked, setCooked] = useState(entry?.cookServings ?? recipe.servings), [eaten, setEaten] = useState(entry?.eatServings ?? state.settings.servings), [usage, setUsage] = useState<{
    pantryId: string;
    amount: number | null;
    unit: string;
    name: string;
    expected: string;
}[]>([]); const needs = useMemo(() => requirements(state, [{ recipe, servings: cooked }]), [state, recipe, cooked]); useEffect(() => { const rows: {
    pantryId: string;
    amount: number | null;
    unit: string;
    name: string;
    expected: string;
}[] = []; for (const n of needs) {
    let left = n.amount;
    for (const p of state.pantry.filter(p => canonical(state, p.name) === canonical(state, n.name))) {
        const required = left === null ? null : convert(left, n.unit, p.unit);
        const actual = required === null || p.amount === null ? null : Math.min(required, p.amount);
        rows.push({ pantryId: p.id, amount: actual, unit: p.unit, name: p.name, expected: JSON.stringify(p) });
        if (left !== null && actual !== null)
            left = Math.max(0, left - convert(actual, p.unit, n.unit)!);
    }
} setUsage(rows); }, [needs, state]); return <form className="form-stack" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); if (await commit('cook', { recipeId: recipe.id, planId: entry?.id, cookServings: cooked, eatServings: eaten, usage, location: field(f, 'location') }))
    onDone(); }}><p className="dialog-description"><strong>{recipe.title}</strong><br />Review what you actually used before updating your pantry.</p><div className="form-grid"><label>Servings cooked<input required type="number" step="0.25" min="0.25" value={cooked} onChange={e => setCooked(Number(e.target.value))}/></label><label>Servings eaten now<input required type="number" step="0.25" min="0" max={cooked} value={eaten} onChange={e => setEaten(Number(e.target.value))}/></label></div><PortionStrip cooked={cooked} eaten={eaten}/><AutoLeftoverNote state={state} entry={entry} remaining={Math.max(0, cooked - eaten)}/><label>Keep remaining portions in<select name="location"><option>Fridge</option><option>Freezer</option></select></label><div className="usage-review"><h3>Pantry deductions</h3><p className="muted">Only the measured amounts below will be deducted. Blank amounts leave stock unchanged.</p>{needs.map(n => <div className="needed-line" key={n.key}><span>{n.name}</span><strong>{n.amount === null ? 'Amount to review' : formatAmount(n.amount, n.unit) + ' needed'}</strong></div>)}{usage.map((u, i) => <label className="usage-line" key={u.pantryId + i}><span>{u.name}<small>{state.pantry.find(p => p.id === u.pantryId)?.location} · {formatAmount(state.pantry.find(p => p.id === u.pantryId)?.amount ?? null, u.unit)} on hand</small></span><input aria-label={'Deduct ' + u.name} type="number" min="0" step="any" max={state.pantry.find(p => p.id === u.pantryId)?.amount ?? undefined} value={u.amount ?? ''} placeholder="Unchanged" onChange={e => setUsage(rows => rows.map((row, j) => i === j ? { ...row, amount: e.target.value === '' ? null : Number(e.target.value) } : row))}/><span>{u.unit}</span></label>)}{needs.some(n => !n.present || n.uncertain || (n.missing ?? 0) > 0) && <p className="field-warning">Some ingredients are missing or unmeasured. Confirm your actual usage below; ingredients without measured stock will stay unchanged.</p>}</div><label className="checkbox-label"><input type="checkbox" required/>I reviewed these pantry deductions and remaining portions.</label><Action disabled={busy} type="submit"><Check size={17}/>{busy ? 'Saving…' : 'Confirm cooked meal'}</Action></form>; }
function BatchForm({ batch, state, busy, commit, onDone, onEat }: {
    batch: PreparedBatch;
    state: State;
    busy: boolean;
    commit: Commit;
    onDone: () => void;
    onEat: () => void;
}) { return <form className="form-stack" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); if (await commit('batch.update', { id: batch.id, remaining: Number(field(f, 'remaining')), location: field(f, 'location'), __expected: JSON.stringify(batch) }))
    onDone(); }}><p><strong>{batch.title}</strong><br />{reserved(state, batch.id)} portions are assigned to upcoming meals.</p><label>Portions remaining<input required type="number" name="remaining" defaultValue={batch.remaining} min={reserved(state, batch.id)} step="0.25"/></label><label>Location<select name="location" defaultValue={batch.location}><option>Fridge</option><option>Freezer</option></select></label><p className="muted">Adjust portions after a spill, a smaller yield, or discarding leftovers. Raw ingredients won’t change.</p><div className="form-grid"><Action secondary type="button" onClick={onEat}>Eat some now</Action><Action disabled={busy} type="submit">Save portions</Action></div></form>; }
function EatForm({ batch, entry, state, busy, commit, onDone }: {
    batch?: PreparedBatch;
    entry?: PlanEntry;
    state: State;
    busy: boolean;
    commit: Commit;
    onDone: () => void;
}) { return <form className="form-stack" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); if (await commit('leftover.eat', { batchId: batch?.id, planId: entry?.id, amount: Number(field(f, 'amount')) }))
    onDone(); }}><p><strong>{batch?.title ?? 'Planned leftovers'}</strong></p><p>{batch ? `${batch.remaining} portions remain; ${batch.remaining - reserved(state, batch.id, entry?.id)} are available for this meal.` : 'Cook the original batch first.'}</p><label>Portions eaten<input required name="amount" type="number" min="0.25" step="0.25" defaultValue={entry?.eatServings ?? Math.min(state.settings.servings, batch?.remaining ?? 0)} readOnly={!!entry}/></label><p className="muted">This reduces prepared portions only. Pantry ingredients are unchanged.</p><Action disabled={busy || !batch} type="submit">Confirm meal eaten <Check size={17}/></Action></form>; }
function ShoppingForm({ item, busy, commit, onDone }: {
    item?: ShoppingItem;
    busy: boolean;
    commit: Commit;
    onDone: () => void;
}) { const [invalid, setInvalid] = useState(''); return <form className="form-stack" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget), v = field(f, 'amount'), n = amount(v); if (v && n === null) {
    setInvalid('Enter a number or fraction, or leave the amount blank.');
    return;
} if (await commit('shopping.save', { ...item, name: field(f, 'name'), amount: n, unit: field(f, 'unit'), group: field(f, 'group'), note: field(f, 'note'), __expected: item ? JSON.stringify(item) : undefined }))
    onDone(); }}><label>Item<input autoFocus required name="name" defaultValue={item?.name}/></label><div className="form-grid"><label>Amount<input name="amount" defaultValue={item?.amount ?? ''} inputMode="decimal" placeholder="e.g. 2 or 1/2"/></label><label>Unit<input name="unit" defaultValue={item?.unit}/></label></div>{invalid && <p role="alert" className="field-error">{invalid}</p>}<label>Group or aisle<input name="group" defaultValue={item?.group ?? 'Other'} placeholder="Produce, dairy, household…"/></label><label>Note<textarea rows={2} name="note" defaultValue={item?.note}/></label>{item && !item.manual && <p className="muted">Editing marks this as your quantity override. Refreshing from the plan will preserve it.</p>}<Action disabled={busy} type="submit">Save shopping item</Action></form>; }
function PurchaseForm({ state, busy, commit, onDone }: {
    state: State;
    busy: boolean;
    commit: Commit;
    onDone: () => void;
}) { const [rows, setRows] = useState(() => state.shopping.filter(x => x.checked && !x.addedToPantry).map(x => ({ id: x.id, name: x.name, amount: x.amount === null ? '' : String(x.amount), unit: x.unit, location: 'Pantry' }))), [invalid, setInvalid] = useState(''); return <form className="form-stack" onSubmit={async (e) => { e.preventDefault(); const values = rows.map(r => ({ ...r, amount: amount(r.amount) })); if (rows.some((r, i) => r.amount && values[i].amount === null)) {
    setInvalid('Use numbers or fractions for purchase quantities.');
    return;
} if (await commit('shopping.purchase', { items: values }))
    onDone(); }}><p>You may have bought a larger package than the recipe needs. Enter what actually came home.</p>{rows.map((r, i) => <div className="purchase-row" key={r.id}><strong>{r.name}</strong><div className="form-grid thirds"><label>Amount<input value={r.amount} onChange={e => setRows(rows.map((x, j) => i === j ? { ...x, amount: e.target.value } : x))} placeholder="On hand"/></label><label>Unit<input value={r.unit} onChange={e => setRows(rows.map((x, j) => i === j ? { ...x, unit: e.target.value } : x))}/></label><label>Location<select value={r.location} onChange={e => setRows(rows.map((x, j) => i === j ? { ...x, location: e.target.value } : x))}>{['Pantry', 'Fridge', 'Freezer'].map(v => <option key={v}>{v}</option>)}</select></label></div></div>)}{invalid && <p className="field-error" role="alert">{invalid}</p>}<Action disabled={busy || !rows.length} type="submit">Confirm pantry additions <Check size={17}/></Action></form>; }
function SettingsPage({ state, commit, busy }: {
    state: State;
    commit: Commit;
    busy: boolean;
}) { return <div className="settings-layout"><form className="form-stack settings-form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); await commit('settings.save', { servings: Number(field(f, 'servings')), weekStartsOn: Number(field(f, 'weekStartsOn')), autoLeftovers: f.get('autoLeftovers') === 'on', categories: field(f, 'categories') }); }}><h2>The way you cook</h2><div className="form-grid"><label>Usual servings per meal<input name="servings" required type="number" step="0.25" min="0.25" defaultValue={state.settings.servings}/></label><label>Start the week on<select name="weekStartsOn" defaultValue={state.settings.weekStartsOn}><option value="1">Monday</option><option value="0">Sunday</option></select></label></div><label className="checkbox-label auto-leftovers-toggle"><input type="checkbox" name="autoLeftovers" defaultChecked={state.settings.autoLeftovers !== false}/>Plan leftover meals automatically</label><p className="muted">When you cook more than you eat, the extra portions are scheduled as leftovers for the following days, one meal per usual serving.</p><label>Recipe categories, one per line<textarea name="categories" required rows={8} defaultValue={state.settings.categories.join('\n')}/></label><p className="muted">Existing recipes keep their category when you change this list.</p><Action disabled={busy} type="submit">Save kitchen settings</Action></form><HouseholdSettings/></div>; }
