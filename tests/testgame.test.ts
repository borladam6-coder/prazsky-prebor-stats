// Batting order limit, short administrator code and the test game (migration 006).
// Run: npm run test:testgame

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, expectError, CONSISTENCY, type Caller, type Row } from './harness.ts';

let t: Awaited<ReturnType<typeof createDb>>;
let c: Caller;
let season: Row;
let lions: string[];
let eagles: string[];

async function session(team: number): Promise<Row> {
  return (await t.q(`select * from live_sessions where game_id = -1 and team_id = $1`, [team]))[0];
}

async function play(team: number, result: string | null, batterTo: number | null, runners: unknown[] = []) {
  const s = await session(team);
  return t.rpc(c, 'live_play', {
    p_game_id: -1, p_team_id: team, p_expected_version: s.version,
    p_result: result, p_batter_to: batterTo, p_runners: JSON.stringify(runners), p_rbi: null
  });
}

before(async () => {
  t = await createDb();
  await t.importFixture();
  c = t.newCaller('Zkoušeč');
  [season] = await t.q(`select * from seasons where is_current`);
  lions = (await t.q(`select id from players where team_id = -1 order by jersey_number`)).map((p) => p.id);
  eagles = (await t.q(`select id from players where team_id = -2 order by jersey_number`)).map((p) => p.id);
});

test('test game: two made-up teams of 12, own season, not current', async () => {
  const [g] = await t.as('anon', `select * from games where id = -1`);
  assert.equal(g.status, 'played');
  assert.equal(g.season_id, -1);
  assert.equal(lions.length, 12);
  assert.equal(eagles.length, 12);
  const [s] = await t.as('anon', `select is_current from seasons where id = -1`);
  assert.equal(s.is_current, false);
  assert.notEqual(season.id, -1);
});

test('batting order: 9 or 10, not 11', async () => {
  await expectError(t.rpc(c, 'live_start', { p_game_id: -1, p_team_id: -2, p_lineup: eagles.slice(0, 11) }), /1–10/);
  await t.rpc(c, 'live_start', { p_game_id: -1, p_team_id: -2, p_lineup: eagles.slice(0, 10) });
  await t.rpc(c, 'live_start', { p_game_id: -1, p_team_id: -1, p_lineup: lions.slice(0, 9) });
});

test('test game is scored like any game and stays out of the league statistics', async () => {
  await play(-2, 'HR', 4);
  await play(-2, '1B', 1);
  await play(-2, 'K', 0, [{ from: 1, to: 1 }]);
  const all = await t.as('anon', `select * from public.batting_totals($1, null, null, null, null, 0)`, [season.id]);
  assert.ok(!all.some((r) => eagles.includes(r.player_id)), 'not in the current season totals');
  const recorded = await t.as('anon', `select * from team_game_batting where season_id = $1 and game_id = -1`, [season.id]);
  assert.equal(recorded.length, 0);
  const [box] = await t.as('anon', `select sum(r)::int r, sum(hr)::int hr from player_game_batting where game_id = -1`);
  assert.deepEqual(box, { r: 1, hr: 1 });
  assert.deepEqual(await t.as('anon', CONSISTENCY), []);
});

test('anyone can wipe the test game, and only the test game', async () => {
  const other = t.newCaller('Kdokoli');
  await t.rpc(other, 'test_reset_game', {});
  const [box] = await t.as('anon', `select coalesce(sum(pa), 0)::int pa, coalesce(sum(r), 0)::int r from player_game_batting where game_id = -1`);
  assert.deepEqual(box, { pa: 0, r: 0 });
  const sessions = await t.q(`select finished, inning, outs, next_slot from live_sessions where game_id = -1 order by team_id`);
  assert.ok(sessions.every((s) => s.finished && s.inning === 1 && s.outs === 0 && s.next_slot === 0));
  // the play-by-play of the test game is hidden
  const [{ n }] = await t.q(`select count(*)::int n from change_groups g where g.action = 'live_play' and g.reverted_by_group_id is null
    and exists (select 1 from change_log l where l.group_id = g.id and l.game_id = -1)`);
  assert.equal(n, 0);
  // and it starts again from the first inning
  const s = await t.rpc(other, 'live_start', { p_game_id: -1, p_team_id: -2, p_lineup: eagles.slice(0, 9) });
  assert.equal(s.finished, false);
  assert.deepEqual(await t.as('anon', CONSISTENCY), []);
});

test('the import does not touch the test game', async () => {
  await t.importFixture();
  const [g] = await t.q(`select status, season_id from games where id = -1`);
  assert.deepEqual(g, { status: 'played', season_id: -1 });
  const [{ n }] = await t.q(`select count(*)::int n from players where team_id in (-1, -2) and active`);
  assert.equal(n, 24);
  const [cur] = await t.q(`select id from seasons where is_current`);
  assert.equal(cur.id, season.id);
});

test('short administrator code (4+ characters)', async () => {
  await t.q(`update private.settings set admin_code_hash = extensions.crypt('ADMIN', extensions.gen_salt('bf', 4))`);
  const check = (code: string) => t.as<{ r: string }>('anon', `select public.admin_check($1, $2) as r`, [code, c.device], c.ip).then((r) => r[0].r);
  assert.equal(await check('admin'), 'ok');
  assert.equal(await check('Admin'), 'ok');
  assert.equal(await check('adm'), 'wrong');
});
