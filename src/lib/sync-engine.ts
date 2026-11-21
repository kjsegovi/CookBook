import { applyCommand } from '../../supabase/functions/_shared/commands.ts';
import { stableJson, statePatch, type Snapshot } from '../../supabase/functions/_shared/state-patch.ts';
import { DomainError, uid, type State } from '../../supabase/functions/_shared/domain.ts';

// Offline editing. Every change is applied on this device at once and kept in
// a saved outbox; the outbox is sent in order whenever the server is reachable.
// What you see is the last confirmed cookbook with the outbox replayed on top,
// using the same command code the server runs. The server stays the authority:
// a change it rejects moves to `problems` for you to keep, copy or discard.
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type OutboxItem = { id: string; type: string; payload: any; at: number };
export type Problem = OutboxItem & { message: string; status: number };
export type SyncStatus = { pending: number; problems: Problem[]; offline: boolean; syncing: boolean };
type Deps = {
    save: (type: string, payload: unknown, id: string, revision: number) => Promise<Snapshot>;
    read: () => Promise<Snapshot>;
    storage?: StorageLike;
    key: string;
    online?: () => boolean;
    retryDelay?: (attempt: number) => number;
};
const failureStatus = (error: unknown) => typeof error === 'object' && error && 'status' in error && typeof (error as any).status === 'number' ? (error as any).status as number : 0;
// Rejections the server will repeat: show them instead of retrying forever.
const isRejection = (status: number) => status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429;
const coalescible = new Set(['shopping.toggle', 'recipe.favorite']);

export class SyncEngine {
    private confirmed: Snapshot;
    private queue: OutboxItem[] = [];
    private problemList: Problem[] = [];
    private listeners = new Set<() => void>();
    private viewCache: Snapshot | null = null;
    private draining: Promise<void> | null = null;
    private sending: string | null = null;
    private failures = 0;
    private timer: ReturnType<typeof setTimeout> | undefined;
    private lastError = false;
    private closed = false;
    private deps: Deps;
    constructor(initial: Snapshot, deps: Deps) {
        this.confirmed = initial; this.deps = deps;
        try {
            const saved = JSON.parse(deps.storage?.getItem(deps.key) ?? 'null');
            if (saved && Array.isArray(saved.queue)) this.queue = saved.queue.filter((i: any) => i && typeof i.id === 'string' && typeof i.type === 'string');
            if (saved && Array.isArray(saved.problems)) this.problemList = saved.problems;
        } catch { /* A damaged outbox is ignored rather than blocking the cookbook. */ }
    }
    get view(): Snapshot {
        if (this.viewCache) return this.viewCache;
        let state = this.confirmed.state;
        for (const item of this.queue) {
            // An item the latest cookbook no longer accepts stays queued; the server decides.
            try { state = applyCommand(state, item.type, item.payload, item.id, new Date(item.at).toISOString()); } catch { /* shown after sending */ }
        }
        return this.viewCache = { ...this.confirmed, state };
    }
    get status(): SyncStatus {
        return { pending: this.queue.length, problems: this.problemList, offline: this.lastError || !this.isOnline(), syncing: this.sending !== null };
    }
    get pending() { return this.queue.length; }
    subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
    // Stops retry timers while no screen is showing the cookbook; any later change or drain resumes.
    pause() { clearTimeout(this.timer); }
    close() { this.closed = true; clearTimeout(this.timer); this.listeners.clear(); }
    clear() { this.queue = []; this.problemList = []; this.persist(); this.changed(); }
    private isOnline() { return this.deps.online ? this.deps.online() : true; }
    private changed() { this.viewCache = null; for (const listener of [...this.listeners]) listener(); }
    private persist() {
        try {
            if (!this.queue.length && !this.problemList.length) this.deps.storage?.removeItem(this.deps.key);
            else this.deps.storage?.setItem(this.deps.key, JSON.stringify({ queue: this.queue, problems: this.problemList }));
        } catch { /* Storage may be full; the change still syncs while the page stays open. */ }
    }
    // Checks the change against what you see now, then queues it. Invalid
    // changes throw at once, so forms show the same errors as before.
    enqueue(type: string, payload: unknown, id = uid()): string {
        if (this.closed) throw new DomainError('Sign in again to save changes.', 401);
        const at = Date.now(), p = payload as any;
        // Validates against what is shown; throws before anything changes.
        const shown = this.view, next = applyCommand(shown.state, type, payload, id, new Date(at).toISOString());
        const coalesce = coalescible.has(type);
        // Rapid taps on the same checkmark or heart keep only the latest unsent choice.
        if (coalesce) this.queue = this.queue.filter(item => item.type !== type || item.payload?.id !== p?.id || item.id === this.sending);
        this.queue.push({ id, type, payload, at });
        this.persist();
        // A new change only needs applying on top of what is shown; a coalesced one is replayed.
        this.viewCache = coalesce ? null : { ...shown, state: next };
        for (const listener of [...this.listeners]) listener();
        void this.drain();
        return id;
    }
    // A newer cookbook from the server, for example after a refresh.
    accept(snapshot: Snapshot) {
        if (snapshot.householdId !== this.confirmed.householdId || snapshot.revision < this.confirmed.revision) return this.view;
        this.confirmed = snapshot; this.changed();
        return this.view;
    }
    async refresh() {
        this.accept(await this.deps.read());
        void this.drain();
        return this.view;
    }
    // Sends queued changes one at a time, oldest first.
    drain(): Promise<void> {
        if (this.closed) return Promise.resolve();
        clearTimeout(this.timer);
        // A pass already running may have checked the outbox before this change arrived.
        if (this.draining) return this.draining.then(() => this.draining ?? (this.queue.length ? this.drain() : undefined));
        const run = (async () => {
            await Promise.resolve();
            try {
                while (this.queue.length && !this.closed) {
                    if (!this.isOnline()) { this.lastError = true; this.changed(); return; }
                    const item = this.queue[0];
                    this.sending = item.id; this.changed();
                    let saved: Snapshot;
                    try { saved = await this.deps.save(item.type, item.payload, item.id, this.confirmed.revision); }
                    catch (error) {
                        this.sending = null;
                        const status = failureStatus(error);
                        if (isRejection(status)) {
                            this.queue.shift();
                            this.problemList = [...this.problemList, { ...item, status, message: error instanceof Error ? error.message : 'This change could not be saved.' }];
                            this.persist(); this.changed();
                            continue;
                        }
                        // Offline, signed out or a server error: keep everything and try later.
                        this.lastError = true; this.failures++; this.changed();
                        if (status !== 401) this.retryLater();
                        return;
                    }
                    this.sending = null; this.lastError = false; this.failures = 0;
                    this.acknowledge(item, saved);
                }
            } finally { this.sending = null; }
        })();
        this.draining = run;
        void run.finally(() => { if (this.draining === run) this.draining = null; });
        return run;
    }
    private retryLater() {
        const delay = this.deps.retryDelay ? this.deps.retryDelay(this.failures) : Math.min(60000, 2000 * 2 ** Math.min(this.failures, 5));
        clearTimeout(this.timer);
        this.timer = setTimeout(() => { void this.drain(); }, delay);
    }
    // After the server confirms a change, later queued edits of the same records
    // were based on this device's copy. Their conflict checks are moved to the
    // server's copy, so your own consecutive offline edits never conflict.
    private acknowledge(item: OutboxItem, saved: Snapshot) {
        const before = this.confirmed.state;
        let local: State;
        try { local = applyCommand(before, item.type, item.payload, item.id, new Date(item.at).toISOString()); } catch { local = saved.state; }
        const replacements = new Map<string, string>(), versions = new Map<string, string>();
        const patch = statePatch(before, local);
        for (const [collection, change] of Object.entries(patch.collections)) {
            for (const row of change?.upsert ?? []) {
                const server = (saved.state as any)[collection]?.find((r: { id: string }) => r.id === row.id);
                if (!server) continue;
                replacements.set(stableJson(row), JSON.stringify(server));
                const localAt = (row as any).updatedAt ?? (row as any).recipe?.updatedAt, serverAt = server.updatedAt ?? server.recipe?.updatedAt;
                if (typeof localAt === 'string' && typeof serverAt === 'string') versions.set(localAt, serverAt);
            }
        }
        if (patch.values.settings) replacements.set(stableJson(local.settings), JSON.stringify(saved.state.settings));
        this.queue.shift();
        this.queue = this.queue.map(next => ({ ...next, payload: rewriteGuards(next.payload, replacements, versions) }));
        this.confirmed = saved;
        this.persist(); this.changed();
    }
    // Waits for queued changes; false if any remain (offline or rejected).
    async flush() {
        await this.drain();
        return this.queue.length === 0;
    }
    dismiss(id: string) { this.problemList = this.problemList.filter(p => p.id !== id); this.persist(); this.changed(); }
    // Keep mine: resend a rejected change against the latest version.
    retry(id: string, payload: unknown) {
        const problem = this.problemList.find(p => p.id === id);
        if (!problem) return;
        const next = this.enqueue(problem.type, payload);
        this.dismiss(id);
        return next;
    }
}

function rewriteGuards(payload: any, replacements: Map<string, string>, versions: Map<string, string>) {
    if (!payload || typeof payload !== 'object' || (!replacements.size && !versions.size)) return payload;
    const next = { ...payload };
    if (typeof next.expectedUpdatedAt === 'string' && versions.has(next.expectedUpdatedAt)) next.expectedUpdatedAt = versions.get(next.expectedUpdatedAt);
    if (typeof next.__expected === 'string') {
        try { const key = stableJson(JSON.parse(next.__expected)); if (replacements.has(key)) next.__expected = replacements.get(key); } catch { /* leave as is */ }
    }
    if (Array.isArray(next.usage)) next.usage = next.usage.map((u: any) => {
        if (!u || typeof u.expected !== 'string') return u;
        try { const key = stableJson(JSON.parse(u.expected)); return replacements.has(key) ? { ...u, expected: replacements.get(key) } : u; } catch { return u; }
    });
    return next;
}

// Keep mine: the same change, checked against the latest version this time.
export function keepMine(problem: Problem, state: State): unknown {
    const p = problem.payload ?? {};
    const recipe = (id: string) => state.recipes.find(r => r.id === id);
    switch (problem.type) {
        case 'recipe.update': return { ...p, expectedUpdatedAt: recipe(p.recipeId)?.updatedAt };
        case 'recipe.save': return { ...p, expectedUpdatedAt: recipe(p.id)?.updatedAt };
        case 'draft.save': return { ...p, expectedUpdatedAt: state.drafts.find(d => d.id === p.id)?.recipe.updatedAt };
        case 'cook': return { ...p, usage: Array.isArray(p.usage) ? p.usage.map((u: any) => { const stock = state.pantry.find(x => x.id === u?.pantryId); return stock ? { ...u, expected: JSON.stringify(stock) } : u; }) : p.usage };
        default: {
            if (typeof p.__expected !== 'string') return p;
            const current = problem.type === 'settings.save' ? state.settings
                : (state as any)[{ 'pantry.save': 'pantry', 'shopping.save': 'shopping', 'plan.save': 'plan', 'batch.update': 'batches' }[problem.type] ?? '']?.find((x: { id: string }) => x.id === p.id);
            return { ...p, __expected: current ? JSON.stringify(current) : undefined };
        }
    }
}
// Save mine as a copy: for recipe edits, a new recipe so nothing is overwritten.
export function copyOfMine(problem: Problem, state: State): unknown | null {
    const p = problem.payload ?? {};
    const base = problem.type === 'recipe.update' ? { ...state.recipes.find(r => r.id === p.recipeId), ...p.changes } : problem.type === 'recipe.save' ? p : null;
    if (!base || !base.title) return null;
    const { expectedUpdatedAt: _a, createdAt: _b, updatedAt: _c, ...rest } = base;
    return { ...rest, id: uid(), title: String(base.title).slice(0, 180) + ' (my version)' };
}
export const describeProblem = (problem: Problem) => ({
    'recipe.update': 'Recipe edit', 'recipe.save': 'Recipe', 'recipe.delete': 'Recipe removal', 'draft.save': 'Draft', 'pantry.save': 'Pantry item', 'shopping.save': 'Shopping item',
    'shopping.toggle': 'Checkmark', 'shopping.purchase': 'Purchases', 'plan.save': 'Planned meal', 'plan.delete': 'Planned meal removal', 'cook': 'Cooked meal', 'leftover.eat': 'Leftovers',
    'batch.update': 'Leftovers', 'settings.save': 'Settings', 'ingredient.save': 'Ingredient names',
} as Record<string, string>)[problem.type] ?? 'Change';
