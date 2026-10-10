// Corrections of live scoring and administrator actions (migration 004).
// Run: npm run test:corrections

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, expectError, CONSISTENCY, type Caller, type Row } from './harness.ts';
import { buildPlays, lineScore, type CurrentPas } from '../src/lib/plays.ts';

const CODE = 'K7QX-M2PA-9TRH-4WZD';

let t: Awaited<ReturnType<typeof createDb>>;
let c: Caller;
let game: Row;
let home: string[];
let away: string[];

async function session(team: number): Promise<Row> {
  return (await t.q(`select * from live_sessions where game_id = $1 and team_id = $2`, [game.id, team]))[0];
}

async function play(team: number, result: string | null, batterTo: number | null, runners: unknown[] = [], rbi: number | null = null) {
  const s = await session(team);
  return t.rpc(c, 'live_play', {
    p_game_id: game.id, p_team_id: team, p_expected_version: s.version,
    p_result: result, p_batter_to: batterTo, p_runners: JSON.stringify(runners), p_rbi: rbi
  });
}

async function lastPlayGroup(): Promise<string> {
  const [g] = await t.q(`select g.id from change_groups g where g.action = 'live_play' and g.reverted_by_group_id is null
    and exists (select 1 from change_log l where l.group_id = g.id and l.game_id = $1)
    order by g.at desc limit 1`, [game.id]);
  return g.id;
}

async function box(): Promise<Record<string, Row>> {
  const rows = await t.q(`select player_id, pa::int, h::int, r::int, rbi::int, sb::int, hr::int, sf::int from player_game_batting where game_id = $1`, [game.id]);
  return Object.fromEntries(rows.map((r) => [r.player_id, r]));
}

async function playLog() {
  const entries = await t.as('anon', `select id, group_id, table_name, action, old_data, new_data, is_derived from change_log
    where game_id = $1 and table_name in ('live_sessions','plate_appearances','game_player_extras','live_run_adjustments') order by id`, [game.id]);
  const ids = [...new Set(entries.filter((e) => ['live_sessions', 'live_run_adjustments'].includes(e.table_name)).map((e) => e.group_id))];
  const groups = await t.as('anon', `select id, at::text, action, actor_name, reverted_by_group_id from change_groups where id = any($1::uuid[])`, [ids]);
  const pas = await t.q(`select id, result, rbi from plate_appearances where game_id = $1 and deleted_at is null`, [game.id]);
  const current: CurrentPas = new Map(pas.map((p) => [p.id, { result: p.result, rbi: p.rbi, deleted: false }]));
  return buildPlays(groups as any, entries.filter((e) => ids.includes(e.group_id)) as any, current);
}

async function runsByTeam(): Promise<Record<number, number>> {
  const rows = await t.q(`select team_id, sum(r)::int r from player_game_batting where game_id = $1 group by team_id`, [game.id]);
  return Object.fromEntries(rows.map((r) => [r.team_id, r.r]));
}

async function lineTotals(): Promise<Record<number, number>> {
  const line = lineScore(await playLog());
  return Object.fromEntries([...line].map(([team, row]) => [team, row.reduce((a, x) => a + x, 0)]));
}

before(async () => {
  t = await createDb();
  await t.importFixture();
  await t.q(`update private.settings set admin_code_hash = extensions.crypt('K7QXM2PA9TRH4WZD', extensions.gen_salt('bf', 4))`);
  c = t.newCaller('Opravář');
  [game] = await t.q(`select * from games where status = 'played' order by id limit 1`);
  home = (await t.q(`select id from players where team_id = $1 and active order by name limit 9`, [game.home_team_id])).map((p) => p.id);
  away = (await t.q(`select id from players where team_id = $1 and active order by name limit 9`, [game.away_team_id])).map((p) => p.id);
  await t.rpc(c, 'live_start', { p_game_id: game.id, p_team_id: game.away_team_id, p_lineup: away });
  await t.rpc(c, 'live_start', { p_game_id: game.id, p_team_id: game.home_team_id, p_lineup: home });
});

test('admin code: checked without case and dashes, failures are limited, never readable', async () => {
  const check = (code: string, device = c.device, ip = c.ip) =>
    t.as<{ r: string }>('anon', `select public.admin_check($1, $2) as r`, [code, device], ip).then((r) => r[0].r);
  assert.equal(await check('k7qx m2pa 9trh 4wzd'), 'ok');
  assert.equal(await check('WRONG-CODE-1234'), 'wrong');
  const brute = t.newCaller('Útočník');
  for (let i = 0; i < 10; i++) await check('guess' + i + 'xxxxxx', brute.device, brute.ip);
  assert.equal(await check(CODE, brute.device, brute.ip), 'locked', 'locked after 10 failures even with the right code');
  await expectError(t.as('anon', `select admin_code_hash from private.settings`), /permission denied/);
});

test('a run correction in an inning shows in the box score and in the line score', async () => {
  // top 1: single, then double scores the runner
  await play(game.away_team_id, '1B', 1);
  await play(game.away_team_id, '2B', 2, [{ from: 1, to: 4 }]);
  assert.equal((await box())[away[0]].r, 1);

  await t.rpc(c, 'live_adjust_runs', { p_game_id: game.id, p_team_id: game.away_team_id, p_inning: 1, p_player_id: away[1], p_delta: 1 });
  assert.equal((await box())[away[1]].r, 1);
  assert.deepEqual(await lineTotals(), await runsByTeam());

  await t.rpc(c, 'live_adjust_runs', { p_game_id: game.id, p_team_id: game.away_team_id, p_inning: 1, p_player_id: away[1], p_delta: -1 });
  await expectError(
    t.rpc(c, 'live_adjust_runs', { p_game_id: game.id, p_team_id: game.away_team_id, p_inning: 1, p_player_id: away[1], p_delta: -1 }),
    /žádný doběh/
  );
  await expectError(
    t.rpc(c, 'live_adjust_runs', { p_game_id: game.id, p_team_id: game.away_team_id, p_inning: 1, p_player_id: home[0], p_delta: 1 }),
    /nehraje za tento tým/
  );
  assert.deepEqual(await lineTotals(), await runsByTeam());
});

test('deleting a play in the middle removes its stats; undo of later plays still works', async () => {
  // runner on 2nd (away[1]); HR by away[2] scores both
  await play(game.away_team_id, 'HR', 4, [{ from: 2, to: 4 }]);
  const hrPlay = await lastPlayGroup();
  await play(game.away_team_id, 'BB', 1); // away[3] walks
  await play(game.away_team_id, '1B', 1, [{ from: 1, to: 2 }]); // away[4]
  const before = await box();
  assert.equal(before[away[2]].hr, 1);
  assert.equal(before[away[2]].r, 1);
  assert.equal(before[away[1]].r, 1);

  await t.rpc(c, 'live_delete_play', { p_game_id: game.id, p_group_id: hrPlay });
  const after = await box();
  assert.equal(after[away[2]]?.pa ?? 0, 0, 'the plate appearance is gone');
  assert.equal(after[away[2]]?.r ?? 0, 0, 'the home run run is gone');
  assert.equal(after[away[1]].r, 0, 'the runner run is gone');
  assert.equal(after[away[4]].pa, 1, 'later plays stay');
  assert.ok(!(await playLog()).some((p) => p.id === hrPlay), 'not in the play log');
  await expectError(t.rpc(c, 'live_delete_play', { p_game_id: game.id, p_group_id: hrPlay }), /už byla vrácena/);

  // undo of the last play still works (counters are reverted relatively)
  await t.rpc(c, 'live_undo', { p_game_id: game.id, p_team_id: null });
  assert.equal((await box())[away[4]]?.pa ?? 0, 0);
  assert.deepEqual(await t.as('anon', CONSISTENCY), []);
  assert.deepEqual(await lineTotals(), await runsByTeam());
});

test('a deleted play comes back when the deletion is reverted', async () => {
  const [del] = await t.q(`select id from change_groups where action = 'live_delete_play' order by at desc limit 1`);
  await t.rpc(c, 'revert_change_group', { p_group_id: del.id, p_force: false });
  const b = await box();
  assert.equal(b[away[2]].hr, 1);
  assert.equal(b[away[2]].r, 1);
  assert.equal(b[away[1]].r, 1);
  assert.equal((await playLog()).filter((p) => p.result === 'HR').length, 1);
  assert.deepEqual(await lineTotals(), await runsByTeam());
});

test('rewind to a play reverts every later play; reverting the rewind brings them back', async () => {
  // finish the top of the 1st and play the bottom
  const s = await session(game.away_team_id);
  for (let i = s.outs; i < 3; i++) {
    const cur = await session(game.away_team_id);
    const runners = [1, 2, 3].filter((b) => cur[`runner_${b}`]).map((b) => ({ from: b, to: b }));
    await play(game.away_team_id, 'K', 0, runners);
  }
  await play(game.home_team_id, '1B', 1);
  const target = await lastPlayGroup();
  const stateAtTarget = await session(game.home_team_id);
  const boxAtTarget = await box();
  await play(game.home_team_id, '3B', 3, [{ from: 1, to: 4 }]);
  await play(game.home_team_id, 'SF', 0, [{ from: 3, to: 4 }]);
  const boxFull = await box();
  const logFull = (await playLog()).length;

  const n = await t.as<{ r: number }>('anon', `select public.live_rewind($1, $2, $3, $4) as r`, [game.id, target, c.actor, c.device], c.ip);
  assert.equal(n[0].r, 2);
  const now = await session(game.home_team_id);
  assert.deepEqual([now.inning, now.outs, now.runner_1, now.next_slot], [stateAtTarget.inning, stateAtTarget.outs, stateAtTarget.runner_1, stateAtTarget.next_slot]);
  assert.deepEqual(await box(), boxAtTarget);

  const [rw] = await t.q(`select id from change_groups where action = 'live_rewind' order by at desc limit 1`);
  await t.rpc(c, 'revert_change_group', { p_group_id: rw.id, p_force: false });
  assert.deepEqual(await box(), boxFull);
  assert.equal((await playLog()).length, logFull, 'plays are back in the log');
  await t.rpc(c, 'live_undo', { p_game_id: game.id, p_team_id: null });
  assert.equal((await box())[home[2]]?.sf ?? 0, 0, 'undo works after the redo');
  assert.deepEqual(await t.as('anon', CONSISTENCY), []);
});

test('editing a result is shown in the play log as edited', async () => {
  const [pa] = await t.q(`select * from plate_appearances where game_id = $1 and result = '3B' and deleted_at is null`, [game.id]);
  await t.rpc(c, 'update_plate_appearance', { p_id: pa.id, p_expected_version: pa.version, p_result: '2B', p_rbi: 1 });
  const p = (await playLog()).find((x) => x.paId === pa.id)!;
  assert.equal(p.result, '2B');
  assert.equal(p.edited, true);
});

test('final score override: admin only, revertable only by the admin', async () => {
  const set = (home: number | null, away: number | null, code = CODE) =>
    t.rpc(c, 'admin_set_score', { p_game_id: game.id, p_home_score: home, p_away_score: away, p_code: code });
  await expectError(set(5, 3, 'WRONGWRONGWRONG'), /Nesprávný kód/);
  await expectError(set(5, null), /obou týmů/);
  const row = await set(5, 3);
  assert.deepEqual([row.home_score, row.away_score], [5, 3]);
  await expectError(t.as('anon', `insert into game_score_overrides (game_id, home_score, away_score) values ($1, 1, 1)`, [game.id]), /permission denied/);

  const [g] = await t.q(`select id from change_groups where action = 'admin_set_score' order by at desc limit 1`);
  await expectError(t.rpc(c, 'revert_change_group', { p_group_id: g.id, p_force: false }), /jen správce/);
  await t.rpc(c, 'admin_revert_group', { p_group_id: g.id, p_code: CODE });
  const [o] = await t.q(`select * from game_score_overrides where game_id = $1`, [game.id]);
  assert.equal(o.home_score, null);
});

test('reset wipes the game; the administrator can restore it exactly', async () => {
  const boxBefore = await box();
  const logBefore = await playLog();
  const sessionsBefore = await t.q(`select team_id, inning, outs, runner_1, runner_2, runner_3, next_slot, finished from live_sessions where game_id = $1 order by team_id`, [game.id]);
  await t.rpc(c, 'admin_set_score', { p_game_id: game.id, p_home_score: 9, p_away_score: 9, p_code: CODE });

  await expectError(t.rpc(c, 'admin_reset_game', { p_game_id: game.id, p_code: 'nope-nope-nope' }), /Nesprávný kód/);
  await t.rpc(c, 'admin_reset_game', { p_game_id: game.id, p_code: CODE });
  assert.deepEqual(await box(), {}, 'no statistics left');
  assert.equal((await playLog()).length, 0, 'no plays left');
  const ss = await t.q(`select finished from live_sessions where game_id = $1`, [game.id]);
  assert.ok(ss.every((s) => s.finished));
  const [o] = await t.q(`select home_score from game_score_overrides where game_id = $1`, [game.id]);
  assert.equal(o.home_score, null);
  assert.deepEqual(await t.as('anon', CONSISTENCY), []);

  const [reset] = await t.q(`select id from change_groups where action = 'admin_reset_game' order by at desc limit 1`);
  await expectError(t.rpc(c, 'revert_change_group', { p_group_id: reset.id, p_force: false }), /jen správce/);
  await t.rpc(c, 'admin_revert_group', { p_group_id: reset.id, p_code: CODE });
  assert.deepEqual(await box(), boxBefore);
  assert.deepEqual((await playLog()).map((p) => p.id), logBefore.map((p) => p.id));
  const sessionsAfter = await t.q(`select team_id, inning, outs, runner_1, runner_2, runner_3, next_slot, finished from live_sessions where game_id = $1 order by team_id`, [game.id]);
  assert.deepEqual(sessionsAfter, sessionsBefore);
  const [o2] = await t.q(`select home_score from game_score_overrides where game_id = $1`, [game.id]);
  assert.equal(o2.home_score, 9);
  assert.deepEqual(await t.as('anon', CONSISTENCY), []);
  assert.deepEqual(await lineTotals(), await runsByTeam());
});

test('admin code can be changed', async () => {
  await expectError(t.rpc(c, 'admin_change_code', { p_code: CODE, p_new_code: 'short' }), /12/);
  await t.rpc(c, 'admin_change_code', { p_code: CODE, p_new_code: 'NEWC-ODE1-2345-6789' });
  const check = (code: string) => t.as<{ r: string }>('anon', `select public.admin_check($1, $2) as r`, [code, c.device], c.ip).then((r) => r[0].r);
  assert.equal(await check('newc-ode1-2345-6789'), 'ok');
  assert.equal(await check(CODE), 'wrong');
});
