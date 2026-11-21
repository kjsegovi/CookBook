import { useState } from 'react';
import { CalendarDays, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { Menu, MenuItem, State } from '../lib/domain';
import { Action, IconButton, type Commit } from './kitchen-ui';

const SLOTS: MenuItem['slot'][] = ['Breakfast', 'Lunch', 'Dinner', 'Snack'];
const todayIso = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// Menus: reusable sets of recipes (a holiday dinner, a week of lunches) that
// can be added to the meal plan in one step.
export default function Menus({ state, commit, busy }: { state: State; commit: Commit; busy: boolean }) {
    const [editing, setEditing] = useState<Menu | 'new' | null>(null), [planning, setPlanning] = useState<string | null>(null);
    const menus = state.menus ?? [];
    if (editing) return <MenuForm menu={editing === 'new' ? undefined : editing} state={state} commit={commit} busy={busy} onDone={() => setEditing(null)}/>;
    return <div className="menus-page">
        <div className="inline-actions"><Action onClick={() => setEditing('new')} disabled={!state.recipes.length}><Plus size={17}/>New menu</Action></div>
        {!state.recipes.length && <p className="muted">Save a few recipes first, then group them into menus.</p>}
        {menus.length === 0 ? <div className="empty-state"><CalendarDays/><h2>No menus yet</h2><p>Group recipes you make together, like a holiday dinner or a week of lunches, and add them to your plan in one step.</p></div> :
            <div className="menu-list">{menus.map(menu => {
                const days = Math.max(...menu.items.map(i => i.day));
                return <article className="menu-card" key={menu.id}>
                    <div className="section-head"><h2>{menu.name}</h2><span className="inline-actions"><IconButton label={'Edit ' + menu.name} onClick={() => setEditing(menu)}><Pencil size={17}/></IconButton><IconButton label={'Delete ' + menu.name} disabled={busy} onClick={() => { if (window.confirm('Delete the menu ' + menu.name + '? Its recipes stay in your library.')) void commit('menu.delete', { id: menu.id }); }}><Trash2 size={17}/></IconButton></span></div>
                    {menu.description && <p className="muted">{menu.description}</p>}
                    {Array.from({ length: days }, (_, d) => d + 1).map(day => {
                        const items = menu.items.filter(i => i.day === day);
                        return items.length ? <div key={day} className="menu-day">{days > 1 && <h3>Day {day}</h3>}<ul>{items.map((i, n) => <li key={n}><span className="muted">{i.slot}</span> <a href={'#/recipes/' + i.recipeId}>{state.recipes.find(r => r.id === i.recipeId)?.title ?? 'Removed recipe'}</a></li>)}</ul></div> : null;
                    })}
                    {planning === menu.id ? <form className="inline-actions" onSubmit={async e => { e.preventDefault(); const date = String(new FormData(e.currentTarget).get('date')); if (await commit('menu.plan', { menuId: menu.id, date })) setPlanning(null); }}>
                        <label>{days > 1 ? 'Day 1 is' : 'Date'}<input type="date" name="date" required defaultValue={todayIso()}/></label><Action type="submit" disabled={busy}>Add to plan</Action><button type="button" className="text-link" onClick={() => setPlanning(null)}>Cancel</button>
                    </form> : <Action secondary onClick={() => setPlanning(menu.id)}><CalendarDays size={17}/>Add to meal plan</Action>}
                </article>;
            })}</div>}
    </div>;
}

function MenuForm({ menu, state, commit, busy, onDone }: { menu?: Menu; state: State; commit: Commit; busy: boolean; onDone: () => void }) {
    const [items, setItems] = useState<MenuItem[]>(menu?.items ?? [{ recipeId: '', day: 1, slot: 'Dinner' }]);
    const recipes = [...state.recipes].sort((a, b) => a.title.localeCompare(b.title));
    const change = (index: number, patch: Partial<MenuItem>) => setItems(list => list.map((item, i) => i === index ? { ...item, ...patch } : item));
    return <form className="form-stack menu-form" onSubmit={async e => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        if (await commit('menu.save', { id: menu?.id, name: String(form.get('name') ?? ''), description: String(form.get('description') ?? ''), items: items.filter(i => i.recipeId), expectedUpdatedAt: menu?.updatedAt })) onDone();
    }}>
        <h2>{menu ? 'Edit menu' : 'A new menu'}</h2>
        <label>Name<input name="name" required maxLength={200} defaultValue={menu?.name} placeholder="Thanksgiving dinner"/></label>
        <label>Notes<textarea name="description" rows={2} maxLength={2000} defaultValue={menu?.description}/></label>
        <fieldset><legend>Recipes</legend>{items.map((item, index) => <div className="menu-item-row" key={index}>
            <label><span className="sr-only">Recipe</span><select required value={item.recipeId} onChange={e => change(index, { recipeId: e.target.value })}><option value="">Choose a recipe…</option>{recipes.map(r => <option key={r.id} value={r.id}>{r.title}</option>)}</select></label>
            <label>Day<input type="number" min={1} max={31} value={item.day} onChange={e => change(index, { day: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })}/></label>
            <label><span className="sr-only">Meal</span><select value={item.slot} onChange={e => change(index, { slot: e.target.value as MenuItem['slot'] })}>{SLOTS.map(s => <option key={s}>{s}</option>)}</select></label>
            <IconButton type="button" label="Remove recipe from menu" onClick={() => setItems(list => list.filter((_, i) => i !== index))}><X size={16}/></IconButton>
        </div>)}
            <Action type="button" secondary onClick={() => setItems(list => [...list, { recipeId: '', day: list.at(-1)?.day ?? 1, slot: 'Dinner' }])}><Plus size={16}/>Add a recipe</Action>
        </fieldset>
        <div className="inline-actions"><Action type="submit" disabled={busy || !items.some(i => i.recipeId)}>Save menu</Action><button type="button" className="text-link" onClick={onDone}>Cancel</button></div>
    </form>;
}
