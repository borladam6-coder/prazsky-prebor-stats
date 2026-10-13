-- =============================================================================
-- Pražský přebor – statistiky
-- Migration 016: a double or a triple does not end on a lower base
--
-- Since 014 a hit accepts the batter out (batter_to = 0); the destination table then
-- also let a double end on 1st and a triple on 1st or 2nd. check_play_rules() refuses that.
--
-- Run once in Supabase → SQL Editor after 015. One transaction.
-- =============================================================================

begin;

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

  -- a double or a triple never ends on a lower base (out trying for more is 0)
  if p_result in ('2B', '3B') and p_batter_to between 1 and (case p_result when '2B' then 1 else 2 end) then
    perform private.fail('Pálkař s tímto výsledkem nemůže skončit na zadané metě.');
  end if;

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

revoke all on all functions in schema private from public;

commit;
