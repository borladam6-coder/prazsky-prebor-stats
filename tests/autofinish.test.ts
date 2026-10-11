// Live scoring ends by itself the day after the game; reopening is then admin only (migration 011).
// Run: npm run test:autofinish

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, expectError, CONSISTENCY, type Caller, type Row } from './harness.ts';

const CODE = 'K7QX-M2PA-9TRH-4WZD';

let t: Awaited<ReturnType<typeof createDb>>;
let c: Caller;
let past: Row; // a game played weeks ago
let today: Row; // a game moved to today
let order: (team: number) => Promise<string[]>;

const session = async (g: number, team: number): Promise<Row> =>
  (await t.q(`select * from live_sessions where game_id = $1 and team_id = $2`, [g, team]))[0];

async function play(g: number, team: number, result: string, batterTo: number, runners: unknown[] = []) {
  const s = await session(g, team);
  return t.rpc(c, 'live_play', {
    p_game_id: g, p_team_id: team, p_expected_version: s.version,
    p_result: result, p_batter_to: batterTo, p_runners: JSON.stringify(runners), p_rbi: null
  });
}

/** last activity N days ago (without the triggers, which would set it to now) */
async function idle(g: number, days: number) {
  await t.db.exec(`set session_replication_role = replica`);
  await t.q(`update live_sessions set updated_at = now() - make_interval(days => $2) where game_id = $1`, [g, days]);
  await t.db.exec(`set session_replication_role = origin`);
}

const autofinish = async () => (await t.as<{ n: number }>('service_role', `select public.live_autofinish() n`))[0].n;

before(async () => {
  t = await createDb();
  await t.importFixture();
  await t.q(`update private.settings set admin_code_hash = extensions.crypt('K7QXM2PA9TRH4WZD', extensions.gen_salt('bf', 4))`);
  c = t.newCaller('Zapisovatel');
  const games = await t.q(`select * from games where status = 'played' and id > 0 order by starts_at limit 2`);
  [past, today] = games;
  await t.q(`update games set starts_at = now() where id = $1`, [today.id]);
  order = async (team) => (await t.q(`select id from players where team_id = $1 and active order by name limit 9`, [team])).map((p) => p.id);
  await t.rpc(c, 'live_start', { p_game_id: past.id, p_team_id: past.away_team_id, p_lineup: await order(past.away_team_id) });
  await t.rpc(c, 'live_start', { p_game_id: today.id, p_team_id: today.home_team_id, p_lineup: await order(today.home_team_id) });
  await t.rpc(c, 'live_start', { p_game_id: -1, p_team_id: -2, p_lineup: (await order(-2)).slice(0, 9) });
  await play(past.id, past.away_team_id, '1B', 1);
  await play(past.id, past.away_team_id, '2B', 2, [{ from: 1, to: 3 }]);
});

test('only sessions of earlier days with no activity since yesterday end, the test game never', async () => {
  assert.equal(await autofinish(), 0, 'scored in today: nothing ends');
  await idle(past.id, 2);
  await idle(today.id, 2);
  await idle(-1, 2);
  assert.equal(await autofinish(), 1);
  assert.equal((await session(past.id, past.away_team_id)).finished, true);
  assert.equal((await session(today.id, today.home_team_id)).finished, false, 'game day not over');
  assert.equal((await session(-1, -2)).finished, false, 'test game');
  assert.equal(await autofinish(), 0, 'nothing twice');

  const [g] = await t.q(`select g.source, g.action, g.actor_name from change_groups g
    join change_log l on l.group_id = g.id where l.table_name = 'live_sessions' and l.game_id = $1
    order by g.at desc limit 1`, [past.id]);
  assert.deepEqual(g, { source: 'import', action: 'live_autofinish', actor_name: 'Automaticky' });
});

test('after the game day only the administrator reopens; corrections stay open to everybody', async () => {
  const team = past.away_team_id;
  const s = await session(past.id, team);
  await expectError(
    t.rpc(c, 'live_finish', { p_game_id: past.id, p_team_id: team, p_expected_version: s.version, p_finished: false }),
    /jen správce/
  );
  await expectError(t.rpc(c, 'live_start', { p_game_id: past.id, p_team_id: team, p_lineup: await order(team) }), /jen správce/);
  // the automatic end cannot be taken back from history either
  const [auto] = await t.q(`select id from change_groups where action = 'live_autofinish' limit 1`);
  await expectError(t.rpc(c, 'revert_change_group', { p_group_id: auto.id, p_force: false }), /jen změny provedené na webu|jen správce/);
  assert.equal((await session(past.id, team)).finished, true);

  // a hit that was an error
  const [pa] = await t.q(`select * from plate_appearances where game_id = $1 and result = '2B' and deleted_at is null`, [past.id]);
  await t.rpc(c, 'update_plate_appearance', { p_id: pa.id, p_expected_version: pa.version, p_result: 'ROE', p_rbi: null });
  const [line] = await t.q(`select h::int, doubles::int from player_game_batting where game_id = $1 and player_id = $2`, [past.id, pa.player_id]);
  assert.deepEqual(line, { h: 0, doubles: 0 });

  // the last play can still be deleted: the scoring stays finished
  const [last] = await t.q(`select private.latest_play($1, null) id`, [past.id]);
  await t.rpc(c, 'live_delete_play', { p_game_id: past.id, p_group_id: last.id });
  const after = await session(past.id, team);
  assert.equal(after.finished, true);
  assert.notEqual(after.runner_1, null, 'the single is on 1st again');

  await expectError(t.rpc(c, 'admin_live_reopen', { p_game_id: past.id, p_team_id: team, p_code: 'WRONG-1234' }), /Nesprávný kód/);
  const reopened = await t.rpc(c, 'admin_live_reopen', { p_game_id: past.id, p_team_id: team, p_code: CODE });
  assert.equal(reopened.finished, false);
  assert.deepEqual(await t.as('anon', CONSISTENCY), []);
});

test('on the game day anybody ends and continues', async () => {
  const team = today.home_team_id;
  let s = await session(today.id, team);
  await t.rpc(c, 'live_finish', { p_game_id: today.id, p_team_id: team, p_expected_version: s.version, p_finished: true });
  s = await session(today.id, team);
  const back = await t.rpc(c, 'live_finish', { p_game_id: today.id, p_team_id: team, p_expected_version: s.version, p_finished: false });
  assert.equal(back.finished, false);
});

test('the scheduled call is for the server only', async () => {
  await expectError(t.as('anon', `select public.live_autofinish()`), /permission denied/);
});

test('manual entry opens again once the live scoring has no plays (migration 012)', async () => {
  // today's game: scoring runs without plays → locked; ended without plays → free
  const team = today.home_team_id;
  const [player] = await order(team);
  const add = () => t.rpc(c, 'add_plate_appearance', { p_game_id: today.id, p_player_id: player, p_result: '1B' });
  await expectError(add(), /živý zápis/);
  const s = await session(today.id, team);
  await t.rpc(c, 'live_finish', { p_game_id: today.id, p_team_id: team, p_expected_version: s.version, p_finished: true });
  await add();

  // the past game has plays → locked; after the administrator wiped the game → free
  const pastTeam = past.away_team_id;
  const [batter] = await order(pastTeam);
  const addPast = () => t.rpc(c, 'add_plate_appearance', { p_game_id: past.id, p_player_id: batter, p_result: '2B' });
  await expectError(addPast(), /živý zápis/);
  await t.rpc(c, 'admin_reset_game', { p_game_id: past.id, p_code: CODE });
  await addPast();
  assert.deepEqual(await t.as('anon', CONSISTENCY), []);
});
