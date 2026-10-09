-- =============================================================================
-- Pražský přebor – statistiky
-- Migration 001: schema, row level security, write RPCs, change history, views
--
-- Run once in Supabase → SQL Editor (as the default `postgres` role).
-- The whole script runs in one transaction: it either applies completely or not at all.
--
-- Security model
--   * Anonymous visitors (anon key) may only SELECT.
--   * Every write goes through a SECURITY DEFINER function in `public` that
--     validates input, rate-limits the caller and records history.
--   * Direct INSERT / UPDATE / DELETE on tables is revoked from anon/authenticated.
--   * Nothing is ever hard-deleted by the app; deletions are soft (deleted_at / active).
--   * Teams, games, standings and imported players are written only by the
--     import function (service role).
--   * Personal data stored: player name, jersey number, team. Nothing else.
-- =============================================================================

begin;

create extension if not exists pgcrypto with schema extensions;

-- -----------------------------------------------------------------------------
-- Private schema (not exposed through the API)
-- -----------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;

-- Secret salt used to hash client IPs and device ids. Never leaves the database.
create table private.settings (
  id        boolean primary key default true check (id),
  hash_salt bytea   not null default extensions.gen_random_bytes(32)
);
insert into private.settings default values;

-- Write attempts used for rate limiting. Rows older than 24 h are purged on every write.
create table private.write_events (
  id          bigint generated always as identity primary key,
  client_hash text        not null,
  device_hash text        not null,
  at          timestamptz not null default now()
);
create index write_events_client_at on private.write_events (client_hash, at);
create index write_events_device_at on private.write_events (device_hash, at);
create index write_events_at        on private.write_events (at);

-- -----------------------------------------------------------------------------
-- Reference data (written only by the import)
-- -----------------------------------------------------------------------------
create table public.seasons (
  id          integer primary key,               -- season id at softball.cz
  league_id   integer     not null,              -- league id at softball.cz (PPM = 13)
  year        integer     not null check (year between 2000 and 2100),
  name        text        not null,
  is_current  boolean     not null default false,
  imported_at timestamptz
);
create unique index seasons_single_current on public.seasons (is_current) where is_current;

create table public.teams (
  id         integer primary key,                -- team id at softball.cz
  name       text not null check (char_length(name) between 1 and 120),
  short_name text,
  code       text not null check (char_length(code) between 1 and 12),
  color      text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  logo_url   text check (logo_url ~ '^https://management\.softball\.cz/')
);

create table public.season_teams (
  season_id integer not null references public.seasons (id),
  team_id   integer not null references public.teams (id),
  primary key (season_id, team_id)
);

create table public.games (
  id           integer primary key,              -- game id at softball.cz
  season_id    integer     not null references public.seasons (id),
  game_number  integer,
  starts_at    timestamptz,
  status       text        not null check (char_length(status) between 1 and 32),
  home_team_id integer     not null references public.teams (id),
  away_team_id integer     not null references public.teams (id),
  home_score   smallint check (home_score >= 0),
  away_score   smallint check (away_score >= 0),
  venue        text,
  updated_at   timestamptz not null default now(),
  check (home_team_id <> away_team_id)
);
create index games_season_start on public.games (season_id, starts_at);
create index games_home         on public.games (home_team_id);
create index games_away         on public.games (away_team_id);

create table public.standings (
  season_id    integer  not null references public.seasons (id),
  team_id      integer  not null references public.teams (id),
  position     smallint,
  games        smallint not null default 0,
  wins         smallint not null default 0,
  draws        smallint not null default 0,
  losses       smallint not null default 0,
  scratches    smallint not null default 0,
  points       smallint not null default 0,
  runs_for     smallint not null default 0,
  runs_against smallint not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (season_id, team_id)
);

-- -----------------------------------------------------------------------------
-- Players (imported from softball.cz or added manually by anyone)
-- -----------------------------------------------------------------------------
create table public.players (
  id              uuid primary key default gen_random_uuid(),
  season_id       integer     not null,
  team_id         integer     not null,
  name            text        not null check (char_length(name) between 2 and 60 and name !~ '[[:cntrl:]]'),
  jersey_number   smallint check (jersey_number between 0 and 99),
  source          text        not null check (source in ('import', 'manual')),
  external_id     integer unique,                -- roster entry id at softball.cz (imported players only)
  edited_manually boolean     not null default false,  -- import never overwrites such rows
  active          boolean     not null default true,   -- false = removed from roster (stats are kept)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  version         integer     not null default 1,
  check ((source = 'import') = (external_id is not null)),
  foreign key (season_id, team_id) references public.season_teams (season_id, team_id)
);
create index players_season_team on public.players (season_id, team_id);

-- -----------------------------------------------------------------------------
-- Batting data. One row per plate appearance; runs and stolen bases per player per game.
-- Season and team statistics are never stored – they are views over these two tables.
-- -----------------------------------------------------------------------------
create table public.plate_appearances (
  id         uuid primary key default gen_random_uuid(),
  game_id    integer     not null references public.games (id),
  player_id  uuid        not null references public.players (id),
  result     text        not null check (result in ('1B','2B','3B','HR','BB','HBP','K','OUT','FC','ROE','SF','SH')),
  rbi        smallint    not null default 0 check (rbi between 0 and 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  version    integer     not null default 1,
  -- a home run always drives in at least the batter, a sacrifice fly at least one runner
  check (result not in ('HR', 'SF') or rbi >= 1)
);
create index plate_appearances_game_player on public.plate_appearances (game_id, player_id);
create index plate_appearances_player      on public.plate_appearances (player_id);

create table public.game_player_extras (
  game_id      integer     not null references public.games (id),
  player_id    uuid        not null references public.players (id),
  runs         smallint    not null default 0 check (runs between 0 and 20),
  stolen_bases smallint    not null default 0 check (stolen_bases between 0 and 20),
  updated_at   timestamptz not null default now(),
  version      integer     not null default 1,
  primary key (game_id, player_id)
);
create index game_player_extras_player on public.game_player_extras (player_id);

-- -----------------------------------------------------------------------------
-- Change history. Every change of players / plate_appearances / game_player_extras
-- is logged by triggers. One user action = one change group, revertable as a unit.
-- -----------------------------------------------------------------------------
create table public.change_groups (
  id                   uuid primary key,
  at                   timestamptz not null default now(),
  source               text not null check (source in ('web', 'import', 'admin')),
  action               text not null,
  actor_name           text,
  device_hash          text,
  reverts_group_id     uuid references public.change_groups (id),
  reverted_by_group_id uuid references public.change_groups (id)
);
create index change_groups_at on public.change_groups (at desc);

create table public.change_log (
  id         bigint generated always as identity primary key,
  group_id   uuid        not null references public.change_groups (id),
  at         timestamptz not null default now(),
  table_name text        not null check (table_name in ('players', 'plate_appearances', 'game_player_extras')),
  row_id     text        not null,
  action     text        not null check (action in ('insert', 'update', 'delete', 'restore')),
  old_data   jsonb,
  new_data   jsonb       not null,
  is_derived boolean     not null default false,  -- automatic follow-up change (HR → run); skipped by revert
  season_id  integer,
  team_id    integer,
  game_id    integer,
  player_id  uuid
);
create index change_log_group  on public.change_log (group_id);
create index change_log_game   on public.change_log (game_id);
create index change_log_player on public.change_log (player_id);
create index change_log_at     on public.change_log (at desc);

-- =============================================================================
-- Helper functions (private)
-- =============================================================================

-- Raise a user-facing error. PT4xx codes become HTTP 4xx in PostgREST.
create function private.fail(p_message text, p_code text default 'P0001')
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception using message = p_message, errcode = p_code;
end;
$$;

create function private.hash_value(p_value text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select encode(extensions.hmac(convert_to(p_value, 'UTF8'), s.hash_salt, 'sha256'::text), 'hex')
  from private.settings s;
$$;

-- Ensures the change group from the current transaction settings exists.
create function private.ensure_group()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_group uuid := nullif(current_setting('app.change_group', true), '')::uuid;
begin
  if v_group is null then
    -- change made outside the API (e.g. SQL editor)
    v_group := gen_random_uuid();
    perform set_config('app.change_group', v_group::text, true);
    perform set_config('app.source', 'admin', true);
    perform set_config('app.action', 'admin', true);
  end if;

  insert into public.change_groups (id, source, action, actor_name, device_hash, reverts_group_id)
  values (
    v_group,
    coalesce(nullif(current_setting('app.source', true), ''), 'admin'),
    coalesce(nullif(current_setting('app.action', true), ''), 'admin'),
    nullif(current_setting('app.actor_name', true), ''),
    nullif(current_setting('app.device_hash', true), ''),
    nullif(current_setting('app.reverts_group', true), '')::uuid
  )
  on conflict (id) do nothing;

  return v_group;
end;
$$;

-- Validates the author, applies rate limits and opens a change group.
-- Must be the first call in every public write function.
create function private.begin_write(p_action text, p_actor text, p_device uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor   text := regexp_replace(btrim(coalesce(p_actor, '')), '\s+', ' ', 'g');
  v_headers jsonb;
  v_ip      text;
  v_client  text;
  v_device  text;
  v_recent  integer;
  v_global  integer;
  v_group   uuid := gen_random_uuid();
begin
  if char_length(v_actor) not between 2 and 32 or v_actor ~ '[[:cntrl:]<>]' then
    perform private.fail('Zadej přezdívku (2–32 znaků), ať je v historii vidět, kdo změnu udělal.');
  end if;
  if p_device is null then
    perform private.fail('Chybí identifikátor zařízení. Obnov stránku.');
  end if;

  v_headers := coalesce(nullif(current_setting('request.headers', true), '')::jsonb, '{}'::jsonb);
  v_ip := coalesce(
    nullif(btrim(v_headers ->> 'cf-connecting-ip'), ''),
    nullif(btrim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''),
    'unknown'
  );
  v_client := private.hash_value('ip:' || v_ip);
  v_device := private.hash_value('device:' || p_device::text);

  delete from private.write_events where at < now() - interval '1 day';

  select count(*) into v_recent
  from private.write_events
  where (client_hash = v_client or device_hash = v_device)
    and at > now() - interval '10 minutes';
  if v_recent >= 150 then
    perform private.fail('Příliš mnoho změn za krátkou dobu. Zkus to prosím za pár minut.', 'PT429');
  end if;

  select count(*) into v_global
  from private.write_events
  where at > now() - interval '1 hour';
  if v_global >= 5000 then
    perform private.fail('Web je teď přetížený změnami. Zkus to prosím později.', 'PT429');
  end if;

  insert into private.write_events (client_hash, device_hash) values (v_client, v_device);

  perform set_config('app.change_group', v_group::text, true);
  perform set_config('app.source', 'web', true);
  perform set_config('app.action', p_action, true);
  perform set_config('app.actor_name', v_actor, true);
  perform set_config('app.device_hash', v_device, true);
  perform set_config('app.reverts_group', '', true);
  perform set_config('app.derived', 'off', true);
  return v_group;
end;
$$;

create function private.clean_player_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if char_length(v) not between 2 and 60 then
    perform private.fail('Jméno hráče musí mít 2–60 znaků.');
  end if;
  if v ~ '[[:cntrl:]0-9<>{}\[\]\\/@#$%^*=_|~"+;:!?&()]' then
    perform private.fail('Jméno hráče obsahuje nepovolené znaky.');
  end if;
  return v;
end;
$$;

create function private.check_jersey(p_number integer)
returns smallint
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_number is not null and p_number not between 0 and 99 then
    perform private.fail('Číslo dresu musí být 0–99.');
  end if;
  return p_number::smallint;
end;
$$;

-- A player can have stats in a game only if his team played it and the game already took place.
create function private.assert_player_in_game(p_game_id integer, p_player_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_game   public.games;
  v_player public.players;
begin
  select * into v_game from public.games where id = p_game_id;
  if not found then
    perform private.fail('Zápas neexistuje.');
  end if;
  select * into v_player from public.players where id = p_player_id;
  if not found then
    perform private.fail('Hráč neexistuje.');
  end if;
  if v_player.season_id <> v_game.season_id
     or v_player.team_id not in (v_game.home_team_id, v_game.away_team_id) then
    perform private.fail('Hráč nehraje za žádný z týmů tohoto zápasu.');
  end if;
  if v_game.status in ('cancelled', 'canceled') then
    perform private.fail('Zápas byl zrušen.');
  end if;
  if not (v_game.status = 'played' or (v_game.starts_at is not null and v_game.starts_at <= now())) then
    perform private.fail('Statistiky lze zadávat jen do odehraných zápasů.');
  end if;
end;
$$;

-- =============================================================================
-- Triggers
-- =============================================================================

-- Bumps updated_at and version only when the data really changed.
create function private.touch_row()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (to_jsonb(new) - 'updated_at' - 'version') = (to_jsonb(old) - 'updated_at' - 'version') then
    new.updated_at := old.updated_at;
    new.version := old.version;
  else
    new.updated_at := now();
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;

create trigger players_touch before update on public.players
  for each row execute function private.touch_row();
create trigger plate_appearances_touch before update on public.plate_appearances
  for each row execute function private.touch_row();
create trigger game_player_extras_touch before update on public.game_player_extras
  for each row execute function private.touch_row();

-- Integrity rules for plate appearances (apply to every write path).
create function private.check_plate_appearance()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if tg_op = 'UPDATE' and (new.game_id <> old.game_id or new.player_id <> old.player_id) then
    perform private.fail('Zápas ani hráče u zapsaného výsledku nelze měnit.');
  end if;

  perform private.assert_player_in_game(new.game_id, new.player_id);

  if new.deleted_at is null and (tg_op = 'INSERT' or old.deleted_at is not null) then
    select count(*) into v_count
    from public.plate_appearances
    where game_id = new.game_id and player_id = new.player_id
      and deleted_at is null and id <> new.id;
    if v_count >= 10 then
      perform private.fail('Hráč už má v tomto zápase 10 příchodů na pálku, víc nelze.');
    end if;
  end if;
  return new;
end;
$$;

create trigger plate_appearances_check before insert or update on public.plate_appearances
  for each row execute function private.check_plate_appearance();

-- Integrity rules for runs / stolen bases.
create function private.check_extras()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hr integer;
begin
  if tg_op = 'UPDATE' and (new.game_id <> old.game_id or new.player_id <> old.player_id) then
    perform private.fail('Zápas ani hráče nelze měnit.');
  end if;
  if tg_op = 'INSERT' then
    perform private.assert_player_in_game(new.game_id, new.player_id);
  end if;

  select count(*) into v_hr
  from public.plate_appearances
  where game_id = new.game_id and player_id = new.player_id
    and result = 'HR' and deleted_at is null;
  if new.runs < v_hr then
    perform private.fail(format('Hráč má v zápase %s HR, doběhů (R) proto nemůže mít méně.', v_hr));
  end if;
  return new;
end;
$$;

create trigger game_player_extras_check before insert or update on public.game_player_extras
  for each row execute function private.check_extras();

-- A home run means the batter scored: keep R in sync when an HR appears or disappears.
create function private.sync_home_run_runs()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was boolean := tg_op = 'UPDATE' and old.deleted_at is null and old.result = 'HR';
  v_is  boolean := new.deleted_at is null and new.result = 'HR';
  v_delta integer := v_is::integer - v_was::integer;
begin
  if v_delta = 0 then
    return null;
  end if;

  perform set_config('app.derived', 'on', true);
  -- Update first: an INSERT … ON CONFLICT would run the insert checks on a
  -- proposed row that never gets stored.
  update public.game_player_extras
  set runs = greatest(runs + v_delta, 0)
  where game_id = new.game_id and player_id = new.player_id;
  if not found and v_delta > 0 then
    insert into public.game_player_extras (game_id, player_id, runs)
    values (new.game_id, new.player_id, v_delta)
    on conflict (game_id, player_id)
    do update set runs = public.game_player_extras.runs + v_delta;
  end if;
  perform set_config('app.derived', 'off', true);
  return null;
end;
$$;

create trigger plate_appearances_sync_runs after insert or update on public.plate_appearances
  for each row execute function private.sync_home_run_runs();

-- History logging.
create function private.log_change()
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

create trigger players_log after insert or update on public.players
  for each row execute function private.log_change();
create trigger plate_appearances_log after insert or update on public.plate_appearances
  for each row execute function private.log_change();
create trigger game_player_extras_log after insert or update on public.game_player_extras
  for each row execute function private.log_change();

-- Hard deletes are never allowed on user data, not even for privileged roles by accident.
create function private.forbid_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform private.fail('Mazání je zakázané. Použij měkké smazání, aby zůstala historie.');
  return null;
end;
$$;

create trigger players_no_delete before delete on public.players
  for each row execute function private.forbid_delete();
create trigger plate_appearances_no_delete before delete on public.plate_appearances
  for each row execute function private.forbid_delete();
create trigger game_player_extras_no_delete before delete on public.game_player_extras
  for each row execute function private.forbid_delete();
create trigger change_log_no_delete before delete on public.change_log
  for each row execute function private.forbid_delete();
create trigger change_groups_no_delete before delete on public.change_groups
  for each row execute function private.forbid_delete();

-- =============================================================================
-- Public write API (called from the browser with the anon key)
-- =============================================================================

create function public.add_plate_appearance(
  p_game_id   integer,
  p_player_id uuid,
  p_result    text,
  p_actor     text,
  p_device    uuid,
  p_rbi       integer default null
)
returns public.plate_appearances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plate_appearances;
  v_rbi integer;
begin
  perform private.begin_write('add_plate_appearance', p_actor, p_device);

  if p_result is null or p_result not in ('1B','2B','3B','HR','BB','HBP','K','OUT','FC','ROE','SF','SH') then
    perform private.fail('Neznámý výsledek na pálce.');
  end if;
  v_rbi := coalesce(p_rbi, case when p_result in ('HR', 'SF') then 1 else 0 end);
  if v_rbi not between 0 and 4 then
    perform private.fail('RBI musí být 0–4.');
  end if;
  if p_result in ('HR', 'SF') and v_rbi < 1 then
    perform private.fail('HR i SF mají vždy aspoň 1 RBI.');
  end if;

  insert into public.plate_appearances (game_id, player_id, result, rbi)
  values (p_game_id, p_player_id, p_result, v_rbi)
  returning * into v_row;
  return v_row;
end;
$$;

create function public.update_plate_appearance(
  p_id               uuid,
  p_expected_version integer,
  p_actor            text,
  p_device           uuid,
  p_result           text default null,
  p_rbi              integer default null
)
returns public.plate_appearances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row    public.plate_appearances;
  v_result text;
  v_rbi    integer;
begin
  perform private.begin_write('update_plate_appearance', p_actor, p_device);

  select * into v_row from public.plate_appearances where id = p_id for update;
  if not found or v_row.deleted_at is not null then
    perform private.fail('Záznam neexistuje nebo byl smazán.');
  end if;
  if v_row.version <> p_expected_version then
    perform private.fail('Záznam mezitím upravil někdo jiný. Načti zápas znovu.', 'PT409');
  end if;

  v_result := coalesce(p_result, v_row.result);
  if v_result not in ('1B','2B','3B','HR','BB','HBP','K','OUT','FC','ROE','SF','SH') then
    perform private.fail('Neznámý výsledek na pálce.');
  end if;
  v_rbi := coalesce(p_rbi, v_row.rbi);
  if v_result in ('HR', 'SF') and v_rbi < 1 then
    v_rbi := 1;
  end if;
  if v_rbi not between 0 and 4 then
    perform private.fail('RBI musí být 0–4.');
  end if;

  update public.plate_appearances
  set result = v_result, rbi = v_rbi
  where id = p_id
  returning * into v_row;
  return v_row;
end;
$$;

create function public.delete_plate_appearance(
  p_id               uuid,
  p_expected_version integer,
  p_actor            text,
  p_device           uuid
)
returns public.plate_appearances
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.plate_appearances;
begin
  perform private.begin_write('delete_plate_appearance', p_actor, p_device);

  select * into v_row from public.plate_appearances where id = p_id for update;
  if not found or v_row.deleted_at is not null then
    perform private.fail('Záznam neexistuje nebo už byl smazán.');
  end if;
  if v_row.version <> p_expected_version then
    perform private.fail('Záznam mezitím upravil někdo jiný. Načti zápas znovu.', 'PT409');
  end if;

  update public.plate_appearances set deleted_at = now() where id = p_id returning * into v_row;
  return v_row;
end;
$$;

-- Runs (R) and stolen bases (SB) are changed by +1 / -1 so that two people
-- tapping at the same time never overwrite each other.
create function public.bump_player_game_stat(
  p_game_id   integer,
  p_player_id uuid,
  p_stat      text,
  p_delta     integer,
  p_actor     text,
  p_device    uuid
)
returns public.game_player_extras
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row     public.game_player_extras;
  v_current integer;
begin
  perform private.begin_write('bump_player_game_stat', p_actor, p_device);

  if p_stat is null or p_stat not in ('runs', 'stolen_bases') then
    perform private.fail('Neznámá statistika.');
  end if;
  if p_delta is null or p_delta not in (-1, 1) then
    perform private.fail('Hodnotu lze měnit jen o 1.');
  end if;

  select * into v_row
  from public.game_player_extras
  where game_id = p_game_id and player_id = p_player_id
  for update;
  v_current := coalesce(case when p_stat = 'runs' then v_row.runs else v_row.stolen_bases end, 0);

  if v_current + p_delta < 0 then
    perform private.fail(case when p_stat = 'runs'
      then 'Doběhy (R) nemohou být záporné.'
      else 'Ukradené mety (SB) nemohou být záporné.' end);
  end if;
  if v_current + p_delta > 20 then
    perform private.fail('Víc než 20 v jednom zápase nejde.');
  end if;

  if v_row.game_id is not null then
    update public.game_player_extras
    set runs         = runs + case when p_stat = 'runs' then p_delta else 0 end,
        stolen_bases = stolen_bases + case when p_stat = 'stolen_bases' then p_delta else 0 end
    where game_id = p_game_id and player_id = p_player_id
    returning * into v_row;
  else
    -- first value for this player in this game (p_delta is +1 here)
    insert into public.game_player_extras (game_id, player_id, runs, stolen_bases)
    values (p_game_id, p_player_id,
            case when p_stat = 'runs' then p_delta else 0 end,
            case when p_stat = 'stolen_bases' then p_delta else 0 end)
    on conflict (game_id, player_id) do update
    set runs         = public.game_player_extras.runs + excluded.runs,
        stolen_bases = public.game_player_extras.stolen_bases + excluded.stolen_bases
    returning * into v_row;
  end if;
  return v_row;
end;
$$;

create function public.add_player(
  p_season_id     integer,
  p_team_id       integer,
  p_name          text,
  p_actor         text,
  p_device        uuid,
  p_jersey_number integer default null
)
returns public.players
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.players;
begin
  perform private.begin_write('add_player', p_actor, p_device);

  if not exists (select 1 from public.season_teams where season_id = p_season_id and team_id = p_team_id) then
    perform private.fail('Tým v této sezóně nehraje.');
  end if;

  insert into public.players (season_id, team_id, name, jersey_number, source, edited_manually)
  values (p_season_id, p_team_id, private.clean_player_name(p_name), private.check_jersey(p_jersey_number), 'manual', true)
  returning * into v_row;
  return v_row;
end;
$$;

create function public.update_player(
  p_id               uuid,
  p_expected_version integer,
  p_name             text,
  p_actor            text,
  p_device           uuid,
  p_jersey_number    integer default null
)
returns public.players
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.players;
begin
  perform private.begin_write('update_player', p_actor, p_device);

  select * into v_row from public.players where id = p_id for update;
  if not found then
    perform private.fail('Hráč neexistuje.');
  end if;
  if v_row.version <> p_expected_version then
    perform private.fail('Hráče mezitím upravil někdo jiný. Načti stránku znovu.', 'PT409');
  end if;

  update public.players
  set name = private.clean_player_name(p_name),
      jersey_number = private.check_jersey(p_jersey_number),
      edited_manually = true
  where id = p_id
  returning * into v_row;
  return v_row;
end;
$$;

create function public.set_player_active(
  p_id               uuid,
  p_expected_version integer,
  p_active           boolean,
  p_actor            text,
  p_device           uuid
)
returns public.players
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.players;
begin
  perform private.begin_write(case when p_active then 'restore_player' else 'remove_player' end, p_actor, p_device);

  if p_active is null then
    perform private.fail('Chybí hodnota.');
  end if;
  select * into v_row from public.players where id = p_id for update;
  if not found then
    perform private.fail('Hráč neexistuje.');
  end if;
  if v_row.version <> p_expected_version then
    perform private.fail('Hráče mezitím upravil někdo jiný. Načti stránku znovu.', 'PT409');
  end if;

  update public.players
  set active = p_active, edited_manually = true
  where id = p_id
  returning * into v_row;
  return v_row;
end;
$$;

-- Reverts one change group (one user action). The revert is itself a new change
-- group, so it can be reverted again. Automatic follow-up changes (is_derived)
-- are skipped because reverting the main change re-creates them.
create function public.revert_change_group(
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
  v_target    public.change_groups;
  v_entry     public.change_log;
  v_current   jsonb;
  v_new_group uuid;
begin
  v_new_group := private.begin_write('revert', p_actor, p_device);
  perform set_config('app.reverts_group', p_group_id::text, true);

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
    if v_entry.table_name = 'plate_appearances' then
      select to_jsonb(t) into v_current from public.plate_appearances t
      where t.id = v_entry.row_id::uuid for update;
    elsif v_entry.table_name = 'game_player_extras' then
      select to_jsonb(t) into v_current from public.game_player_extras t
      where t.game_id = (v_entry.new_data ->> 'game_id')::integer
        and t.player_id = (v_entry.new_data ->> 'player_id')::uuid
      for update;
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
      where game_id = (v_entry.new_data ->> 'game_id')::integer
        and player_id = (v_entry.new_data ->> 'player_id')::uuid;
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

  update public.change_groups set reverted_by_group_id = v_new_group where id = p_group_id;
  return v_new_group;
end;
$$;

-- =============================================================================
-- Import (service role only; called by the scheduled Netlify function)
-- =============================================================================

create function public.import_season(p_payload jsonb)
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

  -- rosters (only teams whose roster was downloaded successfully are touched)
  for v_roster in select * from jsonb_array_elements(coalesce(p_payload -> 'rosters', '[]'::jsonb))
  loop
    v_team_id := (v_roster ->> 'team_id')::integer;

    insert into public.players (season_id, team_id, name, jersey_number, source, external_id)
    select v_season_id, v_team_id, x.name, x.jersey_number, 'import', x.external_id
    from jsonb_to_recordset(v_roster -> 'players') as x(external_id integer, name text, jersey_number smallint)
    on conflict (external_id) do update
    set name = excluded.name, jersey_number = excluded.jersey_number, active = true
    where not public.players.edited_manually
      and (public.players.name, public.players.jersey_number, public.players.active)
          is distinct from (excluded.name, excluded.jersey_number, true);
    get diagnostics v_n = row_count;
    v_players_upserted := v_players_upserted + v_n;

    select coalesce(array_agg((p ->> 'external_id')::integer), '{}') into v_ids
    from jsonb_array_elements(v_roster -> 'players') p;

    update public.players
    set active = false
    where season_id = v_season_id and team_id = v_team_id
      and source = 'import' and not edited_manually and active
      and external_id <> all (v_ids);
    get diagnostics v_n = row_count;
    v_players_removed := v_players_removed + v_n;
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

-- =============================================================================
-- Statistics. Formulas (official scoring rules):
--   AB  = 1B + 2B + 3B + HR + K + OUT + FC + ROE
--   PA  = AB + BB + HBP + SF + SH
--   H   = 1B + 2B + 3B + HR
--   TB  = 1B + 2·2B + 3·3B + 4·HR
--   AVG = H / AB
--   OBP = (H + BB + HBP) / (AB + BB + HBP + SF)
--   SLG = TB / AB
--   OPS = OBP + SLG
-- A rate is NULL when its denominator is 0 (shown as "—" in the UI).
-- =============================================================================

create function public.stat_avg(p_h numeric, p_ab numeric)
returns numeric language sql immutable set search_path = ''
as $$ select case when p_ab > 0 then p_h / p_ab end $$;

create function public.stat_obp(p_h numeric, p_bb numeric, p_hbp numeric, p_ab numeric, p_sf numeric)
returns numeric language sql immutable set search_path = ''
as $$ select case when (p_ab + p_bb + p_hbp + p_sf) > 0
                  then (p_h + p_bb + p_hbp) / (p_ab + p_bb + p_hbp + p_sf) end $$;

create function public.stat_slg(p_tb numeric, p_ab numeric)
returns numeric language sql immutable set search_path = ''
as $$ select case when p_ab > 0 then p_tb / p_ab end $$;

create function public.stat_ops(p_h numeric, p_bb numeric, p_hbp numeric, p_ab numeric, p_sf numeric, p_tb numeric)
returns numeric language sql immutable set search_path = ''
as $$ select public.stat_obp(p_h, p_bb, p_hbp, p_ab, p_sf) + public.stat_slg(p_tb, p_ab) $$;

-- One row per player per game (the single source of all statistics).
create view public.player_game_batting
with (security_invoker = true)
as
with pa as (
  select
    game_id,
    player_id,
    count(*)                                                                  as pa,
    count(*) filter (where result in ('1B','2B','3B','HR','K','OUT','FC','ROE')) as ab,
    count(*) filter (where result in ('1B','2B','3B','HR'))                   as h,
    count(*) filter (where result = '1B')                                     as singles,
    count(*) filter (where result = '2B')                                     as doubles,
    count(*) filter (where result = '3B')                                     as triples,
    count(*) filter (where result = 'HR')                                     as hr,
    coalesce(sum(case result when '1B' then 1 when '2B' then 2 when '3B' then 3 when 'HR' then 4 else 0 end), 0) as tb,
    coalesce(sum(rbi), 0)                                                     as rbi,
    count(*) filter (where result = 'BB')                                     as bb,
    count(*) filter (where result = 'K')                                      as k,
    count(*) filter (where result = 'HBP')                                    as hbp,
    count(*) filter (where result = 'SF')                                     as sf,
    count(*) filter (where result = 'SH')                                     as sh
  from public.plate_appearances
  where deleted_at is null
  group by game_id, player_id
),
lines as (
  select
    coalesce(pa.game_id, x.game_id)       as game_id,
    coalesce(pa.player_id, x.player_id)   as player_id,
    coalesce(pa.pa, 0)::bigint            as pa,
    coalesce(pa.ab, 0)::bigint            as ab,
    coalesce(pa.h, 0)::bigint             as h,
    coalesce(pa.singles, 0)::bigint       as singles,
    coalesce(pa.doubles, 0)::bigint       as doubles,
    coalesce(pa.triples, 0)::bigint       as triples,
    coalesce(pa.hr, 0)::bigint            as hr,
    coalesce(pa.tb, 0)::bigint            as tb,
    coalesce(pa.rbi, 0)::bigint           as rbi,
    coalesce(x.runs, 0)::bigint           as r,
    coalesce(pa.bb, 0)::bigint            as bb,
    coalesce(pa.k, 0)::bigint             as k,
    coalesce(pa.hbp, 0)::bigint           as hbp,
    coalesce(pa.sf, 0)::bigint            as sf,
    coalesce(pa.sh, 0)::bigint            as sh,
    coalesce(x.stolen_bases, 0)::bigint   as sb
  from pa
  full join public.game_player_extras x
    on x.game_id = pa.game_id and x.player_id = pa.player_id
)
select
  g.season_id,
  l.game_id,
  g.starts_at,
  p.team_id,
  case when p.team_id = g.home_team_id then g.away_team_id else g.home_team_id end as opponent_team_id,
  l.player_id,
  l.pa, l.ab, l.h, l.singles, l.doubles, l.triples, l.hr, l.tb, l.rbi, l.r,
  l.bb, l.k, l.hbp, l.sf, l.sh, l.sb,
  public.stat_avg(l.h, l.ab)                         as avg,
  public.stat_obp(l.h, l.bb, l.hbp, l.ab, l.sf)      as obp,
  public.stat_slg(l.tb, l.ab)                        as slg,
  public.stat_ops(l.h, l.bb, l.hbp, l.ab, l.sf, l.tb) as ops
from lines l
join public.games g   on g.id = l.game_id
join public.players p on p.id = l.player_id
where l.pa > 0 or l.r > 0 or l.sb > 0;

create view public.player_season_batting
with (security_invoker = true)
as
select
  season_id, team_id, player_id,
  count(*)::bigint as games,
  sum(pa)::bigint as pa, sum(ab)::bigint as ab, sum(h)::bigint as h,
  sum(singles)::bigint as singles, sum(doubles)::bigint as doubles, sum(triples)::bigint as triples,
  sum(hr)::bigint as hr, sum(tb)::bigint as tb, sum(rbi)::bigint as rbi, sum(r)::bigint as r,
  sum(bb)::bigint as bb, sum(k)::bigint as k, sum(hbp)::bigint as hbp, sum(sf)::bigint as sf,
  sum(sh)::bigint as sh, sum(sb)::bigint as sb,
  public.stat_avg(sum(h), sum(ab))                                    as avg,
  public.stat_obp(sum(h), sum(bb), sum(hbp), sum(ab), sum(sf))        as obp,
  public.stat_slg(sum(tb), sum(ab))                                   as slg,
  public.stat_ops(sum(h), sum(bb), sum(hbp), sum(ab), sum(sf), sum(tb)) as ops
from public.player_game_batting
group by season_id, team_id, player_id;

create view public.team_game_batting
with (security_invoker = true)
as
select
  season_id, game_id, starts_at, team_id, opponent_team_id,
  count(*)::bigint as players,
  sum(pa)::bigint as pa, sum(ab)::bigint as ab, sum(h)::bigint as h,
  sum(singles)::bigint as singles, sum(doubles)::bigint as doubles, sum(triples)::bigint as triples,
  sum(hr)::bigint as hr, sum(tb)::bigint as tb, sum(rbi)::bigint as rbi, sum(r)::bigint as r,
  sum(bb)::bigint as bb, sum(k)::bigint as k, sum(hbp)::bigint as hbp, sum(sf)::bigint as sf,
  sum(sh)::bigint as sh, sum(sb)::bigint as sb,
  public.stat_avg(sum(h), sum(ab))                                    as avg,
  public.stat_obp(sum(h), sum(bb), sum(hbp), sum(ab), sum(sf))        as obp,
  public.stat_slg(sum(tb), sum(ab))                                   as slg,
  public.stat_ops(sum(h), sum(bb), sum(hbp), sum(ab), sum(sf), sum(tb)) as ops
from public.player_game_batting
group by season_id, game_id, starts_at, team_id, opponent_team_id;

create view public.team_season_batting
with (security_invoker = true)
as
select
  season_id, team_id,
  count(*)::bigint as games,
  sum(pa)::bigint as pa, sum(ab)::bigint as ab, sum(h)::bigint as h,
  sum(singles)::bigint as singles, sum(doubles)::bigint as doubles, sum(triples)::bigint as triples,
  sum(hr)::bigint as hr, sum(tb)::bigint as tb, sum(rbi)::bigint as rbi, sum(r)::bigint as r,
  sum(bb)::bigint as bb, sum(k)::bigint as k, sum(hbp)::bigint as hbp, sum(sf)::bigint as sf,
  sum(sh)::bigint as sh, sum(sb)::bigint as sb,
  public.stat_avg(sum(h), sum(ab))                                    as avg,
  public.stat_obp(sum(h), sum(bb), sum(hbp), sum(ab), sum(sf))        as obp,
  public.stat_slg(sum(tb), sum(ab))                                   as slg,
  public.stat_ops(sum(h), sum(bb), sum(hbp), sum(ab), sum(sf), sum(tb)) as ops
from public.team_game_batting
group by season_id, team_id;

-- Player totals with filters (team, game, date range in Prague time, minimum PA).
create function public.batting_totals(
  p_season_id integer,
  p_team_id   integer default null,
  p_game_id   integer default null,
  p_from      date    default null,
  p_to        date    default null,
  p_min_pa    integer default 0
)
returns table (
  season_id integer, team_id integer, player_id uuid, games bigint,
  pa bigint, ab bigint, h bigint, singles bigint, doubles bigint, triples bigint, hr bigint,
  tb bigint, rbi bigint, r bigint, bb bigint, k bigint, hbp bigint, sf bigint, sh bigint, sb bigint,
  avg numeric, obp numeric, slg numeric, ops numeric
)
language sql
stable
set search_path = ''
as $$
  select
    b.season_id, b.team_id, b.player_id,
    count(*)::bigint,
    sum(b.pa)::bigint, sum(b.ab)::bigint, sum(b.h)::bigint,
    sum(b.singles)::bigint, sum(b.doubles)::bigint, sum(b.triples)::bigint, sum(b.hr)::bigint,
    sum(b.tb)::bigint, sum(b.rbi)::bigint, sum(b.r)::bigint, sum(b.bb)::bigint, sum(b.k)::bigint,
    sum(b.hbp)::bigint, sum(b.sf)::bigint, sum(b.sh)::bigint, sum(b.sb)::bigint,
    public.stat_avg(sum(b.h), sum(b.ab)),
    public.stat_obp(sum(b.h), sum(b.bb), sum(b.hbp), sum(b.ab), sum(b.sf)),
    public.stat_slg(sum(b.tb), sum(b.ab)),
    public.stat_ops(sum(b.h), sum(b.bb), sum(b.hbp), sum(b.ab), sum(b.sf), sum(b.tb))
  from public.player_game_batting b
  where b.season_id = p_season_id
    and (p_team_id is null or b.team_id = p_team_id)
    and (p_game_id is null or b.game_id = p_game_id)
    and (p_from is null or (b.starts_at at time zone 'Europe/Prague')::date >= p_from)
    and (p_to   is null or (b.starts_at at time zone 'Europe/Prague')::date <= p_to)
  group by b.season_id, b.team_id, b.player_id
  having sum(b.pa) >= coalesce(p_min_pa, 0);
$$;

-- Team totals with the same filters.
create function public.team_batting_totals(
  p_season_id integer,
  p_team_id   integer default null,
  p_game_id   integer default null,
  p_from      date    default null,
  p_to        date    default null
)
returns table (
  season_id integer, team_id integer, games bigint,
  pa bigint, ab bigint, h bigint, singles bigint, doubles bigint, triples bigint, hr bigint,
  tb bigint, rbi bigint, r bigint, bb bigint, k bigint, hbp bigint, sf bigint, sh bigint, sb bigint,
  avg numeric, obp numeric, slg numeric, ops numeric
)
language sql
stable
set search_path = ''
as $$
  select
    b.season_id, b.team_id,
    count(distinct b.game_id)::bigint,
    sum(b.pa)::bigint, sum(b.ab)::bigint, sum(b.h)::bigint,
    sum(b.singles)::bigint, sum(b.doubles)::bigint, sum(b.triples)::bigint, sum(b.hr)::bigint,
    sum(b.tb)::bigint, sum(b.rbi)::bigint, sum(b.r)::bigint, sum(b.bb)::bigint, sum(b.k)::bigint,
    sum(b.hbp)::bigint, sum(b.sf)::bigint, sum(b.sh)::bigint, sum(b.sb)::bigint,
    public.stat_avg(sum(b.h), sum(b.ab)),
    public.stat_obp(sum(b.h), sum(b.bb), sum(b.hbp), sum(b.ab), sum(b.sf)),
    public.stat_slg(sum(b.tb), sum(b.ab)),
    public.stat_ops(sum(b.h), sum(b.bb), sum(b.hbp), sum(b.ab), sum(b.sf), sum(b.tb))
  from public.player_game_batting b
  where b.season_id = p_season_id
    and (p_team_id is null or b.team_id = p_team_id)
    and (p_game_id is null or b.game_id = p_game_id)
    and (p_from is null or (b.starts_at at time zone 'Europe/Prague')::date >= p_from)
    and (p_to   is null or (b.starts_at at time zone 'Europe/Prague')::date <= p_to)
  group by b.season_id, b.team_id;
$$;

-- =============================================================================
-- Row level security and privileges
-- =============================================================================

alter table public.seasons            enable row level security;
alter table public.teams              enable row level security;
alter table public.season_teams       enable row level security;
alter table public.games              enable row level security;
alter table public.standings          enable row level security;
alter table public.players            enable row level security;
alter table public.plate_appearances  enable row level security;
alter table public.game_player_extras enable row level security;
alter table public.change_groups      enable row level security;
alter table public.change_log         enable row level security;

create policy "public read" on public.seasons            for select to anon, authenticated using (true);
create policy "public read" on public.teams              for select to anon, authenticated using (true);
create policy "public read" on public.season_teams       for select to anon, authenticated using (true);
create policy "public read" on public.games              for select to anon, authenticated using (true);
create policy "public read" on public.standings          for select to anon, authenticated using (true);
create policy "public read" on public.players            for select to anon, authenticated using (true);
create policy "public read" on public.plate_appearances  for select to anon, authenticated using (true);
create policy "public read" on public.game_player_extras for select to anon, authenticated using (true);
create policy "public read" on public.change_groups      for select to anon, authenticated using (true);
create policy "public read" on public.change_log         for select to anon, authenticated using (true);
-- No insert / update / delete policies: with RLS enabled this denies all direct writes.

revoke all on all tables in schema public from anon, authenticated;
grant select on
  public.seasons, public.teams, public.season_teams, public.games, public.standings,
  public.players, public.plate_appearances, public.game_player_extras,
  public.change_groups, public.change_log,
  public.player_game_batting, public.player_season_batting,
  public.team_game_batting, public.team_season_batting
to anon, authenticated;

-- Functions: nothing is executable by default, then grant explicitly.
revoke all on all functions in schema private from public;
revoke all on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.add_plate_appearance(integer, uuid, text, text, uuid, integer),
  public.update_plate_appearance(uuid, integer, text, uuid, text, integer),
  public.delete_plate_appearance(uuid, integer, text, uuid),
  public.bump_player_game_stat(integer, uuid, text, integer, text, uuid),
  public.add_player(integer, integer, text, text, uuid, integer),
  public.update_player(uuid, integer, text, text, uuid, integer),
  public.set_player_active(uuid, integer, boolean, text, uuid),
  public.revert_change_group(uuid, text, uuid, boolean),
  public.batting_totals(integer, integer, integer, date, date, integer),
  public.team_batting_totals(integer, integer, integer, date, date),
  public.stat_avg(numeric, numeric),
  public.stat_obp(numeric, numeric, numeric, numeric, numeric),
  public.stat_slg(numeric, numeric),
  public.stat_ops(numeric, numeric, numeric, numeric, numeric, numeric)
to anon, authenticated;

grant execute on function public.import_season(jsonb) to service_role;

-- Live updates in the browser (Supabase Realtime), if the publication exists.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime
      add table public.plate_appearances, public.game_player_extras, public.players, public.games;
  end if;
end;
$$;

commit;
