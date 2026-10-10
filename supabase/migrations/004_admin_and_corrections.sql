-- =============================================================================
-- Pražský přebor – statistiky
-- Migration 004: corrections of live scoring and an administrator
--
-- For everyone (logged and revertable like every other change):
--   * live_delete_play()  – remove one play anywhere in the game (its plate
--     appearance, runs and stolen bases), the current game state stays as it is
--   * live_rewind()       – go back to a chosen play (reverts every later play)
--   * live_adjust_runs()  – add or remove a run of a player in a given inning
-- For the administrator (secret code, stored only as a bcrypt hash):
--   * admin_reset_game()  – wipe all statistics and the live scoring of a game
--   * admin_set_score()   – final score that overrides the imported one
--   * admin_revert_group(), admin_change_code(), admin_check()
-- Also: reverting a revert brings the originally reverted changes back to life
-- (they are no longer marked as reverted).
--
-- Run once in Supabase → SQL Editor after 003. One transaction.
-- The administrator code is set separately (see README), never in this file.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Administrator code
-- -----------------------------------------------------------------------------
alter table private.settings add column admin_code_hash text;

create table private.admin_failures (
  id          bigint generated always as identity primary key,
  client_hash text        not null,
  device_hash text        not null,
  at          timestamptz not null default now()
);
create index admin_failures_at on private.admin_failures (at);

-- Codes are compared without dashes, spaces and letter case.
create function private.normalize_code(p_code text)
returns text
language sql
immutable
set search_path = ''
as $$ select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')) $$;

create function private.code_matches(p_code text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select s.admin_code_hash is not null
     and char_length(private.normalize_code(p_code)) >= 8
     and extensions.crypt(private.normalize_code(p_code), s.admin_code_hash) = s.admin_code_hash
  from private.settings s
$$;

-- Raises unless the code is right. Brute force is limited by begin_write (150 writes
-- per 10 minutes) and by the length of the code.
create function private.require_admin(p_code text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.code_matches(p_code) then
    perform private.fail('Nesprávný kód správce.', 'PT403');
  end if;
end;
$$;

-- Used by the page to unlock the admin panel. Failed attempts are counted
-- (10 per hour per device or IP, 50 per hour in total).
create function public.admin_check(p_code text, p_device uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_headers jsonb := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_ip      text;
  v_client  text;
  v_device  text;
begin
  if p_device is null then
    return 'wrong';
  end if;
  v_ip := coalesce(
    nullif(btrim(v_headers ->> 'cf-connecting-ip'), ''),
    nullif(btrim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''),
    'unknown'
  );
  v_client := private.hash_value('ip:' || v_ip);
  v_device := private.hash_value('device:' || p_device::text);

  delete from private.admin_failures where at < now() - interval '1 day';
  if (select count(*) from private.admin_failures
      where (client_hash = v_client or device_hash = v_device) and at > now() - interval '1 hour') >= 10
     or (select count(*) from private.admin_failures where at > now() - interval '1 hour') >= 50 then
    return 'locked';
  end if;
  if (select admin_code_hash from private.settings) is null then
    return 'unset';
  end if;
  if private.code_matches(p_code) then
    return 'ok';
  end if;
  insert into private.admin_failures (client_hash, device_hash) values (v_client, v_device);
  return 'wrong';
end;
$$;

create function public.admin_change_code(p_code text, p_new_code text, p_actor text, p_device uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.begin_write('admin_change_code', p_actor, p_device);
  perform private.require_admin(p_code);
  if char_length(private.normalize_code(p_new_code)) < 12 then
    perform private.fail('Nový kód musí mít aspoň 12 písmen nebo číslic.');
  end if;
  update private.settings
  set admin_code_hash = extensions.crypt(private.normalize_code(p_new_code), extensions.gen_salt('bf', 8));
  return true;
end;
$$;

-- -----------------------------------------------------------------------------
-- New tables: run corrections per inning, manual final score
-- -----------------------------------------------------------------------------
create table public.live_run_adjustments (
  id         uuid primary key default gen_random_uuid(),
  game_id    integer     not null references public.games (id),
  team_id    integer     not null references public.teams (id),
  inning     smallint    not null check (inning between 1 and 30),
  player_id  uuid        not null references public.players (id),
  delta      smallint    not null check (delta in (-1, 1)),
  cancelled  boolean     not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    integer     not null default 1
);
create index live_run_adjustments_game on public.live_run_adjustments (game_id);

create table public.game_score_overrides (
  game_id    integer     primary key references public.games (id),
  home_score smallint check (home_score between 0 and 99),
  away_score smallint check (away_score between 0 and 99),
  updated_at timestamptz not null default now(),
  version    integer     not null default 1,
  check ((home_score is null) = (away_score is null))
);

create trigger live_run_adjustments_touch before update on public.live_run_adjustments
  for each row execute function private.touch_row();
create trigger game_score_overrides_touch before update on public.game_score_overrides
  for each row execute function private.touch_row();
create trigger live_run_adjustments_no_delete before delete on public.live_run_adjustments
  for each row execute function private.forbid_delete();
create trigger game_score_overrides_no_delete before delete on public.game_score_overrides
  for each row execute function private.forbid_delete();

-- -----------------------------------------------------------------------------
-- History for the new tables
-- -----------------------------------------------------------------------------
alter table public.change_log drop constraint change_log_table_name_check;
alter table public.change_log add constraint change_log_table_name_check
  check (table_name in ('players', 'plate_appearances', 'game_player_extras', 'live_lineups', 'live_sessions',
                        'live_run_adjustments', 'game_score_overrides'));

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
  elsif tg_table_name = 'game_score_overrides' then
    v_row_id := v_new ->> 'game_id';
    select g.season_id into v_season from public.games g where g.id = (v_new ->> 'game_id')::integer;
  else
    if tg_table_name = 'players' then
      v_player := (v_new ->> 'id')::uuid;
      v_row_id := v_new ->> 'id';
    elsif tg_table_name in ('plate_appearances', 'live_run_adjustments') then
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

create trigger live_run_adjustments_log after insert or update on public.live_run_adjustments
  for each row execute function private.log_change();
create trigger game_score_overrides_log after insert or update on public.game_score_overrides
  for each row execute function private.log_change();

-- -----------------------------------------------------------------------------
-- Revert: new tables + "revert of a revert" restores the original changes
-- -----------------------------------------------------------------------------
create or replace function private.revert_group(p_group_id uuid, p_force boolean, p_new_group uuid)
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
    elsif v_entry.table_name = 'live_run_adjustments' then
      select to_jsonb(t) into v_current from public.live_run_adjustments t
      where t.id = v_entry.row_id::uuid for update;
    elsif v_entry.table_name = 'game_score_overrides' then
      select to_jsonb(t) into v_current from public.game_score_overrides t
      where t.game_id = v_game for update;
    else
      select to_jsonb(t) into v_current from public.players t
      where t.id = v_entry.row_id::uuid for update;
    end if;

    -- Runs and stolen bases are counters: they are reverted relatively (the change is
    -- subtracted), so other changes of the same player in between do not block it.
    if v_entry.table_name <> 'game_player_extras' and not coalesce(p_force, false)
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
      set runs = runs - ((v_entry.new_data ->> 'runs')::integer - coalesce((v_entry.old_data ->> 'runs')::integer, 0)),
          stolen_bases = stolen_bases
            - ((v_entry.new_data ->> 'stolen_bases')::integer - coalesce((v_entry.old_data ->> 'stolen_bases')::integer, 0))
      where game_id = v_game and player_id = (v_entry.new_data ->> 'player_id')::uuid;
    elsif v_entry.table_name = 'live_sessions' then
      if v_entry.action = 'insert' then
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
    elsif v_entry.table_name = 'live_run_adjustments' then
      update public.live_run_adjustments
      set cancelled = case when v_entry.action = 'insert' then true else (v_entry.old_data ->> 'cancelled')::boolean end
      where id = v_entry.row_id::uuid;
    elsif v_entry.table_name = 'game_score_overrides' then
      update public.game_score_overrides
      set home_score = case when v_entry.action = 'insert' then null else (v_entry.old_data ->> 'home_score')::smallint end,
          away_score = case when v_entry.action = 'insert' then null else (v_entry.old_data ->> 'away_score')::smallint end
      where game_id = v_game;
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

  -- changes this group had reverted (or deleted) are valid again
  update public.change_groups set reverted_by_group_id = null where reverted_by_group_id = p_group_id;
  update public.change_groups set reverted_by_group_id = p_new_group where id = p_group_id;
end;
$$;

-- Administrator changes can be reverted only by the administrator.
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
  if exists (select 1 from public.change_groups where id = p_group_id and action like 'admin\_%') then
    perform private.fail('Tuto změnu může vrátit jen správce.', 'PT403');
  end if;
  perform set_config('app.reverts_group', p_group_id::text, true);
  perform private.revert_group(p_group_id, p_force, v_new_group);
  return v_new_group;
end;
$$;

create function public.admin_revert_group(p_group_id uuid, p_code text, p_actor text, p_device uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_group uuid;
begin
  v_new_group := private.begin_write('admin_revert', p_actor, p_device);
  perform private.require_admin(p_code);
  perform set_config('app.reverts_group', p_group_id::text, true);
  perform private.revert_group(p_group_id, false, v_new_group);
  return v_new_group;
end;
$$;

-- -----------------------------------------------------------------------------
-- Corrections of live scoring (everyone)
-- -----------------------------------------------------------------------------

-- Removes one play: its plate appearance, the runs and stolen bases it gave.
-- The current state of the inning is not touched (use "undo" for the last play).
create function public.live_delete_play(p_game_id integer, p_group_id uuid, p_actor text, p_device uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_group uuid;
  v_target    public.change_groups;
  v_entry     public.change_log;
  v_dr        integer;
  v_dsb       integer;
begin
  v_new_group := private.begin_write('live_delete_play', p_actor, p_device);
  perform set_config('app.reverts_group', p_group_id::text, true);

  select * into v_target from public.change_groups where id = p_group_id for update;
  if not found or v_target.action <> 'live_play' or v_target.reverted_by_group_id is not null
     or not exists (select 1 from public.change_log where group_id = p_group_id and game_id = p_game_id) then
    perform private.fail('Akce neexistuje nebo už byla vrácena.');
  end if;
  perform private.ensure_group();

  -- plate appearance first (a home run takes its run away automatically)
  update public.plate_appearances p
  set deleted_at = now()
  from public.change_log l
  where l.group_id = p_group_id and l.table_name = 'plate_appearances' and l.action = 'insert'
    and p.id = l.row_id::uuid and p.deleted_at is null;

  -- runs and stolen bases of this play, relative to the current values
  for v_entry in
    select * from public.change_log
    where group_id = p_group_id and table_name = 'game_player_extras' and not is_derived
  loop
    v_dr := coalesce((v_entry.new_data ->> 'runs')::integer, 0) - coalesce((v_entry.old_data ->> 'runs')::integer, 0);
    v_dsb := coalesce((v_entry.new_data ->> 'stolen_bases')::integer, 0) - coalesce((v_entry.old_data ->> 'stolen_bases')::integer, 0);
    update public.game_player_extras
    set runs = greatest(runs - v_dr, 0), stolen_bases = greatest(stolen_bases - v_dsb, 0)
    where game_id = p_game_id and player_id = (v_entry.new_data ->> 'player_id')::uuid;
  end loop;

  update public.change_groups set reverted_by_group_id = v_new_group where id = p_group_id;
  return v_new_group;
end;
$$;

-- Goes back to the state right after the given play: every later play of the game is reverted.
create function public.live_rewind(p_game_id integer, p_group_id uuid, p_actor text, p_device uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_group uuid;
  v_latest    uuid;
  v_count     integer := 0;
begin
  v_new_group := private.begin_write('live_rewind', p_actor, p_device);
  if not exists (
    select 1 from public.change_groups g
    where g.id = p_group_id and g.action = 'live_play' and g.reverted_by_group_id is null
      and exists (select 1 from public.change_log l where l.group_id = g.id and l.game_id = p_game_id)
  ) then
    perform private.fail('Akce neexistuje nebo už byla vrácena.');
  end if;
  perform private.ensure_group();

  loop
    select l.group_id into v_latest
    from public.change_log l
    join public.change_groups g on g.id = l.group_id
    where l.game_id = p_game_id and l.table_name = 'live_sessions'
      and g.action = 'live_play' and g.reverted_by_group_id is null
    order by l.id desc
    limit 1;
    exit when v_latest is null or v_latest = p_group_id;
    perform private.revert_group(v_latest, false, v_new_group);
    v_count := v_count + 1;
    if v_count > 500 then
      perform private.fail('Příliš mnoho akcí najednou.');
    end if;
  end loop;
  return v_count;
end;
$$;

-- Adds (+1) or removes (−1) a run of a player in a given inning.
create function public.live_adjust_runs(
  p_game_id   integer,
  p_team_id   integer,
  p_inning    integer,
  p_player_id uuid,
  p_delta     integer,
  p_actor     text,
  p_device    uuid
)
returns public.live_run_adjustments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_game public.games;
  v_row  public.live_run_adjustments;
begin
  perform private.begin_write('live_adjust', p_actor, p_device);
  v_game := private.assert_live_team(p_game_id, p_team_id);
  perform private.assert_team_player(v_game, p_team_id, p_player_id);
  perform private.assert_player_in_game(p_game_id, p_player_id);
  if p_inning is null or p_inning not between 1 and 30 then
    perform private.fail('Směna musí být 1–30.');
  end if;
  if p_delta is null or p_delta not in (-1, 1) then
    perform private.fail('Doběh lze měnit jen o 1.');
  end if;

  if p_delta < 0 and coalesce((select runs from public.game_player_extras
                               where game_id = p_game_id and player_id = p_player_id), 0) = 0 then
    perform private.fail('Hráč v tomto zápase nemá žádný doběh.');
  end if;
  perform private.add_extras(p_game_id, p_player_id, p_delta, 0);

  insert into public.live_run_adjustments (game_id, team_id, inning, player_id, delta)
  values (p_game_id, p_team_id, p_inning, p_player_id, p_delta)
  returning * into v_row;
  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Administrator actions
-- -----------------------------------------------------------------------------

-- Wipes all statistics and live scoring of a game. One change group: revertable by the administrator.
create function public.admin_reset_game(p_game_id integer, p_code text, p_actor text, p_device uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid;
begin
  v_group := private.begin_write('admin_reset_game', p_actor, p_device);
  perform private.require_admin(p_code);
  if not exists (select 1 from public.games where id = p_game_id) then
    perform private.fail('Zápas neexistuje.');
  end if;
  perform private.ensure_group();

  update public.plate_appearances set deleted_at = now() where game_id = p_game_id and deleted_at is null;
  update public.game_player_extras set runs = 0, stolen_bases = 0
  where game_id = p_game_id and (runs <> 0 or stolen_bases <> 0);
  update public.live_run_adjustments set cancelled = true where game_id = p_game_id and not cancelled;
  update public.live_sessions
  set finished = true, inning = 1, outs = 0, runner_1 = null, runner_2 = null, runner_3 = null, next_slot = 0
  where game_id = p_game_id;
  update public.game_score_overrides set home_score = null, away_score = null
  where game_id = p_game_id and home_score is not null;

  -- the play-by-play of this game is gone (comes back when the reset is reverted)
  update public.change_groups g set reverted_by_group_id = v_group
  where g.reverted_by_group_id is null and g.id <> v_group
    and g.action in ('live_play', 'live_adjust')
    and exists (select 1 from public.change_log l where l.group_id = g.id and l.game_id = p_game_id);
  return v_group;
end;
$$;

-- Final score that replaces the imported one; both null removes the override.
create function public.admin_set_score(
  p_game_id    integer,
  p_home_score integer,
  p_away_score integer,
  p_code       text,
  p_actor      text,
  p_device     uuid
)
returns public.game_score_overrides
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.game_score_overrides;
begin
  perform private.begin_write('admin_set_score', p_actor, p_device);
  perform private.require_admin(p_code);
  if not exists (select 1 from public.games where id = p_game_id) then
    perform private.fail('Zápas neexistuje.');
  end if;
  if (p_home_score is null) <> (p_away_score is null) then
    perform private.fail('Zadej skóre obou týmů, nebo ani jednoho.');
  end if;
  if p_home_score not between 0 and 99 or p_away_score not between 0 and 99 then
    perform private.fail('Skóre musí být 0–99.');
  end if;

  update public.game_score_overrides set home_score = p_home_score, away_score = p_away_score
  where game_id = p_game_id
  returning * into v_row;
  if not found then
    insert into public.game_score_overrides (game_id, home_score, away_score)
    values (p_game_id, p_home_score, p_away_score)
    returning * into v_row;
  end if;
  return v_row;
end;
$$;

-- -----------------------------------------------------------------------------
-- Row level security, privileges, realtime
-- -----------------------------------------------------------------------------
alter table public.live_run_adjustments enable row level security;
alter table public.game_score_overrides enable row level security;
create policy "public read" on public.live_run_adjustments for select to anon, authenticated using (true);
create policy "public read" on public.game_score_overrides for select to anon, authenticated using (true);
revoke all on public.live_run_adjustments, public.game_score_overrides from public, anon, authenticated;
grant select on public.live_run_adjustments, public.game_score_overrides to anon, authenticated;

revoke all on all functions in schema private from public;
revoke all on function
  public.admin_check(text, uuid),
  public.admin_change_code(text, text, text, uuid),
  public.admin_revert_group(uuid, text, text, uuid),
  public.admin_reset_game(integer, text, text, uuid),
  public.admin_set_score(integer, integer, integer, text, text, uuid),
  public.live_delete_play(integer, uuid, text, uuid),
  public.live_rewind(integer, uuid, text, uuid),
  public.live_adjust_runs(integer, integer, integer, uuid, integer, text, uuid)
from public, anon, authenticated;
grant execute on function
  public.admin_check(text, uuid),
  public.admin_change_code(text, text, text, uuid),
  public.admin_revert_group(uuid, text, text, uuid),
  public.admin_reset_game(integer, text, text, uuid),
  public.admin_set_score(integer, integer, integer, text, text, uuid),
  public.live_delete_play(integer, uuid, text, uuid),
  public.live_rewind(integer, uuid, text, uuid),
  public.live_adjust_runs(integer, integer, integer, uuid, integer, text, uuid)
to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.live_run_adjustments, public.game_score_overrides;
  end if;
end;
$$;

commit;
