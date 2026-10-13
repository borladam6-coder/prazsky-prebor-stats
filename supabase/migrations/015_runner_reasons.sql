-- =============================================================================
-- Pražský přebor – statistiky
-- Migration 015: why a runner moved or was put out; runner interference
--
-- * Every runner in live_play_details.runners gets 'why' (null when not given):
--   sb / wp / pb  advance without a batted ball (only SB counts in the statistics),
--   cs / po       out without a batted ball (caught stealing, picked off),
--   int           out for interference on a batted ball.
--   Older plays have no 'why' key (their runner-only outs read as caught stealing).
-- * Kinds 'rhit' (runner hit by a batted ball: batter 1B) and 'rint' (runner hindered a
--   fielder: batter FC): one runner out with why 'int', the batter on 1st. A run never
--   counts when that out is the third one (dead ball).
-- * live_play_detailed() keeps its signature; live_play() is unchanged.
--
-- Run once in Supabase → SQL Editor after 014. One transaction.
-- =============================================================================

begin;

alter table public.live_play_details drop constraint live_play_details_kind_check;
alter table public.live_play_details
  add constraint live_play_details_kind_check
  check (kind in ('fly', 'line', 'pop', 'ground', 'fc', 'dp', 'bunt', 'rhit', 'rint'));

create or replace function private.check_play_rules(p_before public.live_sessions, p_result text, p_batter_to integer, p_runners jsonb)
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
         -- runner interference ends the play like a force (dead ball)
         coalesce(bool_or(
           (value ->> 'to')::integer = 0
           and (((value ->> 'from')::integer < 2 or v_occ[1])
                and ((value ->> 'from')::integer < 3 or v_occ[2])
                or value ->> 'why' = 'int')
         ), false)
    into v_outs, v_runs, v_forced
  from jsonb_array_elements(coalesce(p_runners, '[]'::jsonb));

  -- runs on the third out count only on a time play (never after runner interference): a runner tagged out with the batter
  -- safe, or the batter tagged out after his hit trying for one more base
  if p_result is not null and p_before.outs + v_outs >= 3 and v_runs > 0
     and ((coalesce(p_batter_to, 0) = 0 and p_result not in ('1B', '2B', '3B')) or v_forced) then
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
  p_device           uuid,
  p_batter_extra     text default null
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
  v_to      integer;
  v_why     text;
  v_int     integer := 0;
begin
  if p_client_id is null then
    perform private.fail('Chybí identifikátor akce. Obnov stránku.');
  end if;
  if p_kind is not null and p_kind not in ('fly', 'line', 'pop', 'ground', 'fc', 'dp', 'bunt', 'rhit', 'rint') then
    perform private.fail('Neznámý druh akce.');
  end if;
  if p_batter_extra is not null and p_batter_extra not in ('error', 'throw') then
    perform private.fail('Neznámý důvod postupu pálkaře.');
  end if;
  -- why each runner moved or was out (live_play checks the moves themselves)
  for v_item in select value from jsonb_array_elements(
      case when jsonb_typeof(p_runners) = 'array' then p_runners else '[]'::jsonb end) loop
    continue when jsonb_typeof(v_item) <> 'object'
      or coalesce(jsonb_typeof(v_item -> 'from'), '') <> 'number'
      or coalesce(jsonb_typeof(v_item -> 'to'), '') <> 'number';
    if coalesce(jsonb_typeof(v_item -> 'why'), 'null') not in ('string', 'null') then
      perform private.fail('Neplatný důvod u běžce.');
    end if;
    v_why := v_item ->> 'why';
    v_from := (v_item ->> 'from')::integer;
    v_to := (v_item ->> 'to')::integer;
    if v_why is null then
      continue;
    end if;
    if v_why not in ('sb', 'wp', 'pb', 'cs', 'po', 'int') then
      perform private.fail('Neznámý důvod u běžce.');
    end if;
    if jsonb_typeof(v_item -> 'sb') = 'boolean' and (v_item ->> 'sb')::boolean <> (v_why = 'sb') then
      perform private.fail('Stolen base nesouhlasí s důvodem postupu.');
    end if;
    if v_why in ('sb', 'wp', 'pb') and (p_result is not null or v_to = 0 or v_to <= v_from) then
      perform private.fail('SB, WP a PB jde zapsat jen u postupu běžce mimo odpal.');
    end if;
    if v_why in ('cs', 'po') and (p_result is not null or v_to <> 0) then
      perform private.fail('Caught stealing a pickoff jde zapsat jen u outu běžce mimo odpal.');
    end if;
    if v_why = 'int' then
      if coalesce(p_kind, '') not in ('rhit', 'rint') or v_to <> 0 then
        perform private.fail('Interference jde zapsat jen u outu běžce při odpalu.');
      end if;
      v_int := v_int + 1;
    end if;
  end loop;
  -- runner interference: one runner out, the batter on 1st with 1B (hit by the ball) or FC
  if p_kind in ('rhit', 'rint') and (
       p_result is distinct from (case p_kind when 'rhit' then '1B' else 'FC' end)
       or p_batter_to is distinct from 1 or v_int <> 1) then
    perform private.fail('Při interference běžce je jeden běžec out a pálkař na 1. metě.');
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
      'why', v_item -> 'why',
      'player', case v_from when 1 then v_before.runner_1 when 2 then v_before.runner_2 else v_before.runner_3 end
    ));
  end loop;

  insert into public.live_play_details
    (group_id, game_id, team_id, inning, outs_before, batter_id, result, kind, location, batter_to, runners, batter_extra)
  values (
    nullif(current_setting('app.change_group', true), '')::uuid,
    p_game_id, p_team_id, v_before.inning, v_before.outs,
    case when p_result is null then null else v_lineup[v_before.next_slot + 1] end,
    p_result, p_kind, p_location, p_batter_to, v_moves, p_batter_extra
  );
  return v_s;
end;
$$;

revoke all on all functions in schema private from public;
revoke all on function public.live_play_detailed(uuid, integer, integer, integer, text, integer, jsonb, integer, text, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.live_play_detailed(uuid, integer, integer, integer, text, integer, jsonb, integer, text, text, text, uuid, text)
  to anon, authenticated;

commit;
