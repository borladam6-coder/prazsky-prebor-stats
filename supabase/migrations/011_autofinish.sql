-- =============================================================================
-- Pražský přebor – statistiky
-- Migration 011: live scoring ends by itself the day after the game
--
-- * live_autofinish() ends every live session that is still open although its game
--   was played on an earlier day (Prague time) and nobody has scored in it since
--   yesterday. Called once a day by the Netlify function close-live (service role).
--   Every ended session is its own change group ("Automaticky"), visible in history.
-- * Once the game day is over, only the administrator can open a finished live
--   scoring again (continue or start over). Corrections of single plays (result, RBI,
--   runs, deleting plays) stay open to everybody; they keep the session finished.
-- * private.require_admin() marks the transaction as the administrator's, so the
--   rule above holds for every admin function (e.g. reverting from history).
-- * The test game is never ended automatically and can always be reopened.
--
-- Run once in Supabase → SQL Editor after 010. One transaction.
-- =============================================================================

begin;

-- Prague calendar day of a timestamp.
create function private.prague_day(p_at timestamptz)
returns date
language sql
stable
set search_path = ''
as $$
  select (p_at at time zone 'Europe/Prague')::date
$$;

-- The game day is over (Prague time). Test games never count as over.
create function private.game_day_over(p_game_id integer)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select g.season_id <> -1
     and g.starts_at is not null
     and private.prague_day(g.starts_at) < private.prague_day(now())
  from public.games g
  where g.id = p_game_id
$$;

-- The administrator's code was checked in this transaction.
create or replace function private.require_admin(p_code text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not private.code_matches(p_code) then
    perform private.fail('Nesprávný kód správce.', 'PT403');
  end if;
  perform set_config('app.admin', 'on', true);
end;
$$;

-- Finished → running again after the game day: administrator only.
-- Checked at commit (deferred): taking back a play restores the old session row for a
-- moment (finished = false) and then ends the scoring again; only a session that is
-- still running at the end of the transaction counts as reopened.
create function private.guard_reopen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.finished and not new.finished
     and coalesce(current_setting('app.admin', true), '') <> 'on'
     and coalesce(private.game_day_over(new.game_id), false)
     and exists (select 1 from public.live_sessions s
                 where s.game_id = new.game_id and s.team_id = new.team_id and not s.finished) then
    perform private.fail('Zápas už proběhl. Ukončený živý zápis může znovu otevřít jen správce.', 'PT403');
  end if;
  return null;
end;
$$;

create constraint trigger live_sessions_guard_reopen after update on public.live_sessions
  deferrable initially deferred
  for each row execute function private.guard_reopen();

-- Reopens a finished live scoring with the administrator's code.
create function public.admin_live_reopen(
  p_game_id integer,
  p_team_id integer,
  p_code    text,
  p_actor   text,
  p_device  uuid
)
returns public.live_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s public.live_sessions;
begin
  perform private.begin_write('live_reopen', p_actor, p_device);
  perform private.require_admin(p_code);
  perform private.assert_live_team(p_game_id, p_team_id);
  v_s := private.lock_session(p_game_id, p_team_id, null, false);
  if not v_s.finished then
    return v_s;
  end if;
  update public.live_sessions set finished = false
  where game_id = p_game_id and team_id = p_team_id
  returning * into v_s;
  return v_s;
end;
$$;

-- Ends live scoring of games from earlier days. Returns how many sessions it ended.
create function public.live_autofinish()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   record;
  v_count integer := 0;
begin
  for v_row in
    select s.game_id, s.team_id
    from public.live_sessions s
    join public.games g on g.id = s.game_id
    where not s.finished
      and g.season_id <> -1
      and private.prague_day(coalesce(g.starts_at, s.started_at)) < private.prague_day(now())
      and private.prague_day(s.updated_at) < private.prague_day(now())
    order by s.game_id, s.team_id
    for update of s
  loop
    -- one change group per session, so each can be taken back on its own
    perform set_config('app.change_group', gen_random_uuid()::text, true);
    perform set_config('app.source', 'import', true);
    perform set_config('app.action', 'live_autofinish', true);
    perform set_config('app.actor_name', 'Automaticky', true);
    perform set_config('app.device_hash', '', true);
    perform set_config('app.reverts_group', '', true);
    perform set_config('app.derived', 'off', true);
    update public.live_sessions set finished = true
    where game_id = v_row.game_id and team_id = v_row.team_id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on all functions in schema private from public;
revoke all on function public.admin_live_reopen(integer, integer, text, text, uuid) from public, anon, authenticated;
grant execute on function public.admin_live_reopen(integer, integer, text, text, uuid) to anon, authenticated;
revoke all on function public.live_autofinish() from public, anon, authenticated;
grant execute on function public.live_autofinish() to service_role;

commit;
