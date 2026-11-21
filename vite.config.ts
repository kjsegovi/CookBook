import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            // src/main.tsx registers the worker itself, only in production builds.
            injectRegister: false,
            registerType: 'prompt',
            manifestFilename: 'manifest.webmanifest',
            manifest: {
                id: './',
                name: 'CookBook',
                short_name: 'CookBook',
                description: 'Your recipes, pantry, weekly meals, and good leftovers, together in one kitchen.',
                start_url: './',
                scope: './',
                display: 'standalone',
                theme_color: '#35664b',
                background_color: '#faf9f5',
                icons: [
                    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
                    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
                    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
                ],
                // A later phase reads ?share-url= on start; unknown params are ignored until then.
                share_target: { action: './', method: 'GET', enctype: 'application/x-www-form-urlencoded', params: { url: 'share-url', text: 'share-text', title: 'share-title' } },
            },
            workbox: {
                // App shell only: built JS/CSS/HTML, fonts and icons. No runtime caching, so
                // Supabase API and Edge Function responses always go to the network.
                globPatterns: ['**/*.{js,css,html,svg,png,woff2,ttf,webmanifest}'],
                globIgnores: ['404.html', 'shortcuts/**'],
                navigateFallback: 'index.html',
                // The OAuth consent screen is reached through the 404.html redirect; let it hit the network.
                // Workbox matches these against pathname + search.
                navigateFallbackDenylist: [/\/oauth\/consent\/?(?:\?|$)/, /\/shortcuts\//],
                cleanupOutdatedCaches: true,
                runtimeCaching: [],
            },
        }),
    ],
    // Relative assets work for both USER.github.io/REPO/ and a custom domain.
    base: './',
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    build: { sourcemap: false },
});
