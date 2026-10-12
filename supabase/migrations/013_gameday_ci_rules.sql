-- =============================================================================
-- Pražský přebor – statistiky
-- Migration 013: game-day scoring, catcher's interference, softball rules, tie-breaker
--
-- * Scoring (live and by hand) opens on the game day (Prague time), not at the start.
-- * New result CI (catcher's interference): a plate appearance, not an at-bat (AB
--   lists the results explicitly, so CI is left out of AB and OBP automatically).
-- * live_play_detailed() refuses what the rules do not allow:
--     - a batter running on a dropped third strike with first base occupied and < 2 outs
--     - runs on a play whose third out is the batter or a force out (only a time play
--       – a runner tagged out after a run crossed – lets the run count)
-- * Tie-breaker: from the 8th inning every half starts with the last batter of the
--   previous half on 2nd base (set by a trigger on the play that ends the half, so
--   taking that play back removes him again).
--
-- Run once in Supabase → SQL Editor after 012. One transaction.
-- =============================================================================

begin;

-- ----------------------------------------------------------------------------- game day
create function private.game_day_started(p_starts_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $$
  select p_starts_at is not null and private.prague_day(p_starts_at) <= private.prague_day(now())
$$;

create or replace function private.assert_player_in_game(p_game_id integer, p_player_id uuid)
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
  if not (v_game.status = 'played' or private.game_day_started(v_game.starts_at)) then
    perform private.fail('Statistiky lze zadávat od dne zápasu.');
  end if;
end;
$$;

create or replace function private.assert_live_team(p_game_id integer, p_team_id integer)
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
  if not (v_game.status = 'played' or private.game_day_started(v_game.starts_at)) then
    perform private.fail('Živě lze zapisovat od dne zápasu.');
  end if;
  return v_game;
end;
$$;

-- ----------------------------------------------------------------------------- CI
alter table public.plate_appearances drop constraint plate_appearances_result_check;
alter table public.plate_appearances add constraint plate_appearances_result_check
  check (result in ('1B','2B','3B','HR','BB','HBP','K','OUT','FC','ROE','SF','SH','CI'));
alter table public.live_play_details drop constraint live_play_details_result_check;
alter table public.live_play_details add constraint live_play_details_result_check
  check (result in ('1B','2B','3B','HR','BB','HBP','K','OUT','FC','ROE','SF','SH','CI'));

create or replace function public.add_plate_appearance(
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

  if p_result is null or p_result not in ('1B','2B','3B','HR','BB','HBP','K','OUT','FC','ROE','SF','SH','CI') then
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

create or replace function public.update_plate_appearance(
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
  if v_result not in ('1B','2B','3B','HR','BB','HBP','K','OUT','FC','ROE','SF','SH','CI') then
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

  if p_result is not null and p_result not in ('1B','2B','3B','HR','BB','HBP','K','OUT','FC','ROE','SF','SH','CI') then
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
      perform private.fail('Stolen base lze zapsat jen mimo odpal a jen s postupem běžce.');
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
      perform private.fail('Sacrifice jde jen při méně než 2 outech.');
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
      perform private.fail('U sacrifice fly musí aspoň jeden běžec skórovat.');
    end if;

    v_rbi := coalesce(p_rbi,
      case when p_result in ('ROE', 'K') or v_outs >= 2 then 0 else v_runs end);
    if p_result in ('HR', 'SF') then
      v_rbi := greatest(v_rbi, 1);
    end if;
    if v_rbi < 0 or v_rbi > least(4, v_runs) then
      perform private.fail('RBI nemůže být víc než runs v této akci.');
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

-- ----------------------------------------------------------------------------- rules
create function private.check_play_rules(p_before public.live_sessions, p_result text, p_batter_to integer, p_runners jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_occ    boolean[];
  v_outs   integer;
  v_runs   integer;
  v_forced boolean;
begin
  if p_before.game_id is null then
    return;
  end if;
  v_occ := array[p_before.runner_1 is not null, p_before.runner_2 is not null, p_before.runner_3 is not null];

  -- dropped third strike: the batter may run only with first base empty or two outs
  if p_result = 'K' and coalesce(p_batter_to, 0) > 0 and v_occ[1] and p_before.outs < 2 then
    perform private.fail('Na dropped third strike smí pálkař běžet jen při volné 1. metě nebo při 2 outech.');
  end if;

  select (case when p_result is not null and p_batter_to = 0 then 1 else 0 end)
       + count(*) filter (where (value ->> 'to')::integer = 0),
         (case when p_batter_to = 4 then 1 else 0 end)
       + count(*) filter (where (value ->> 'to')::integer = 4),
         -- a runner put out while every base behind him was taken (the batter running)
         coalesce(bool_or(
           (value ->> 'to')::integer = 0
           and ((value ->> 'from')::integer < 2 or v_occ[1])
           and ((value ->> 'from')::integer < 3 or v_occ[2])
         ), false)
    into v_outs, v_runs, v_forced
  from jsonb_array_elements(coalesce(p_runners, '[]'::jsonb));

  -- runs on the third out count only on a time play (a runner tagged out, batter safe)
  if p_result is not null and p_before.outs + v_outs >= 3 and v_runs > 0
     and (coalesce(p_batter_to, 0) = 0 or v_forced) then
    perform private.fail('Při 3. outu, kdy je out pálkař nebo force out, se run nepočítá.');
  end if;
end;
$$;

create or replace function public.live_play_detailed(
  p_client_id        uuid,
  p_game_id          integer,
  p_team_id          integer,
  p_expected_version integer,
  p_result           text,
  p_batter_to        integer,
  p_runners          jsonb,
  p_rbi              integer,
  p_kind             text,
  p_location         text,
  p_actor            text,
  p_device           uuid
)
returns public.live_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_before  public.live_sessions;
  v_lineup  uuid[];
  v_s       public.live_sessions;
  v_count   integer;
  v_moves   jsonb := '[]'::jsonb;
  v_item    jsonb;
  v_from    integer;
begin
  if p_client_id is null then
    perform private.fail('Chybí identifikátor akce. Obnov stránku.');
  end if;
  if p_kind is not null and p_kind not in ('fly', 'line', 'pop', 'ground', 'fc', 'dp', 'bunt') then
    perform private.fail('Neznámý druh akce.');
  end if;
  if p_location is not null and p_location not in ('P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF') then
    perform private.fail('Neznámé místo odpalu.');
  end if;

  delete from private.live_requests where at < now() - interval '2 days';
  insert into private.live_requests (id) values (p_client_id) on conflict do nothing;
  get diagnostics v_count = row_count;
  if v_count = 0 then
    -- sent twice (the answer got lost): already done
    select * into v_s from public.live_sessions where game_id = p_game_id and team_id = p_team_id;
    if not found then
      perform private.fail('Živý zápis tohoto týmu ještě nezačal.');
    end if;
    return v_s;
  end if;

  select * into v_before from public.live_sessions where game_id = p_game_id and team_id = p_team_id;
  select players into v_lineup from public.live_lineups where game_id = p_game_id and team_id = p_team_id;

  -- softball rules live_play does not know: dropped third strike, runs on the third out
  perform private.check_play_rules(v_before, p_result, p_batter_to, p_runners);

  v_s := public.live_play(
    p_game_id, p_team_id, p_expected_version, p_result, p_batter_to, p_runners, p_rbi, p_actor, p_device
  );

  -- the runners as they were before the play (live_play has validated the moves)
  for v_item in select value from jsonb_array_elements(coalesce(p_runners, '[]'::jsonb)) loop
    v_from := (v_item ->> 'from')::integer;
    v_moves := v_moves || jsonb_build_array(jsonb_build_object(
      'from', v_from,
      'to', (v_item ->> 'to')::integer,
      'sb', coalesce((v_item ->> 'sb')::boolean, false),
      'player', case v_from when 1 then v_before.runner_1 when 2 then v_before.runner_2 else v_before.runner_3 end
    ));
  end loop;

  insert into public.live_play_details
    (group_id, game_id, team_id, inning, outs_before, batter_id, result, kind, location, batter_to, runners)
  values (
    nullif(current_setting('app.change_group', true), '')::uuid,
    p_game_id, p_team_id, v_before.inning, v_before.outs,
    case when p_result is null then null else v_lineup[v_before.next_slot + 1] end,
    p_result, p_kind, p_location, p_batter_to, v_moves
  );
  return v_s;
end;
$$;

-- ----------------------------------------------------------------------------- tie-breaker
create function private.tiebreak_runner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lineup uuid[];
  v_n      integer;
begin
  if coalesce(current_setting('app.action', true), '') = 'live_play'
     and new.inning > old.inning and new.inning >= 8
     and new.runner_1 is null and new.runner_2 is null and new.runner_3 is null then
    select players into v_lineup from public.live_lineups where game_id = new.game_id and team_id = new.team_id;
    v_n := coalesce(cardinality(v_lineup), 0);
    if v_n > 0 then
      new.runner_2 := v_lineup[((new.next_slot - 1 + v_n) % v_n) + 1];
    end if;
  end if;
  return new;
end;
$$;

create trigger live_sessions_tiebreak before update on public.live_sessions
  for each row execute function private.tiebreak_runner();

revoke all on all functions in schema private from public;

commit;
