-- =============================================================================
-- Pražský přebor – statistiky
-- Migration 010: what happened in each play (for the play-by-play)
--
-- The statistics need only the result, the runs and the stolen bases. For a readable
-- play-by-play ("Krátký Karel forced out at 2nd, Lehký Lukáš out at 1st – double play")
-- the play itself is kept too: how the ball was put in play (fly, line, pop, ground,
-- fielder's choice, double play, bunt), where it went (optional) and where every
-- runner ended. One row per play, written in the same transaction as the play;
-- a play that is taken back simply stops showing (its change group is reverted).
--
-- live_play_detailed() = live_play_once() + these details. Nothing else changes.
--
-- Run once in Supabase → SQL Editor after 009. One transaction.
-- =============================================================================

begin;

create table public.live_play_details (
  group_id    uuid        primary key references public.change_groups (id),
  game_id     integer     not null references public.games (id),
  team_id     integer     not null references public.teams (id),
  inning      smallint    not null,
  outs_before smallint    not null,
  batter_id   uuid        references public.players (id),
  result      text        check (result in ('1B','2B','3B','HR','BB','HBP','K','OUT','FC','ROE','SF','SH')),
  kind        text        check (kind in ('fly', 'line', 'pop', 'ground', 'fc', 'dp', 'bunt')),
  location    text        check (location in ('P', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF')),
  batter_to   smallint    check (batter_to between 0 and 4),
  -- every runner on base before the play: [{"from": 1-3, "to": 0-4, "sb": bool, "player": uuid}]
  runners     jsonb       not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);
create index live_play_details_game on public.live_play_details (game_id);

alter table public.live_play_details enable row level security;
create policy "public read" on public.live_play_details for select to anon, authenticated using (true);
revoke all on public.live_play_details from public, anon, authenticated;
grant select on public.live_play_details to anon, authenticated;

create function public.live_play_detailed(
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

revoke all on all functions in schema private from public;
revoke all on function public.live_play_detailed(uuid, integer, integer, integer, text, integer, jsonb, integer, text, text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.live_play_detailed(uuid, integer, integer, integer, text, integer, jsonb, integer, text, text, text, uuid)
  to anon, authenticated;

commit;
