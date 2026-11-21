// Features only the desktop app offers. The website never shows them.
type TauriInternals = { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
const tauri = () => (globalThis as { __TAURI_INTERNALS__?: TauriInternals }).__TAURI_INTERNALS__;
export const canBrowseForRecipes = () => !!tauri();
// Opens the recipe browser window; its "Save to CookBook" button sends the page back here.
export function browseForRecipes(url = 'https://duckduckgo.com/?q=recipe') {
    return tauri()?.invoke('open_clipper', { url });
}

// iPhone and iPad app (Capacitor): cookbook:// links (Reminders sync returning,
// or cookbook://import?url=… from the share extension) open inside the app.
export async function listenForAppLinks() {
    const capacitor = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
    if (!capacitor?.isNativePlatform?.()) return;
    const { App } = await import('@capacitor/app');
    await App.addListener('appUrlOpen', ({ url }) => {
        let link: URL;
        try { link = new URL(url); } catch { return; }
        if (link.protocol !== 'cookbook:') return;
        if (link.hash) { location.hash = link.hash; return; }
        const shared = link.searchParams.get('url');
        if (shared && /^https?:\/\//.test(shared)) location.href = location.origin + location.pathname + '?share-url=' + encodeURIComponent(shared);
    });
}
