// Data access. Reads go straight to tables/views (read-only for the public key);
// every write goes through a database function that validates it and records history.

import { supabase } from './supabase.ts';
import { identity } from './identity.svelte.ts';
import type {
  ChangeEntry, ChangeGroup, GameExtras, PaResult, PlateAppearance, Player,
  PlayerGameLine, PlayerTotals, TeamGameLine, TeamTotals
} from './types.ts';

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
