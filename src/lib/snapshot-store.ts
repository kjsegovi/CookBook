import { applyStatePatch, statePatch, type Delta, type Snapshot } from '../../supabase/functions/_shared/state-patch.ts';
import { SnapshotCache } from './snapshot-cache.ts';

type ReadResult = Snapshot | { householdId: string; revision: number; unchanged: true };
export class SnapshotStore {
    private current: Snapshot | null;
    private inFlight: Promise<Snapshot> | undefined;
    private readRemote: (revision: number | null) => Promise<ReadResult>;
    private cache: SnapshotCache;
    private active = true;
    constructor(read: (revision: number | null) => Promise<ReadResult>, cache: SnapshotCache) {
        this.readRemote = read; this.cache = cache; this.current = cache.read();
    }
    peek() { return this.current; }
    close() { this.active = false; this.current = null; this.cache.clear(); }
    private checkActive() { if (!this.active) throw new Error('Sign in again to open your cookbook.'); }
    accept(snapshot: Snapshot) {
        this.checkActive();
        if (this.current?.householdId === snapshot.householdId && this.current.revision > snapshot.revision) return this.current;
        if (this.current?.householdId === snapshot.householdId) snapshot = {
            ...snapshot, state: applyStatePatch(this.current.state, statePatch(this.current.state, snapshot.state)),
        };
        this.current = snapshot; this.cache.write(snapshot);
        return snapshot;
    }
    read(): Promise<Snapshot> {
        this.checkActive();
        if (this.inFlight) return this.inFlight;
        const base = this.current;
        const promise = (async () => {
            let result = await this.readRemote(base?.revision ?? null);
            this.checkActive();
            if ('unchanged' in result) {
                if (base && base.householdId === result.householdId && base.revision === result.revision) return this.accept(base);
                result = await this.readRemote(null);
                this.checkActive();
                if ('unchanged' in result) throw new Error('Your cookbook could not be loaded. Please try again.');
            }
            return this.accept(result);
        })();
        this.inFlight = promise;
        const clear = () => { if (this.inFlight === promise) this.inFlight = undefined; };
        void promise.then(clear, clear);
        return promise;
    }
    async saved(result: Snapshot | Delta): Promise<Snapshot> {
        this.checkActive();
        if ('state' in result) return this.accept(result);
        if (this.current && this.current.householdId === result.householdId && this.current.revision === result.baseRevision) {
            return this.accept({ householdId: result.householdId, revision: result.revision, state: applyStatePatch(this.current.state, result.patch) });
        }
        // A refresh or another device may advance the local revision while a
        // save is in transit. Never attach its patch to a different snapshot.
        const latest = await this.readRemote(null);
        this.checkActive();
        if ('unchanged' in latest) throw new Error('Your cookbook update could not be confirmed. Refresh to check it.');
        return this.accept(latest);
    }
}
