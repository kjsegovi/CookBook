import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type { PlanEntry, State } from '../lib/domain';
import { IconButton, type Commit } from './kitchen-ui';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (date: string, days: number) => { const d = new Date(date + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return iso(d); };
const monthTitle = (month: string) => new Date(month + '-01T12:00:00Z').toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });

// A month of meals. Drag a meal to another day, or tap it and then tap the day:
// tapping works with touch screens, where browser drag-and-drop does not.
export default function PlanMonth({ state, commit, busy, today, onAdd }: { state: State; commit: Commit; busy: boolean; today: string; onAdd: (date: string) => void }) {
    const [month, setMonth] = useState(today.slice(0, 7)), [selected, setSelected] = useState<string | null>(null), [over, setOver] = useState<string | null>(null);
    const drag = useRef<{ id: string; x: number; y: number; moved: boolean } | null>(null);
    const first = month + '-01', offset = (new Date(first + 'T12:00:00Z').getUTCDay() - state.settings.weekStartsOn + 7) % 7;
    const start = addDays(first, -offset), days = Array.from({ length: 42 }, (_, i) => addDays(start, i));
    const shift = (n: number) => { const d = new Date(first + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() + n); setMonth(iso(d).slice(0, 7)); };
    const title = (p: PlanEntry) => state.recipes.find(r => r.id === p.recipeId)?.title ?? 'Removed recipe';
    const move = async (id: string, date: string) => {
        const entry = state.plan.find(p => p.id === id);
        setSelected(null); setOver(null);
        if (entry && entry.date !== date) await commit('plan.move', { id, date });
    };
    const dayAt = (x: number, y: number) => (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-date]')?.dataset.date ?? null;
    const down = (e: ReactPointerEvent, p: PlanEntry) => { if (p.done || busy) return; drag.current = { id: p.id, x: e.clientX, y: e.clientY, moved: false }; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); };
    const moveDrag = (e: ReactPointerEvent) => {
        const d = drag.current; if (!d) return;
        if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) d.moved = true;
        if (d.moved) setOver(dayAt(e.clientX, e.clientY));
    };
    const up = (e: ReactPointerEvent, p: PlanEntry) => {
        const d = drag.current; drag.current = null;
        if (!d) return;
        if (d.moved) { const date = dayAt(e.clientX, e.clientY); if (date) void move(p.id, date); else setOver(null); }
        else setSelected(selected === p.id ? null : p.id);
    };
    const selectedEntry = state.plan.find(p => p.id === selected);
    return <div className="plan-month">
        <div className="week-picker"><IconButton label="Previous month" onClick={() => shift(-1)}><ArrowLeft size={18}/></IconButton><h2>{monthTitle(month)}</h2><IconButton label="Next month" onClick={() => shift(1)}><ArrowRight size={18}/></IconButton><button className="text-link" onClick={() => setMonth(today.slice(0, 7))}>This month</button></div>
        <p className="muted" role="status">{selectedEntry ? `Moving ${title(selectedEntry)}: choose a day, or tap it again to cancel.` : 'Drag a meal to another day, or tap a meal and then a day.'}</p>
        <div className="month-grid" role="grid" aria-label={monthTitle(month)}>
            {days.slice(0, 7).map(d => <div key={'h' + d} className="month-head" role="columnheader">{new Date(d + 'T12:00:00Z').toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' })}</div>)}
            {days.map(date => {
                const entries = state.plan.filter(p => p.date === date).sort((a, b) => ['Breakfast', 'Lunch', 'Dinner', 'Snack'].indexOf(a.slot) - ['Breakfast', 'Lunch', 'Dinner', 'Snack'].indexOf(b.slot));
                return <div key={date} data-date={date} role="gridcell" aria-label={date}
                    className={['month-day', date.slice(0, 7) !== month ? 'outside' : '', date === today ? 'today' : '', over === date ? 'drop' : '', selected ? 'target' : ''].join(' ')}
                    onClick={() => { if (selected) void move(selected, date); }}>
                    <div className="month-day-head"><span>{Number(date.slice(-2))}</span>{!selected && <button className="month-add" aria-label={'Add meal for ' + date} onClick={e => { e.stopPropagation(); onAdd(date); }}>+</button>}</div>
                    {entries.map(p => <button key={p.id} type="button" className={['month-meal', p.kind, p.done ? 'done' : '', selected === p.id ? 'selected' : ''].join(' ')} title={`${p.slot}: ${title(p)}`}
                        aria-pressed={selected === p.id} disabled={p.done}
                        onPointerDown={e => down(e, p)} onPointerMove={moveDrag} onPointerUp={e => up(e, p)} onPointerCancel={() => { drag.current = null; setOver(null); }}
                        onClick={e => e.stopPropagation()}
                        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(selected === p.id ? null : p.id); } }}>
                        <span className="slot">{p.slot[0]}</span>{p.kind === 'leftover' ? 'Leftovers: ' : ''}{title(p)}
                    </button>)}
                </div>;
            })}
        </div>
    </div>;
}
