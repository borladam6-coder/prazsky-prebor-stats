<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { league } from '#lib/league.svelte.ts';
  import { month } from '#lib/format.ts';
  import GameCard from '#lib/components/GameCard.svelte';
  import TeamBadge from '#lib/components/TeamBadge.svelte';

  type View = 'odehrane' | 'nadchazejici' | 'vse';

  onMount(() => {
    league.loadRecorded().catch(() => {});
  });

  const teamId = $derived(Number(page.url.searchParams.get('tym')) || null);
  const view = $derived((page.url.searchParams.get('stav') as View) || 'odehrane');

  function setParam(key: string, value: string | null) {
    const url = new URL(page.url.href);
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    goto(url, { replace: true, reset: false });
  }

  const games = $derived.by(() => {
    let list = league.games.filter((g) => !teamId || g.home_team_id === teamId || g.away_team_id === teamId);
    if (view === 'odehrane') list = list.filter((g) => g.status === 'played');
    if (view === 'nadchazejici') list = list.filter((g) => g.status !== 'played');
    const dir = view === 'nadchazejici' ? 1 : -1;
    return [...list].sort((a, b) => (a.starts_at ?? '9999').localeCompare(b.starts_at ?? '9999') * dir);
  });

  const groups = $derived.by(() => {
    const out: { label: string; items: typeof games }[] = [];
    for (const g of games) {
      const label = month(g.starts_at);
      const last = out.at(-1);
      if (last && last.label === label) last.items.push(g);
      else out.push({ label, items: [g] });
    }
    return out;
  });

  const views: { id: View; label: string }[] = [
    { id: 'odehrane', label: 'Odehrané' },
    { id: 'nadchazejici', label: 'Nadcházející' },
    { id: 'vse', label: 'Vše' }
  ];
</script>

<svelte:head>
  <title>Zápasy – Pražský přebor mužů</title>
</svelte:head>

<div class="page">
  <h1>Zápasy</h1>
  <p class="lead muted">Vyber odehraný zápas, otevře se jeho box score a dají se do něj zapisovat statistiky.</p>

  <div class="filters">
    <div class="seg views" role="group" aria-label="Které zápasy">
      {#each views as v (v.id)}
        <button type="button" aria-pressed={view === v.id} onclick={() => setParam('stav', v.id === 'odehrane' ? null : v.id)}>
          {v.label}
        </button>
      {/each}
    </div>

    <div class="teams" role="group" aria-label="Tým">
      <button type="button" class="chip" aria-pressed={teamId === null} onclick={() => setParam('tym', null)}>Všechny týmy</button>
      {#each league.teams as t (t.id)}
        <button type="button" class="chip team" aria-pressed={teamId === t.id} onclick={() => setParam('tym', String(t.id))}>
          <TeamBadge team={t} size={20} />
          {t.short_name ?? t.name}
        </button>
      {/each}
    </div>
  </div>

  {#if groups.length === 0}
    <p class="empty">Žádné zápasy pro tento výběr.</p>
  {:else}
    {#each groups as grp (grp.label)}
      <section class="month">
        <h2>{grp.label}</h2>
        <div class="cards">
          {#each grp.items as g, i (g.id)}
            <div class="rise" style:--i={Math.min(i, 8)}>
              <GameCard game={g} recorded={league.recorded.get(g.id) ?? 0} focusTeam={teamId} />
            </div>
          {/each}
        </div>
      </section>
    {/each}
  {/if}
</div>

<style>
  .lead {
    margin: 14px 0 24px;
    max-width: 60ch;
    font-size: 17px;
  }
  .filters {
    display: grid;
    gap: 12px;
    margin-bottom: 8px;
  }
  .views {
    max-width: 420px;
  }
  .teams {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    margin: 0 calc(var(--gutter) * -1);
    padding: 2px var(--gutter) 6px;
    scrollbar-width: none;
  }
  .teams::-webkit-scrollbar {
    display: none;
  }
  .chip.team {
    padding-left: 6px;
  }
  .month {
    margin-top: 32px;
  }
  .month h2 {
    margin-bottom: 14px;
  }
  .cards {
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr);
  }
  .cards > div {
    display: grid;
  }
  @media (min-width: 620px) {
    .cards {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (min-width: 1000px) {
    .cards {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
