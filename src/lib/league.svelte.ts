// League reference data (season, teams, players, games, standings), loaded once
// and shared by every page. Small enough to keep in memory (≈ 200 players, ≈ 100 games).

import { supabase, configProblem } from './supabase.ts';
import type { Game, Player, Season, Standing, Team } from './types.ts';

const PLAYER_COLS = 'id, season_id, team_id, name, jersey_number, source, active, version';
const GAME_COLS = 'id, season_id, game_number, starts_at, status, home_team_id, away_team_id, home_score, away_score, venue';

class League {
  season = $state<Season | null>(null);
  teams = $state<Team[]>([]);
  players = $state<Player[]>([]);
  games = $state<Game[]>([]);
  standings = $state<Standing[]>([]);
  /** game id → number of teams (0–2) with recorded batting stats */
  recorded = $state<Map<number, number>>(new Map());
  status = $state<'idle' | 'loading' | 'ready' | 'error'>('idle');
  error = $state<string | null>(null);

  teamById = $derived(new Map(this.teams.map((t) => [t.id, t])));
  playerById = $derived(new Map(this.players.map((p) => [p.id, p])));
  gameById = $derived(new Map(this.games.map((g) => [g.id, g])));

  private pending: Promise<void> | null = null;

  /** Loads everything once; later calls reuse the same promise. */
  ensure(): Promise<void> {
    if (this.status === 'ready') return Promise.resolve();
    return (this.pending ??= this.load());
  }

  async load(): Promise<void> {
    this.status = 'loading';
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
      await Promise.all([this.loadTeams(), this.loadPlayers(), this.loadGames(), this.loadStandings()]);
      this.status = 'ready';
      this.error = null;
    } catch (e) {
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
    const { data, error } = await supabase!
      .from('games')
      .select(GAME_COLS)
      .eq('season_id', this.season!.id)
      .order('starts_at', { ascending: true, nullsFirst: false });
    if (error) throw error;
    this.games = (data ?? []) as Game[];
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

  /** Which games already have stats (refreshed on demand, cheap: ≤ 2 rows per game). */
  async loadRecorded() {
    if (!this.season) return;
    const { data, error } = await supabase!
      .from('team_game_batting')
      .select('game_id, team_id')
      .eq('season_id', this.season.id);
    if (error) throw error;
    const m = new Map<number, number>();
    for (const r of data ?? []) m.set(r.game_id, (m.get(r.game_id) ?? 0) + 1);
    this.recorded = m;
  }

  /** Replaces or adds one player after a write (keeps the list sorted by name). */
  upsertPlayer(p: Player) {
    const rest = this.players.filter((x) => x.id !== p.id);
    this.players = [...rest, p].sort((a, b) => a.name.localeCompare(b.name, 'cs'));
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
    return this.players.filter((p) => p.team_id === teamId && (includeInactive || p.active));
  }

  /** A game can receive statistics once it has been played (or its start time has passed). */
  isPlayable(g: Game) {
    if (g.status === 'cancelled' || g.status === 'canceled') return false;
    return g.status === 'played' || (g.starts_at !== null && new Date(g.starts_at).getTime() <= Date.now());
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
