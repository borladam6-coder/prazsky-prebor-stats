// Database tests: run the real migration in PGlite (Postgres compiled to WASM),
// emulate the Supabase roles and exercise import, write RPCs, security, history,
// revert and statistics. Run: npm run test:db

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { fetchSeason } from '../netlify/lib/softball-api.ts';
import { buildApi, LEAGUE_ID, YEAR, SEASON_ID, rosterId } from './fixture.ts';

const MIGRATION = readFileSync(new URL('../supabase/migrations/001_init.sql', import.meta.url), 'utf8');
const CONSISTENCY = readFileSync(new URL('../supabase/tests/consistency.sql', import.meta.url), 'utf8');

let db: PGlite;
let ipCounter = 0;

type Row = Record<string, any>;

interface Caller {
  ip: string;
  device: string;
  actor: string;
}

function newCaller(actor = 'Tester'): Caller {
  ipCounter++;
  return { ip: `10.0.${Math.floor(ipCounter / 250)}.${ipCounter % 250}`, device: crypto.randomUUID(), actor };
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
  const keys = Object.keys(args);
  const sql = `select to_jsonb(r) as r from public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) r`;
  const rows = await as('anon', sql, keys.map((k) => args[k]), c.ip);
  return rows[0].r;
}

const pa = (c: Caller, game: number, player: string, result: string, rbi?: number) =>
  rpc(c, 'add_plate_appearance', {
    p_game_id: game, p_player_id: player, p_result: result, p_actor: c.actor, p_device: c.device,
    ...(rbi === undefined ? {} : { p_rbi: rbi })
  });

const bump = (c: Caller, game: number, player: string, stat: string, delta: number) =>
  rpc(c, 'bump_player_game_stat', {
    p_game_id: game, p_player_id: player, p_stat: stat, p_delta: delta, p_actor: c.actor, p_device: c.device
  });

async function q<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

async function importFixture(opts = {}) {
  const api = buildApi(opts);
  const { payload, warnings } = await fetchSeason(LEAGUE_ID, YEAR, api.get, 'https://softball.cz/api/external');
  const rows = await as<{ r: Row }>('service_role', 'select public.import_season($1::jsonb) as r', [JSON.stringify(payload)]);
  return { summary: rows[0].r, warnings, payload, api };
}

async function playedGame(): Promise<{ game: Row; home: Row[]; away: Row[] }> {
  const [game] = await q(`select * from games where status = 'played' order by id limit 1`);
  const home = await q(`select * from players where team_id = $1 and active order by name`, [game.home_team_id]);
  const away = await q(`select * from players where team_id = $1 and active order by name`, [game.away_team_id]);
  return { game, home, away };
}

async function expectError(p: Promise<unknown>, pattern: RegExp) {
  await assert.rejects(p, (err: any) => {
    assert.match(String(err?.message ?? err), pattern);
    return true;
  });
}

before(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create schema extensions;
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
  `);
  await db.exec(MIGRATION);
});

// ----------------------------------------------------------------- import

test('import stores only allowed data and is idempotent', async () => {
  const { summary, payload, warnings } = await importFixture();
  assert.equal(warnings.length, 0);
  assert.equal(summary.teams, 10);

  const json = JSON.stringify(payload);
  for (const forbidden of ['birth_date', '1990-01-01', 'bank_account', '123456789/0100', 'user_id', 'Rozhodčí', 'data_box']) {
    assert.ok(!json.includes(forbidden), `payload must not contain ${forbidden}`);
  }

  const [counts] = await q(`select
    (select count(*) from teams)::int teams, (select count(*) from games)::int games,
    (select count(*) from players)::int players, (select count(*) from standings)::int standings,
    (select count(*) from seasons where is_current)::int current`);
  assert.deepEqual(counts, { teams: 10, games: 45, players: 140, standings: 10, current: 1 });

  const colors = await q(`select color from teams`);
  assert.equal(new Set(colors.map((c) => c.color)).size, 10, 'each team gets a distinct color');

  const logos = await q(`select id, logo_url from teams where id in (196, 129) order by id`);
  assert.deepEqual(logos, [
    { id: 129, logo_url: null },
    { id: 196, logo_url: 'https://management.softball.cz/files/196/view' }
  ], 'logo kept from schedule, foreign hosts rejected');

  const [g] = await q(`select starts_at from games where id = 169700`);
  assert.ok(g.starts_at instanceof Date);

  const groupsBefore = (await q(`select count(*)::int n from change_groups`))[0].n;
  const again = await importFixture();
  assert.equal(again.summary.games_changed, 0);
  assert.equal(again.summary.players_changed, 0);
  const groupsAfter = (await q(`select count(*)::int n from change_groups`))[0].n;
  assert.equal(groupsAfter, groupsBefore, 'a no-op import creates no history');
});

test('import updates renamed players, deactivates removed ones, skips failed rosters', async () => {
  const renamedId = rosterId(196, 3);
  const removedId = rosterId(196, 4);
  const untouchedTeamPlayer = rosterId(129, 2);
  const { summary, warnings } = await importFixture({
    renamed: { [renamedId]: 'Nové Jméno' },
    removedRosterIds: [removedId, untouchedTeamPlayer],
    failingRosterTeamIds: [129]
  });
  assert.equal(warnings.length, 1);
  assert.equal(summary.players_changed, 1);
  assert.equal(summary.players_removed, 1);

  const [renamed] = await q(`select name, active from players where external_id = $1`, [renamedId]);
  assert.deepEqual(renamed, { name: 'Nové Jméno', active: true });
  const [removed] = await q(`select active from players where external_id = $1`, [removedId]);
  assert.equal(removed.active, false);
  const [untouched] = await q(`select active from players where external_id = $1`, [untouchedTeamPlayer]);
  assert.equal(untouched.active, true, 'team with a failed roster download is left alone');

  // back to the original roster
  await importFixture();
  const [back] = await q(`select name, active from players where external_id = $1`, [removedId]);
  assert.equal(back.active, true);
});

// ----------------------------------------------------------------- security

test('anonymous users cannot write directly or read private data', async () => {
  const { game, home } = await playedGame();
  await expectError(
    as('anon', `insert into plate_appearances (game_id, player_id, result) values ($1, $2, '1B')`, [game.id, home[0].id]),
    /permission denied/
  );
  await expectError(as('anon', `update players set name = 'X' where id = $1`, [home[0].id]), /permission denied/);
  await expectError(as('anon', `delete from games`), /permission denied/);
  await expectError(as('anon', `update teams set color = '#000000'`), /permission denied/);
  await expectError(as('anon', `select * from private.settings`), /permission denied/);
  await expectError(as('anon', `select * from private.write_events`), /permission denied/);
  await expectError(as('anon', `select public.import_season('{}'::jsonb)`), /permission denied/);
  await expectError(as('authenticated', `select public.import_season('{}'::jsonb)`), /permission denied/);
  const rows = await as('anon', `select count(*)::int n from players`);
  assert.ok(rows[0].n > 0, 'anon can read');
});

test('hard delete is blocked even for the database owner', async () => {
  await expectError(q(`delete from players`), /Mazání je zakázané/);
  await expectError(q(`delete from change_log`), /Mazání je zakázané/);
});

// ----------------------------------------------------------------- writes and validation

test('plate appearances: defaults, HR → run, validation', async () => {
  const c = newCaller('Adam');
  const { game, home, away } = await playedGame();
  const p = home[0].id;

  const hr = await pa(c, game.id, p, 'HR');
  assert.equal(hr.rbi, 1);
  let [x] = await q(`select runs from game_player_extras where game_id = $1 and player_id = $2`, [game.id, p]);
  assert.equal(x.runs, 1, 'HR adds a run');

  const sf = await pa(c, game.id, p, 'SF');
  assert.equal(sf.rbi, 1);
  const single = await pa(c, game.id, p, '1B', 2);
  assert.equal(single.rbi, 2);

  await expectError(pa(c, game.id, p, 'XX'), /Neznámý výsledek/);
  await expectError(pa(c, game.id, p, '1B', 5), /RBI musí být 0–4/);
  await expectError(pa(c, game.id, p, 'HR', 0), /aspoň 1 RBI/);
  await expectError(pa({ ...c, actor: ' ' }, game.id, p, '1B'), /přezdívku/);
  await expectError(pa({ ...c, actor: '<b>x</b>' }, game.id, p, '1B'), /přezdívku/);

  const [outsider] = await q(`select id from players where team_id not in ($1, $2) limit 1`, [game.home_team_id, game.away_team_id]);
  await expectError(pa(c, game.id, outsider.id, '1B'), /nehraje za žádný z týmů/);

  const [future] = await q(`select * from games where status = 'scheduled' and starts_at > now() limit 1`);
  const [futurePlayer] = await q(`select id from players where team_id = $1 limit 1`, [future.home_team_id]);
  await expectError(pa(c, future.id, futurePlayer.id, '1B'), /jen do odehraných zápasů/);

  await expectError(bump(c, game.id, p, 'runs', -1), /3 HR|1 HR/);
  await expectError(bump(c, game.id, away[0].id, 'runs', -1), /nemohou být záporné/);
  await expectError(bump(c, game.id, p, 'runs', 2), /jen o 1/);
  await expectError(bump(c, game.id, p, 'hits', 1), /Neznámá statistika/);

  const sb = await bump(c, game.id, p, 'stolen_bases', 1);
  assert.equal(sb.stolen_bases, 1);

  // edit with optimistic locking
  const edited = await rpc(c, 'update_plate_appearance', {
    p_id: single.id, p_expected_version: single.version, p_actor: c.actor, p_device: c.device, p_result: '2B'
  });
  assert.equal(edited.result, '2B');
  assert.equal(edited.version, single.version + 1);
  await expectError(
    rpc(c, 'update_plate_appearance', {
      p_id: single.id, p_expected_version: single.version, p_actor: c.actor, p_device: c.device, p_rbi: 0
    }),
    /upravil někdo jiný/
  );

  // changing a 1B into an HR adds the run, deleting the HR removes it again
  const s2 = await pa(c, game.id, p, '1B');
  const toHr = await rpc(c, 'update_plate_appearance', {
    p_id: s2.id, p_expected_version: s2.version, p_actor: c.actor, p_device: c.device, p_result: 'HR'
  });
  assert.equal(toHr.rbi, 1);
  [x] = await q(`select runs from game_player_extras where game_id = $1 and player_id = $2`, [game.id, p]);
  assert.equal(x.runs, 2);
  await rpc(c, 'delete_plate_appearance', { p_id: toHr.id, p_expected_version: toHr.version, p_actor: c.actor, p_device: c.device });
  [x] = await q(`select runs from game_player_extras where game_id = $1 and player_id = $2`, [game.id, p]);
  assert.equal(x.runs, 1);
});

test('at most 10 plate appearances per player per game', async () => {
  const c = newCaller();
  const { game, away } = await playedGame();
  const p = away[5].id;
  for (let i = 0; i < 10; i++) await pa(c, game.id, p, 'OUT');
  await expectError(pa(c, game.id, p, 'OUT'), /10 příchodů/);
});

test('rate limit stops floods', async () => {
  const c = newCaller();
  const { game, away } = await playedGame();
  const p = away[6].id;
  for (let i = 0; i < 75; i++) {
    await bump(c, game.id, p, 'stolen_bases', 1);
    await bump(c, game.id, p, 'stolen_bases', -1);
  }
  await expectError(bump(c, game.id, p, 'stolen_bases', 1), /Příliš mnoho změn/);
  // same device from another IP is still limited
  await expectError(bump({ ...c, ip: '192.168.50.50' }, game.id, p, 'stolen_bases', 1), /Příliš mnoho změn/);
  // a different person is not affected
  const other = newCaller();
  await bump(other, game.id, p, 'stolen_bases', 1);

  const [ev] = await q(`select client_hash from private.write_events limit 1`);
  assert.match(ev.client_hash, /^[0-9a-f]{64}$/, 'IP is stored only as a salted hash');
  assert.ok(!(await q(`select 1 from private.write_events where client_hash like '%10.%'`)).length);
});

// ----------------------------------------------------------------- players

test('players: add, edit, deactivate; import respects manual edits', async () => {
  const c = newCaller();
  const added = await rpc(c, 'add_player', {
    p_season_id: SEASON_ID, p_team_id: 196, p_name: '  Nový   Hráč ', p_actor: c.actor, p_device: c.device, p_jersey_number: 77
  });
  assert.equal(added.name, 'Nový Hráč');
  assert.equal(added.source, 'manual');

  await expectError(rpc(c, 'add_player', { p_season_id: SEASON_ID, p_team_id: 196, p_name: 'X', p_actor: c.actor, p_device: c.device }), /2–60 znaků/);
  await expectError(rpc(c, 'add_player', { p_season_id: SEASON_ID, p_team_id: 196, p_name: 'Hráč<script>', p_actor: c.actor, p_device: c.device }), /nepovolené znaky/);
  await expectError(rpc(c, 'add_player', { p_season_id: SEASON_ID, p_team_id: 196, p_name: 'Hráč Tři', p_actor: c.actor, p_device: c.device, p_jersey_number: 100 }), /0–99/);
  await expectError(rpc(c, 'add_player', { p_season_id: SEASON_ID, p_team_id: 999, p_name: 'Hráč Tři', p_actor: c.actor, p_device: c.device }), /nehraje/);

  const [imported] = await q(`select * from players where external_id = $1`, [rosterId(257, 1)]);
  const edited = await rpc(c, 'update_player', {
    p_id: imported.id, p_expected_version: imported.version, p_name: 'Opravené Jméno', p_actor: c.actor, p_device: c.device, p_jersey_number: 12
  });
  assert.equal(edited.edited_manually, true);

  await importFixture();
  const [after] = await q(`select name, jersey_number from players where id = $1`, [imported.id]);
  assert.deepEqual(after, { name: 'Opravené Jméno', jersey_number: 12 }, 'import does not overwrite manual edits');

  const off = await rpc(c, 'set_player_active', {
    p_id: added.id, p_expected_version: added.version, p_active: false, p_actor: c.actor, p_device: c.device
  });
  assert.equal(off.active, false);
});

// ----------------------------------------------------------------- history and revert

test('history records who/when/what and revert works as a unit', async () => {
  const c = newCaller('Revertér');
  const { game, home } = await playedGame();
  const p = home[7].id;

  const hr = await pa(c, game.id, p, 'HR');
  const [group] = await q(`select g.* from change_groups g join change_log l on l.group_id = g.id
                           where l.row_id = $1 and l.action = 'insert'`, [hr.id]);
  assert.equal(group.actor_name, 'Revertér');
  assert.equal(group.source, 'web');
  assert.equal(group.action, 'add_plate_appearance');
  assert.match(group.device_hash, /^[0-9a-f]{64}$/);
  const entries = await q(`select table_name, is_derived from change_log where group_id = $1 order by id`, [group.id]);
  assert.deepEqual(entries, [
    { table_name: 'plate_appearances', is_derived: false },
    { table_name: 'game_player_extras', is_derived: true }
  ]);

  const revertGroup = await as('anon', `select public.revert_change_group($1, $2, $3) as g`, [group.id, c.actor, c.device], c.ip);
  const [after] = await q(`select deleted_at from plate_appearances where id = $1`, [hr.id]);
  assert.ok(after.deleted_at, 'reverted PA is soft-deleted');
  const [x] = await q(`select runs from game_player_extras where game_id = $1 and player_id = $2`, [game.id, p]);
  assert.equal(x.runs, 0, 'run from the HR disappears with it');

  await expectError(as('anon', `select public.revert_change_group($1, $2, $3)`, [group.id, c.actor, c.device], c.ip), /už byla vrácena/);

  // revert the revert = redo
  await as('anon', `select public.revert_change_group($1, $2, $3)`, [revertGroup[0].g, c.actor, c.device], c.ip);
  const [redo] = await q(`select deleted_at from plate_appearances where id = $1`, [hr.id]);
  assert.equal(redo.deleted_at, null);
  const [x2] = await q(`select runs from game_player_extras where game_id = $1 and player_id = $2`, [game.id, p]);
  assert.equal(x2.runs, 1);

  // conflict: a change followed by a newer change on the same row
  const s = await pa(c, game.id, p, '1B');
  const [g1] = await q(`select group_id from change_log where row_id = $1 and action = 'insert'`, [s.id]);
  await rpc(c, 'update_plate_appearance', { p_id: s.id, p_expected_version: s.version, p_actor: c.actor, p_device: c.device, p_rbi: 1 });
  await expectError(as('anon', `select public.revert_change_group($1, $2, $3)`, [g1.group_id, c.actor, c.device], c.ip), /znovu změněn/);

  // players: reverting an edit restores the old values, reverting an addition removes from the roster
  const added = await rpc(c, 'add_player', { p_season_id: SEASON_ID, p_team_id: 603, p_name: 'Vratný Hráč', p_actor: c.actor, p_device: c.device });
  const renamed = await rpc(c, 'update_player', { p_id: added.id, p_expected_version: added.version, p_name: 'Přejmenovaný Hráč', p_actor: c.actor, p_device: c.device, p_jersey_number: 5 });
  const [editGroup] = await q(`select group_id from change_log where row_id = $1 and action = 'update' order by id desc limit 1`, [added.id]);
  await as('anon', `select public.revert_change_group($1, $2, $3)`, [editGroup.group_id, c.actor, c.device], c.ip);
  const [restored] = await q(`select name, jersey_number, active from players where id = $1`, [added.id]);
  assert.deepEqual(restored, { name: 'Vratný Hráč', jersey_number: null, active: true });
  assert.ok(renamed.version > added.version);
  const [addGroup] = await q(`select group_id from change_log where row_id = $1 and action = 'insert'`, [added.id]);
  await as('anon', `select public.revert_change_group($1, $2, $3)`, [addGroup.group_id, c.actor, c.device], c.ip);
  const [gone] = await q(`select active from players where id = $1`, [added.id]);
  assert.equal(gone.active, false);

  // import changes cannot be reverted from the web
  const [imp] = await q(`select id from change_groups where source = 'import' limit 1`);
  await expectError(as('anon', `select public.revert_change_group($1, $2, $3)`, [imp.id, c.actor, c.device], c.ip), /jen změny provedené na webu/);
});

// ----------------------------------------------------------------- statistics

interface Tally { pa: number; ab: number; h: number; s: number; d: number; t: number; hr: number; tb: number; rbi: number; bb: number; k: number; hbp: number; sf: number; sh: number; }

test('random game simulation: views match an independent calculation', async () => {
  // fresh players so earlier tests do not interfere
  const games = await q(`select * from games where status = 'played' order by id offset 3 limit 12`);
  const results = ['1B','1B','1B','2B','3B','HR','BB','HBP','K','K','OUT','OUT','OUT','FC','ROE','SF','SH'];
  const AB = new Set(['1B','2B','3B','HR','K','OUT','FC','ROE']);
  const TB: Record<string, number> = { '1B': 1, '2B': 2, '3B': 3, HR: 4 };
  const expected = new Map<string, Tally & { r: number; sb: number; games: Set<number> }>();
  let seed = 42;
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };

  const baseline = await as('anon', `select * from player_season_batting`);
  let c = newCaller('Simulátor');
  let writes = 0;
  const call = async <T>(fn: () => Promise<T>): Promise<T> => {
    if (++writes % 120 === 0) c = newCaller('Simulátor');
    return fn();
  };

  for (const g of games) {
    for (const teamId of [g.home_team_id, g.away_team_id]) {
      const roster = await q(`select id from players where team_id = $1 and active and source = 'import' order by external_id limit 9`, [teamId]);
      for (const pl of roster) {
        const key = pl.id;
        const e = expected.get(key) ?? { pa: 0, ab: 0, h: 0, s: 0, d: 0, t: 0, hr: 0, tb: 0, rbi: 0, bb: 0, k: 0, hbp: 0, sf: 0, sh: 0, r: 0, sb: 0, games: new Set<number>() };
        const existing = await q(`select count(*)::int n from plate_appearances where game_id = $1 and player_id = $2 and deleted_at is null`, [g.id, pl.id]);
        if (existing[0].n > 0) continue;
        const n = 2 + rnd(3);
        for (let i = 0; i < n; i++) {
          const res = results[rnd(results.length)];
          const rbi = res === 'HR' || res === 'SF' ? 1 + rnd(2) : rnd(4) === 0 ? 1 : 0;
          const row = await call(() => pa(c, g.id, pl.id, res, rbi));
          // occasionally delete a plate appearance again
          if (rnd(10) === 0) {
            await call(() => rpc(c, 'delete_plate_appearance', { p_id: row.id, p_expected_version: row.version, p_actor: c.actor, p_device: c.device }));
            continue;
          }
          e.pa++; e.rbi += rbi; e.games.add(g.id);
          if (AB.has(res)) e.ab++;
          if (TB[res]) { e.h++; e.tb += TB[res]; }
          if (res === '1B') e.s++; if (res === '2B') e.d++; if (res === '3B') e.t++;
          if (res === 'HR') { e.hr++; e.r++; }
          if (res === 'BB') e.bb++; if (res === 'K') e.k++; if (res === 'HBP') e.hbp++;
          if (res === 'SF') e.sf++; if (res === 'SH') e.sh++;
        }
        if (rnd(3) === 0) { await call(() => bump(c, g.id, pl.id, 'runs', 1)); e.r++; e.games.add(g.id); }
        if (rnd(5) === 0) { await call(() => bump(c, g.id, pl.id, 'stolen_bases', 1)); e.sb++; e.games.add(g.id); }
        expected.set(key, e);
      }
    }
  }

  const rows = await as('anon', `select * from player_season_batting where player_id = any($1::uuid[])`, [[...expected.keys()]]);
  // earlier tests already recorded stats for some players: add that baseline
  for (const b of baseline) {
    const e = expected.get(b.player_id);
    if (!e) continue;
    e.pa += Number(b.pa); e.ab += Number(b.ab); e.h += Number(b.h); e.s += Number(b.singles);
    e.d += Number(b.doubles); e.t += Number(b.triples); e.hr += Number(b.hr); e.tb += Number(b.tb);
    e.rbi += Number(b.rbi); e.r += Number(b.r); e.bb += Number(b.bb); e.k += Number(b.k);
    e.hbp += Number(b.hbp); e.sf += Number(b.sf); e.sh += Number(b.sh); e.sb += Number(b.sb);
    for (let i = 0; i < Number(b.games); i++) e.games.add(-1 - i);
  }
  const byId = new Map(rows.map((r) => [r.player_id, r]));
  const close = (a: unknown, b: number | null, what: string) => {
    if (b === null) return assert.equal(a, null, what);
    assert.ok(Math.abs(Number(a) - b) < 1e-9, `${what}: ${a} vs ${b}`);
  };

  let compared = 0;
  for (const [id, e] of expected) {
    const r = byId.get(id);
    if (e.games.size === 0) { assert.equal(r, undefined); continue; }
    assert.ok(r, `row for ${id}`);
    compared++;
    assert.deepEqual(
      [r.games, r.pa, r.ab, r.h, r.singles, r.doubles, r.triples, r.hr, r.tb, r.rbi, r.r, r.bb, r.k, r.hbp, r.sf, r.sh, r.sb].map(Number),
      [e.games.size, e.pa, e.ab, e.h, e.s, e.d, e.t, e.hr, e.tb, e.rbi, e.r, e.bb, e.k, e.hbp, e.sf, e.sh, e.sb]
    );
    const avg = e.ab ? e.h / e.ab : null;
    const obpDen = e.ab + e.bb + e.hbp + e.sf;
    const obp = obpDen ? (e.h + e.bb + e.hbp) / obpDen : null;
    const slg = e.ab ? e.tb / e.ab : null;
    close(r.avg, avg, 'AVG');
    close(r.obp, obp, 'OBP');
    close(r.slg, slg, 'SLG');
    close(r.ops, obp !== null && slg !== null ? obp + slg : null, 'OPS');
  }
  assert.ok(compared > 50, `compared ${compared} players`);

  // filtered totals = same numbers
  const [one] = [...expected.entries()].filter(([, e]) => e.games.size > 0);
  const [team] = await q(`select team_id from players where id = $1`, [one[0]]);
  const filtered = await as('anon', `select * from public.batting_totals($1, p_team_id => $2)`, [SEASON_ID, team.team_id]);
  const f = filtered.find((r) => r.player_id === one[0]);
  assert.ok(f); assert.equal(Number(f.pa), one[1].pa);

  const minPa = await as('anon', `select min(pa)::int m from public.batting_totals($1, p_min_pa => 8)`, [SEASON_ID]);
  assert.ok(minPa[0].m === null || minPa[0].m >= 8);

  const future = await as('anon', `select count(*)::int n from public.batting_totals($1, p_from => '2100-01-01')`, [SEASON_ID]);
  assert.equal(future[0].n, 0);

  const teamTotals = await as('anon', `select * from public.team_batting_totals($1)`, [SEASON_ID]);
  const teamView = await as('anon', `select * from team_season_batting where season_id = $1`, [SEASON_ID]);
  for (const t of teamTotals) {
    const v = teamView.find((x) => x.team_id === t.team_id);
    assert.ok(v); assert.equal(Number(v.pa), Number(t.pa));
    assert.equal(Number(v.h), Number(t.h));
  }
});

test('consistency checks return no problems', async () => {
  const problems = await as('anon', CONSISTENCY);
  assert.deepEqual(problems, []);
});

test('rates are NULL (not errors) when the denominator is zero', async () => {
  const c = newCaller();
  const { game, away } = await playedGame();
  const p = away[8].id;
  await pa(c, game.id, p, 'BB');
  await pa(c, game.id, p, 'SH');
  const [r] = await as('anon', `select avg, obp, slg, ops from player_game_batting where game_id = $1 and player_id = $2`, [game.id, p]);
  assert.deepEqual({ avg: r.avg, slg: r.slg, ops: r.ops }, { avg: null, slg: null, ops: null });
  assert.equal(Number(r.obp), 1);
});
