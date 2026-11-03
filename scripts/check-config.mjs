import { loadEnv } from 'vite';
const env = { ...loadEnv('production', process.cwd(), ''), ...process.env };
const url = env.VITE_SUPABASE_URL?.trim(), key = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
const optional = process.argv.includes('--optional');
if ((!url || !key || url.includes('YOUR_PROJECT') || key.includes('YOUR_SUPABASE')) && !optional) throw new Error('Set the SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY repository variables before publishing.');
if (key?.startsWith('sb_secret_')) throw new Error('A private Supabase secret key must never be put in browser configuration. Use a publishable key.');
if (key?.startsWith('eyJ')) {
    let payload;
    try { payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()); } catch { throw new Error('The public key is malformed.'); }
    if (payload.role !== 'anon') throw new Error('Use only a publishable key or legacy anon key in browser configuration.');
}
if (url && !url.includes('YOUR_PROJECT')) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['127.0.0.1','localhost'].includes(parsed.hostname))) throw new Error('The Supabase URL must use HTTPS, except for local development.');
}
console.log(url && key ? 'Public configuration checked.' : 'Building the unconfigured login screen for local setup.');

const region = env.VITE_SUPABASE_FUNCTION_REGION?.trim();
if (region && !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(region)) throw new Error('Use a Supabase region name or leave the optional function region empty.');
