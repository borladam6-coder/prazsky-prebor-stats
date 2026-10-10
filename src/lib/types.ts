export interface Season {
  id: number;
  year: number;
  name: string;
  imported_at: string | null;
}

export interface Team {
  id: number;
  name: string;
  short_name: string | null;
  code: string;
  color: string;
  logo_url: string | null;
}

export interface Player {
  id: string;
  season_id: number;
  team_id: number;
  name: string;
  jersey_number: number | null;
  source: 'import' | 'manual';
  active: boolean;
  version: number;
}

export interface Game {
  id: number;
  season_id: number;
  game_number: number | null;
  starts_at: string | null;
  status: string;
  home_team_id: number;
  away_team_id: number;
  home_score: number | null;
  away_score: number | null;
  venue: string | null;
  /** final score set manually by the administrator (overrides the imported one) */
  score_override?: boolean;
  imported_score?: [number | null, number | null];
}

export interface Standing {
  team_id: number;
  position: number | null;
  games: number;
  wins: number;
  draws: number;
  losses: number;
  scratches: number;
  points: number;
  runs_for: number;
  runs_against: number;
}

/** Counting stats shared by every batting row (game line, season line, totals). */
export interface BattingCounts {
  pa: number;
  ab: number;
  h: number;
  singles: number;
  doubles: number;
  triples: number;
  hr: number;
  tb: number;
  rbi: number;
  r: number;
  bb: number;
  k: number;
  hbp: number;
  sf: number;
  sh: number;
  sb: number;
}

export interface BattingRates {
  avg: number | null;
  obp: number | null;
  slg: number | null;
  ops: number | null;
}

export interface PlayerTotals extends BattingCounts, BattingRates {
  season_id: number;
  team_id: number;
  player_id: string;
  games: number;
}

export interface TeamTotals extends BattingCounts, BattingRates {
  season_id: number;
  team_id: number;
  games: number;
}

export interface PlayerGameLine extends BattingCounts, BattingRates {
  season_id: number;
  game_id: number;
  starts_at: string | null;
  team_id: number;
  opponent_team_id: number;
  player_id: string;
}

export interface TeamGameLine extends BattingCounts, BattingRates {
  season_id: number;
  game_id: number;
  team_id: number;
  players: number;
}

export type PaResult = '1B' | '2B' | '3B' | 'HR' | 'BB' | 'HBP' | 'K' | 'OUT' | 'FC' | 'ROE' | 'SF' | 'SH';

export interface PlateAppearance {
  id: string;
  game_id: number;
  player_id: string;
  result: PaResult;
  rbi: number;
  created_at: string;
  deleted_at: string | null;
  version: number;
}

export interface GameExtras {
  game_id: number;
  player_id: string;
  runs: number;
  stolen_bases: number;
  version: number;
}

export interface ChangeGroup {
  id: string;
  at: string;
  source: 'web' | 'import' | 'admin';
  action: string;
  actor_name: string | null;
  reverts_group_id: string | null;
  reverted_by_group_id: string | null;
}

export interface ChangeEntry {
  id: number;
  group_id: string;
  table_name:
    | 'players' | 'plate_appearances' | 'game_player_extras' | 'live_lineups' | 'live_sessions'
    | 'live_run_adjustments' | 'game_score_overrides';
  action: 'insert' | 'update' | 'delete' | 'restore';
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown>;
  is_derived: boolean;
  game_id: number | null;
  player_id: string | null;
  team_id: number | null;
}

/** Live scoring state of one team in one game. */
export interface LiveSession {
  game_id: number;
  team_id: number;
  inning: number;
  outs: number;
  runner_1: string | null;
  runner_2: string | null;
  runner_3: string | null;
  next_slot: number;
  finished: boolean;
  started_at: string;
  updated_at: string;
  version: number;
}

export interface LiveLineup {
  game_id: number;
  team_id: number;
  players: string[];
  version: number;
}
