// Public environment variables, inlined into the browser bundle at build time.
// Set them in Netlify → Site configuration → Environment variables.
// Only the publishable (anon) key belongs here – never the secret key.
import { defineEnvVars } from '@sveltejs/kit/env';

const optional = (value: string | undefined) => (value ?? '').trim();

export const variables = defineEnvVars({
  PUBLIC_SUPABASE_URL: {
    public: true,
    static: true,
    schema: optional,
    description: 'Supabase project URL, e.g. https://abcd.supabase.co'
  },
  PUBLIC_SUPABASE_PUBLISHABLE_KEY: {
    public: true,
    static: true,
    schema: optional,
    description: 'Supabase publishable key (sb_publishable_…)'
  }
});
