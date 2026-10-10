-- =============================================================================
-- Pražský přebor – statistiky
-- Migration 005: offline-safe live scoring, one source of truth per team
--
--   * live_play_once()  – live_play with a client request id. A play queued on a
--     phone without signal may be sent twice (the answer got lost); the second
--     attempt does nothing and returns the current state.
--   * Manual box-score entry (add/delete a plate appearance, +/- runs and stolen
--     bases) is refused for a team that has live scoring in that game. Its
--     statistics are corrected through the play-by-play instead.
--   * Messages use "out/outy" (softball terminology) instead of "aut/auty".
--
-- Run once in Supabase → SQL Editor after 004. One transaction.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- Messages: "out" instead of "aut" (same functions as in 002, only the texts differ)
-- -----------------------------------------------------------------------------

create or replace function public.live_play(
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
      perform private.fail('Obětovaný odpal jde jen při méně než 2 outech.');
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
    perform private.fail('V jedné směně nemohou být víc než 3 outy.');
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

create or replace function public.live_set_state(
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
    perform private.fail('Outy musí být 0–2.');
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

-- -----------------------------------------------------------------------------
-- Idempotent play
-- -----------------------------------------------------------------------------

create table private.live_requests (
  id uuid        primary key,
  at timestamptz not null default now()
);
create index live_requests_at on private.live_requests (at);

create function public.live_play_once(
  p_client_id        uuid,
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
  v_s     public.live_sessions;
  v_count integer;
begin
  if p_client_id is null then
    perform private.fail('Chybí identifikátor akce. Obnov stránku.');
  end if;

  delete from private.live_requests where at < now() - interval '2 days';

  -- Claim the id first: a concurrent retry waits here until this transaction
  -- ends and then sees the id as already used.
  insert into private.live_requests (id) values (p_client_id) on conflict do nothing;
  get diagnostics v_count = row_count;

  if v_count = 0 then
    select * into v_s from public.live_sessions where game_id = p_game_id and team_id = p_team_id;
    if not found then
      perform private.fail('Živý zápis tohoto týmu ještě nezačal.');
    end if;
    return v_s;
  end if;

  return public.live_play(
    p_game_id, p_team_id, p_expected_version, p_result, p_batter_to, p_runners, p_rbi, p_actor, p_device
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Manual entry vs. live scoring
-- -----------------------------------------------------------------------------

create function private.guard_manual_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('app.action', true), '') not in
     ('add_plate_appearance', 'delete_plate_appearance', 'bump_player_game_stat') then
    return new;
  end if;
  if exists (
    select 1
    from public.live_sessions s
    join public.players p on p.id = new.player_id
    where s.game_id = new.game_id and s.team_id = p.team_id
  ) then
    perform private.fail('Tento tým má v zápase živý zápis. Statistiky oprav v průběhu zápasu na stránce živého zápisu.');
  end if;
  return new;
end;
$$;

create trigger guard_manual_entry
  before insert or update on public.plate_appearances
  for each row execute function private.guard_manual_entry();
create trigger guard_manual_entry
  before insert or update on public.game_player_extras
  for each row execute function private.guard_manual_entry();

revoke all on all functions in schema private from public;
revoke all on function public.live_play_once(uuid, integer, integer, integer, text, integer, jsonb, integer, text, uuid)
  from public, anon, authenticated;
grant execute on function public.live_play_once(uuid, integer, integer, integer, text, integer, jsonb, integer, text, uuid)
  to anon, authenticated;

commit;
