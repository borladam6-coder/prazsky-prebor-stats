// Client for the public JSON API behind softball.cz (verified 2026-10-09).
//
// Endpoints used:
//   GET /api/external/infoblock/league/{leagueId}/detail?year={year}
//   GET /api/external/infoblock/league/{leagueId}/{year}/schedule
//   GET /api/external/infoblock/league/{leagueId}/{year}/table
//   GET /api/external/roster/{teamId}/{seasonId}/players
//
// The API also returns personal data (birth dates, user ids, club addresses,
// bank accounts). `normalize*` functions keep only what the app is allowed to
// store: team names, game data, standings, player name + jersey number.

export const API_BASE = 'https://softball.cz/api/external';

export interface SeasonPayload {
  id: number;
  league_id: number;
  year: number;
  name: string;
}

export interface TeamPayload {
  id: number;
  name: string;
  short_name: string | null;
  code: string;
  logo_url: string | null;
}

export interface GamePayload {
  id: number;
  game_number: number | null;
  starts_at: string | null;
  status: string;
  home_team_id: number;
  away_team_id: number;
  home_score: number | null;
  away_score: number | null;
  venue: string | null;
}

export interface StandingPayload {
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

export interface RosterPayload {
  team_id: number;
  players: { external_id: number; name: string; jersey_number: number | null }[];
}

export interface ImportPayload {
  season: SeasonPayload;
  teams: TeamPayload[];
  games: GamePayload[];
  standings: StandingPayload[];
  rosters: RosterPayload[];
}

export class SourceFormatError extends Error {}

// ---------------------------------------------------------------- helpers

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function req<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new SourceFormatError(`Missing ${what}`);
  return value;
}

function int(v: unknown, what: string): number {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n)) throw new SourceFormatError(`Expected integer for ${what}, got ${JSON.stringify(v)}`);
  return n;
}

function optInt(v: unknown, what: string): number | null {
  return v === null || v === undefined || v === '' ? null : int(v, what);
}

function text(v: unknown, what: string): string {
  if (typeof v !== 'string' || v.trim() === '') throw new SourceFormatError(`Expected text for ${what}`);
  return v.replace(/\s+/g, ' ').trim();
}

function optText(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.replace(/\s+/g, ' ').trim() : null;
}

// Team logos are hosted by the association; accept only that host over https.
function logoUrl(v: unknown): string | null {
  const url = optText(v);
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname === 'management.softball.cz' ? u.toString() : null;
  } catch {
    return null;
  }
}

function data(body: unknown, what: string): unknown {
  if (!isObject(body) || !('data' in body)) throw new SourceFormatError(`Unexpected response shape for ${what}`);
  return body.data;
}

function arr(v: unknown, what: string): unknown[] {
  if (!Array.isArray(v)) throw new SourceFormatError(`Expected array for ${what}`);
  return v;
}

// ---------------------------------------------------------------- normalization

export function normalizeDetail(body: unknown, leagueId: number, year: number): { season: SeasonPayload; teams: TeamPayload[] } {
  const d = data(body, 'league detail');
  if (!isObject(d)) throw new SourceFormatError('League detail is not an object');

  const seasons = arr(d.seasons, 'seasons').filter(isObject);
  const season = seasons.find((s) => String(s.year) === String(year));
  const seasonId = season ? int(season.id, 'season.id') : int(d.current_season_id, 'current_season_id');
  if (!season && String(d.current_season_year) !== String(year)) {
    throw new SourceFormatError(`Season ${year} not found for league ${leagueId}`);
  }

  const teams = arr(d.current_season_teams, 'current_season_teams').filter(isObject).map((t) => ({
    id: int(t.id, 'team.id'),
    name: text(t.name, 'team.name'),
    short_name: optText(t.name_short),
    code: optText(t.shortcut) ?? text(t.name, 'team.name').slice(0, 12),
    logo_url: logoUrl(t.logo_url)
  }));
  if (teams.length === 0) throw new SourceFormatError('No teams in season');

  return {
    season: {
      id: seasonId,
      league_id: int(d.id ?? leagueId, 'league.id'),
      year,
      name: text(season?.name ?? d.name, 'season.name')
    },
    teams
  };
}

function teamFromGame(t: unknown, what: string): TeamPayload {
  if (!isObject(t)) throw new SourceFormatError(`Missing ${what}`);
  return {
    id: int(t.id, `${what}.id`),
    name: text(t.name, `${what}.name`),
    short_name: optText(t.name_short),
    code: optText(t.shortcut) ?? text(t.name, `${what}.name`).slice(0, 12),
    logo_url: logoUrl(t.logo_url)
  };
}

export function normalizeSchedule(body: unknown): { games: GamePayload[]; teams: TeamPayload[] } {
  const rows = arr(data(body, 'schedule'), 'schedule').filter(isObject);
  const teams = new Map<number, TeamPayload>();
  const games = rows.map((g) => {
    const home = teamFromGame(g.team_home, 'team_home');
    const away = teamFromGame(g.team_away, 'team_away');
    teams.set(home.id, home);
    teams.set(away.id, away);

    // `start` is often empty for played games; `planning_date` is always filled. Both are UTC.
    const startsAt = optText(g.start) ?? optText(g.planning_date);
    if (startsAt && Number.isNaN(Date.parse(startsAt))) throw new SourceFormatError(`Bad date ${startsAt}`);

    const playground = isObject(g.playground) ? g.playground : null;
    const ground = playground && isObject(playground.ground) ? playground.ground : null;

    return {
      id: int(g.id, 'game.id'),
      game_number: optInt(g.game_number, 'game.game_number'),
      starts_at: startsAt,
      status: text(g.status, 'game.status').toLowerCase(),
      home_team_id: home.id,
      away_team_id: away.id,
      home_score: optInt(g.team_home_score, 'game.team_home_score'),
      away_score: optInt(g.team_away_score, 'game.team_away_score'),
      venue: optText(ground?.name) ?? optText(playground?.name)
    };
  });
  return { games, teams: [...teams.values()] };
}

export function normalizeTable(body: unknown): StandingPayload[] {
  const rows = arr(data(body, 'table'), 'table').filter(isObject);
  return rows.map((r) => ({
    team_id: int(r.team_id, 'table.team_id'),
    position: optInt(r.position, 'table.position'),
    games: int(r.games ?? 0, 'table.games'),
    wins: int(r.wins ?? 0, 'table.wins'),
    draws: int(r.draws ?? 0, 'table.draws'),
    losses: int(r.losses ?? 0, 'table.losses'),
    scratches: int(r.scratches ?? 0, 'table.scratches'),
    points: int(r.points ?? 0, 'table.points'),
    runs_for: int(r.points_for ?? 0, 'table.points_for'),
    runs_against: int(r.points_against ?? 0, 'table.points_against')
  }));
}

export function normalizeRoster(teamId: number, body: unknown): RosterPayload {
  const rows = arr(body, 'roster').filter(isObject);
  const seen = new Set<number>();
  const players: RosterPayload['players'] = [];
  for (const p of rows) {
    if (p.crossed_at) continue; // struck from the roster at softball.cz
    const id = int(p.id, 'roster.id');
    if (seen.has(id)) continue;
    const name = optText(p.full_name_revert);
    if (!name || name.length < 2 || name.length > 60) continue;
    let jersey = optInt(p.dress_number, 'roster.dress_number');
    if (jersey !== null && (jersey < 0 || jersey > 99)) jersey = null;
    seen.add(id);
    // Only these three fields leave this function. Birth date, user id etc. are dropped here.
    players.push({ external_id: id, name, jersey_number: jersey });
  }
  return { team_id: teamId, players };
}

// ---------------------------------------------------------------- fetching

export type JsonGetter = (url: string) => Promise<unknown>;

export async function getJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const res = await fetch(url, {
    headers: {
      accept: 'application/json',
      'user-agent': 'prazsky-prebor-stats (community stats site; daily import)'
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return res.json();
}

export interface FetchResult {
  payload: ImportPayload;
  warnings: string[];
}

export async function fetchSeason(
  leagueId: number,
  year: number,
  get: JsonGetter = (url) => getJson(url),
  base = API_BASE
): Promise<FetchResult> {
  const warnings: string[] = [];
  const [detailBody, scheduleBody, tableBody] = await Promise.all([
    get(`${base}/infoblock/league/${leagueId}/detail?year=${year}`),
    get(`${base}/infoblock/league/${leagueId}/${year}/schedule`),
    get(`${base}/infoblock/league/${leagueId}/${year}/table`)
  ]);

  const { season, teams: seasonTeams } = normalizeDetail(detailBody, leagueId, year);
  const { games, teams: gameTeams } = normalizeSchedule(scheduleBody);

  // Teams = season participants + any team that appears in the schedule.
  // The league detail has no logos, the schedule does: merge and keep any logo found.
  const teams = new Map<number, TeamPayload>();
  for (const t of [...gameTeams, ...seasonTeams]) {
    const prev = teams.get(t.id);
    teams.set(t.id, { ...t, logo_url: t.logo_url ?? prev?.logo_url ?? null });
  }

  const standings = normalizeTable(tableBody).filter((s) => {
    if (teams.has(s.team_id)) return true;
    warnings.push(`Standing row for unknown team ${s.team_id} skipped`);
    return false;
  });

  const rosterTeamIds = seasonTeams.map((t) => t.id);
  const rosterResults = await Promise.allSettled(
    rosterTeamIds.map(async (teamId) =>
      normalizeRoster(teamId, await get(`${base}/roster/${teamId}/${season.id}/players`))
    )
  );
  const rosters: RosterPayload[] = [];
  rosterResults.forEach((r, i) => {
    if (r.status === 'fulfilled') rosters.push(r.value);
    else warnings.push(`Roster ${rosterTeamIds[i]} skipped: ${String(r.reason)}`);
  });

  req(season.id, 'season id');
  return { payload: { season, teams: [...teams.values()], games, standings, rosters }, warnings };
}
