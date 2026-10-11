-- =============================================================================
-- Pražský přebor – statistiky
-- Migration 008: rosters from softball.cz only as a starting list
--
-- The scheduled import keeps the schedule, results and standings up to date. Players
-- are taken from softball.cz only once per team and season (when the team has no
-- players yet). After that the import never adds, renames or hides anybody: whoever
-- comes to a game can play and is added on the web.
--
-- Run once in Supabase → SQL Editor after 007. One transaction.
-- =============================================================================

begin;

create or replace function public.import_season(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_palette  constant text[] := array[
    '#E5484D', '#F76B15', '#FFC53D', '#46A758', '#12A594',
    '#0090FF', '#3E63DD', '#8E4EC6', '#D6409F', '#AD7F58'
  ];
  v_season   jsonb := p_payload -> 'season';
  v_season_id integer := (v_season ->> 'id')::integer;
  v_team     record;
  v_color    text;
  v_roster   jsonb;
  v_team_id  integer;
  v_ids      integer[];
  v_n        integer;
  v_teams    integer := 0;
  v_games    integer := 0;
  v_standings integer := 0;
  v_players_upserted integer := 0;
  v_players_removed  integer := 0;
begin
  if v_season_id is null then
    perform private.fail('Import: chybí sezóna.');
  end if;

  perform set_config('app.change_group', gen_random_uuid()::text, true);
  perform set_config('app.source', 'import', true);
  perform set_config('app.action', 'import', true);
  perform set_config('app.actor_name', 'Import softball.cz', true);
  perform set_config('app.device_hash', '', true);
  perform set_config('app.reverts_group', '', true);
  perform set_config('app.derived', 'off', true);

  -- season
  update public.seasons set is_current = false where is_current and id <> v_season_id;
  insert into public.seasons (id, league_id, year, name, is_current, imported_at)
  values (v_season_id, (v_season ->> 'league_id')::integer, (v_season ->> 'year')::integer,
          v_season ->> 'name', true, now())
  on conflict (id) do update
  set league_id = excluded.league_id, year = excluded.year, name = excluded.name,
      is_current = true, imported_at = now();

  -- teams (keep an existing color; give new teams the first unused palette color)
  for v_team in
    select * from jsonb_to_recordset(p_payload -> 'teams')
      as x(id integer, name text, short_name text, code text, logo_url text)
    order by id
  loop
    if exists (select 1 from public.teams where id = v_team.id) then
      update public.teams
      set name = v_team.name, short_name = v_team.short_name, code = v_team.code, logo_url = v_team.logo_url
      where id = v_team.id
        and (name, short_name, code, logo_url)
            is distinct from (v_team.name, v_team.short_name, v_team.code, v_team.logo_url);
    else
      select c into v_color
      from unnest(c_palette) with ordinality as u(c, i)
      where c not in (select color from public.teams)
      order by i
      limit 1;
      if v_color is null then
        select c_palette[(count(*) % array_length(c_palette, 1)) + 1] into v_color from public.teams;
      end if;
      insert into public.teams (id, name, short_name, code, color, logo_url)
      values (v_team.id, v_team.name, v_team.short_name, v_team.code, v_color, v_team.logo_url);
    end if;
    insert into public.season_teams (season_id, team_id) values (v_season_id, v_team.id)
    on conflict do nothing;
    v_teams := v_teams + 1;
  end loop;

  -- games
  insert into public.games
    (id, season_id, game_number, starts_at, status, home_team_id, away_team_id, home_score, away_score, venue)
  select x.id, v_season_id, x.game_number, x.starts_at, x.status, x.home_team_id, x.away_team_id,
         x.home_score, x.away_score, x.venue
  from jsonb_to_recordset(p_payload -> 'games') as x(
    id integer, game_number integer, starts_at timestamptz, status text,
    home_team_id integer, away_team_id integer, home_score smallint, away_score smallint, venue text)
  on conflict (id) do update
  set game_number  = excluded.game_number,
      starts_at    = excluded.starts_at,
      status       = excluded.status,
      home_team_id = excluded.home_team_id,
      away_team_id = excluded.away_team_id,
      home_score   = excluded.home_score,
      away_score   = excluded.away_score,
      venue        = excluded.venue,
      updated_at   = now()
  where (public.games.game_number, public.games.starts_at, public.games.status,
         public.games.home_team_id, public.games.away_team_id,
         public.games.home_score, public.games.away_score, public.games.venue)
        is distinct from
        (excluded.game_number, excluded.starts_at, excluded.status,
         excluded.home_team_id, excluded.away_team_id,
         excluded.home_score, excluded.away_score, excluded.venue);
  get diagnostics v_games = row_count;

  -- standings
  insert into public.standings
    (season_id, team_id, position, games, wins, draws, losses, scratches, points, runs_for, runs_against)
  select v_season_id, x.team_id, x.position, x.games, x.wins, x.draws, x.losses, x.scratches,
         x.points, x.runs_for, x.runs_against
  from jsonb_to_recordset(p_payload -> 'standings') as x(
    team_id integer, position smallint, games smallint, wins smallint, draws smallint,
    losses smallint, scratches smallint, points smallint, runs_for smallint, runs_against smallint)
  on conflict (season_id, team_id) do update
  set position = excluded.position, games = excluded.games, wins = excluded.wins,
      draws = excluded.draws, losses = excluded.losses, scratches = excluded.scratches,
      points = excluded.points, runs_for = excluded.runs_for, runs_against = excluded.runs_against,
      updated_at = now()
  where (public.standings.position, public.standings.games, public.standings.wins,
         public.standings.draws, public.standings.losses, public.standings.scratches,
         public.standings.points, public.standings.runs_for, public.standings.runs_against)
        is distinct from
        (excluded.position, excluded.games, excluded.wins, excluded.draws, excluded.losses,
         excluded.scratches, excluded.points, excluded.runs_for, excluded.runs_against);
  get diagnostics v_standings = row_count;

  -- rosters: only as a starting list. A team gets the players from softball.cz once, when
  -- it has no players in this season yet; after that the roster belongs to the web (anyone
  -- who comes can play), so the import never adds, renames or hides players again.
  for v_roster in select * from jsonb_array_elements(coalesce(p_payload -> 'rosters', '[]'::jsonb))
  loop
    v_team_id := (v_roster ->> 'team_id')::integer;
    continue when exists (select 1 from public.players where season_id = v_season_id and team_id = v_team_id);

    insert into public.players (season_id, team_id, name, jersey_number, source, external_id)
    select v_season_id, v_team_id, x.name, x.jersey_number, 'import', x.external_id
    from jsonb_to_recordset(v_roster -> 'players') as x(external_id integer, name text, jersey_number smallint)
    on conflict (external_id) do nothing;
    get diagnostics v_n = row_count;
    v_players_upserted := v_players_upserted + v_n;
  end loop;

  return jsonb_build_object(
    'season_id', v_season_id,
    'teams', v_teams,
    'games_changed', v_games,
    'standings_changed', v_standings,
    'players_changed', v_players_upserted,
    'players_removed', v_players_removed
  );
end;
$$;

commit;
