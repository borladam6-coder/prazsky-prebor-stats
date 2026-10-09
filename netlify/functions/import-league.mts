// Scheduled import: softball.cz → Supabase.
//
// Runs every 6 hours (cron below is UTC). Can also be started manually:
// Netlify → Logs & metrics → Functions → import-league → "Run now".
//
// Required environment variables (Netlify → Site configuration → Environment variables):
//   SUPABASE_URL          https://<project>.supabase.co
//   SUPABASE_SECRET_KEY   sb_secret_…  (server only, never in the browser or the repo)
// Optional:
//   LEAGUE_ID             default 13 (Pražský přebor mužů)
//   SEASON_YEAR           default 2026

import type { Config } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { fetchSeason } from '../lib/softball-api.ts';

function env(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== '' ? value.trim() : undefined;
}

// Describes the shape of a key for troubleshooting without ever logging the key itself.
function describeKey(key: string): string {
  const kind = key.startsWith('sb_secret_')
    ? 'secret key'
    : key.startsWith('sb_publishable_')
      ? 'PUBLISHABLE key (wrong – the secret key is needed)'
      : key.startsWith('eyJ')
        ? 'legacy JWT key'
        : 'unknown format';
  const issues = [
    /\s/.test(key) ? 'contains whitespace or line breaks' : null,
    /^["']|["']$/.test(key) ? 'wrapped in quotes' : null
  ].filter(Boolean);
  return `${kind}, ${key.length} characters${issues.length ? ', ' + issues.join(', ') : ''}`;
}

// Supabase project URL must be the bare origin, e.g. https://abcd.supabase.co
function describeUrl(url: string): string {
  return /^https:\/\/[a-z0-9]+\.supabase\.co\/?$/.test(url) ? 'looks valid' : 'unexpected format';
}

export default async (): Promise<Response> => {
  const started = Date.now();
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SECRET_KEY');
  const leagueId = Number(env('LEAGUE_ID') ?? 13);
  const year = Number(env('SEASON_YEAR') ?? 2026);

  if (!url || !key) {
    console.error('import-league: SUPABASE_URL or SUPABASE_SECRET_KEY is not set');
    return new Response('Missing configuration', { status: 500 });
  }
  if (!Number.isInteger(leagueId) || !Number.isInteger(year)) {
    console.error('import-league: LEAGUE_ID / SEASON_YEAR must be integers');
    return new Response('Bad configuration', { status: 500 });
  }

  try {
    const { payload, warnings } = await fetchSeason(leagueId, year);
    warnings.forEach((w) => console.warn('import-league:', w));

    const supabase = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    const { data, error } = await supabase.rpc('import_season', { p_payload: payload });
    if (error) {
      if (/api key/i.test(error.message)) {
        console.error(`import-league: SUPABASE_SECRET_KEY: ${describeKey(key)}; SUPABASE_URL: ${describeUrl(url)}`);
      }
      throw new Error(`Supabase: ${error.message}`);
    }

    const summary = { ...((data as Record<string, unknown>) ?? {}), warnings: warnings.length, ms: Date.now() - started };
    console.log('import-league: done', JSON.stringify(summary));
    return Response.json(summary);
  } catch (err) {
    console.error('import-league: failed', err);
    return new Response('Import failed', { status: 500 });
  }
};

export const config: Config = {
  schedule: '7 */6 * * *'
};
