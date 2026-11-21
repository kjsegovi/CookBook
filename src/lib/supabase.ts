import { createClient } from '@supabase/supabase-js';

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim().replace(/\/+$/, '');
export const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const url = supabaseUrl, key = publishableKey;
export const configured = !!url && !!key && !url.includes('YOUR_PROJECT');
export const supabase = configured ? createClient(url!, key!, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'cookbook-auth-' + new URL(url!).hostname },
}) : null;
export const appUrl = () => new URL(import.meta.env.BASE_URL, document.baseURI).href;
// Inside the desktop and phone apps the page address is an app-only scheme
// (tauri://, capacitor://). Links that leave the app, such as password reset
// emails and the bookmarklet, point at the hosted website instead.
export const nativeApp = () => typeof window !== 'undefined' && (!/^https?:$/.test(location.protocol) || 'Capacitor' in window || '__TAURI_INTERNALS__' in window);
export const publicAppUrl = () => import.meta.env.VITE_PUBLIC_APP_URL?.trim() || appUrl();
export const requireClient = () => {
    if (!supabase) throw new Error('Your kitchen is not connected yet. Please finish setup before signing in.');
    return supabase;
};
