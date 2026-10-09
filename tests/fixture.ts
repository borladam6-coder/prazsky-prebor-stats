// Synthetic responses shaped exactly like the softball.cz API (structure verified 2026-10-09).
// Includes the personal fields the real API returns, so tests can prove they are dropped.

export const LEAGUE_ID = 13;
export const YEAR = 2026;
export const SEASON_ID = 1397;

// Fixed reference time so repeated imports produce identical data.
const FIXED_NOW = new Date();

export interface FixtureOptions {
  teams?: number;
  playersPerTeam?: number;
  renamed?: Record<number, string>;      // roster id → new name
  removedRosterIds?: number[];
  failingRosterTeamIds?: number[];
  now?: Date;
}

const club = (id: number) => ({
  id, name: `Klub ${id}`, name_short: `K${id}`, shortcut: `K${id}`, ground_id: 1, region_id: 1,
  post_street: 'Ulice 1', post_zip: '10000', post_city: 'Praha',
  invoice_street: 'Ulice 1', invoice_zip: '10000', invoice_city: 'Praha',
  ic: '12345678', bank_account: '123456789/0100', data_box: 'abc123', website: null, note: null, logo_id: null
});

export function teamIds(n: number): number[] {
  return [196, 129, 257, 41, 363, 603, 282, 125, 765, 225, 900, 901].slice(0, n);
}

export function rosterId(teamId: number, i: number): number {
  return teamId * 1000 + i;
}

export function buildApi(opts: FixtureOptions = {}) {
  const nTeams = opts.teams ?? 10;
  const nPlayers = opts.playersPerTeam ?? 14;
  const ids = teamIds(nTeams);
  const now = opts.now ?? FIXED_NOW;
  const team = (id: number, withLogo = false) => ({
    id, name: `Tým ${id}`, name_short: `T${id}`, shortcut: `T${id}`, club_id: id, club: club(id),
    note: null, logo_id: null,
    logo_url: withLogo ? (id === 129 ? 'https://evil.example.com/x.png' : `https://management.softball.cz/files/${id}/view`) : null
  });

  const detail = {
    message: 'ok',
    data: {
      id: LEAGUE_ID, name: 'Pražský přebor mužů', shortcut: 'PPM', slug: 'PPM',
      seasons: [
        { id: SEASON_ID, name: 'Pražský přebor mužů', year: String(YEAR), status: 'closed', gender: 'male' },
        { id: 1200, name: 'Pražský přebor mužů', year: '2025', status: 'closed', gender: 'male' }
      ],
      current_season_teams: ids.map((id) => team(id)),
      current_season_year: String(YEAR),
      current_season_id: SEASON_ID,
      applications: []
    }
  };

  // Round robin: every pair once. Games in the past are played, a few in the future are scheduled.
  const games: unknown[] = [];
  let gid = 169700;
  let n = 0;
  for (let a = 0; a < ids.length; a++) {
    for (let b = a + 1; b < ids.length; b++) {
      n++;
      const past = n % 9 !== 0;
      const when = new Date(now.getTime() + (past ? -1 : 1) * (n * 36e5 * 20));
      games.push({
        id: gid++, status: past ? 'played' : 'scheduled', type: 'league',
        planning_date: when.toISOString().replace('Z', '000Z'),
        start: past ? null : when.toISOString(),
        end: null,
        playground: { id: 1, name: 'Hřiště', ground: { name: 'Svoboda Park' } },
        team_home: team(ids[a], true), team_away: team(ids[b], true),
        team_home_score: past ? (n * 7) % 15 : null,
        team_away_score: past ? (n * 5) % 13 : null,
        game_number: n, description: 'Rozhodčí: Někdo, Někdo', play_url: null, note: null
      });
    }
  }

  const table = {
    message: 'ok',
    data: ids.map((id, i) => ({
      id: i + 1, team_id: id, team_name: `Tým ${id}`, basic_group: 'A', super_group: null, super_group2: null,
      games: 18, wins: 18 - i, draws: 0, losses: i, scratches: 0, points: (18 - i) * 2,
      points_for: 100 - i, points_against: 50 + i, position: i + 1,
      team: { id, shortcut: `T${id}` }, tournament: null
    }))
  };

  const rosters = new Map<number, unknown[]>();
  for (const id of ids) {
    const list: unknown[] = [];
    for (let i = 1; i <= nPlayers; i++) {
      const rid = rosterId(id, i);
      if (opts.removedRosterIds?.includes(rid)) continue;
      list.push({
        id: rid,
        full_name_revert: opts.renamed?.[rid] ?? `Příjmení${i} Jméno${id}`,
        dress_number: i === nPlayers ? null : i,
        expertise: { id: 1, name: 'UTL' },
        is_hosting: false, is_pickup: false, hosting_type: null, order: i, note: null,
        birth_date: '1990-01-01', user_id: 5000 + rid, approved_at: null, crossed_at: null,
        created_at: '2026-03-01T00:00:00.000000Z'
      });
    }
    rosters.set(id, list);
  }

  const get = async (url: string): Promise<unknown> => {
    const path = new URL(url).pathname + new URL(url).search;
    if (path.endsWith(`/league/${LEAGUE_ID}/detail?year=${YEAR}`)) return detail;
    if (path.endsWith(`/league/${LEAGUE_ID}/${YEAR}/schedule`)) return { message: 'ok', data: games };
    if (path.endsWith(`/league/${LEAGUE_ID}/${YEAR}/table`)) return table;
    const m = path.match(/\/roster\/(\d+)\/(\d+)\/players$/);
    if (m && Number(m[2]) === SEASON_ID) {
      const teamId = Number(m[1]);
      if (opts.failingRosterTeamIds?.includes(teamId)) throw new Error('HTTP 500');
      return rosters.get(teamId) ?? [];
    }
    throw new Error(`Unexpected URL ${url}`);
  };

  return { get, ids, games };
}
