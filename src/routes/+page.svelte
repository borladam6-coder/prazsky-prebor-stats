<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { league } from '#lib/league.svelte.ts';
  import { battingTotals, errorMessage } from '#lib/api.ts';
  import { LEADER_STATS, STATS, compareStat, type StatKey } from '#lib/stats.ts';
  import { rate, num } from '#lib/format.ts';
  import type { PlayerTotals } from '#lib/types.ts';
  import Scoreboard from '#lib/components/Scoreboard.svelte';
  import GameRow from '#lib/components/GameRow.svelte';
  import TeamBadge from '#lib/components/TeamBadge.svelte';

  let totals = $state<PlayerTotals[] | null>(null);
  let loadError = $state<string | null>(null);
  let stat = $state<StatKey>('avg');
  let minPa = $state(10);

  onMount(async () => {
    try {
      const [t] = await Promise.all([battingTotals(league.season!.id), league.loadRecorded()]);
      totals = t;
    } catch (e) {
      loadError = errorMessage(e);
    }
  });

  const def = $derived(STATS[stat]);
  const leaders = $derived.by(() => {
    if (!totals) return [];
    const pool = def.kind === 'rate' ? totals.filter((t) => t.pa >= minPa) : totals;
    return pool
      .filter((t) => t[stat] !== null && Number(t[stat]) > 0)
      .sort((a, b) => compareStat(a[stat], b[stat], -1))
      .slice(0, 5);
  });
  const hasStats = $derived((totals?.length ?? 0) > 0);

  const recent = $derived(league.playedGames.slice(0, 5));
  const upcoming = $derived(league.upcomingGames.slice(0, 4));
</script>

<svelte:head>
  <title>Pražský přebor mužů – statistiky</title>
</svelte:head>

<div class="page">
  <section class="intro">
    <h1>Pražský přebor mužů</h1>
    <p>
      Pálkařské statistiky všech týmů. Zapisuje je kdokoli po zápase, každá změna se ukládá do historie a dá se vrátit.
    </p>
  </section>

  <div class="grid">
    <div class="col-board">
      <Scoreboard />
    </div>

    <section class="leaders panel" aria-labelledby="leaders-title">
      <div class="leaders-head">
        <h2 id="leaders-title">Nejlepší pálkaři</h2>
        <a class="all" href="/hraci?sort={stat}">Všichni hráči</a>
      </div>

      <div class="chips" role="group" aria-label="Statistika">
        {#each LEADER_STATS as k (k)}
          <button type="button" class="chip" aria-pressed={stat === k} title={STATS[k].title} onclick={() => (stat = k)}>
            {STATS[k].label}
          </button>
        {/each}
      </div>

      {#if def.kind === 'rate'}
        <label class="minpa">
          <span>Jen hráči s aspoň</span>
          <input class="input" type="number" min="0" max="200" inputmode="numeric" bind:value={minPa} />
          <span>PA</span>
        </label>
      {/if}

      {#if loadError}
        <p class="empty">{loadError}</p>
      {:else if totals === null}
        <ol class="list" aria-busy="true">
          {#each Array(5) as _, i (i)}<li class="skeleton"></li>{/each}
        </ol>
      {:else if !hasStats}
        <div class="empty">
          <p>Zatím nikdo nezapsal žádné statistiky.</p>
          <a class="btn btn-primary" href="/zapasy">Vybrat zápas a zapsat</a>
        </div>
      {:else if leaders.length === 0}
        <p class="empty">Nikdo nemá aspoň {minPa} PA. Sniž limit.</p>
      {:else}
        <ol class="list">
          {#each leaders as l, i (l.player_id)}
            {@const p = league.player(l.player_id)}
            {@const team = league.team(l.team_id)}
            <li animate:flip={{ duration: 260 }} in:fade={{ duration: 160 }}>
              <span class="rank">{i + 1}</span>
              <TeamBadge {team} size={28} />
              <a class="who" href="/hraci/{l.player_id}">
                <span class="pname">{p?.name ?? 'Neznámý hráč'}</span>
                <span class="pteam">{team?.short_name ?? team?.name} · {l.pa} PA</span>
              </a>
              <span class="val" class:first={i === 0}>{def.kind === 'rate' ? rate(l[stat]) : num(l[stat])}</span>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  </div>

  <div class="games">
    <section class="section" aria-labelledby="recent-title">
      <div class="section-head">
        <h2 id="recent-title">Poslední výsledky</h2>
        <a class="all" href="/zapasy">Všechny zápasy</a>
      </div>
      {#if recent.length}
        <div class="panel list-games">
          {#each recent as g (g.id)}<GameRow game={g} recorded={league.recorded.get(g.id) ?? 0} />{/each}
        </div>
      {:else}
        <p class="empty">Zatím se nehrálo.</p>
      {/if}
    </section>

    <section class="section" aria-labelledby="next-title">
      <div class="section-head">
        <h2 id="next-title">Nejbližší zápasy</h2>
      </div>
      {#if upcoming.length}
        <div class="panel list-games">
          {#each upcoming as g (g.id)}<GameRow game={g} />{/each}
        </div>
      {:else}
        <p class="empty">Žádný další zápas v rozpisu.</p>
      {/if}
    </section>
  </div>
</div>

<style>
  .intro {
    max-width: 640px;
    margin: 8px 0 24px;
  }
  .intro p {
    color: var(--muted);
    margin: 12px 0 0;
    font-size: 17px;
  }

  .grid {
    display: grid;
    gap: 20px;
  }
  @media (min-width: 980px) {
    .grid {
      grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr);
      align-items: start;
    }
  }

  .leaders {
    padding: 18px;
  }
  .leaders-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .all {
    font-size: 14px;
    font-weight: 600;
    color: var(--muted);
    text-underline-offset: 3px;
  }
  .all:hover {
    color: var(--ink);
  }

  .chips {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    margin: 14px -18px 0;
    padding: 2px 18px 4px;
    scrollbar-width: none;
  }
  .chips::-webkit-scrollbar {
    display: none;
  }

  .minpa {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 10px;
    font-size: 14px;
    color: var(--muted);
  }
  .minpa .input {
    width: 72px;
    min-height: 34px;
    padding: 4px 8px;
    text-align: center;
  }

  .list {
    list-style: none;
    margin: 14px 0 0;
    padding: 0;
  }
  .list li {
    display: grid;
    grid-template-columns: 22px 28px 1fr auto;
    align-items: center;
    gap: 10px;
    padding: 10px 0;
    border-top: 1px solid var(--line);
  }
  .rank {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 18px;
    color: var(--faint);
    text-align: center;
  }
  .who {
    display: grid;
    min-width: 0;
    text-decoration: none;
  }
  .pname {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pteam {
    font-size: 13px;
    color: var(--muted);
  }
  .who:hover .pname {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .val {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 26px;
    line-height: 1;
  }
  .val.first {
    color: var(--amber-ink);
    font-size: 32px;
  }
  .skeleton {
    height: 49px;
    background: linear-gradient(90deg, var(--surface-2), var(--surface), var(--surface-2));
    background-size: 200% 100%;
    animation: shimmer 1.2s linear infinite;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }
  .empty {
    margin-top: 14px;
  }
  .empty p {
    margin: 0 0 14px;
  }

  .games {
    display: grid;
    gap: 0 20px;
  }
  @media (min-width: 980px) {
    .games {
      grid-template-columns: 1fr 1fr;
    }
  }
  .list-games {
    overflow: hidden;
  }
  .list-games :global(.row:last-child) {
    border-bottom: none;
  }
</style>
