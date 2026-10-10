// Offline-safe plays and the lock of manual entry for live-scored teams (migration 005).
// Run: npm run test:offline

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, expectError, CONSISTENCY, type Caller, type Row } from './harness.ts';

let t: Awaited<ReturnType<typeof createDb>>;
let c: Caller;
let game: Row;
let home: string[];
let away: string[];

async function session(team: number): Promise<Row> {
  return (await t.q(`select * from live_sessions where game_id = $1 and team_id = $2`, [game.id, team]))[0];
}

const once = (id: string, s: Row, result: string | null, batterTo: number | null, runners: unknown[] = []) =>
  t.rpc(c, 'live_play_once', {
    p_client_id: id, p_game_id: s.game_id, p_team_id: s.team_id, p_expected_version: s.version,
    p_result: result, p_batter_to: batterTo, p_runners: JSON.stringify(runners), p_rbi: null
  });

before(async () => {
  t = await createDb();
  await t.importFixture();
  c = t.newCaller('Offline');
  [game] = await t.q(`select * from games where status = 'played' order by id limit 1`);
  home = (await t.q(`select id from players where team_id = $1 and active order by name limit 9`, [game.home_team_id])).map((p) => p.id);
  away = (await t.q(`select id from players where team_id = $1 and active order by name limit 9`, [game.away_team_id])).map((p) => p.id);
  await t.rpc(c, 'live_start', { p_game_id: game.id, p_team_id: game.away_team_id, p_lineup: away });
});

test('a play sent twice (lost answer) is applied once', async () => {
  const s0 = await session(game.away_team_id);
  const id = crypto.randomUUID();
  const a = await once(id, s0, '1B', 1);
  // the retry carries the old expected version; it must not fail and must not apply again
  const b = await once(id, s0, '1B', 1);
  assert.equal(b.version, a.version);
  assert.equal(b.runner_1, away[0]);
  const [{ n }] = await t.q(`select count(*)::int n from plate_appearances where game_id = $1 and deleted_at is null`, [game.id]);
  assert.equal(n, 1);
});

test('a queue of plays chains versions and keeps the database consistent', async () => {
  let s = await session(game.away_team_id);
  s = await once(crypto.randomUUID(), s, '2B', 2, [{ from: 1, to: 4 }]);
  s = await once(crypto.randomUUID(), s, 'K', 0, [{ from: 2, to: 2 }]);
  s = await once(crypto.randomUUID(), s, null, null, [{ from: 2, to: 3, sb: true }]);
  assert.equal(s.outs, 1);
  assert.equal(s.runner_3, away[1]);
  const [{ r }] = await t.q(`select sum(runs)::int r from game_player_extras where game_id = $1`, [game.id]);
  assert.equal(r, 1);
  assert.deepEqual(await t.q(CONSISTENCY), []);
});

test('a failed play frees its id, a stale version is a conflict', async () => {
  const s = await session(game.away_team_id);
  const id = crypto.randomUUID();
  await expectError(once(id, s, 'SF', 0, [{ from: 3, to: 3 }]), /aspoň jeden/);
  // same id, valid play now: the failed attempt did not consume it
  const ok = await once(id, s, 'SF', 0, [{ from: 3, to: 4 }]);
  assert.equal(ok.outs, 2);
  await expectError(once(crypto.randomUUID(), s, '1B', 1), /Mezitím zapsal někdo jiný/);
});

test('messages say "out", not "aut"', async () => {
  const s = await session(game.away_team_id);
  await expectError(once(crypto.randomUUID(), s, 'SH', 0), /méně než 2 outech/);
  await expectError(
    t.rpc(c, 'live_set_state', {
      p_game_id: game.id, p_team_id: game.away_team_id, p_expected_version: s.version,
      p_inning: 1, p_outs: 3, p_runner_1: null, p_runner_2: null, p_runner_3: null, p_next_slot: 0
    }),
    /Outy musí být 0–2/
  );
});

test('manual entry is locked for a live-scored team, free for the other one', async () => {
  await expectError(
    t.rpc(c, 'add_plate_appearance', { p_game_id: game.id, p_player_id: away[5], p_result: '1B' }),
    /živý zápis/
  );
  await expectError(
    t.rpc(c, 'bump_player_game_stat', { p_game_id: game.id, p_player_id: away[0], p_stat: 'runs', p_delta: 1 }),
    /živý zápis/
  );
  const [pa] = await t.q(`select * from plate_appearances where game_id = $1 and deleted_at is null limit 1`, [game.id]);
  await expectError(t.rpc(c, 'delete_plate_appearance', { p_id: pa.id, p_expected_version: pa.version }), /živý zápis/);

  // home team is not scored live: manual entry works
  const added = await t.rpc(c, 'add_plate_appearance', { p_game_id: game.id, p_player_id: home[0], p_result: 'HR' });
  assert.equal(added.rbi, 1);
  await t.rpc(c, 'bump_player_game_stat', { p_game_id: game.id, p_player_id: home[1], p_stat: 'stolen_bases', p_delta: 1 });

  // live corrections of the live team still work (edit of a result from the play-by-play)
  const fixed = await t.rpc(c, 'update_plate_appearance', { p_id: pa.id, p_expected_version: pa.version, p_result: '2B', p_rbi: null });
  assert.equal(fixed.result, '2B');
  assert.deepEqual(await t.q(CONSISTENCY), []);
});

test('only the RPC is public: the request table is not readable', async () => {
  await expectError(t.as('anon', `select * from private.live_requests`), /permission denied/);
});
