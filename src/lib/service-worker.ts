import { nativeApp } from './supabase';

// Registers the app-shell service worker built by vite-plugin-pwa (production only).
// A new version installs in the background and waits; the next in-app navigation
// activates it and reloads, so nobody loses a half-typed form to an update.
export function registerServiceWorker() {
    // The desktop and phone apps bundle their files, so they don't need (and their app-only schemes don't support) a worker.
    if (!import.meta.env.PROD || !('serviceWorker' in navigator) || nativeApp()) return;
    window.addEventListener('load', async () => {
        try {
            const registration = await navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js');
            let reloading = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (reloading) return;
                reloading = true;
                location.reload();
            });
            const activateOnNavigation = (worker: ServiceWorker) => {
                window.addEventListener('hashchange', () => worker.postMessage({ type: 'SKIP_WAITING' }), { once: true });
            };
            // Only an update has an existing controller; the first install activates on its own.
            if (registration.waiting && navigator.serviceWorker.controller) activateOnNavigation(registration.waiting);
            registration.addEventListener('updatefound', () => {
                const worker = registration.installing;
                worker?.addEventListener('statechange', () => {
                    if (worker.state === 'installed' && navigator.serviceWorker.controller) activateOnNavigation(worker);
                });
            });
            // Long-lived standalone windows rarely reload; check for a new version hourly.
            setInterval(() => { registration.update().catch(() => {}); }, 60 * 60 * 1000);
        } catch (error) {
            console.warn('CookBook could not enable offline support.', error);
        }
    });
}
