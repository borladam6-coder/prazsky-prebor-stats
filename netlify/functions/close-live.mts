// Scheduled: ends live scoring that was left open after the game day (migration 011).
//
// Runs every night (cron below is UTC: 00:17 UTC = 01:17 or 02:17 in Prague, i.e. always
// after midnight Prague time). Can also be started manually:
// Netlify → Logs & metrics → Functions → close-live → "Run now".
//
// Uses the same environment variables as import-league:
//   SUPABASE_URL, SUPABASE_SECRET_KEY (server only, never in the browser or the repo)

import type { Config } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
}

export default async (): Promise<Response> => {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SECRET_KEY')?.replace(/\s+/g, '');
  if (!url || !key) {
    console.error('close-live: SUPABASE_URL or SUPABASE_SECRET_KEY is not set');
    return new Response('Missing configuration', { status: 500 });
  }
  try {
    const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await supabase.rpc('live_autofinish');
    if (error) throw new Error(`Supabase: ${error.message}`);
    console.log('close-live: ended sessions', data);
    return Response.json({ ended: data });
  } catch (err) {
    console.error('close-live: failed', err);
    return new Response('Close failed', { status: 500 });
  }
};

export const config: Config = {
  schedule: '17 0 * * *'
};
