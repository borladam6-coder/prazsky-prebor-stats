import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_PUBLISHABLE_KEY } from '$app/env/public';

export type ConfigProblem = 'missing' | 'bad-url' | 'secret-key' | null;

const url = String(PUBLIC_SUPABASE_URL ?? '').trim().replace(/\/+$/, '');
const key = String(PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '').trim();

function check(): ConfigProblem {
  if (!url || !key) return 'missing';
  if (!/^https:\/\/[^/]+$/.test(url)) return 'bad-url';
  // a secret key bypasses row level security and must never reach the browser
  if (key.startsWith('sb_secret_')) return 'secret-key';
  return null;
}

export const configProblem: ConfigProblem = check();

export const supabase: SupabaseClient | null = configProblem
  ? null
  : createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
