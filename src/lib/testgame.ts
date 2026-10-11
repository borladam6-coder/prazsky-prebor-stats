// The test game: two made-up teams in their own season (migration 006). Anyone can try
// live scoring there; it never shows up in the league table, statistics or game lists.

export const TEST_SEASON_ID = -1;
export const TEST_GAME_ID = -1;

export const isTestGame = (id: number | null | undefined) => id === TEST_GAME_ID;
export const isTestTeam = (id: number | null | undefined) => id != null && id < 0;
