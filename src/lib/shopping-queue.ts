import type { ShoppingItem, State } from '../../supabase/functions/_shared/domain.ts';

type Snapshot = { state: State; revision: number };
type Check = { id: string; checked: boolean; operationId: string; identity: string };
type Options = {
    initialSnapshot?: Snapshot;
    read: () => Promise<Snapshot>;
    save: (type: string, payload: unknown, id: string, revision: number) => Promise<Snapshot>;
    onSnapshot: (snapshot: Snapshot) => void;
    onPending: (pending: boolean) => void;
    onError: (message: string) => void;
};

// Ignore the checkmark when recognizing a row, but never replay an old tap onto
// a different quantity, a purchased row, or a newly generated week's groceries.
const identity = (item: ShoppingItem, state: State) => {
    const details = Object.entries(item).filter(([key]) => key !== 'checked').sort(([a], [b]) => a.localeCompare(b));
    return JSON.stringify([details, item.manual ? '' : state.shoppingWeek]);
};

export class ShoppingQueue {
    private confirmed: Snapshot | null = null;
    private queued = new Map<string, Check>();
    private active: Check | null = null;
    private running: Promise<boolean> | null = null;
    private options: Options;

    constructor(options: Options) { this.options = options; this.confirmed = options.initialSnapshot ?? null; }

    get pending() { return !!this.active || this.queued.size > 0; }

    accept(snapshot: Snapshot) {
        // A focus refresh can finish after a save. It must not undo that save.
        if (!this.confirmed || snapshot.revision >= this.confirmed.revision) this.confirmed = snapshot;
        this.emit();
    }

    toggle(id: string, checked: boolean) {
        const state = this.confirmed?.state, item = state?.shopping.find(item => item.id === id);
        if (!state || !item || item.addedToPantry) return;
        this.queued.set(id, { id, checked, operationId: crypto.randomUUID(), identity: identity(item, state) });
        this.options.onPending(true);
        this.emit();
        // The view updates before any network work. Repeated taps waiting for a
        // save replace one another, so only the most recent choice is sent.
        this.running ??= Promise.resolve().then(() => this.drain());
    }

    flush(): Promise<boolean> { return this.running ?? Promise.resolve(true); }

    private emit() {
        if (!this.confirmed) return;
        const checks = new Map<string, boolean>();
        if (this.active) checks.set(this.active.id, this.active.checked);
        for (const check of this.queued.values()) checks.set(check.id, check.checked);
        const { state, revision } = this.confirmed;
        this.options.onSnapshot(checks.size ? {
            revision,
            state: { ...state, shopping: state.shopping.map(item => checks.has(item.id) && !item.addedToPantry ? { ...item, checked: checks.get(item.id)! } : item) },
        } : this.confirmed);
    }

    private async drain() {
        let saved = true;
        try {
            while (this.queued.size) {
                const check = this.queued.values().next().value!;
                this.queued.delete(check.id);
                this.active = check;
                await this.save(check);
                this.active = null;
                this.emit();
            }
        } catch (error) {
            saved = false;
            this.queued.clear();
            // A lost response may still have saved on the server. Read the
            // actual result before removing the optimistic checkmarks.
            try { this.accept(await this.options.read()); } catch { /* Keep the last confirmed state and show the error. */ }
            this.options.onError('Some shopping checkmarks could not be saved. Please check the list and try again.' + (error instanceof Error && 'status' in error && error.status === 409 ? ' The list changed in another session.' : ''));
        } finally {
            this.active = null;
            this.running = null;
            // Taps made during error recovery still need their own save.
            if (this.queued.size) this.running = Promise.resolve().then(() => this.drain());
            this.emit();
            this.options.onPending(this.pending);
        }
        return saved;
    }

    private async save(check: Check) {
        for (let attempt = 0; attempt < 3; attempt++) {
            const current = this.confirmed!, item = current.state.shopping.find(item => item.id === check.id);
            if (current.state.operations.includes(check.operationId)) return;
            if (!item || item.addedToPantry || identity(item, current.state) !== check.identity) {
                throw Object.assign(new Error('This shopping item changed.'), { status: 409 });
            }
            if (item.checked === check.checked) return;
            try {
                this.accept(await this.options.save('shopping.toggle', { id: check.id, checked: check.checked }, check.operationId, current.revision));
                return;
            } catch (error) {
                const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
                if (attempt === 2 || status !== undefined && status !== 409 && status !== 503) throw error;
                // Reuse the operation ID after an ambiguous network failure;
                // the server's duplicate protection prevents applying it twice.
                this.accept(await this.options.read());
            }
        }
    }
}
