-- =============================================================================
-- Pražský přebor – statistiky
-- Migration 003: undo across both teams of a game
--
-- When both teams are scored live on one device, "undo" must revert the last
-- play of the game, whichever team was batting. live_undo() therefore accepts
-- p_team_id = null, meaning "the latest play of this game".
-- Run once in Supabase → SQL Editor after 002_live.sql. One transaction.
-- =============================================================================

begin;

create or replace function public.live_undo(
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
  v_team      integer;
  v_s         public.live_sessions;
begin
  v_new_group := private.begin_write('revert', p_actor, p_device);

  select l.group_id, (l.new_data ->> 'team_id')::integer into v_target, v_team
  from public.change_log l
  join public.change_groups g on g.id = l.group_id
  where l.game_id = p_game_id
    and l.table_name = 'live_sessions'
    and (p_team_id is null or l.row_id = p_game_id || ':' || p_team_id)
    and g.action = 'live_play'
    and g.reverted_by_group_id is null
  order by l.id desc
  limit 1;
  if v_target is null then
    perform private.fail('Není co vrátit.');
  end if;

  perform private.lock_session(p_game_id, v_team, null, true);
  perform set_config('app.reverts_group', v_target::text, true);
  perform private.revert_group(v_target, false, v_new_group);
  select * into v_s from public.live_sessions where game_id = p_game_id and team_id = v_team;
  return v_s;
end;
$$;

-- create or replace keeps the existing grants; repeated here for a fresh database
revoke all on function public.live_undo(integer, integer, text, uuid) from public;
grant execute on function public.live_undo(integer, integer, text, uuid) to anon, authenticated;

commit;
