-- =============================================================================
-- Pražský přebor – statistiky
-- Migration 009: softball terms in English in database messages
--
-- Same functions as before (live_play from 005, live_adjust_runs from 004), only the
-- messages say "stolen base", "sacrifice", "run" instead of the Czech terms.
--
-- Run once in Supabase → SQL Editor after 008. One transaction.
-- =============================================================================

begin;

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

create or replace function public.live_adjust_runs(
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
    perform private.fail('Run lze měnit jen o 1.');
  end if;

  if p_delta < 0 and coalesce((select runs from public.game_player_extras
                               where game_id = p_game_id and player_id = p_player_id), 0) = 0 then
    perform private.fail('Hráč v tomto zápase nemá žádný run.');
  end if;
  perform private.add_extras(p_game_id, p_player_id, p_delta, 0);

  insert into public.live_run_adjustments (game_id, team_id, inning, player_id, delta)
  values (p_game_id, p_team_id, p_inning, p_player_id, p_delta)
  returning * into v_row;
  return v_row;
end;
$$;

commit;
