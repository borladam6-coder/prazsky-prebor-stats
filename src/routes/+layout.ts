// The site is a static single-page app: data is loaded in the browser from Supabase.
import { league } from '#lib/league.svelte.ts';

export const ssr = false;
export const prerender = false;

export async function load() {
  try {
    await league.ensure();
    return { loadError: null as string | null };
  } catch (e) {
    return { loadError: e instanceof Error ? e.message : String(e) };
  }
}
