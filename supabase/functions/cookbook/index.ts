import { createClient } from '@supabase/supabase-js';
import { createHandler } from '../_shared/api.ts';

const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
if (!url || !key) throw new Error('Supabase runtime credentials are missing.');
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const origins = (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean);
Deno.serve(createHandler(admin, origins));
