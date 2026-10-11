// Taking plays back restores the exact state before them (migration 007).
// Run: npm run test:undo

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, expectError, CONSISTENCY, type Caller, type Row } from './harness.ts';
import { buildPlays, lineScore, type CurrentPas } from '../src/lib/plays.ts';

let t: Awaited<ReturnType<typeof createDb>>;
let c: Caller;
const G = -1; // the test game: fresh for every test
const TEAM = -2;
let order: string[];

async function session(): Promise<Row> {
  return (await t.q(`select * from live_sessions where game_id = $1 and team_id = $2`, [G, TEAM]))[0];
}
const state = (s: Row) => ({ inning: s.inning, outs: s.outs, r1: s.runner_1, r2: s.runner_2, r3: s.runner_3, up: s.next_slot });

async function play(result: string | null, batterTo: number | null, runners: unknown[] = []) {
  const s = await session();
  return t.rpc(c, 'live_play', {
    p_game_id: G, p_team_id: TEAM, p_expected_version: s.version,
    p_result: result, p_batter_to: batterTo, p_runners: JSON.stringify(runners), p_rbi: null
  });
}

async function latest(): Promise<string> {
  const [g] = await t.q(`select private.latest_play($1, null) id`, [G]);
  return g.id;
}

async function box(): Promise<Record<string, Row>> {
  const rows = await t.q(`select player_id, pa::int, h::int, r::int, rbi::int, sb::int from player_game_batting where game_id = $1`, [G]);
  return Object.fromEntries(rows.map((r) => [r.player_id, r]));
}

async function consistent() {
  assert.deepEqual(await t.as('anon', CONSISTENCY), []);
  const entries = await t.as('anon', `select id, group_id, table_name, action, old_data, new_data, is_derived from change_log
    where game_id = $1 and table_name in ('live_sessions','plate_appearances','game_player_extras','live_run_adjustments') order by id`, [G]);
  const ids = [...new Set(entries.filter((e) => ['live_sessions', 'live_run_adjustments'].includes(e.table_name)).map((e) => e.group_id))];
  const groups = await t.as('anon', `select id, at::text, action, actor_name, reverted_by_group_id from change_groups where id = any($1::uuid[])`, [ids]);
  const pas = await t.q(`select id, result, rbi from plate_appearances where game_id = $1 and deleted_at is null`, [G]);
  const current: CurrentPas = new Map(pas.map((p) => [p.id, { result: p.result, rbi: p.rbi, deleted: false }]));
  const line = lineScore(buildPlays(groups as any, entries.filter((e) => ids.includes(e.group_id)) as any, current));
  const lineRuns = [...(line.get(TEAM) ?? [])].reduce((a, x) => a + x, 0);
  const [{ r }] = await t.q(`select coalesce(sum(r), 0)::int r from player_game_batting where game_id = $1 and team_id = $2`, [G, TEAM]);
  assert.equal(lineRuns, r, 'line score = runs in the box score');
}

beforeEach(async () => {
  t ??= await createDb();
  if (!c) {
    await t.importFixture();
    c = t.newCaller('Zpět');
    order = (await t.q(`select id from players where team_id = $1 order by jersey_number limit 9`, [TEAM])).map((p) => p.id);
  }
  await t.rpc(c, 'test_reset_game', {});
  await t.rpc(c, 'live_start', { p_game_id: G, p_team_id: TEAM, p_lineup: order });
});

test('the reported case: double, double, triple, single – deleting the single', async () => {
  await play('2B', 2);                                    // Dan on 2nd
  await play('2B', 2, [{ from: 2, to: 4 }]);              // Karel on 2nd, Dan scores
  await play('3B', 3, [{ from: 2, to: 4 }]);              // Sváťa on 3rd, Karel scores
  const before = state(await session());
  const boxBefore = await box();
  await play('1B', 1, [{ from: 3, to: 3 }]);              // Pavel on 1st, Sváťa stays
  await t.rpc(c, 'live_delete_play', { p_game_id: G, p_group_id: await latest() });
  assert.deepEqual(state(await session()), before, 'Sváťa on 3rd, Pavel up again');
  assert.deepEqual(await box(), boxBefore);
  // and undo keeps working
  await t.rpc(c, 'live_undo', { p_game_id: G, p_team_id: null });
  const s = await session();
  assert.equal(s.runner_3, null);
  assert.equal(s.runner_2, order[1], 'Karel back on 2nd before the triple');
  await consistent();
});

test('a runner who scored on the deleted single is back on 3rd', async () => {
  await play('3B', 3);
  const before = state(await session());
  await play('1B', 1, [{ from: 3, to: 4 }]);
  assert.equal((await box())[order[0]].r, 1);
  await t.rpc(c, 'live_delete_play', { p_game_id: G, p_group_id: await latest() });
  assert.deepEqual(state(await session()), before);
  assert.equal((await box())[order[0]]?.r ?? 0, 0);
  await consistent();
});

test('undo works after the play was corrected (result, substitution, run correction)', async () => {
  await play('1B', 1);
  const before = state(await session());
  await play('2B', 2, [{ from: 1, to: 4 }]);
  const [pa] = await t.q(`select * from plate_appearances where game_id = $1 and deleted_at is null order by created_at desc limit 1`, [G]);
  await t.rpc(c, 'update_plate_appearance', { p_id: pa.id, p_expected_version: pa.version, p_result: '3B', p_rbi: null });
  const s = await session();
  const bench = (await t.q(`select id from players where team_id = $1 order by jersey_number offset 9 limit 1`, [TEAM]))[0].id;
  await t.rpc(c, 'live_set_lineup', {
    p_game_id: G, p_team_id: TEAM, p_expected_version: s.version, p_lineup: [...order.slice(0, 8), bench], p_next_slot: null
  });
  await t.rpc(c, 'live_adjust_runs', { p_game_id: G, p_team_id: TEAM, p_inning: 1, p_player_id: order[0], p_delta: -1 });

  await t.rpc(c, 'live_undo', { p_game_id: G, p_team_id: null });
  assert.deepEqual(state(await session()), before, 'state before the double');
  const b = await box();
  assert.equal(b[order[1]]?.pa ?? 0, 0, 'the double/triple is gone');
  assert.equal(b[order[0]].r, 0, 'no negative runs');
  const [{ n }] = await t.q(`select count(*)::int n from live_run_adjustments where game_id = $1 and not cancelled`, [G]);
  assert.equal(n, 0, 'the run correction went with the run');
  const [lu] = await t.q(`select players from live_lineups where game_id = $1 and team_id = $2`, [G, TEAM]);
  assert.equal(lu.players[8], bench, 'the substitution stays');
  await consistent();
});

test('an older play: "delete from here" takes it and every later play back', async () => {
  await play('1B', 1);
  const before = state(await session());
  await play('BB', 1, [{ from: 1, to: 2 }]);
  const walk = await latest();
  await play('HR', 4, [{ from: 2, to: 4 }, { from: 1, to: 4 }]);
  await expectError(t.rpc(c, 'live_delete_play', { p_game_id: G, p_group_id: walk }), /jen poslední akci/);
  const n = await t.rpc(c, 'live_delete_from', { p_game_id: G, p_group_id: walk });
  assert.equal(n, 2);
  assert.deepEqual(state(await session()), before);
  const b = await box();
  assert.equal(Object.values(b).reduce((a, r) => a + r.pa, 0), 1, 'only the single remains');
  assert.equal(Object.values(b).reduce((a, r) => a + r.r, 0), 0);
  await consistent();
});

test('the third out taken back: same inning, same outs, same runners', async () => {
  await play('1B', 1);
  await play('K', 0, [{ from: 1, to: 1 }]);
  await play('K', 0, [{ from: 1, to: 1 }]);
  const before = state(await session());
  await play('OUT', 0, [{ from: 1, to: 2 }]);
  assert.equal((await session()).inning, 2);
  await t.rpc(c, 'live_delete_play', { p_game_id: G, p_group_id: await latest() });
  assert.deepEqual(state(await session()), before);
  await consistent();
});

test('a stolen base taken back puts the runner back', async () => {
  await play('1B', 1);
  const before = state(await session());
  await play(null, null, [{ from: 1, to: 2, sb: true }]);
  assert.equal((await box())[order[0]].sb, 1);
  await t.rpc(c, 'live_undo', { p_game_id: G, p_team_id: null });
  assert.deepEqual(state(await session()), before);
  assert.equal((await box())[order[0]].sb, 0);
  await consistent();
});

test('fixing the last play after the game keeps the scoring finished', async () => {
  await play('1B', 1);
  await play('HR', 4, [{ from: 1, to: 4 }]);
  const s = await session();
  await t.rpc(c, 'live_finish', { p_game_id: G, p_team_id: TEAM, p_expected_version: s.version, p_finished: true });
  await t.rpc(c, 'live_delete_play', { p_game_id: G, p_group_id: await latest() });
  const after = await session();
  assert.equal(after.finished, true);
  assert.equal(after.runner_1, order[0]);
  await consistent();
});

test('play details are kept for the play-by-play (once, with the runners as they were)', async () => {
  await play('1B', 1);
  const s = await session();
  const id = crypto.randomUUID();
  const args = {
    p_client_id: id, p_game_id: G, p_team_id: TEAM, p_expected_version: s.version,
    p_result: 'OUT', p_batter_to: 0, p_runners: JSON.stringify([{ from: 1, to: 0 }]), p_rbi: null,
    p_kind: 'dp', p_location: 'SS'
  };
  await t.rpc(c, 'live_play_detailed', args);
  await t.rpc(c, 'live_play_detailed', args); // sent twice
  const rows = await t.as('anon', `select * from live_play_details where game_id = $1 order by created_at`, [G]);
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { kind: rows[0].kind, location: rows[0].location, batter: rows[0].batter_id, outs: rows[0].outs_before, runners: rows[0].runners },
    { kind: 'dp', location: 'SS', batter: order[1], outs: 0, runners: [{ from: 1, to: 0, sb: false, player: order[0] }] }
  );
  assert.equal((await session()).outs, 2);
  await expectError(t.rpc(c, 'live_play_detailed', { ...args, p_client_id: crypto.randomUUID(), p_kind: 'curve' }), /Neznámý druh/);
  // taken back: the play disappears from the play-by-play with its details
  await t.rpc(c, 'live_undo', { p_game_id: G, p_team_id: null });
  assert.equal((await session()).outs, 0);
  await consistent();
});
