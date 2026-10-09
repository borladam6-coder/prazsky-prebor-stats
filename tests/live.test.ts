// Live scoring in the database: lineup, plays, runners, outs, innings, undo.
// Run: npm run test:live

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { createDb, expectError, CONSISTENCY, type Caller, type Row } from './harness.ts';
import { defaultPlay, validatePlay, applyPlay, occupied, type Bases, type LiveState, type Play } from '../src/lib/live.ts';
import type { PaResult } from '../src/lib/types.ts';

let t: Awaited<ReturnType<typeof createDb>>;
let c: Caller;
let game: Row;
let other: Row; // a game the team does not play
let lineup: string[];
let bench: string[];
let opponent: string;

interface PlayArgs {
  result?: string | null;
  batterTo?: number | null;
  runners?: { from: number; to: number; sb?: boolean }[];
  rbi?: number | null;
}

async function session(): Promise<Row> {
  const [s] = await t.q(`select * from live_sessions where game_id = $1 and team_id = $2`, [game.id, game.home_team_id]);
  return s;
}

async function play(a: PlayArgs, version?: number) {
  const s = await session();
  return t.rpc(c, 'live_play', {
    p_game_id: game.id,
    p_team_id: game.home_team_id,
    p_expected_version: version ?? s.version,
    p_result: a.result ?? null,
    p_batter_to: a.batterTo ?? null,
    p_runners: JSON.stringify(a.runners ?? []),
    p_rbi: a.rbi ?? null
  });
}

const undo = () => t.rpc(c, 'live_undo', { p_game_id: game.id, p_team_id: game.home_team_id });

async function line(player: string): Promise<Row> {
  const [l] = await t.q(`select * from player_game_batting where game_id = $1 and player_id = $2`, [game.id, player]);
  return l ?? { pa: 0, h: 0, rbi: 0, r: 0, sb: 0 };
}

const bases = (s: Row) => [s.runner_1, s.runner_2, s.runner_3];

before(async () => {
  t = await createDb();
  await t.importFixture();
  c = t.newCaller('Zapisovatel');
  [game] = await t.q(`select * from games where status = 'played' order by id limit 1`);
  [other] = await t.q(
    `select * from games where status = 'played' and $1 not in (home_team_id, away_team_id) order by id limit 1`,
    [game.home_team_id]
  );
  const home = await t.q(`select id from players where team_id = $1 and active order by name`, [game.home_team_id]);
  lineup = home.slice(0, 9).map((p) => p.id);
  bench = home.slice(9).map((p) => p.id);
  [{ id: opponent }] = await t.q(`select id from players where team_id = $1 limit 1`, [game.away_team_id]);
});

test('live tables are read-only for the public key', async () => {
  await expectError(
    t.as('anon', `insert into live_lineups (game_id, team_id, players) values ($1, $2, $3)`, [game.id, game.home_team_id, lineup]),
    /permission denied/
  );
  await expectError(t.as('anon', `delete from live_sessions`), /permission denied/);
});

test('start validates the team and the lineup', async () => {
  const start = (g: number, team: number, l: string[]) =>
    t.rpc(c, 'live_start', { p_game_id: g, p_team_id: team, p_lineup: l });
  await expectError(start(other.id, game.home_team_id, lineup), /nehraje/);
  await expectError(start(game.id, game.home_team_id, [...lineup, opponent]), /nehraje za tento tým/);
  await expectError(start(game.id, game.home_team_id, [lineup[0], lineup[0]]), /dvakrát/);
  await expectError(start(game.id, game.home_team_id, []), /1–20/);

  const s = await start(game.id, game.home_team_id, lineup);
  assert.equal(s.inning, 1);
  assert.equal(s.outs, 0);
  assert.equal(s.next_slot, 0);
  await expectError(start(game.id, game.home_team_id, lineup), /už běží/);
});

test('four singles in a row score one run', async () => {
  for (let i = 0; i < 3; i++) {
    const s = await session();
    const runners = ([1, 2, 3] as const)
      .filter((b) => bases(s)[b - 1])
      .map((b) => ({ from: b, to: b + 1 }));
    await play({ result: '1B', batterTo: 1, runners });
  }
  let s = await session();
  assert.deepEqual(bases(s), [lineup[2], lineup[1], lineup[0]], 'bases loaded');

  await play({ result: '1B', batterTo: 1, runners: [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }] });
  s = await session();
  assert.deepEqual(bases(s), [lineup[3], lineup[2], lineup[1]]);
  assert.equal(s.next_slot, 4);
  assert.equal(s.outs, 0);
  assert.equal((await line(lineup[0])).r, 1, 'first batter scored');
  assert.equal((await line(lineup[3])).rbi, 1, 'default RBI = runs on the play');
  assert.equal((await line(lineup[3])).h, 1);
});

test('invalid plays are rejected', async () => {
  const s = await session();
  const all = (to: number[]) => [1, 2, 3].map((b, i) => ({ from: b, to: to[i] }));
  await expectError(play({ result: '1B', batterTo: 1, runners: all([2, 3, 3]) }), /dva běžci/);
  await expectError(play({ result: '1B', batterTo: 1, runners: [{ from: 1, to: 2 }] }), /Chybí, co se stalo/);
  await expectError(play({ result: '1B', batterTo: 1, runners: all([1, 2, 3]) }), /dva běžci/);
  await expectError(play({ result: '1B', batterTo: 2, runners: all([2, 3, 4]) }), /dva běžci/);
  await expectError(play({ result: '2B', batterTo: 2, runners: all([1, 4, 4]) }), /dva běžci|předběhnout/);
  await expectError(play({ result: '1B', batterTo: 1, runners: all([4, 3, 4]) }), /předběhnout/);
  await expectError(play({ result: 'HR', batterTo: 1, runners: all([4, 4, 4]) }), /nemůže skončit/);
  await expectError(play({ result: '1B', batterTo: 1, runners: all([2, 3, 4]), rbi: 2 }), /RBI/);
  await expectError(play({ result: 'SF', batterTo: 0, runners: all([1, 2, 3]) }), /aspoň jeden/);
  await expectError(play({ result: 'OUT', batterTo: 0, runners: [{ from: 1, to: 0 }, { from: 2, to: 1 }, { from: 3, to: 3 }] }), /couvat/);
  await expectError(play({ result: 'BB', batterTo: 1, runners: all([2, 3, 4]) }, s.version - 1), /Mezitím/);
  await expectError(play({ result: null, runners: all([1, 2, 3]) }), /neposunul/);
  await expectError(play({ result: null, runners: all([2, 3, 4]).map((r) => ({ ...r, sb: true })), rbi: 1 }), /RBI/);
  await expectError(play({ result: 'XX', batterTo: 1, runners: all([2, 3, 4]) }), /Neznámý/);
  assert.equal((await session()).version, s.version, 'nothing changed');
});

test('a double with the bases loaded clears second and third', async () => {
  await play({ result: '2B', batterTo: 2, runners: [{ from: 1, to: 3 }, { from: 2, to: 4 }, { from: 3, to: 4 }] });
  const s = await session();
  assert.deepEqual(bases(s), [null, lineup[4], lineup[3]]);
  assert.equal((await line(lineup[4])).rbi, 2);
  assert.equal((await line(lineup[4])).doubles, 1);
  assert.equal((await line(lineup[1])).r, 1);
  assert.equal((await line(lineup[2])).r, 1);
});

test('stolen base and a runner scoring without a hit', async () => {
  // runner on 2nd steals 3rd, runner on 3rd scores on the same play (e.g. wild throw)
  await play({ result: null, runners: [{ from: 2, to: 3, sb: true }, { from: 3, to: 4 }] });
  const s = await session();
  assert.deepEqual(bases(s), [null, null, lineup[4]]);
  assert.equal(s.next_slot, 5, 'runner-only play keeps the batter');
  assert.equal((await line(lineup[4])).sb, 1);
  assert.equal((await line(lineup[3])).r, 1);
  assert.equal((await line(lineup[3])).rbi, 1, 'no RBI added for a run without a batter');
});

test('home run: runners and batter score, batter run added automatically', async () => {
  await play({ result: 'HR', batterTo: 4, runners: [{ from: 3, to: 4 }] });
  const s = await session();
  assert.deepEqual(bases(s), [null, null, null]);
  const hr = await line(lineup[5]);
  assert.equal(hr.hr, 1);
  assert.equal(hr.r, 1, 'exactly one run for the batter');
  assert.equal(hr.rbi, 2);
  assert.equal((await line(lineup[4])).r, 1);
});

test('undo restores the previous play exactly', async () => {
  const before = await session();
  const runsBefore = (await line(lineup[6])).r;
  await play({ result: '3B', batterTo: 3, runners: [] });
  await undo();
  const after = await session();
  assert.deepEqual(
    { ...after, updated_at: null, version: null },
    { ...before, updated_at: null, version: null }
  );
  assert.equal((await line(lineup[6])).pa, 0);
  assert.equal((await line(lineup[6])).r, runsBefore);

  // undo the home run too: batter run, runner run and RBI disappear
  await undo();
  const s = await session();
  assert.deepEqual(bases(s), [null, null, lineup[4]]);
  assert.equal(s.next_slot, 5);
  assert.equal((await line(lineup[5])).pa, 0);
  assert.equal((await line(lineup[5])).r, 0);
  assert.equal((await line(lineup[4])).r, 0);

  // and play it again
  await play({ result: 'HR', batterTo: 4, runners: [{ from: 3, to: 4 }] });
  assert.equal((await line(lineup[5])).r, 1);
});

test('three outs end the inning and clear the bases', async () => {
  await play({ result: '1B', batterTo: 1, runners: [] }); // lineup[6] on first
  await play({ result: 'K', batterTo: 0, runners: [{ from: 1, to: 1 }] });
  await expectError(play({ result: 'SF', batterTo: 0, runners: [{ from: 1, to: 1 }] }), /aspoň jeden|méně než 2/);
  await play({ result: 'OUT', batterTo: 0, runners: [{ from: 1, to: 2 }] });
  let s = await session();
  assert.equal(s.outs, 2);
  await expectError(play({ result: 'SH', batterTo: 0, runners: [{ from: 2, to: 3 }] }), /méně než 2/);
  // fielder's choice: runner thrown out, inning over
  await play({ result: 'FC', batterTo: 1, runners: [{ from: 2, to: 0 }] });
  s = await session();
  assert.equal(s.inning, 2);
  assert.equal(s.outs, 0);
  assert.deepEqual(bases(s), [null, null, null]);
  assert.equal(s.next_slot, 1, 'lineup wrapped around');

  await undo();
  s = await session();
  assert.equal(s.inning, 1);
  assert.equal(s.outs, 2);
  assert.deepEqual(bases(s), [null, lineup[6], null]);
  await play({ result: 'FC', batterTo: 1, runners: [{ from: 2, to: 0 }] });
});

test('substitution keeps undo of the last play possible', async () => {
  await play({ result: 'BB', batterTo: 1, runners: [] }); // lineup[1] walks
  assert.equal((await line(lineup[1])).pa, 2);
  const s = await session();
  const changed = [...lineup];
  changed[8] = bench[0]; // pinch hitter for the 9th batter
  await t.rpc(c, 'live_set_lineup', {
    p_game_id: game.id, p_team_id: game.home_team_id, p_expected_version: s.version, p_lineup: changed, p_next_slot: null
  });
  const [l] = await t.q(`select players from live_lineups where game_id = $1`, [game.id]);
  assert.equal(l.players[8], bench[0]);
  await undo();
  assert.equal((await session()).runner_1, null, 'walk undone');
  assert.equal((await line(lineup[1])).pa, 1);
});

test('manual state correction, finish and reopen', async () => {
  let s = await session();
  await expectError(
    t.rpc(c, 'live_set_state', {
      p_game_id: game.id, p_team_id: game.home_team_id, p_expected_version: s.version,
      p_inning: 2, p_outs: 1, p_runner_1: opponent, p_runner_2: null, p_runner_3: null, p_next_slot: 3
    }),
    /nehraje za tento tým/
  );
  s = await t.rpc(c, 'live_set_state', {
    p_game_id: game.id, p_team_id: game.home_team_id, p_expected_version: s.version,
    p_inning: 3, p_outs: 1, p_runner_1: bench[1], p_runner_2: null, p_runner_3: null, p_next_slot: 2
  });
  assert.equal(s.inning, 3);
  // a pinch runner scores: the run belongs to him
  await play({ result: '3B', batterTo: 3, runners: [{ from: 1, to: 4 }] });
  assert.equal((await line(bench[1])).r, 1);
  assert.equal((await line(lineup[2])).triples, 1);

  s = await session();
  await t.rpc(c, 'live_finish', { p_game_id: game.id, p_team_id: game.home_team_id, p_expected_version: s.version, p_finished: true });
  await expectError(play({ result: 'K', batterTo: 0, runners: [{ from: 3, to: 3 }] }), /ukončený/);
  s = await session();
  await t.rpc(c, 'live_finish', { p_game_id: game.id, p_team_id: game.home_team_id, p_expected_version: s.version, p_finished: false });
  await play({ result: 'K', batterTo: 0, runners: [{ from: 3, to: 3 }] });
  assert.equal((await session()).outs, 2);
});

test('every play is one revertable history group', async () => {
  const groups = await t.q(`select action, count(*)::int n from change_groups where source = 'web' group by action order by action`);
  const byAction = Object.fromEntries(groups.map((g) => [g.action, g.n]));
  assert.ok(byAction.live_play >= 15);
  assert.equal(byAction.live_start, 1);

  // the latest play reverted from the history page = same as undo
  const [last] = await t.q(`select id from change_groups where action = 'live_play' and reverted_by_group_id is null order by at desc, id limit 1`);
  const [entries] = await t.q(`select array_agg(distinct table_name order by table_name) t from change_log where group_id = $1`, [last.id]);
  assert.deepEqual(entries.t, ['live_sessions', 'plate_appearances']);
  await t.rpc(c, 'revert_change_group', { p_group_id: last.id, p_force: false });
  assert.equal((await session()).outs, 1);
});

test('statistics stay consistent with the plays', async () => {
  const problems = await t.as('anon', CONSISTENCY);
  assert.deepEqual(problems, []);

  // runs in the box score = runs counted from the history of live plays
  const [box] = await t.q(`select sum(r)::int r, sum(rbi)::int rbi from player_game_batting where game_id = $1`, [game.id]);
  const [pas] = await t.q(`select count(*)::int n from plate_appearances where game_id = $1 and deleted_at is null`, [game.id]);
  assert.ok(box.r >= box.rbi, 'runs ≥ RBI (some runs had no RBI)');
  assert.ok(pas.n > 10);
});

test('simulation: browser logic and database agree play by play', async () => {
  const team = game.away_team_id;
  const players = (await t.q(`select id from players where team_id = $1 and active order by name`, [team])).map((p) => p.id);
  const order = players.slice(0, 12);
  const sim = t.newCaller('Simulace');
  await t.rpc(sim, 'live_start', { p_game_id: game.id, p_team_id: team, p_lineup: order });

  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const results: PaResult[] = ['1B', '1B', '1B', '2B', '3B', 'HR', 'BB', 'HBP', 'K', 'K', 'OUT', 'OUT', 'OUT', 'FC', 'ROE', 'SF', 'SH'];

  const read = async (): Promise<Row> =>
    (await t.q(`select * from live_sessions where game_id = $1 and team_id = $2`, [game.id, team]))[0];
  const toState = (s: Row): LiveState => ({ inning: s.inning, outs: s.outs, bases: [s.runner_1, s.runner_2, s.runner_3], nextSlot: s.next_slot });

  const stack: { play: Play; before: LiveState }[] = [];
  let undos = 0;
  for (let i = 0; i < 90; i++) {
    const s = await read();
    const state = toState(s);

    if (stack.length && rand() < 0.1) {
      await t.rpc(sim, 'live_undo', { p_game_id: game.id, p_team_id: team });
      const prev = stack.pop()!;
      assert.deepEqual(toState(await read()), prev.before, `undo ${i}`);
      undos++;
      continue;
    }

    let play: Play;
    const on = occupied(state.bases as Bases);
    if (on.length && rand() < 0.12) {
      // stolen base of the lead runner (steal home from third)
      const lead = on[on.length - 1];
      play = { result: null, batterTo: null, rbi: 0, runners: on.map((b) => ({ from: b, to: b === lead ? ((b + 1) as 2 | 3 | 4) : b, sb: b === lead })) };
    } else {
      play = defaultPlay(pick(results), state.bases as Bases, state.outs);
    }
    if (validatePlay(play, state.bases as Bases, state.outs)) continue; // e.g. SF without a runner on third

    await t.rpc(sim, 'live_play', {
      p_game_id: game.id, p_team_id: team, p_expected_version: s.version,
      p_result: play.result, p_batter_to: play.batterTo, p_runners: JSON.stringify(play.runners), p_rbi: play.rbi
    });
    const predicted = applyPlay(state, order, play);
    assert.deepEqual(toState(await read()), { inning: predicted.inning, outs: predicted.outs, bases: predicted.bases, nextSlot: predicted.nextSlot }, `play ${i}`);
    stack.push({ play, before: state });
  }
  assert.ok(undos > 3 && stack.length > 50);

  // expected box score from the surviving plays
  const exp = new Map<string, { pa: number; r: number; rbi: number; sb: number }>();
  const get = (id: string) => exp.get(id) ?? (exp.set(id, { pa: 0, r: 0, rbi: 0, sb: 0 }), exp.get(id)!);
  for (const { play, before } of stack) {
    for (const r of play.runners) {
      const id = before.bases[r.from - 1]!;
      if (r.to === 4) get(id).r++;
      if (r.sb) get(id).sb++;
    }
    if (play.result) {
      const batter = order[before.nextSlot];
      get(batter).pa++;
      get(batter).rbi += play.rbi;
      if (play.batterTo === 4) get(batter).r++;
    }
  }
  const box = await t.q(`select player_id, pa::int, r::int, rbi::int, sb::int from player_game_batting where game_id = $1 and team_id = $2`, [game.id, team]);
  const actual = Object.fromEntries(box.map((b) => [b.player_id, { pa: b.pa, r: b.r, rbi: b.rbi, sb: b.sb }]));
  const expected = Object.fromEntries([...exp].filter(([, v]) => v.pa || v.r || v.sb));
  assert.deepEqual(actual, expected);

  assert.deepEqual(await t.as('anon', CONSISTENCY), []);
});

test('both teams on one device: undo without a team reverts the latest play of the game', async () => {
  const [g2] = await t.q(`select * from games where status = 'played' and id <> $1 order by id desc limit 1`, [game.id]);
  const order = async (team: number) =>
    (await t.q(`select id from players where team_id = $1 and active order by name limit 9`, [team])).map((p) => p.id);
  const dual = t.newCaller('Oba týmy');
  await t.rpc(dual, 'live_start', { p_game_id: g2.id, p_team_id: g2.away_team_id, p_lineup: await order(g2.away_team_id) });
  await t.rpc(dual, 'live_start', { p_game_id: g2.id, p_team_id: g2.home_team_id, p_lineup: await order(g2.home_team_id) });

  const sess = async (team: number) =>
    (await t.q(`select * from live_sessions where game_id = $1 and team_id = $2`, [g2.id, team]))[0];
  const hit = async (team: number, result: string, batterTo: number, runners: unknown[] = []) => {
    const s = await sess(team);
    await t.rpc(dual, 'live_play', {
      p_game_id: g2.id, p_team_id: team, p_expected_version: s.version, p_result: result,
      p_batter_to: batterTo, p_runners: JSON.stringify(runners), p_rbi: null
    });
  };

  // top of the 1st: away makes three outs → inning 2 for away, home bats next
  await hit(g2.away_team_id, 'K', 0);
  await hit(g2.away_team_id, 'OUT', 0);
  await hit(g2.away_team_id, 'OUT', 0);
  assert.equal((await sess(g2.away_team_id)).inning, 2);
  assert.equal((await sess(g2.home_team_id)).inning, 1);
  await hit(g2.home_team_id, '1B', 1);

  const undoGame = () => t.rpc(dual, 'live_undo', { p_game_id: g2.id, p_team_id: null });
  let s = await undoGame();
  assert.equal(s.team_id, g2.home_team_id, 'home single undone first');
  assert.equal((await sess(g2.home_team_id)).runner_1, null);
  s = await undoGame();
  assert.equal(s.team_id, g2.away_team_id, 'then the third out of the away team');
  assert.equal(s.inning, 1);
  assert.equal(s.outs, 2);

  // undo for one team still only touches that team
  await hit(g2.home_team_id, '1B', 1);
  s = await t.rpc(dual, 'live_undo', { p_game_id: g2.id, p_team_id: g2.away_team_id });
  assert.equal(s.outs, 1);
  assert.ok((await sess(g2.home_team_id)).runner_1, 'home runner untouched');
  assert.deepEqual(await t.as('anon', CONSISTENCY), []);
});
