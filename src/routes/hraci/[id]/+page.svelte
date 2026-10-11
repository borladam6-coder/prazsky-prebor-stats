<script lang="ts">
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import { league } from '#lib/league.svelte.ts';
  import { playerGameLog, playerSeason, battingTotals, errorMessage } from '#lib/api.ts';
  import { statColumns } from '#lib/columns.ts';
  import { BOX_STATS, STATS, type StatKey } from '#lib/stats.ts';
  import { rate, num, day } from '#lib/format.ts';
  import type { PlayerGameLine, PlayerTotals } from '#lib/types.ts';
  import StatTable from '#lib/components/StatTable.svelte';
  import Skeleton from '#lib/components/Skeleton.svelte';
  import TeamBadge from '#lib/components/TeamBadge.svelte';
  import Icon from '#lib/components/Icon.svelte';

  const id = $derived(page.params.id ?? '');
  const player = $derived(league.player(id));
  const team = $derived(league.team(player?.team_id));

  let log = $state<PlayerGameLine[] | null>(null);
  // Season line comes from the database view, which sums the same game lines.
  let season = $state<PlayerTotals | null>(null);
  let error = $state<string | null>(null);
  /** every batter of the season, for the percentiles */
  let league_ = $state<PlayerTotals[] | null>(null);

  $effect(() => {
    const pid = id;
    untrack(async () => {
      log = null;
      season = null;
      try {
        [log, season] = await Promise.all([playerGameLog(pid), playerSeason(pid)]);
        error = null;
      } catch (e) {
        error = errorMessage(e);
      }
      if (!league_ && league.season) battingTotals(league.season.id).then((t) => (league_ = t)).catch(() => {});
    });
  });

  // ------------------------------------------------------------ percentiles (Baseball Savant style)
  // Only qualified batters are ranked, colour means "how good", and the pool size is shown.
  const MIN_PA = 10;
  const PCT_STATS: { key: string; label: string; title: string; value: (t: PlayerTotals) => number | null; lower?: boolean; rate?: boolean }[] = [
    { key: 'avg', label: 'AVG', title: 'Batting average', value: (t) => t.avg, rate: true },
    { key: 'obp', label: 'OBP', title: 'On-base percentage', value: (t) => t.obp, rate: true },
    { key: 'slg', label: 'SLG', title: 'Slugging percentage', value: (t) => t.slg, rate: true },
    { key: 'ops', label: 'OPS', title: 'On-base plus slugging', value: (t) => t.ops, rate: true },
    { key: 'hr', label: 'HR', title: 'Home runs', value: (t) => t.hr },
    { key: 'rbi', label: 'RBI', title: 'Runs batted in', value: (t) => t.rbi },
    { key: 'sb', label: 'SB', title: 'Stolen bases', value: (t) => t.sb },
    { key: 'k', label: 'K %', title: 'Strikeouts na PA (méně je lépe)', value: (t) => (t.pa ? t.k / t.pa : null), lower: true }
  ];
  const pool = $derived((league_ ?? []).filter((t) => t.pa >= MIN_PA));
  const qualified = $derived(!!season && season.pa >= MIN_PA);
  const percentiles = $derived.by(() => {
    if (!season || !qualified || pool.length < 3) return [];
    return PCT_STATS.map((st) => {
      const mine = st.value(season!);
      const values = pool.map(st.value).filter((v): v is number => v !== null && v !== undefined).map(Number);
      if (mine === null || mine === undefined || !values.length) return null;
      const m = Number(mine);
      const below = values.filter((v) => (st.lower ? v > m : v < m)).length;
      const equal = values.filter((v) => v === m).length;
      const pct = Math.round(((below + Math.max(0, equal - 1) / 2) / Math.max(1, values.length - 1)) * 100);
      const shown = st.key === 'k' ? `${Math.round(m * 100)} %` : st.rate ? rate(m) : num(m);
      return { ...st, pct: Math.max(0, Math.min(100, pct)), shown };
    }).filter((x) => x !== null);
  });

  const tiles: StatKey[] = ['avg', 'obp', 'slg', 'ops'];
  const counts: StatKey[] = ['games', 'pa', 'h', 'hr', 'rbi', 'r', 'bb', 'k', 'sb'];

  const columns = statColumns<PlayerGameLine>([...BOX_STATS]);
  const ordered = $derived(log ? [...log].reverse() : []);
</script>

<svelte:head>
  <title>{player?.name ?? 'Hráč'} – Pražský přebor mužů</title>
</svelte:head>

<div class="page">
  <a class="back" href="/hraci"><Icon name="back" size={18} /> Hráči</a>

  {#if !player}
    <p class="empty">Hráč neexistuje.</p>
  {:else}
    <header class="card head" style:--team={team?.color}>
      <span class="jersey" aria-label="Číslo dresu">{player.jersey_number ?? '–'}</span>
      <div class="who">
        <h1>{player.name}</h1>
        <a class="team" href="/tymy/{team?.id}">
          <TeamBadge {team} size={24} />
          {team?.name}
        </a>
        {#if !player.active}<p class="muted">Momentálně mimo soupisku.</p>{/if}
      </div>
    </header>

    {#if error}
      <p class="empty">{error}</p>
    {:else if log === null}
      <Skeleton rows={6} height={44} card />
    {:else if !season}
      <div class="empty">
        <p>Hráč zatím nemá zapsané žádné statistiky.</p>
        <a class="btn btn-primary" href="/zapasy?tym={team?.id}">Zápasy týmu</a>
      </div>
    {:else}
      <section class="tiles" aria-label="Sezóna">
        {#each tiles as k, i (k)}
          <div class="card tile rise" style:--i={i} title={STATS[k].title}>
            <span class="tv">{rate(season[k])}</span>
            <span class="tl">{STATS[k].label}</span>
          </div>
        {/each}
      </section>

      <dl class="counts">
        {#each counts as k (k)}
          <div title={STATS[k].title}>
            <dt>{STATS[k].label}</dt>
            <dd>{num(season[k])}</dd>
          </div>
        {/each}
      </dl>

      {#if league_}
        <section class="section pcts" aria-labelledby="pct-title">
          <div class="section-head">
            <h2 id="pct-title">V porovnání s ligou</h2>
            <span class="muted pool">z {pool.length} hráčů s min. {MIN_PA} PA</span>
          </div>
          {#if !qualified}
            <p class="muted">Percentily se počítají od {MIN_PA} PA, {player.name.split(' ')[0]} má zatím {season.pa}.</p>
          {:else if percentiles.length === 0}
            <p class="muted">Zatím málo hráčů na porovnání.</p>
          {:else}
            <ul class="pctlist">
              {#each percentiles as p (p.key)}
                <li title="{p.title}: lepší než {p.pct} % hráčů">
                  <span class="pl-l">{p.label}</span>
                  <span class="pl-bar"><span class="pl-fill" style:--p={p.pct}></span><span class="pl-dot num-c" style:--p={p.pct}>{p.pct}</span></span>
                  <span class="pl-v num-c">{p.shown}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </section>
      {/if}

      <section class="section">
        <div class="section-head"><h2>Zápas po zápase</h2></div>
        <StatTable
          rows={ordered}
          rowKey={(r) => r.game_id}
          {columns}
          nameLabel="Zápas"
          essential={['pa', 'ab', 'h', 'hr', 'rbi', 'r', 'bb']}
          caption="Statistiky po zápasech"
          totals={{ label: 'Sezóna', row: season as unknown as PlayerGameLine }}
        >
          {#snippet name(r)}
            {@const opp = league.team(r.opponent_team_id)}
            <a class="game" href="/zapasy/{r.game_id}">
              <span class="d">{day(r.starts_at)}</span>
              <span class="o">{opp?.short_name ?? opp?.name}</span>
            </a>
          {/snippet}
        </StatTable>
      </section>
    {/if}
  {/if}
</div>

<style>
  .back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--muted);
    text-decoration: none;
    font-weight: 600;
    margin-bottom: 16px;
  }
  .back:hover {
    color: var(--ink);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 24px;
    margin-bottom: 14px;
    background:
      radial-gradient(70% 160% at 0% 0%, color-mix(in srgb, var(--team, var(--faint)) 26%, transparent), transparent 60%),
      var(--surface);
  }
  .jersey {
    display: grid;
    place-items: center;
    width: 76px;
    height: 76px;
    flex-shrink: 0;
    border-radius: 22px;
    background: var(--team, var(--surface-3));
    color: #fff;
    font-weight: 800;
    font-size: 36px;
    letter-spacing: -0.04em;
    text-shadow: 0 1px 2px rgb(0 0 0 / 0.3);
  }
  .who {
    min-width: 0;
  }
  h1 {
    font-size: clamp(28px, 6vw, 48px);
    overflow-wrap: anywhere;
  }
  .team {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    color: var(--muted);
    text-decoration: none;
    font-weight: 600;
  }
  .team:hover {
    color: var(--ink);
  }

  .tiles {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }
  @media (min-width: 720px) {
    .tiles {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
  }
  .tile {
    display: grid;
    gap: 6px;
    padding: 18px 20px;
  }
  .tv {
    font-size: clamp(34px, 7vw, 48px);
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 1;
  }

  .tl {
    order: -1;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--muted);
  }

  .counts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
    gap: 8px;
    margin: 12px 0 0;
  }
  .counts div {
    padding: 10px 14px;
    border-radius: 14px;
    background: var(--surface);
    border: 1px solid var(--line);
  }
  dt {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--muted);
  }
  dd {
    margin: 0;
    font-weight: 800;
    font-size: 22px;
    letter-spacing: -0.02em;
    line-height: 1.2;
  }
  /* percentile bars: one hue, stronger = better */
  .pool {
    font-size: 13px;
  }
  .pctlist {
    list-style: none;
    margin: 0;
    padding: 6px 16px;
    border: 1px solid var(--line);
    border-radius: var(--r-l);
    background: var(--surface);
  }
  .pctlist li {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) 56px;
    align-items: center;
    gap: 12px;
    padding: 9px 0;
  }
  .pctlist li + li {
    border-top: 1px solid var(--line);
  }
  .pl-l {
    font-weight: 800;
    font-size: 13.5px;
  }
  .pl-bar {
    position: relative;
    height: 8px;
    border-radius: 4px;
    background: var(--surface-3);
    margin-right: 14px;
  }
  .pl-fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: calc(var(--p) * 1%);
    border-radius: 4px;
    background: color-mix(in srgb, var(--accent) calc(35% + var(--p) * 0.65%), var(--surface-3));
  }
  .pl-dot {
    position: absolute;
    top: 50%;
    left: calc(var(--p) * 1%);
    transform: translate(-50%, -50%);
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--accent) calc(35% + var(--p) * 0.65%), var(--surface-3));
    color: var(--accent-ink);
    font-size: 12.5px;
    font-weight: 800;
    box-shadow: 0 0 0 3px var(--surface);
  }
  .pl-v {
    text-align: right;
    font-weight: 800;
  }
  .game {
    display: flex;
    gap: 8px;
    text-decoration: none;
  }
  .game .d {
    color: var(--muted);
    min-width: 58px;
  }
  .game:hover .o {
    text-decoration: underline;
  }
  @media (max-width: 520px) {
    .head {
      padding: 18px;
      gap: 14px;
    }
    .jersey {
      width: 62px;
      height: 62px;
      font-size: 28px;
    }
  }
</style>
