export type PhotoVariant = 'thumbnail' | 'full';
export type PhotoSource = { url: string; fallback?: string };
type Waiter = { reference: string; resolve: (source: PhotoSource) => void; reject: (error: unknown) => void; promise: Promise<PhotoSource> };
export class PhotoResolver {
    private cache = new Map<string, { source: PhotoSource; expires: number }>();
    private pending = new Map<string, Waiter>();
    private queued = new Map<PhotoVariant, Set<string>>();
    private scheduled = false;
    private generation = 0;
    private sign: (references: string[], variant: PhotoVariant) => Promise<Record<string, PhotoSource>>;
    constructor(sign: (references: string[], variant: PhotoVariant) => Promise<Record<string, PhotoSource>>) { this.sign = sign; }
    clear() {
        this.generation++; this.cache.clear(); this.queued.clear();
        for (const waiter of this.pending.values()) waiter.reject(new Error('The cookbook session changed.'));
        this.pending.clear();
    }
    resolve(reference: string, variant: PhotoVariant = 'thumbnail'): Promise<PhotoSource> {
        if (!reference.startsWith('photo:')) return Promise.resolve({ url: reference });
        const key = variant + ':' + reference, cached = this.cache.get(key);
        if (cached && cached.expires > Date.now()) return Promise.resolve(cached.source);
        const existing = this.pending.get(key);
        if (existing) return existing.promise;
        let resolve!: Waiter['resolve'], reject!: Waiter['reject'];
        const promise = new Promise<PhotoSource>((done, fail) => { resolve = done; reject = fail; });
        this.pending.set(key, { reference, resolve, reject, promise });
        const queue = this.queued.get(variant) ?? new Set<string>(); queue.add(reference); this.queued.set(variant, queue);
        if (!this.scheduled) { this.scheduled = true; queueMicrotask(() => { void this.flush(); }); }
        return promise;
    }
    private async flush() {
        this.scheduled = false;
        const queued = this.queued; this.queued = new Map();
        const generation = this.generation;
        const jobs: Promise<void>[] = [];
        for (const [variant, references] of queued) {
            const list = [...references];
            for (let start = 0; start < list.length; start += 24) {
                const batch = list.slice(start, start + 24);
                jobs.push((async () => {
                    try {
                        const sources = await this.sign(batch, variant);
                        if (generation !== this.generation) return;
                        for (const reference of batch) {
                            const key = variant + ':' + reference, waiter = this.pending.get(key), source = sources[reference];
                            this.pending.delete(key);
                            if (source?.url) { this.cache.set(key, { source, expires: Date.now() + 240000 }); waiter?.resolve(source); }
                            else waiter?.reject(new Error('Your photo could not be loaded.'));
                        }
                    } catch (error) {
                        if (generation !== this.generation) return;
                        for (const reference of batch) {
                            const key = variant + ':' + reference;
                            this.pending.get(key)?.reject(error); this.pending.delete(key);
                        }
                    }
                })());
            }
        }
        await Promise.all(jobs);
    }
}
