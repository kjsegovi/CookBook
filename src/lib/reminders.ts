import type { SyncScope } from '../../supabase/functions/_shared/reminders-domain.ts';

export const REMINDERS_SHORTCUT = 'CookBook Groceries';
export const MAX_REMINDERS_URL_LENGTH = 8000;
export type RemindersEnvelope = { version: 2; scope: SyncScope; signature: string; finishUrl: string; ackUrl: string; returnUrl: string };
export type RemindersStatus = { syncId: string; phase: 'waiting' | 'finishing' | 'complete'; count: number; skipped: number };

export function remindersHandoff(payload: RemindersEnvelope) {
    const text = JSON.stringify(payload);
    const prefix = `shortcuts://run-shortcut?name=${encodeURIComponent(REMINDERS_SHORTCUT)}`;
    const textUrl = `${prefix}&input=text&text=${encodeURIComponent(text)}`;
    const clipboard = textUrl.length > MAX_REMINDERS_URL_LENGTH;
    return { text, clipboard, url: clipboard ? `${prefix}&input=clipboard` : textUrl };
}

export function remindersReturnId(hash: string) {
    if (!hash.startsWith('#/shopping?')) return null;
    const id = new URLSearchParams(hash.slice(hash.indexOf('?') + 1)).get('reminders-sync');
    return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}
