// League reference data (season, teams, players, games, standings), loaded once
// and shared by every page. Small enough to keep in memory (≈ 200 players, ≈ 100 games).

import { supabase, configProblem } from './supabase.ts';
import type { Game, Player, Season, Standing, Team } from './types.ts';
import { TEST_GAME_ID, TEST_SEASON_ID } from './testgame.ts';
import { isoDay } from './format.ts';

/** Last loaded reference data, shown at once on the next visit while fresh data loads. */
const CACHE_KEY = 'pps.league.v1';
const CACHE_MAX_AGE = 7 * 24 * 3600_000;

interface Cached {
  at: number;
  season: Season;
  teams: Team[];
  players: Player[];
  games: Game[];
  standings: Standing[];
  test?: { teams: Team[]; players: Player[]; games: Game[] };
}

const PLAYER_COLS = 'id, season_id, team_id, name, jersey_number, source, active, version';
const GAME_COLS = 'id, season_id, game_number, starts_at, status, home_team_id, away_team_id, home_score, away_score, venue';

class League {
  season = $state<Season | null>(null);
  teams = $state<Team[]>([]);
  players = $state<Player[]>([]);
  games = $state<Game[]>([]);
  standings = $state<Standing[]>([]);
  /**
   * The test game with its two teams and players. Reachable by id (league.game(-1) …)
   * but never part of the lists above, so it stays out of tables, statistics and search.
   */
  test = $state<{ teams: Team[]; players: Player[]; games: Game[] }>({ teams: [], players: [], games: [] });
  /** game id → number of teams (0–2) with recorded batting stats */
  recorded = $state<Map<number, number>>(new Map());
  /** game id → team id → runs in our box score */
  recordedRuns = $state<Map<number, Map<number, number>>>(new Map());
  /** loadRecorded() has finished at least once */
  recordedLoaded = $state(false);
  status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  error = $state<string | null>(null);

  teamById = $derived(new Map([...this.teams, ...this.test.teams].map((t) => [t.id, t])));
  playerById = $derived(new Map([...this.players, ...this.test.players].map((p) => [p.id, p])));
  gameById = $derived(new Map([...this.games, ...this.test.games].map((g) => [g.id, g])));

  private pending: Promise<void> | null = null;

  /**
   * Loads everything once; later calls reuse the same promise. With data from the last
   * visit the site starts at once and the fresh data replaces it a moment later.
   */
  ensure(): Promise<void> {
    if (this.status === 'ready') return Promise.resolve();
    if (this.status === 'idle' && this.restore()) {
      this.status = 'ready';
      this.pending = this.load(true).catch(() => {});
      return Promise.resolve();
    }
    return (this.pending ??= this.load());
  }

  private restore(): boolean {
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return false;
      const c = JSON.parse(raw) as Cached;
      if (!c.season || Date.now() - c.at > CACHE_MAX_AGE) return false;
      this.season = c.season;
      this.teams = c.teams;
      this.players = c.players;
      this.games = c.games;
      this.standings = c.standings;
      if (c.test) this.test = c.test;
      return true;
    } catch {
      return false;
    }
  }

  private save() {
    try {
      const c: Cached = {
        at: Date.now(),
        season: $state.snapshot(this.season)!,
        teams: $state.snapshot(this.teams),
        players: $state.snapshot(this.players),
        games: $state.snapshot(this.games),
        standings: $state.snapshot(this.standings),
        test: $state.snapshot(this.test)
      };
      localStorage.setItem(CACHE_KEY, JSON.stringify(c));
    } catch {
      /* storage full or blocked: no cache, fine */
    }
  }

  /** `background`: data from the cache is already shown, a failure keeps it. */
  async load(background = false): Promise<void> {
    if (!background) this.status = 'loading';
    try {
      if (!supabase) throw new Error(configMessage());
      const { data: season, error } = await supabase
        .from('seasons')
        .select('id, year, name, imported_at')
        .eq('is_current', true)
        .maybeSingle();
      if (error) throw error;
      if (!season) throw new Error('V databázi zatím není žádná sezóna. Spusť v Netlify import (funkce import-league).');
      this.season = season;
      await Promise.all([this.loadTeams(), this.loadPlayers(), this.loadGames(), this.loadStandings(), this.loadTest()]);
      this.status = 'ready';
      this.error = null;
      this.save();
    } catch (e) {
      if (background) throw e;
      this.status = 'error';
      this.error = e instanceof Error ? e.message : String(e);
      this.pending = null;
      throw e;
    }
  }

  async loadTeams() {
    const { data, error } = await supabase!
      .from('season_teams')
      .select('teams(id, name, short_name, code, color, logo_url)')
      .eq('season_id', this.season!.id);
    if (error) throw error;
    this.teams = (data ?? [])
      .map((r) => r.teams as unknown as Team)
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, 'cs'));
  }

  async loadPlayers() {
    const { data, error } = await supabase!
      .from('players')
      .select(PLAYER_COLS)
      .eq('season_id', this.season!.id)
      .order('name');
    if (error) throw error;
    this.players = (data ?? []) as Player[];
  }

  async loadGames() {
    // games and the administrator's manual scores in parallel (one round trip less)
    const [{ data, error }, { data: overrides }] = await Promise.all([
      supabase!
        .from('games')
        .select(GAME_COLS)
        .eq('season_id', this.season!.id)
        .order('starts_at', { ascending: true, nullsFirst: false }),
      supabase!.from('game_score_overrides').select('game_id, home_score, away_score').not('home_score', 'is', null)
    ]);
    if (error) throw error;
    const games = (data ?? []) as Game[];
    // manual final score set by the administrator wins over the imported one
    const byGame = new Map((overrides ?? []).map((o) => [o.game_id as number, o]));
    this.games = games.map((g) => {
      const o = byGame.get(g.id);
      return o
        ? { ...g, home_score: o.home_score, away_score: o.away_score, imported_score: [g.home_score, g.away_score], score_override: true }
        : g;
    });
  }

  async loadStandings() {
    const { data, error } = await supabase!
      .from('standings')
      .select('team_id, position, games, wins, draws, losses, scratches, points, runs_for, runs_against')
      .eq('season_id', this.season!.id)
      .order('position', { ascending: true, nullsFirst: false });
    if (error) throw error;
    this.standings = (data ?? []) as Standing[];
  }

  /** The test game (optional: a database without migration 006 simply has none). */
  async loadTest() {
    const [teams, players, games] = await Promise.all([
      supabase!.from('season_teams').select('teams(id, name, short_name, code, color, logo_url)').eq('season_id', TEST_SEASON_ID),
      supabase!.from('players').select(PLAYER_COLS).eq('season_id', TEST_SEASON_ID).order('name'),
      supabase!.from('games').select(GAME_COLS).eq('id', TEST_GAME_ID)
    ]);
    if (teams.error || players.error || games.error) return;
    this.test = {
      teams: (teams.data ?? []).map((r) => r.teams as unknown as Team).filter(Boolean),
      players: (players.data ?? []) as Player[],
      games: (games.data ?? []) as Game[]
    };
  }

  /** Which games already have stats (refreshed on demand, cheap: ≤ 2 rows per game). */
  async loadRecorded() {
    if (!this.season) return;
    const { data, error } = await supabase!
      .from('team_game_batting')
      .select('game_id, team_id, r')
      .eq('season_id', this.season.id);
    if (error) throw error;
    const m = new Map<number, number>();
    const runs = new Map<number, Map<number, number>>();
    for (const r of data ?? []) {
      m.set(r.game_id, (m.get(r.game_id) ?? 0) + 1);
      if (!runs.has(r.game_id)) runs.set(r.game_id, new Map());
      runs.get(r.game_id)!.set(r.team_id, Number(r.r));
    }
    this.recorded = m;
    this.recordedRuns = runs;
    this.recordedLoaded = true;
  }

  /** Replaces or adds one player after a write (keeps the list sorted by name). */
  upsertPlayer(p: Player) {
    const sort = (list: Player[]) => list.sort((a, b) => a.name.localeCompare(b.name, 'cs'));
    if (p.season_id === TEST_SEASON_ID) {
      this.test = { ...this.test, players: sort([...this.test.players.filter((x) => x.id !== p.id), p]) };
      return;
    }
    this.players = sort([...this.players.filter((x) => x.id !== p.id), p]);
  }

  team(id: number | null | undefined) {
    return id == null ? undefined : this.teamById.get(id);
  }
  player(id: string | null | undefined) {
    return id == null ? undefined : this.playerById.get(id);
  }
  game(id: number | null | undefined) {
    return id == null ? undefined : this.gameById.get(id);
  }

  teamPlayers(teamId: number, includeInactive = false) {
    return [...this.players, ...this.test.players].filter((p) => p.team_id === teamId && (includeInactive || p.active));
  }

  /**
   * Teams whose runs in our box score differ from the result reported to softball.cz
   * (a forgotten run in the scoring, usually). Only a hint, nothing is changed.
   */
  scoreMismatch(g: Game, runs?: Map<number, number>): { teamId: number; ours: number; official: number }[] {
    const [home, away] = g.score_override && g.imported_score ? g.imported_score : [g.home_score, g.away_score];
    if (g.status !== 'played' || home == null || away == null) return [];
    const ours = runs ?? this.recordedRuns.get(g.id);
    if (!ours) return [];
    return [
      { teamId: g.home_team_id, official: home },
      { teamId: g.away_team_id, official: away }
    ]
      .filter((x) => ours.has(x.teamId) && ours.get(x.teamId) !== x.official)
      .map((x) => ({ ...x, ours: ours.get(x.teamId)! }));
  }

  /**
   * A game can be scored (live or by hand) from the morning of its game day (Prague time)
   * or once it is played; same rule as the database (migration 013).
   */
  isPlayable(g: Game) {
    if (g.status === 'cancelled' || g.status === 'canceled') return false;
    return g.status === 'played' || (g.starts_at !== null && isoDay(g.starts_at)! <= isoDay(new Date().toISOString())!);
  }

  playedGames = $derived(
    this.games
      .filter((g) => g.status === 'played')
      .sort((a, b) => (b.starts_at ?? '').localeCompare(a.starts_at ?? ''))
  );

  upcomingGames = $derived(
    this.games
      .filter((g) => g.status !== 'played' && g.starts_at && new Date(g.starts_at).getTime() > Date.now())
      .sort((a, b) => (a.starts_at ?? '').localeCompare(b.starts_at ?? ''))
  );
}

function configMessage() {
  switch (configProblem) {
    case 'bad-url':
      return 'Adresa databáze (PUBLIC_SUPABASE_URL) nemá správný tvar.';
    case 'secret-key':
      return 'Do prohlížeče se dostal tajný klíč. Web je zablokovaný, oprav proměnné v Netlify.';
    default:
      return 'Web nemá nastavené připojení k databázi.';
  }
}

export const league = new League();
