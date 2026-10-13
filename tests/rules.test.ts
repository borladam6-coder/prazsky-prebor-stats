// Game-day scoring, catcher's interference, dropped third strike, runs on the third out,
// tie-breaker runner (migration 013), out after a hit (014), runner reasons and
// interference (015). Run: npm run test:rules

import { test, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, expectError, CONSISTENCY, type Caller, type Row } from './harness.ts';

let t: Awaited<ReturnType<typeof createDb>>;
let c: Caller;
const G = -1;
const TEAM = -2;
let order: string[];

const session = async (): Promise<Row> => (await t.q(`select * from live_sessions where game_id = $1 and team_id = $2`, [G, TEAM]))[0];

async function play(result: string | null, batterTo: number | null, runners: unknown[] = [], kind: string | null = null) {
  const s = await session();
  return t.rpc(c, 'live_play_detailed', {
    p_client_id: crypto.randomUUID(), p_game_id: G, p_team_id: TEAM, p_expected_version: s.version,
    p_result: result, p_batter_to: batterTo, p_runners: JSON.stringify(runners), p_rbi: null, p_kind: kind, p_location: null
  });
}
async function state(inning: number, outs: number, bases: (string | null)[], nextSlot = 0) {
  const s = await session();
  await t.rpc(c, 'live_set_state', {
    p_game_id: G, p_team_id: TEAM, p_expected_version: s.version, p_inning: inning, p_outs: outs,
    p_runner_1: bases[0], p_runner_2: bases[1], p_runner_3: bases[2], p_next_slot: nextSlot
  });
}

before(async () => {
  t = await createDb();
  await t.importFixture();
  c = t.newCaller('Pravidla');
  order = (await t.q(`select id from players where team_id = $1 order by jersey_number limit 9`, [TEAM])).map((p) => p.id);
});
beforeEach(async () => {
  await t.rpc(c, 'test_reset_game', {});
  await t.rpc(c, 'live_start', { p_game_id: G, p_team_id: TEAM, p_lineup: order });
});

test('scoring opens on the game day, not at the start time', async () => {
  const [g] = await t.q(`select * from games where id > 0 order by id limit 1`);
  const [p] = await t.q(`select id from players where team_id = $1 limit 1`, [g.home_team_id]);
  await t.q(`update games set status = 'scheduled', starts_at = now() + interval '1 day' where id = $1`, [g.id]);
  await expectError(t.rpc(c, 'add_plate_appearance', { p_game_id: g.id, p_player_id: p.id, p_result: '1B' }), /od dne zápasu/);
  await expectError(t.rpc(c, 'live_start', { p_game_id: g.id, p_team_id: g.home_team_id, p_lineup: [p.id] }), /od dne zápasu/);
  // later today (the morning of the game day): both work
  await t.q(`update games set starts_at = date_trunc('day', now() at time zone 'Europe/Prague') at time zone 'Europe/Prague' + interval '23 hours 30 minutes' where id = $1`, [g.id]);
  await t.rpc(c, 'add_plate_appearance', { p_game_id: g.id, p_player_id: p.id, p_result: '1B' });
});

test("catcher's interference: a plate appearance, not an at-bat", async () => {
  await play('CI', 1);
  const [l] = await t.q(`select pa::int, ab::int from player_game_batting where game_id = $1 and player_id = $2`, [G, order[0]]);
  assert.deepEqual(l, { pa: 1, ab: 0 });
  assert.equal((await session()).runner_1, order[0]);
  assert.deepEqual(await t.as('anon', CONSISTENCY), []);
});

test('dropped third strike: only with first base empty or two outs', async () => {
  await state(1, 0, [order[5], null, null], 0);
  await expectError(play('K', 1, [{ from: 1, to: 2 }]), /dropped third strike/);
  await state(1, 2, [order[5], null, null], 0);
  await play('K', 1, [{ from: 1, to: 2 }]);
  assert.equal((await session()).runner_1, order[0]);
});

test('runs on the third out: never on a batter out or a force out, yes on a time play', async () => {
  // ground out for the third out, runner from third crosses: no run
  await state(1, 2, [null, null, order[6]], 0);
  await expectError(play('OUT', 0, [{ from: 3, to: 4 }]), /run nepočítá/);
  // single, runner from first forced out at second for the third out: no run
  await state(1, 2, [order[5], null, order[6]], 0);
  await expectError(play('1B', 1, [{ from: 1, to: 0 }, { from: 3, to: 4 }]), /run nepočítá/);
  // single, runner from second thrown out at home after the runner from third scored: counts
  await state(1, 2, [null, order[5], order[6]], 0);
  await play('1B', 1, [{ from: 2, to: 0 }, { from: 3, to: 4 }]);
  const [{ r }] = await t.q(`select coalesce(sum(r), 0)::int r from player_game_batting where game_id = $1`, [G]);
  assert.equal(r, 1);
  assert.equal((await session()).inning, 2);
});

test('tie-breaker: from the 8th inning the last batter starts on second; undo removes him', async () => {
  await state(7, 2, [null, null, null], 3);
  await play('K', 0);
  const s = await session();
  assert.equal(s.inning, 8);
  assert.equal(s.runner_2, order[3], 'the batter who made the last out');
  assert.equal(s.runner_1, null);
  await play('1B', 1, [{ from: 2, to: 4 }]);
  const [{ r }] = await t.q(`select r::int from player_game_batting where game_id = $1 and player_id = $2`, [G, order[3]]);
  assert.equal(r, 1, 'his run counts');
  await t.rpc(c, 'live_undo', { p_game_id: G, p_team_id: null });
  await t.rpc(c, 'live_undo', { p_game_id: G, p_team_id: null });
  const back = await session();
  assert.deepEqual([back.inning, back.outs, back.runner_2], [7, 2, null]);
  assert.deepEqual(await t.as('anon', CONSISTENCY), []);
});

test('a hit with the batter out trying for one more base; the reason he got further', async () => {
  await state(1, 2, [null, order[5], null], 0);
  // single, run scores, batter tagged out at second for the third out: hit, out, run counts
  await play('1B', 0, [{ from: 2, to: 4 }]);
  const [l] = await t.q(`select pa::int, ab::int, h::int from player_game_batting where game_id = $1 and player_id = $2`, [G, order[0]]);
  assert.deepEqual(l, { pa: 1, ab: 1, h: 1 });
  const [{ r }] = await t.q(`select coalesce(sum(r), 0)::int r from player_game_batting where game_id = $1`, [G]);
  assert.equal(r, 1);
  assert.equal((await session()).inning, 2);
  // single and to second on an error
  const s = await session();
  await t.rpc(c, 'live_play_detailed', {
    p_client_id: crypto.randomUUID(), p_game_id: G, p_team_id: TEAM, p_expected_version: s.version,
    p_result: '1B', p_batter_to: 2, p_runners: '[]', p_rbi: null, p_kind: null, p_location: null, p_batter_extra: 'error'
  });
  const [d] = await t.q(`select result, batter_to, batter_extra from live_play_details where game_id = $1 order by created_at desc limit 1`, [G]);
  assert.deepEqual(d, { result: '1B', batter_to: 2, batter_extra: 'error' });
  assert.deepEqual(await t.as('anon', CONSISTENCY), []);
});

const lastRunners = async () =>
  (await t.q(`select runners from live_play_details where game_id = $1 order by created_at desc limit 1`, [G]))[0].runners as Row[];
const batting = async (player: string) =>
  (await t.q(`select coalesce(sum(pa), 0)::int pa, coalesce(sum(ab), 0)::int ab, coalesce(sum(h), 0)::int h, coalesce(sum(sb), 0)::int sb
              from player_game_batting where game_id = $1 and player_id = $2`, [G, player]))[0];

test('runner reasons: SB counts, WP and PB do not; CS and pickoff only on an out', async () => {
  await state(1, 0, [order[5], null, order[6]], 0);
  await play(null, null, [{ from: 1, to: 2, sb: false, why: 'wp' }, { from: 3, to: 4, sb: false, why: 'pb' }]);
  assert.equal((await batting(order[5])).sb, 0, 'a wild pitch is no stolen base');
  assert.deepEqual((await lastRunners()).map((r) => r.why), ['wp', 'pb']);
  await play(null, null, [{ from: 2, to: 3, sb: true, why: 'sb' }]);
  assert.equal((await batting(order[5])).sb, 1);
  await play(null, null, [{ from: 3, to: 0, why: 'po' }]);
  assert.equal((await lastRunners())[0].why, 'po');
  assert.equal((await session()).outs, 1);

  await state(1, 0, [order[5], null, null], 0);
  await expectError(play(null, null, [{ from: 1, to: 2, sb: true, why: 'wp' }]), /nesouhlasí/);
  await expectError(play(null, null, [{ from: 1, to: 0, why: 'wp' }]), /jen u postupu/);
  await expectError(play(null, null, [{ from: 1, to: 2, why: 'cs' }]), /jen u outu/);
  await expectError(play('1B', 1, [{ from: 1, to: 2, why: 'wp' }]), /mimo odpal/);
  await expectError(play(null, null, [{ from: 1, to: 2, why: 'xx' }]), /Neznámý důvod/);
  // without a reason (older pages) still works and is stored as null
  await play(null, null, [{ from: 1, to: 2 }]);
  assert.equal((await lastRunners())[0].why, null);
  assert.deepEqual(await t.as('anon', CONSISTENCY), []);
});

test('runner interference: hit by the ball is a single, hindering a fielder an FC', async () => {
  await state(1, 0, [order[5], null, null], 0);
  await play('1B', 1, [{ from: 1, to: 0, why: 'int' }], 'rhit');
  assert.deepEqual(await batting(order[0]), { pa: 1, ab: 1, h: 1, sb: 0 });
  const s = await session();
  assert.deepEqual([s.outs, s.runner_1], [1, order[0]]);
  await play('FC', 1, [{ from: 1, to: 0, why: 'int' }], 'rint');
  assert.deepEqual(await batting(order[1]), { pa: 1, ab: 1, h: 0, sb: 0 });

  await expectError(play('FC', 1, [{ from: 1, to: 0, why: 'int' }], 'rhit'), /interference běžce/);
  await expectError(play('1B', 2, [{ from: 1, to: 0, why: 'int' }], 'rhit'), /interference běžce/);
  await expectError(play('1B', 1, [{ from: 1, to: 2 }], 'rhit'), /interference běžce/);
  await expectError(play('1B', 1, [{ from: 1, to: 0, why: 'int' }], null), /jen u outu běžce při odpalu/);

  // third out by interference: a run does not count
  await state(1, 2, [order[5], null, order[6]], 3);
  await expectError(play('1B', 1, [{ from: 1, to: 0, why: 'int' }, { from: 3, to: 4 }], 'rhit'), /run nepočítá/);
  await play('1B', 1, [{ from: 1, to: 0, why: 'int' }, { from: 3, to: 3 }], 'rhit');
  assert.equal((await session()).inning, 2);
  assert.deepEqual(await t.as('anon', CONSISTENCY), []);
});

test('a double or a triple does not end on a lower base', async () => {
  await state(1, 0, [null, null, null], 0);
  await expectError(play('2B', 1), /nemůže skončit/);
  await expectError(play('3B', 2), /nemůže skončit/);
  await play('2B', 0);
  assert.equal((await session()).outs, 1);
});
