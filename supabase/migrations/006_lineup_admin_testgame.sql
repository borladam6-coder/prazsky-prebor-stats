-- =============================================================================
-- Pražský přebor – statistiky
-- Migration 006: batting order of 9 (or 10), short administrator code, test game
--
--   * Batting order: at most 10 batters (9 normally, 10 with an extra player).
--   * Administrator code: at least 4 letters or digits (was 8 to unlock, 12 to set).
--     The code itself is set separately (README), never in this file.
--   * Test game: two made-up teams in their own season (id -1), always open for
--     live scoring, outside every league table and statistic. Anyone can wipe it
--     with test_reset_game(); the import never touches it (other season, negative ids).
--
-- Run once in Supabase → SQL Editor after 005. One transaction.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Batting order: 1–10 players
-- -----------------------------------------------------------------------------
create or replace function private.check_lineup(p_game public.games, p_team_id integer, p_lineup uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid;
begin
  if p_lineup is null or cardinality(p_lineup) not between 1 and 10 then
    perform private.fail('Pořadí pálkařů musí mít 1–10 hráčů (9, s extra hráčem 10).');
  end if;
  if array_position(p_lineup, null) is not null then
    perform private.fail('V pořadí pálkařů je prázdné místo.');
  end if;
  if (select count(distinct x) from unnest(p_lineup) x) <> cardinality(p_lineup) then
    perform private.fail('Hráč je v pořadí pálkařů dvakrát.');
  end if;
  foreach v_player in array p_lineup loop
    perform private.assert_team_player(p_game, p_team_id, v_player);
  end loop;
  return p_lineup;
end;
$$;

-- -----------------------------------------------------------------------------
-- Administrator code: at least 4 characters
-- -----------------------------------------------------------------------------
create or replace function private.code_matches(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select s.admin_code_hash is not null
     and char_length(private.normalize_code(p_code)) >= 4
     and extensions.crypt(private.normalize_code(p_code), s.admin_code_hash) = s.admin_code_hash
  from private.settings s
$$;

create or replace function public.admin_change_code(p_code text, p_new_code text, p_actor text, p_device uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.begin_write('admin_change_code', p_actor, p_device);
  perform private.require_admin(p_code);
  if char_length(private.normalize_code(p_new_code)) < 4 then
    perform private.fail('Nový kód musí mít aspoň 4 písmena nebo číslice.');
  end if;
  update private.settings
  set admin_code_hash = extensions.crypt(private.normalize_code(p_new_code), extensions.gen_salt('bf', 8));
  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- Test game (season -1, teams -1 and -2, game -1)
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.seasons where id = -1) then
    return;
  end if;
  insert into public.seasons (id, league_id, year, name, is_current, imported_at)
  values (-1, 0, 2026, 'Testovací zápas', false, now());

  insert into public.teams (id, name, short_name, code, color) values
    (-1, 'Testovací Lvi', 'Lvi', 'LVI', '#D9902B'),
    (-2, 'Testovací Orli', 'Orli', 'ORL', '#3E7BD6');

  insert into public.season_teams (season_id, team_id) values (-1, -1), (-1, -2);

  insert into public.players (season_id, team_id, name, jersey_number, source, edited_manually)
  select -1, t.team_id, t.name, t.nr, 'manual', true
  from (values
    (-1, 'Pálka Petr', 1), (-1, 'Rychlý Radek', 2), (-1, 'Silný Standa', 3), (-1, 'Chytrý Čeněk', 4),
    (-1, 'Mrštný Martin', 5), (-1, 'Dlouhý David', 6), (-1, 'Bystrý Bořek', 7), (-1, 'Tichý Tomáš', 8),
    (-1, 'Veselý Vojta', 9), (-1, 'Hbitý Hugo', 10), (-1, 'Statný Šimon', 11), (-1, 'Malý Matěj', 12),
    (-2, 'Daleký Dan', 1), (-2, 'Pevný Pavel', 2), (-2, 'Skokan Sváťa', 3), (-2, 'Krátký Karel', 4),
    (-2, 'Mocný Milan', 5), (-2, 'Lehký Lukáš', 6), (-2, 'Ostrý Oldřich', 7), (-2, 'Prudký Patrik', 8),
    (-2, 'Hrdý Hynek', 9), (-2, 'Zručný Zdeněk', 10), (-2, 'Smělý Samuel', 11), (-2, 'Jistý Jakub', 12)
  ) as t(team_id, name, nr);

  -- "played" = always open for live scoring and for statistics entry
  insert into public.games (id, season_id, game_number, starts_at, status, home_team_id, away_team_id, venue)
  values (-1, -1, 0, '2026-01-01 18:00:00+01', 'played', -1, -2, 'Testovací hřiště');
end;
$$;

-- Wipes everything recorded in the test game (statistics, live scoring) so the next
-- person starts from scratch. Logged like any other change.
create function public.test_reset_game(p_actor text, p_device uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
begin
  v_group := private.begin_write('test_reset', p_actor, p_device);
  if not exists (select 1 from public.games where id = -1 and season_id = -1) then
    perform private.fail('Testovací zápas neexistuje.');
  end if;
  perform private.ensure_group();

  update public.plate_appearances set deleted_at = now() where game_id = -1 and deleted_at is null;
  update public.game_player_extras set runs = 0, stolen_bases = 0
  where game_id = -1 and (runs <> 0 or stolen_bases <> 0);
  update public.live_run_adjustments set cancelled = true where game_id = -1 and not cancelled;
  -- nothing is deleted (history): the sessions end and start again from the 1st inning;
  -- a finished session without any play is shown as "not started" on the web
  update public.live_sessions
  set finished = true, inning = 1, outs = 0, runner_1 = null, runner_2 = null, runner_3 = null, next_slot = 0
  where game_id = -1;
  update public.game_score_overrides set home_score = null, away_score = null
  where game_id = -1 and home_score is not null;

  -- the old play-by-play is not shown any more
  update public.change_groups g set reverted_by_group_id = v_group
  where g.reverted_by_group_id is null and g.id <> v_group
    and g.action in ('live_play', 'live_adjust')
    and exists (select 1 from public.change_log l where l.group_id = g.id and l.game_id = -1);
  return v_group;
end;
$$;

revoke all on all functions in schema private from public;
revoke all on function public.test_reset_game(text, uuid) from public, anon, authenticated;
grant execute on function public.test_reset_game(text, uuid) to anon, authenticated;

commit;
