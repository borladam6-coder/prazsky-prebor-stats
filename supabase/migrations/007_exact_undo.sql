-- =============================================================================
-- Pražský přebor – statistiky
-- Migration 007: taking a play back always restores the exact state before it
--
-- Before: "delete play" removed only the statistics and left the runners, outs and
-- batter as they were after the play; a later undo then failed ("Záznam byl od té doby
-- znovu změněn"). Undo also failed after a correction of the same play (edited result,
-- a substitution, a run correction).
--
-- Now:
--   * private.revert_live_play(): takes one play back completely: its plate appearance,
--     runs and stolen bases, and the inning, outs, runners and batter up as they were
--     before it. Later corrections of that play do not block it (the play is the source
--     of truth); a run that was already removed by a correction cancels that correction.
--   * live_undo, live_rewind use it.
--   * live_delete_play(): only the latest play of the game (= undo). An older play
--     cannot disappear on its own because later plays were built on it.
--   * live_delete_from(): takes back this play and every later one (state before it).
--
-- Run once in Supabase → SQL Editor after 006. One transaction.
-- =============================================================================

begin;

create function private.revert_live_play(p_group_id uuid, p_new_group uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry public.change_log;
  v_game  integer;
  v_need  integer;
  v_have  integer;
  v_adj   public.live_run_adjustments;
  v_sess  public.change_log;
  v_done  boolean;
begin
  -- a finished scoring stays finished (fixing the last play after the game)
  select * into v_sess from public.change_log
  where group_id = p_group_id and table_name = 'live_sessions' limit 1;
  select finished into v_done from public.live_sessions
  where game_id = (v_sess.new_data ->> 'game_id')::integer and team_id = (v_sess.new_data ->> 'team_id')::integer;

  -- runs of this play that a later correction already took away: cancel that correction
  -- first, so the run can be taken back without going below zero
  for v_entry in
    select * from public.change_log
    where group_id = p_group_id and table_name = 'game_player_extras' and not is_derived
  loop
    v_game := (v_entry.new_data ->> 'game_id')::integer;
    v_need := (v_entry.new_data ->> 'runs')::integer - coalesce((v_entry.old_data ->> 'runs')::integer, 0);
    select runs into v_have from public.game_player_extras
    where game_id = v_game and player_id = (v_entry.new_data ->> 'player_id')::uuid
    for update;
    while v_need > coalesce(v_have, 0) loop
      select * into v_adj from public.live_run_adjustments
      where game_id = v_game and player_id = (v_entry.new_data ->> 'player_id')::uuid
        and delta < 0 and not cancelled
      order by created_at desc
      limit 1
      for update;
      exit when not found;
      update public.live_run_adjustments set cancelled = true where id = v_adj.id;
      update public.game_player_extras set runs = runs + 1
      where game_id = v_game and player_id = v_adj.player_id;
      update public.change_groups g set reverted_by_group_id = p_new_group
      where g.reverted_by_group_id is null and g.action = 'live_adjust'
        and exists (select 1 from public.change_log l
                    where l.group_id = g.id and l.table_name = 'live_run_adjustments' and l.row_id = v_adj.id::text);
      v_have := coalesce(v_have, 0) + 1;
    end loop;
  end loop;

  -- the play itself, without the "changed since" check: undo means "as before this play"
  perform private.revert_group(p_group_id, true, p_new_group);
  if v_done then
    update public.live_sessions set finished = true
    where game_id = (v_sess.new_data ->> 'game_id')::integer and team_id = (v_sess.new_data ->> 'team_id')::integer
      and not finished;
  end if;
end;
$$;

-- The latest play of the game (or of one team) whose state can still be taken back.
create function private.latest_play(p_game_id integer, p_team_id integer)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select l.group_id
  from public.change_log l
  join public.change_groups g on g.id = l.group_id
  where l.game_id = p_game_id
    and l.table_name = 'live_sessions'
    and (p_team_id is null or l.row_id = p_game_id || ':' || p_team_id)
    and g.action = 'live_play'
    and g.reverted_by_group_id is null
  order by l.id desc
  limit 1
$$;

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
  v_target := private.latest_play(p_game_id, p_team_id);
  if v_target is null then
    perform private.fail('Není co vrátit.');
  end if;
  select (new_data ->> 'team_id')::integer into v_team
  from public.change_log where group_id = v_target and table_name = 'live_sessions' limit 1;

  perform private.lock_session(p_game_id, v_team, null, true);
  perform set_config('app.reverts_group', v_target::text, true);
  perform private.revert_live_play(v_target, v_new_group);
  select * into v_s from public.live_sessions where game_id = p_game_id and team_id = v_team;
  return v_s;
end;
$$;

create or replace function public.live_delete_play(p_game_id integer, p_group_id uuid, p_actor text, p_device uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new_group uuid;
begin
  v_new_group := private.begin_write('live_delete_play', p_actor, p_device);
  if not exists (
    select 1 from public.change_groups g
    where g.id = p_group_id and g.action = 'live_play' and g.reverted_by_group_id is null
      and exists (select 1 from public.change_log l where l.group_id = g.id and l.game_id = p_game_id)
  ) then
    perform private.fail('Akce neexistuje nebo už byla vrácena.');
  end if;
  if private.latest_play(p_game_id, null) is distinct from p_group_id then
    perform private.fail('Smazat jde jen poslední akci. U starší akce použij „Smazat od této akce“.');
  end if;
  perform set_config('app.reverts_group', p_group_id::text, true);
  perform private.revert_live_play(p_group_id, v_new_group);
  return v_new_group;
end;
$$;

-- Back to the state right after this play (every later play of the game is taken back).
create or replace function public.live_rewind(p_game_id integer, p_group_id uuid, p_actor text, p_device uuid)
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
    v_latest := private.latest_play(p_game_id, null);
    exit when v_latest is null or v_latest = p_group_id;
    perform private.revert_live_play(v_latest, v_new_group);
    v_count := v_count + 1;
    if v_count > 500 then
      perform private.fail('Příliš mnoho akcí najednou.');
    end if;
  end loop;
  return v_count;
end;
$$;

-- Takes back this play and every later one: the state before this play.
create function public.live_delete_from(p_game_id integer, p_group_id uuid, p_actor text, p_device uuid)
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
  v_new_group := private.begin_write('live_delete_from', p_actor, p_device);
  if not exists (
    select 1 from public.change_groups g
    where g.id = p_group_id and g.action = 'live_play' and g.reverted_by_group_id is null
      and exists (select 1 from public.change_log l where l.group_id = g.id and l.game_id = p_game_id)
  ) then
    perform private.fail('Akce neexistuje nebo už byla vrácena.');
  end if;
  perform private.ensure_group();

  loop
    v_latest := private.latest_play(p_game_id, null);
    exit when v_latest is null;
    perform private.revert_live_play(v_latest, v_new_group);
    v_count := v_count + 1;
    exit when v_latest = p_group_id;
    if v_count > 500 then
      perform private.fail('Příliš mnoho akcí najednou.');
    end if;
  end loop;
  return v_count;
end;
$$;

revoke all on all functions in schema private from public;
revoke all on function public.live_delete_from(integer, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.live_delete_from(integer, uuid, text, uuid) to anon, authenticated;

commit;
