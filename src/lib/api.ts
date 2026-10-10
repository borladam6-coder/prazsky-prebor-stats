// Data access. Reads go straight to tables/views (read-only for the public key);
// every write goes through a database function that validates it and records history.

import { supabase } from './supabase.ts';
import { identity } from './identity.svelte.ts';
import { admin } from './admin.svelte.ts';
import type {
  ChangeEntry, ChangeGroup, GameExtras, LiveLineup, LiveSession, PaResult, PlateAppearance, Player,
  PlayerGameLine, PlayerTotals, TeamGameLine, TeamTotals
} from './types.ts';
import type { Play } from './live.ts';
import { buildPlays, type CurrentPas, type LogEntry, type LogGroup, type PlayItem } from './plays.ts';

export class WriteCancelled extends Error {}

function db() {
  if (!supabase) throw new Error('Web nemá nastavené připojení k databázi.');
  return supabase;
}

/** Turns database/network errors into a short Czech message. */
export function errorMessage(e: unknown): string {
  if (e instanceof WriteCancelled) return 'Zrušeno.';
  const err = e as { message?: string; code?: string } | null;
  const msg = err?.message ?? String(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'Nepodařilo se spojit s databází. Zkontroluj připojení a zkus to znovu.';
  if (/violates check constraint/i.test(msg)) return 'Hodnota je mimo povolený rozsah.';
  return msg;
}

// ------------------------------------------------------------------ reads

export interface TotalsFilter {
  teamId?: number | null;
  gameId?: number | null;
  from?: string | null;
  to?: string | null;
  minPa?: number;
}

export async function battingTotals(seasonId: number, f: TotalsFilter = {}): Promise<PlayerTotals[]> {
  const { data, error } = await db().rpc('batting_totals', {
    p_season_id: seasonId,
    p_team_id: f.teamId ?? null,
    p_game_id: f.gameId ?? null,
    p_from: f.from || null,
    p_to: f.to || null,
    p_min_pa: f.minPa ?? 0
  });
  if (error) throw error;
  return (data ?? []) as PlayerTotals[];
}

export async function teamBattingTotals(seasonId: number, f: TotalsFilter = {}): Promise<TeamTotals[]> {
  const { data, error } = await db().rpc('team_batting_totals', {
    p_season_id: seasonId,
    p_team_id: f.teamId ?? null,
    p_game_id: f.gameId ?? null,
    p_from: f.from || null,
    p_to: f.to || null
  });
  if (error) throw error;
  return (data ?? []) as TeamTotals[];
}

export async function gameLines(gameId: number): Promise<PlayerGameLine[]> {
  const { data, error } = await db().from('player_game_batting').select('*').eq('game_id', gameId);
  if (error) throw error;
  return (data ?? []) as PlayerGameLine[];
}

export async function playerGameLog(playerId: string): Promise<PlayerGameLine[]> {
  const { data, error } = await db()
    .from('player_game_batting')
    .select('*')
    .eq('player_id', playerId)
    .order('starts_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlayerGameLine[];
}

export async function playerSeason(playerId: string): Promise<PlayerTotals | null> {
  const { data, error } = await db().from('player_season_batting').select('*').eq('player_id', playerId).maybeSingle();
  if (error) throw error;
  return (data as PlayerTotals | null) ?? null;
}

/** One row per team per game with recorded stats (≤ 2 per game, fine for the 1000-row API limit). */
export async function teamGameLines(seasonId: number): Promise<TeamGameLine[]> {
  const { data, error } = await db()
    .from('team_game_batting')
    .select('season_id, game_id, team_id, players, pa, ab, h, singles, doubles, triples, hr, tb, rbi, r, bb, k, hbp, sf, sh, sb, avg, obp, slg, ops')
    .eq('season_id', seasonId);
  if (error) throw error;
  return (data ?? []) as TeamGameLine[];
}

export async function gameEntries(gameId: number): Promise<{ pas: PlateAppearance[]; extras: GameExtras[] }> {
  const [pas, extras] = await Promise.all([
    db()
      .from('plate_appearances')
      .select('id, game_id, player_id, result, rbi, created_at, deleted_at, version')
      .eq('game_id', gameId)
      .is('deleted_at', null)
      .order('created_at'),
    db().from('game_player_extras').select('game_id, player_id, runs, stolen_bases, version').eq('game_id', gameId)
  ]);
  if (pas.error) throw pas.error;
  if (extras.error) throw extras.error;
  return { pas: (pas.data ?? []) as PlateAppearance[], extras: (extras.data ?? []) as GameExtras[] };
}

const LIVE_COLS = 'game_id, team_id, inning, outs, runner_1, runner_2, runner_3, next_slot, finished, started_at, updated_at, version';

/** Live sessions of one game (one per scoring team) with their lineups. */
export async function liveOfGame(gameId: number): Promise<{ sessions: LiveSession[]; lineups: LiveLineup[] }> {
  const [s, l] = await Promise.all([
    db().from('live_sessions').select(LIVE_COLS).eq('game_id', gameId),
    db().from('live_lineups').select('game_id, team_id, players, version').eq('game_id', gameId)
  ]);
  if (s.error) throw s.error;
  if (l.error) throw l.error;
  return { sessions: (s.data ?? []) as LiveSession[], lineups: (l.data ?? []) as LiveLineup[] };
}

/** A session counts as live while it is not finished and had a play in the last 4 hours. */
export const LIVE_STALE_MS = 4 * 3600_000;

export async function activeLive(): Promise<LiveSession[]> {
  const since = new Date(Date.now() - LIVE_STALE_MS).toISOString();
  const { data, error } = await db()
    .from('live_sessions')
    .select(LIVE_COLS)
    .eq('finished', false)
    .gt('updated_at', since)
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as LiveSession[];
}

/** Runs per team in one game (from the box score). */
export async function gameRuns(gameId: number): Promise<Map<number, number>> {
  const { data, error } = await db().from('team_game_batting').select('team_id, r').eq('game_id', gameId);
  if (error) throw error;
  return new Map((data ?? []).map((r) => [r.team_id as number, Number(r.r)]));
}

/** Play-by-play of the live scoring of one game (from the change history). */
export async function gamePlayLog(gameId: number, pas: PlateAppearance[] = []): Promise<PlayItem[]> {
  const { data: entries, error } = await db()
    .from('change_log')
    .select('id, group_id, table_name, action, old_data, new_data, is_derived')
    .eq('game_id', gameId)
    .in('table_name', ['live_sessions', 'plate_appearances', 'game_player_extras', 'live_run_adjustments'])
    .order('id')
    .limit(5000);
  if (error) throw error;
  const live = new Set(
    (entries ?? [])
      .filter((e) => e.table_name === 'live_sessions' || e.table_name === 'live_run_adjustments')
      .map((e) => e.group_id as string)
  );
  const ids = [...live];
  const groups: LogGroup[] = [];
  for (let i = 0; i < ids.length; i += 80) {
    const { data, error: e2 } = await db()
      .from('change_groups')
      .select('id, at, action, actor_name, reverted_by_group_id')
      .in('id', ids.slice(i, i + 80));
    if (e2) throw e2;
    groups.push(...((data ?? []) as LogGroup[]));
  }
  const current: CurrentPas = new Map(pas.map((p) => [p.id, { result: p.result, rbi: p.rbi, deleted: !!p.deleted_at }]));
  return buildPlays(groups, ((entries ?? []) as LogEntry[]).filter((e) => live.has(e.group_id)), current);
}

export interface HistoryPage {
  groups: ChangeGroup[];
  entries: ChangeEntry[];
}

/** Newest change groups, optionally only those touching one game. */
export async function history(opts: { before?: string; gameId?: number; limit?: number } = {}): Promise<HistoryPage> {
  const limit = opts.limit ?? 30;
  let groupIds: string[] | null = null;

  if (opts.gameId) {
    const { data, error } = await db()
      .from('change_log')
      .select('group_id')
      .eq('game_id', opts.gameId)
      .order('id', { ascending: false })
      .limit(500);
    if (error) throw error;
    groupIds = [...new Set((data ?? []).map((r) => r.group_id as string))];
    if (groupIds.length === 0) return { groups: [], entries: [] };
  }

  let q = db()
    .from('change_groups')
    .select('id, at, source, action, actor_name, reverts_group_id, reverted_by_group_id')
    .order('at', { ascending: false })
    .limit(limit);
  if (opts.before) q = q.lt('at', opts.before);
  if (groupIds) q = q.in('id', groupIds.slice(0, 200));
  const { data: groups, error } = await q;
  if (error) throw error;

  // Entries are needed only to describe web changes; imports are summarised by count.
  const webIds = (groups ?? []).filter((g) => g.source !== 'import').map((g) => g.id);
  let entries: ChangeEntry[] = [];
  if (webIds.length) {
    const { data, error: e2 } = await db()
      .from('change_log')
      .select('id, group_id, table_name, action, old_data, new_data, is_derived, game_id, player_id, team_id')
      .in('group_id', webIds)
      .order('id');
    if (e2) throw e2;
    entries = (data ?? []) as ChangeEntry[];
  }
  return { groups: (groups ?? []) as ChangeGroup[], entries };
}

// ------------------------------------------------------------------ writes

async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const actor = await identity.require();
  if (!actor) throw new WriteCancelled();
  const { data, error } = await db().rpc(fn, { ...args, p_actor: actor, p_device: identity.device });
  if (error) throw error;
  return data as T;
}

export const addPlateAppearance = (gameId: number, playerId: string, result: PaResult, rbi?: number) =>
  call<PlateAppearance>('add_plate_appearance', {
    p_game_id: gameId,
    p_player_id: playerId,
    p_result: result,
    ...(rbi === undefined ? {} : { p_rbi: rbi })
  });

export const updatePlateAppearance = (pa: PlateAppearance, change: { result?: PaResult; rbi?: number }) =>
  call<PlateAppearance>('update_plate_appearance', {
    p_id: pa.id,
    p_expected_version: pa.version,
    p_result: change.result ?? null,
    p_rbi: change.rbi ?? null
  });

export const deletePlateAppearance = (pa: PlateAppearance) =>
  call<PlateAppearance>('delete_plate_appearance', { p_id: pa.id, p_expected_version: pa.version });

export const bumpStat = (gameId: number, playerId: string, stat: 'runs' | 'stolen_bases', delta: 1 | -1) =>
  call<GameExtras>('bump_player_game_stat', { p_game_id: gameId, p_player_id: playerId, p_stat: stat, p_delta: delta });

export const addPlayer = (seasonId: number, teamId: number, name: string, jersey: number | null) =>
  call<Player>('add_player', { p_season_id: seasonId, p_team_id: teamId, p_name: name, p_jersey_number: jersey });

export const updatePlayer = (p: Player, name: string, jersey: number | null) =>
  call<Player>('update_player', { p_id: p.id, p_expected_version: p.version, p_name: name, p_jersey_number: jersey });

export const setPlayerActive = (p: Player, active: boolean) =>
  call<Player>('set_player_active', { p_id: p.id, p_expected_version: p.version, p_active: active });

export const revertGroup = (groupId: string) => call<string>('revert_change_group', { p_group_id: groupId });

// ------------------------------------------------------------------ live scoring

const live = (gameId: number, teamId: number) => ({ p_game_id: gameId, p_team_id: teamId });

export const liveStart = (gameId: number, teamId: number, lineup: string[]) =>
  call<LiveSession>('live_start', { ...live(gameId, teamId), p_lineup: lineup });

export const liveSetLineup = (s: LiveSession, lineup: string[], nextSlot: number | null = null) =>
  call<LiveSession>('live_set_lineup', {
    ...live(s.game_id, s.team_id), p_expected_version: s.version, p_lineup: lineup, p_next_slot: nextSlot
  });

export const liveSetState = (
  s: LiveSession,
  st: { inning: number; outs: number; bases: (string | null)[]; nextSlot: number }
) =>
  call<LiveSession>('live_set_state', {
    ...live(s.game_id, s.team_id),
    p_expected_version: s.version,
    p_inning: st.inning,
    p_outs: st.outs,
    p_runner_1: st.bases[0],
    p_runner_2: st.bases[1],
    p_runner_3: st.bases[2],
    p_next_slot: st.nextSlot
  });

export const liveFinish = (s: LiveSession, finished: boolean) =>
  call<LiveSession>('live_finish', { ...live(s.game_id, s.team_id), p_expected_version: s.version, p_finished: finished });

export const livePlay = (s: LiveSession, play: Play) =>
  call<LiveSession>('live_play', {
    ...live(s.game_id, s.team_id),
    p_expected_version: s.version,
    p_result: play.result,
    p_batter_to: play.batterTo,
    p_runners: play.runners,
    p_rbi: play.result ? play.rbi : null
  });

/** Undo the last play of this team, or with `wholeGame` the last play of the game (both teams scored). */
export const liveUndo = (s: LiveSession, wholeGame = false) =>
  call<LiveSession>('live_undo', { p_game_id: s.game_id, p_team_id: wholeGame ? null : s.team_id });

// ------------------------------------------------------------------ corrections of live scoring

export const liveDeletePlay = (gameId: number, groupId: string) =>
  call<string>('live_delete_play', { p_game_id: gameId, p_group_id: groupId });

/** Back to the state right after this play; returns the number of reverted plays. */
export const liveRewind = (gameId: number, groupId: string) =>
  call<number>('live_rewind', { p_game_id: gameId, p_group_id: groupId });

export const liveAdjustRuns = (gameId: number, teamId: number, inning: number, playerId: string, delta: 1 | -1) =>
  call('live_adjust_runs', {
    p_game_id: gameId, p_team_id: teamId, p_inning: inning, p_player_id: playerId, p_delta: delta
  });

// ------------------------------------------------------------------ administrator

async function adminCall<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  if (!admin.code) throw new Error('Nejdřív odemkni správu kódem správce.');
  try {
    return await call<T>(fn, { ...args, p_code: admin.code });
  } catch (e) {
    if (/Nesprávný kód správce/.test(errorMessage(e))) admin.forget();
    throw e;
  }
}

export const adminResetGame = (gameId: number) => adminCall<string>('admin_reset_game', { p_game_id: gameId });

export const adminSetScore = (gameId: number, home: number | null, away: number | null) =>
  adminCall('admin_set_score', { p_game_id: gameId, p_home_score: home, p_away_score: away });

export const adminRevertGroup = (groupId: string) => adminCall<string>('admin_revert_group', { p_group_id: groupId });

export const adminChangeCode = (newCode: string) => adminCall<boolean>('admin_change_code', { p_new_code: newCode });
