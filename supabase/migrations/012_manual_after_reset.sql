-- =============================================================================
-- Pražský přebor – statistiky
-- Migration 012: manual entry after the live scoring was wiped
--
-- Manual entry of a team was refused as soon as the team had any live session row.
-- Sessions are never deleted, so after "Smazat celý záznam zápasu" (or after taking
-- every play back and ending the scoring) the team stayed locked for good.
-- Now the lock holds only while the live scoring runs or still has plays; a finished
-- session without any play counts as not started (same rule as the web page).
--
-- Run once in Supabase → SQL Editor after 011. One transaction.
-- =============================================================================

begin;

create or replace function private.guard_manual_entry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_team integer;
begin
  if coalesce(current_setting('app.action', true), '') not in
     ('add_plate_appearance', 'delete_plate_appearance', 'bump_player_game_stat') then
    return new;
  end if;
  select p.team_id into v_team from public.players p where p.id = new.player_id;
  if exists (
    select 1
    from public.live_sessions s
    where s.game_id = new.game_id and s.team_id = v_team
      and (
        not s.finished
        or exists (
          select 1
          from public.change_log l
          join public.change_groups g on g.id = l.group_id
          where l.game_id = new.game_id
            and l.table_name = 'live_sessions'
            and (l.new_data ->> 'team_id')::integer = v_team
            and g.action = 'live_play'
            and g.reverted_by_group_id is null
        )
      )
  ) then
    perform private.fail('Tento tým má v zápase živý zápis. Statistiky oprav v průběhu zápasu (tužkou u akce).');
  end if;
  return new;
end;
$$;

revoke all on all functions in schema private from public;

commit;
