<script lang="ts">
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import { league } from '#lib/league.svelte.ts';
  import { playerGameLog, playerSeason, errorMessage } from '#lib/api.ts';
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
    });
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
  .tile:last-child .tv {
    color: var(--accent-text);
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
