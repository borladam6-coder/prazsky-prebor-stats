-- Consistency checks. Run in Supabase → SQL Editor at any time.
-- Every row returned is a problem; an empty result means everything is consistent.

with raw_lines as (
  -- statistics rebuilt directly from the base tables, independently of the views
  select
    coalesce(pa.game_id, x.game_id) as game_id,
    coalesce(pa.player_id, x.player_id) as player_id,
    coalesce(pa.n, 0) as pa,
    coalesce(pa.h, 0) as h,
    coalesce(pa.ab, 0) as ab,
    coalesce(pa.tb, 0) as tb,
    coalesce(pa.rbi, 0) as rbi,
    coalesce(x.runs, 0) as r,
    coalesce(x.stolen_bases, 0) as sb
  from (
    select game_id, player_id,
      count(*) as n,
      count(*) filter (where result in ('1B','2B','3B','HR')) as h,
      count(*) filter (where result not in ('BB','HBP','SF','SH')) as ab,
      sum(case result when '1B' then 1 when '2B' then 2 when '3B' then 3 when 'HR' then 4 else 0 end) as tb,
      sum(rbi) as rbi
    from public.plate_appearances
    where deleted_at is null
    group by game_id, player_id
  ) pa
  full join public.game_player_extras x on x.game_id = pa.game_id and x.player_id = pa.player_id
),
raw_season as (
  select p.season_id, p.team_id, l.player_id,
    sum(l.pa) pa, sum(l.h) h, sum(l.ab) ab, sum(l.tb) tb, sum(l.rbi) rbi, sum(l.r) r, sum(l.sb) sb
  from raw_lines l join public.players p on p.id = l.player_id
  where l.pa > 0 or l.r > 0 or l.sb > 0
  group by p.season_id, p.team_id, l.player_id
)

-- 1. Season view = sum of raw game records
select 'season view differs from raw data' as problem, s.player_id::text as subject,
       format('view %s/%s/%s/%s, raw %s/%s/%s/%s (PA/AB/H/TB)', s.pa, s.ab, s.h, s.tb, r.pa, r.ab, r.h, r.tb) as detail
from public.player_season_batting s
full join raw_season r on r.player_id = s.player_id and r.season_id = s.season_id
where (s.pa, s.ab, s.h, s.tb, s.rbi, s.r, s.sb) is distinct from (r.pa, r.ab, r.h, r.tb, r.rbi, r.r, r.sb)

union all
-- 2. Season view = sum of game lines
select 'season view differs from game lines', s.player_id::text, format('%s vs %s PA', s.pa, g.pa)
from public.player_season_batting s
join (
  select season_id, player_id, sum(pa) pa, sum(ab) ab, sum(h) h, sum(r) r, sum(rbi) rbi, sum(sb) sb, count(*) games
  from public.player_game_batting group by season_id, player_id
) g on g.player_id = s.player_id and g.season_id = s.season_id
where (s.pa, s.ab, s.h, s.r, s.rbi, s.sb, s.games) is distinct from (g.pa, g.ab, g.h, g.r, g.rbi, g.sb, g.games)

union all
-- 3. Team season totals = sum of its players
select 'team totals differ from players', t.team_id::text, format('team %s PA, players %s PA', t.pa, p.pa)
from public.team_season_batting t
join (
  select season_id, team_id, sum(pa) pa, sum(ab) ab, sum(h) h, sum(tb) tb, sum(r) r, sum(rbi) rbi, sum(sb) sb
  from public.player_season_batting group by season_id, team_id
) p on p.team_id = t.team_id and p.season_id = t.season_id
where (t.pa, t.ab, t.h, t.tb, t.r, t.rbi, t.sb) is distinct from (p.pa, p.ab, p.h, p.tb, p.r, p.rbi, p.sb)

union all
-- 4. Identities on every game line
select 'identity broken', player_id::text || ' @ ' || game_id,
       format('PA=%s AB=%s BB=%s HBP=%s SF=%s SH=%s H=%s 1B=%s 2B=%s 3B=%s HR=%s TB=%s R=%s RBI=%s',
              pa, ab, bb, hbp, sf, sh, h, singles, doubles, triples, hr, tb, r, rbi)
from public.player_game_batting
where pa <> ab + bb + hbp + sf + sh
   or h <> singles + doubles + triples + hr
   or tb <> singles + 2 * doubles + 3 * triples + 4 * hr
   or h > ab
   or k > ab - h
   or r < hr
   or rbi < hr

union all
-- 5. Rates are within their mathematical ranges (no division by zero is possible: NULL when denominator is 0)
select 'rate out of range', player_id::text, format('AVG %s OBP %s SLG %s', avg, obp, slg)
from public.player_season_batting
where avg not between 0 and 1 or obp not between 0 and 1 or slg not between 0 and 4
   or (ab = 0 and (avg is not null or slg is not null))
   or (ab + bb + hbp + sf = 0 and obp is not null)

union all
-- 6. Stats only for players of teams that played the game
select 'player not in game', pa.id::text, format('game %s', pa.game_id)
from public.plate_appearances pa
join public.players p on p.id = pa.player_id
join public.games g on g.id = pa.game_id
where p.team_id not in (g.home_team_id, g.away_team_id) or p.season_id <> g.season_id

union all
-- 7. Every user change is in the history
select 'row without history', pa.id::text, 'plate_appearances'
from public.plate_appearances pa
where not exists (select 1 from public.change_log l where l.table_name = 'plate_appearances' and l.row_id = pa.id::text)
union all
select 'row without history', p.id::text, 'players'
from public.players p
where not exists (select 1 from public.change_log l where l.table_name = 'players' and l.row_id = p.id::text);
