-- =============================================================================
-- Pražský přebor – statistiky
-- Migration 002: live scoring (lineup, bases, outs, innings)
--
-- Run once in Supabase → SQL Editor after 001_init.sql. One transaction.
--
-- Model
--   * live_lineups  – batting order of one team in one game.
--   * live_sessions – where the inning stands: inning, outs, runners, next batter.
--   * live_play()   – one call per play. Writes the plate appearance, the runs and
--     stolen bases of the runners and the new game state in a single change group,
--     so "undo" is simply reverting that group.
--   * Statistics are still only plate_appearances + game_player_extras; the live
--     tables only hold the state needed to keep scoring.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
create table public.live_lineups (
  game_id    integer     not null references public.games (id),
  team_id    integer     not null references public.teams (id),
  players    uuid[]      not null check (cardinality(players) between 1 and 20 and array_position(players, null) is null),
  updated_at timestamptz not null default now(),
  version    integer     not null default 1,
  primary key (game_id, team_id)
);

create table public.live_sessions (
  game_id    integer     not null,
  team_id    integer     not null,
  inning     smallint    not null default 1 check (inning between 1 and 30),
  outs       smallint    not null default 0 check (outs between 0 and 2),
  runner_1   uuid references public.players (id),
  runner_2   uuid references public.players (id),
  runner_3   uuid references public.players (id),
  next_slot  smallint    not null default 0 check (next_slot between 0 and 19),
  finished   boolean     not null default false,
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer     not null default 1,
  primary key (game_id, team_id),
  foreign key (game_id, team_id) references public.live_lineups (game_id, team_id),
  check (runner_1 is null or (runner_1 is distinct from runner_2 and runner_1 is distinct from runner_3)),
  check (runner_2 is null or runner_2 is distinct from runner_3)
);
create index live_sessions_updated on public.live_sessions (updated_at desc) where not finished;

create trigger live_lineups_touch before update on public.live_lineups
  for each row execute function private.touch_row();
create trigger live_sessions_touch before update on public.live_sessions
  for each row execute function private.touch_row();

create trigger live_lineups_no_delete before delete on public.live_lineups
  for each row execute function private.forbid_delete();
create trigger live_sessions_no_delete before delete on public.live_sessions
  for each row execute function private.forbid_delete();

-- -----------------------------------------------------------------------------
-- History: log the live tables too
-- -----------------------------------------------------------------------------
alter table public.change_log drop constraint change_log_table_name_check;
alter table public.change_log add constraint change_log_table_name_check
  check (table_name in ('players', 'plate_appearances', 'game_player_extras', 'live_lineups', 'live_sessions'));

create or replace function private.log_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old    jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  v_new    jsonb := to_jsonb(new);
  v_action text := lower(tg_op);
  v_group  uuid;
  v_player uuid;
  v_team   integer;
  v_season integer;
  v_row_id text;
begin
  if tg_op = 'UPDATE' and (v_old - 'updated_at' - 'version') = (v_new - 'updated_at' - 'version') then
    return null;
  end if;

  if tg_table_name in ('plate_appearances', 'players') and tg_op = 'UPDATE' then
    if v_old ? 'deleted_at' and (v_old ->> 'deleted_at') is null and (v_new ->> 'deleted_at') is not null then
      v_action := 'delete';
    elsif v_old ? 'deleted_at' and (v_old ->> 'deleted_at') is not null and (v_new ->> 'deleted_at') is null then
      v_action := 'restore';
    end if;
  end if;

  if tg_table_name in ('live_lineups', 'live_sessions') then
    v_row_id := (v_new ->> 'game_id') || ':' || (v_new ->> 'team_id');
    v_team := (v_new ->> 'team_id')::integer;
    select g.season_id into v_season from public.games g where g.id = (v_new ->> 'game_id')::integer;
  else
    if tg_table_name = 'players' then
      v_player := (v_new ->> 'id')::uuid;
      v_row_id := v_new ->> 'id';
    elsif tg_table_name = 'plate_appearances' then
      v_player := (v_new ->> 'player_id')::uuid;
      v_row_id := v_new ->> 'id';
    else
      v_player := (v_new ->> 'player_id')::uuid;
      v_row_id := (v_new ->> 'game_id') || ':' || (v_new ->> 'player_id');
    end if;
    select p.team_id, p.season_id into v_team, v_season from public.players p where p.id = v_player;
  end if;

  v_group := private.ensure_group();

  insert into public.change_log
    (group_id, table_name, row_id, action, old_data, new_data, is_derived, season_id, team_id, game_id, player_id)
  values
    (v_group, tg_table_name, v_row_id, v_action, v_old, v_new,
     coalesce(current_setting('app.derived', true), 'off') = 'on',
     v_season, v_team, (v_new ->> 'game_id')::integer, v_player);
  return null;
end;
$$;

create trigger live_lineups_log after insert or update on public.live_lineups
  for each row execute function private.log_change();
create trigger live_sessions_log after insert or update on public.live_sessions
  for each row execute function private.log_change();

-- -----------------------------------------------------------------------------
-- Revert, now also for the live tables. The body moved to private.revert_group
-- so that live_undo() can reuse it.
-- -----------------------------------------------------------------------------
create function private.revert_group(p_group_id uuid, p_force boolean, p_new_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target  public.change_groups;
  v_entry   public.change_log;
  v_current jsonb;
  v_game    integer;
  v_team    integer;
begin
  select * into v_target from public.change_groups where id = p_group_id for update;
  if not found then
    perform private.fail('Změna neexistuje.');
  end if;
  if v_target.source <> 'web' then
    perform private.fail('Vrátit lze jen změny provedené na webu.');
  end if;
  if v_target.reverted_by_group_id is not null then
    perform private.fail('Tato změna už byla vrácena.');
  end if;

  perform private.ensure_group();

  for v_entry in
    select * from public.change_log
    where group_id = p_group_id and not is_derived
    order by id desc
  loop
    v_game := (v_entry.new_data ->> 'game_id')::integer;
    v_team := (v_entry.new_data ->> 'team_id')::integer;

    if v_entry.table_name = 'plate_appearances' then
      select to_jsonb(t) into v_current from public.plate_appearances t
      where t.id = v_entry.row_id::uuid for update;
    elsif v_entry.table_name = 'game_player_extras' then
      select to_jsonb(t) into v_current from public.game_player_extras t
      where t.game_id = v_game and t.player_id = (v_entry.new_data ->> 'player_id')::uuid
      for update;
    elsif v_entry.table_name = 'live_sessions' then
      select to_jsonb(t) into v_current from public.live_sessions t
      where t.game_id = v_game and t.team_id = v_team for update;
    elsif v_entry.table_name = 'live_lineups' then
      select to_jsonb(t) into v_current from public.live_lineups t
      where t.game_id = v_game and t.team_id = v_team for update;
    else
      select to_jsonb(t) into v_current from public.players t
      where t.id = v_entry.row_id::uuid for update;
    end if;

    if not coalesce(p_force, false)
       and (v_current - 'updated_at' - 'version') is distinct from (v_entry.new_data - 'updated_at' - 'version') then
      perform private.fail('Záznam byl od té doby znovu změněn. Nejdřív vrať novější změny.', 'PT409');
    end if;

    if v_entry.table_name = 'plate_appearances' then
      if v_entry.action = 'insert' then
        update public.plate_appearances set deleted_at = now() where id = v_entry.row_id::uuid;
      else
        update public.plate_appearances
        set result     = v_entry.old_data ->> 'result',
            rbi        = (v_entry.old_data ->> 'rbi')::smallint,
            deleted_at = (v_entry.old_data ->> 'deleted_at')::timestamptz
        where id = v_entry.row_id::uuid;
      end if;
    elsif v_entry.table_name = 'game_player_extras' then
      update public.game_player_extras
      set runs         = coalesce((v_entry.old_data ->> 'runs')::smallint, 0),
          stolen_bases = coalesce((v_entry.old_data ->> 'stolen_bases')::smallint, 0)
      where game_id = v_game and player_id = (v_entry.new_data ->> 'player_id')::uuid;
    elsif v_entry.table_name = 'live_sessions' then
      if v_entry.action = 'insert' then
        -- nothing is deleted: a reverted start just ends the session
        update public.live_sessions set finished = true where game_id = v_game and team_id = v_team;
      else
        update public.live_sessions
        set inning    = (v_entry.old_data ->> 'inning')::smallint,
            outs      = (v_entry.old_data ->> 'outs')::smallint,
            runner_1  = (v_entry.old_data ->> 'runner_1')::uuid,
            runner_2  = (v_entry.old_data ->> 'runner_2')::uuid,
            runner_3  = (v_entry.old_data ->> 'runner_3')::uuid,
            next_slot = (v_entry.old_data ->> 'next_slot')::smallint,
            finished  = (v_entry.old_data ->> 'finished')::boolean,
            started_at = (v_entry.old_data ->> 'started_at')::timestamptz
        where game_id = v_game and team_id = v_team;
      end if;
    elsif v_entry.table_name = 'live_lineups' then
      if v_entry.action <> 'insert' then
        update public.live_lineups
        set players = array(select jsonb_array_elements_text(v_entry.old_data -> 'players'))::uuid[]
        where game_id = v_game and team_id = v_team;
      end if;
    else
      if v_entry.action = 'insert' then
        update public.players set active = false, edited_manually = true where id = v_entry.row_id::uuid;
      else
        update public.players
        set name          = v_entry.old_data ->> 'name',
            jersey_number = (v_entry.old_data ->> 'jersey_number')::smallint,
            active        = (v_entry.old_data ->> 'active')::boolean,
            edited_manually = true
        where id = v_entry.row_id::uuid;
      end if;
    end if;
  end loop;

  update public.change_groups set reverted_by_group_id = p_new_group where id = p_group_id;
end;
$$;

create or replace function public.revert_change_group(
  p_group_id uuid,
  p_actor    text,
  p_device   uuid,
  p_force    boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_group uuid;
begin
  v_new_group := private.begin_write('revert', p_actor, p_device);
  perform set_config('app.reverts_group', p_group_id::text, true);
  perform private.revert_group(p_group_id, p_force, v_new_group);
  return v_new_group;
end;
$$;

-- -----------------------------------------------------------------------------
-- Live helpers
-- -----------------------------------------------------------------------------

-- The team plays this game and the game has started (or is played) and is not cancelled.
create function private.assert_live_team(p_game_id integer, p_team_id integer)
returns public.games
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_game public.games;
begin
  select * into v_game from public.games where id = p_game_id;
  if not found then
    perform private.fail('Zápas neexistuje.');
  end if;
  if p_team_id is null or p_team_id not in (v_game.home_team_id, v_game.away_team_id) then
    perform private.fail('Tento tým v zápase nehraje.');
  end if;
  if v_game.status in ('cancelled', 'canceled') then
    perform private.fail('Zápas byl zrušen.');
  end if;
  if not (v_game.status = 'played' or (v_game.starts_at is not null and v_game.starts_at <= now() + interval '2 hours')) then
    perform private.fail('Živě lze zapisovat až v den zápasu, nejdřív 2 hodiny před začátkem.');
  end if;
  return v_game;
end;
$$;

-- A player of the given team in the game's season.
create function private.assert_team_player(p_game public.games, p_team_id integer, p_player_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_player_id is null or not exists (
    select 1 from public.players
    where id = p_player_id and team_id = p_team_id and season_id = p_game.season_id
  ) then
    perform private.fail('Hráč nehraje za tento tým.');
  end if;
end;
$$;

create function private.check_lineup(p_game public.games, p_team_id integer, p_lineup uuid[])
returns uuid[]
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_player uuid;
begin
  if p_lineup is null or cardinality(p_lineup) not between 1 and 20 then
    perform private.fail('Pořadí pálkařů musí mít 1–20 hráčů.');
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

-- Locks the session; checks the expected version and (optionally) that it still runs.
create function private.lock_session(p_game_id integer, p_team_id integer, p_expected_version integer, p_must_run boolean)
returns public.live_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.live_sessions;
begin
  select * into v_s from public.live_sessions where game_id = p_game_id and team_id = p_team_id for update;
  if not found then
    perform private.fail('Živý zápis tohoto týmu ještě nezačal.');
  end if;
  if p_expected_version is not null and v_s.version <> p_expected_version then
    perform private.fail('Mezitím zapsal někdo jiný. Stav se načte znovu.', 'PT409');
  end if;
  if p_must_run and v_s.finished then
    perform private.fail('Živý zápis je ukončený.');
  end if;
  return v_s;
end;
$$;

-- Adds runs / stolen bases (update first, see sync_home_run_runs in 001).
create function private.add_extras(p_game_id integer, p_player_id uuid, p_runs integer, p_sb integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_runs = 0 and p_sb = 0 then
    return;
  end if;
  update public.game_player_extras
  set runs = runs + p_runs, stolen_bases = stolen_bases + p_sb
  where game_id = p_game_id and player_id = p_player_id;
  if not found then
    insert into public.game_player_extras (game_id, player_id, runs, stolen_bases)
    values (p_game_id, p_player_id, p_runs, p_sb);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Public live API
-- -----------------------------------------------------------------------------

-- Starts live scoring for a team (or starts over a finished session).
create function public.live_start(
  p_game_id integer,
  p_team_id integer,
  p_lineup  uuid[],
  p_actor   text,
  p_device  uuid
)
returns public.live_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.games;
  v_s    public.live_sessions;
begin
  perform private.begin_write('live_start', p_actor, p_device);
  v_game := private.assert_live_team(p_game_id, p_team_id);
  perform private.check_lineup(v_game, p_team_id, p_lineup);

  select * into v_s from public.live_sessions where game_id = p_game_id and team_id = p_team_id for update;
  if found then
    if not v_s.finished then
      perform private.fail('Živý zápis tohoto týmu už běží.', 'PT409');
    end if;
    update public.live_lineups set players = p_lineup where game_id = p_game_id and team_id = p_team_id;
    update public.live_sessions
    set inning = 1, outs = 0, runner_1 = null, runner_2 = null, runner_3 = null,
        next_slot = 0, finished = false, started_at = now()
    where game_id = p_game_id and team_id = p_team_id
    returning * into v_s;
  else
    insert into public.live_lineups (game_id, team_id, players) values (p_game_id, p_team_id, p_lineup);
    insert into public.live_sessions (game_id, team_id) values (p_game_id, p_team_id) returning * into v_s;
  end if;
  return v_s;
end;
$$;

-- Changes the batting order (substitution, new batter, reorder).
-- p_next_slot: index (0-based) of the batter who is up next; null keeps the current one.
create function public.live_set_lineup(
  p_game_id          integer,
  p_team_id          integer,
  p_expected_version integer,
  p_lineup           uuid[],
  p_actor            text,
  p_device           uuid,
  p_next_slot        integer default null
)
returns public.live_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.games;
  v_s    public.live_sessions;
  v_next integer;
begin
  perform private.begin_write('live_lineup', p_actor, p_device);
  v_game := private.assert_live_team(p_game_id, p_team_id);
  v_s := private.lock_session(p_game_id, p_team_id, p_expected_version, true);
  perform private.check_lineup(v_game, p_team_id, p_lineup);

  v_next := coalesce(p_next_slot, least(v_s.next_slot, cardinality(p_lineup) - 1));
  if v_next < 0 or v_next >= cardinality(p_lineup) then
    perform private.fail('Neplatný pálkař na řadě.');
  end if;

  update public.live_lineups set players = p_lineup where game_id = p_game_id and team_id = p_team_id;
  -- touch the session only when the next batter really changes (keeps "undo" of the last play possible)
  if v_next <> v_s.next_slot then
    update public.live_sessions set next_slot = v_next
    where game_id = p_game_id and team_id = p_team_id;
  end if;
  select * into v_s from public.live_sessions where game_id = p_game_id and team_id = p_team_id;
  return v_s;
end;
$$;

-- Manual correction of the state (pinch runner, wrong outs, skipped batter …).
create function public.live_set_state(
  p_game_id          integer,
  p_team_id          integer,
  p_expected_version integer,
  p_inning           integer,
  p_outs             integer,
  p_runner_1         uuid,
  p_runner_2         uuid,
  p_runner_3         uuid,
  p_next_slot        integer,
  p_actor            text,
  p_device           uuid
)
returns public.live_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game   public.games;
  v_s      public.live_sessions;
  v_size   integer;
  v_runner uuid;
begin
  perform private.begin_write('live_state', p_actor, p_device);
  v_game := private.assert_live_team(p_game_id, p_team_id);
  v_s := private.lock_session(p_game_id, p_team_id, p_expected_version, true);

  if p_inning is null or p_inning not between 1 and 30 then
    perform private.fail('Směna musí být 1–30.');
  end if;
  if p_outs is null or p_outs not between 0 and 2 then
    perform private.fail('Auty musí být 0–2.');
  end if;
  select cardinality(players) into v_size from public.live_lineups where game_id = p_game_id and team_id = p_team_id;
  if p_next_slot is null or p_next_slot < 0 or p_next_slot >= v_size then
    perform private.fail('Neplatný pálkař na řadě.');
  end if;
  foreach v_runner in array array_remove(array[p_runner_1, p_runner_2, p_runner_3], null) loop
    perform private.assert_team_player(v_game, p_team_id, v_runner);
  end loop;
  if (p_runner_1 is not null and (p_runner_1 = p_runner_2 or p_runner_1 = p_runner_3))
     or (p_runner_2 is not null and p_runner_2 = p_runner_3) then
    perform private.fail('Jeden hráč nemůže být na dvou metách.');
  end if;

  update public.live_sessions
  set inning = p_inning, outs = p_outs, runner_1 = p_runner_1, runner_2 = p_runner_2, runner_3 = p_runner_3,
      next_slot = p_next_slot
  where game_id = p_game_id and team_id = p_team_id
  returning * into v_s;
  return v_s;
end;
$$;

-- Ends (or reopens) live scoring.
create function public.live_finish(
  p_game_id          integer,
  p_team_id          integer,
  p_expected_version integer,
  p_finished         boolean,
  p_actor            text,
  p_device           uuid
)
returns public.live_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.live_sessions;
begin
  perform private.begin_write(case when p_finished then 'live_finish' else 'live_reopen' end, p_actor, p_device);
  perform private.assert_live_team(p_game_id, p_team_id);
  v_s := private.lock_session(p_game_id, p_team_id, p_expected_version, false);
  if p_finished is null then
    perform private.fail('Chybí hodnota.');
  end if;
  update public.live_sessions set finished = p_finished
  where game_id = p_game_id and team_id = p_team_id
  returning * into v_s;
  return v_s;
end;
$$;

-- One play.
--   p_result     plate appearance result of the batter up, or null for a runner-only
--                play (stolen base, wild pitch, pick-off …)
--   p_batter_to  where the batter ended: 0 = out, 1–3 = base, 4 = scored
--   p_runners    every runner on base: [{"from": 1-3, "to": 0-4, "sb": bool}]
--   p_rbi        runs batted in (≤ runs scored on the play)
create function public.live_play(
  p_game_id          integer,
  p_team_id          integer,
  p_expected_version integer,
  p_result           text,
  p_batter_to        integer,
  p_runners          jsonb,
  p_rbi              integer,
  p_actor            text,
  p_device           uuid
)
returns public.live_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game    public.games;
  v_s       public.live_sessions;
  v_lineup  uuid[];
  v_bases   uuid[];
  v_new     uuid[] := array[null, null, null]::uuid[];
  v_batter  uuid;
  v_item    jsonb;
  v_from    integer;
  v_to      integer;
  v_sb      boolean;
  v_runner  uuid;
  v_froms   integer[] := '{}';
  v_tos     integer[] := '{}';
  v_outs    integer := 0;
  v_runs    integer := 0;
  v_moved   boolean := false;
  v_scored  uuid[] := '{}';
  v_stole   uuid[] := '{}';
  v_min     integer;
  v_max     integer;
  v_rbi     integer := 0;
  v_total   integer;
  v_player  uuid;
  i         integer;
  j         integer;
begin
  perform private.begin_write('live_play', p_actor, p_device);
  v_game := private.assert_live_team(p_game_id, p_team_id);
  v_s := private.lock_session(p_game_id, p_team_id, p_expected_version, true);
  select players into v_lineup from public.live_lineups where game_id = p_game_id and team_id = p_team_id;
  v_bases := array[v_s.runner_1, v_s.runner_2, v_s.runner_3];

  if p_result is not null and p_result not in ('1B','2B','3B','HR','BB','HBP','K','OUT','FC','ROE','SF','SH') then
    perform private.fail('Neznámý výsledek na pálce.');
  end if;
  if jsonb_typeof(coalesce(p_runners, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_runners, '[]'::jsonb)) > 3 then
    perform private.fail('Neplatný zápis běžců.');
  end if;

  -- runners
  for v_item in select value from jsonb_array_elements(coalesce(p_runners, '[]'::jsonb)) loop
    if jsonb_typeof(v_item) <> 'object'
       or coalesce(jsonb_typeof(v_item -> 'from'), '') <> 'number'
       or coalesce(jsonb_typeof(v_item -> 'to'), '') <> 'number'
       or coalesce(jsonb_typeof(v_item -> 'sb'), 'boolean') <> 'boolean' then
      perform private.fail('Neplatný zápis běžců.');
    end if;
    v_from := (v_item ->> 'from')::integer;
    v_to := (v_item ->> 'to')::integer;
    v_sb := coalesce((v_item ->> 'sb')::boolean, false);
    if v_from not between 1 and 3 or v_to not between 0 and 4 then
      perform private.fail('Neplatný pohyb běžce.');
    end if;
    if v_from = any (v_froms) then
      perform private.fail('Běžec je v zápisu dvakrát.');
    end if;
    v_runner := v_bases[v_from];
    if v_runner is null then
      perform private.fail(format('Na %s. metě nikdo není.', v_from));
    end if;
    if v_to <> 0 and v_to < v_from then
      perform private.fail('Běžec nemůže couvat.');
    end if;
    if v_sb and (p_result is not null or v_to = 0 or v_to = v_from) then
      perform private.fail('Ukradenou metu lze zapsat jen mimo odpal a jen s postupem běžce.');
    end if;
    if v_to <> v_from then
      v_moved := true;
    end if;

    if v_to = 0 then
      v_outs := v_outs + 1;
    elsif v_to = 4 then
      v_runs := v_runs + 1;
      v_scored := v_scored || v_runner;
    else
      if v_new[v_to] is not null then
        perform private.fail('Na jedné metě nemohou být dva běžci.');
      end if;
      v_new[v_to] := v_runner;
    end if;
    if v_sb then
      v_stole := v_stole || v_runner;
    end if;
    v_froms := v_froms || v_from;
    v_tos := v_tos || v_to;
  end loop;

  for i in 1..3 loop
    if v_bases[i] is not null and not (i = any (v_froms)) then
      perform private.fail(format('Chybí, co se stalo s běžcem na %s. metě.', i));
    end if;
  end loop;

  -- batter
  if p_result is null then
    if p_batter_to is not null or coalesce(p_rbi, 0) <> 0 then
      perform private.fail('Bez výsledku na pálce nejde zapsat pálkaře ani RBI.');
    end if;
    if not v_moved then
      perform private.fail('Žádný běžec se neposunul.');
    end if;
  else
    v_batter := v_lineup[v_s.next_slot + 1];
    if v_batter is null then
      perform private.fail('Neplatný pálkař na řadě. Oprav sestavu.');
    end if;
    if v_batter = any (v_bases) then
      perform private.fail('Pálkař na řadě je zároveň běžec na metě. Oprav sestavu nebo stav.');
    end if;
    if p_result in ('SF', 'SH') and v_s.outs >= 2 then
      perform private.fail('Obětovaný odpal jde jen při méně než 2 autech.');
    end if;

    select lo, hi into v_min, v_max from (values
      ('1B', 1, 4), ('2B', 2, 4), ('3B', 3, 4), ('HR', 4, 4),
      ('BB', 1, 4), ('HBP', 1, 4), ('FC', 1, 4), ('ROE', 1, 4),
      ('K', 0, 4), ('OUT', 0, 0), ('SF', 0, 0), ('SH', 0, 1)
    ) r(code, lo, hi) where r.code = p_result;
    if p_batter_to is null or p_batter_to not between v_min and v_max then
      perform private.fail('Pálkař s tímto výsledkem nemůže skončit na zadané metě.');
    end if;

    if p_batter_to = 0 then
      v_outs := v_outs + 1;
    elsif p_batter_to = 4 then
      v_runs := v_runs + 1;
      v_scored := v_scored || v_batter;
    else
      if v_new[p_batter_to] is not null then
        perform private.fail('Na jedné metě nemohou být dva běžci.');
      end if;
      v_new[p_batter_to] := v_batter;
    end if;
    v_froms := v_froms || 0;
    v_tos := v_tos || p_batter_to;

    if p_result = 'SF' and v_runs = 0 then
      perform private.fail('Při obětovaném odpalu do pole musí doběhnout aspoň jeden běžec.');
    end if;

    v_rbi := coalesce(p_rbi,
      case when p_result in ('ROE', 'K') or v_outs >= 2 then 0 else v_runs end);
    if p_result in ('HR', 'SF') then
      v_rbi := greatest(v_rbi, 1);
    end if;
    if v_rbi < 0 or v_rbi > least(4, v_runs) then
      perform private.fail('RBI nemůže být víc než doběhů v této akci.');
    end if;
  end if;

  -- nobody passes a runner ahead of him
  for i in 1..cardinality(v_froms) loop
    for j in 1..cardinality(v_froms) loop
      if v_froms[i] < v_froms[j] and v_tos[i] <> 0 and v_tos[j] <> 0
         and not (v_tos[i] < v_tos[j] or (v_tos[i] = 4 and v_tos[j] = 4)) then
        perform private.fail('Běžec nemůže předběhnout běžce před sebou.');
      end if;
    end loop;
  end loop;

  v_total := v_s.outs + v_outs;
  if v_total > 3 then
    perform private.fail('V jedné směně nemohou být víc než 3 auty.');
  end if;

  -- statistics
  if p_result is not null then
    insert into public.plate_appearances (game_id, player_id, result, rbi)
    values (p_game_id, v_batter, p_result, v_rbi);
  end if;
  for v_player in select distinct x from unnest(v_scored || v_stole) x loop
    perform private.add_extras(
      p_game_id, v_player,
      -- the batter's own run on a home run is added automatically (sync_home_run_runs)
      case when v_player = any (v_scored) and not coalesce(v_player = v_batter and p_result = 'HR', false) then 1 else 0 end,
      case when v_player = any (v_stole) then 1 else 0 end
    );
  end loop;

  -- new state
  if v_total = 3 then
    update public.live_sessions
    set inning = least(inning + 1, 30), outs = 0, runner_1 = null, runner_2 = null, runner_3 = null,
        next_slot = case when p_result is null then next_slot else (next_slot + 1) % cardinality(v_lineup) end
    where game_id = p_game_id and team_id = p_team_id
    returning * into v_s;
  else
    update public.live_sessions
    set outs = v_total, runner_1 = v_new[1], runner_2 = v_new[2], runner_3 = v_new[3],
        next_slot = case when p_result is null then next_slot else (next_slot + 1) % cardinality(v_lineup) end
    where game_id = p_game_id and team_id = p_team_id
    returning * into v_s;
  end if;
  return v_s;
end;
$$;

-- Undoes the last play of this team in this game (reverts its change group).
create function public.live_undo(
  p_game_id integer,
  p_team_id integer,
  p_actor   text,
  p_device  uuid
)
returns public.live_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_group uuid;
  v_target    uuid;
  v_s         public.live_sessions;
begin
  v_new_group := private.begin_write('revert', p_actor, p_device);
  perform private.lock_session(p_game_id, p_team_id, null, true);

  select l.group_id into v_target
  from public.change_log l
  join public.change_groups g on g.id = l.group_id
  where l.game_id = p_game_id
    and l.table_name = 'live_sessions'
    and l.row_id = p_game_id || ':' || p_team_id
    and g.action = 'live_play'
    and g.reverted_by_group_id is null
  order by l.id desc
  limit 1;
  if v_target is null then
    perform private.fail('Není co vrátit.');
  end if;

  perform set_config('app.reverts_group', v_target::text, true);
  perform private.revert_group(v_target, false, v_new_group);
  select * into v_s from public.live_sessions where game_id = p_game_id and team_id = p_team_id;
  return v_s;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row level security, privileges, realtime
-- -----------------------------------------------------------------------------
alter table public.live_lineups  enable row level security;
alter table public.live_sessions enable row level security;
create policy "public read" on public.live_lineups  for select to anon, authenticated using (true);
create policy "public read" on public.live_sessions for select to anon, authenticated using (true);

revoke all on public.live_lineups, public.live_sessions from public, anon, authenticated;
grant select on public.live_lineups, public.live_sessions to anon, authenticated;

revoke all on all functions in schema private from public;
revoke all on function
  public.live_start(integer, integer, uuid[], text, uuid),
  public.live_set_lineup(integer, integer, integer, uuid[], text, uuid, integer),
  public.live_set_state(integer, integer, integer, integer, integer, uuid, uuid, uuid, integer, text, uuid),
  public.live_finish(integer, integer, integer, boolean, text, uuid),
  public.live_play(integer, integer, integer, text, integer, jsonb, integer, text, uuid),
  public.live_undo(integer, integer, text, uuid)
from public, anon, authenticated;
grant execute on function
  public.live_start(integer, integer, uuid[], text, uuid),
  public.live_set_lineup(integer, integer, integer, uuid[], text, uuid, integer),
  public.live_set_state(integer, integer, integer, integer, integer, uuid, uuid, uuid, integer, text, uuid),
  public.live_finish(integer, integer, integer, boolean, text, uuid),
  public.live_play(integer, integer, integer, text, integer, jsonb, integer, text, uuid),
  public.live_undo(integer, integer, text, uuid)
to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.live_lineups, public.live_sessions;
  end if;
end;
$$;

commit;
