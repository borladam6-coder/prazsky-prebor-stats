// The test game: two made-up teams in their own season (migration 006). Anyone can try
// live scoring there; it never shows up in the league table, statistics or game lists.

export const TEST_SEASON_ID = -1;
export const TEST_GAME_ID = -1;

import { isoDay } from './format.ts';

export const isTestGame = (id: number | null | undefined) => id === TEST_GAME_ID;
export const isTestTeam = (id: number | null | undefined) => id != null && id < 0;

/**
 * The game day is over (Prague time): finished live scoring then reopens only with the
 * administrator's code (same rule as private.game_day_over in migration 011).
 */
export function gameDayOver(game: { id: number; starts_at: string | null } | undefined, now = new Date()): boolean {
  if (!game?.starts_at || isTestGame(game.id)) return false;
  return isoDay(game.starts_at)! < isoDay(now.toISOString())!;
}
