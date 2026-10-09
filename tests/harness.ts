// Shared test setup: all migrations in PGlite with the Supabase roles emulated.

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { fetchSeason } from '../netlify/lib/softball-api.ts';
import { buildApi, LEAGUE_ID, YEAR, type FixtureOptions } from './fixture.ts';

export type Row = Record<string, any>;

const dir = new URL('../supabase/migrations/', import.meta.url);
export const MIGRATIONS = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()
  .map((f) => readFileSync(new URL(f, dir), 'utf8'));

export const CONSISTENCY = readFileSync(new URL('../supabase/tests/consistency.sql', import.meta.url), 'utf8');

export interface Caller {
  ip: string;
  device: string;
  actor: string;
}

export async function createDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema extensions;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  for (const m of MIGRATIONS) await db.exec(m);

  let ipCounter = 0;

  function newCaller(actor = 'Tester'): Caller {
    ipCounter++;
    return { ip: `10.1.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`, device: crypto.randomUUID(), actor };
  }

  async function as<T = Row>(role: string, sql: string, params: unknown[] = [], ip = '10.9.9.9'): Promise<T[]> {
    return db.transaction(async (tx: Transaction) => {
      await tx.query(`select set_config('request.headers', $1, true)`, [JSON.stringify({ 'x-forwarded-for': `${ip}, 172.16.0.1` })]);
      await tx.exec(`set local role ${role}`);
      const res = await tx.query<T>(sql, params);
      return res.rows;
    });
  }

  async function rpc(c: Caller, fn: string, args: Record<string, unknown>): Promise<Row> {
    const all = { ...args, p_actor: c.actor, p_device: c.device };
    const keys = Object.keys(all);
    const sql = `select to_jsonb(r) as r from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) r`;
    const rows = await as('anon', sql, keys.map((k) => all[k as keyof typeof all]), c.ip);
    return rows[0].r;
  }

  async function q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await db.query<T>(sql, params)).rows;
  }

  async function importFixture(opts: FixtureOptions = {}) {
    const api = buildApi(opts);
    const { payload, warnings } = await fetchSeason(LEAGUE_ID, YEAR, api.get, 'https://softball.cz/api/external');
    const rows = await as<{ r: Row }>('service_role', 'select public.import_season($1::jsonb) as r', [JSON.stringify(payload)]);
    return { summary: rows[0].r, warnings, payload, api };
  }

  return { db, newCaller, as, rpc, q, importFixture };
}

export async function expectError(p: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(p, (err: any) => {
    assert.match(String(err?.message ?? err), pattern);
    return true;
  });
}
