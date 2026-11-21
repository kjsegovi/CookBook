// A Storage-shaped store backed by IndexedDB. Reads are synchronous from an
// in-memory copy loaded once at start, so the existing snapshot cache can use
// it unchanged; writes go to memory at once and to IndexedDB in the background.
// IndexedDB holds far more than localStorage (about 5 MB), so large cookbooks
// stay available offline.
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const DB = 'cookbook', STORE = 'kv';

function request<T>(r: IDBRequest<T>) { return new Promise<T>((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }

export async function openIdbStorage(factory: IDBFactory | undefined = globalThis.indexedDB): Promise<StorageLike> {
    if (!factory) throw new Error('IndexedDB is not available.');
    const open = factory.open(DB, 1);
    open.onupgradeneeded = () => { if (!open.result.objectStoreNames.contains(STORE)) open.result.createObjectStore(STORE); };
    const db = await request(open);
    const memory = new Map<string, string>();
    const tx = db.transaction(STORE, 'readonly'), store = tx.objectStore(STORE);
    const [keys, values] = await Promise.all([request(store.getAllKeys()), request(store.getAll())]);
    keys.forEach((key, i) => { if (typeof key === 'string' && typeof values[i] === 'string') memory.set(key, values[i]); });
    // Writes are queued so the last write for a key always lands last.
    let queue = Promise.resolve();
    const persist = (apply: (s: IDBObjectStore) => void) => {
        queue = queue.then(() => new Promise<void>(resolve => {
            try {
                const t = db.transaction(STORE, 'readwrite');
                apply(t.objectStore(STORE));
                t.oncomplete = t.onerror = t.onabort = () => resolve();
            } catch { resolve(); }
        }));
    };
    return {
        getItem: key => memory.get(key) ?? null,
        setItem: (key, value) => { memory.set(key, value); persist(s => s.put(value, key)); },
        removeItem: key => { memory.delete(key); persist(s => s.delete(key)); },
    };
}

// Ask the browser not to evict saved recipes and photos under storage pressure.
export function requestPersistence() {
    try { void navigator.storage?.persist?.().catch(() => undefined); } catch { /* Optional. */ }
}
