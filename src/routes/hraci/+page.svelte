<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { league } from '#lib/league.svelte.ts';
  import { battingTotals, errorMessage } from '#lib/api.ts';
  import { statColumns } from '#lib/columns.ts';
  import { STATS, TABLE_STATS, type StatKey } from '#lib/stats.ts';
  import type { PlayerTotals } from '#lib/types.ts';
  import StatTable from '#lib/components/StatTable.svelte';
  import TeamBadge from '#lib/components/TeamBadge.svelte';
  import Filters from '#lib/components/Filters.svelte';
  import Icon from '#lib/components/Icon.svelte';

  const requested = page.url.searchParams.get('sort');
  const initialSort: StatKey = requested && requested in STATS ? (requested as StatKey) : 'ops';
  let sortKey = $state<string>(initialSort);
  let sortDir = $state<1 | -1>(STATS[initialSort].lowerIsBetter ? 1 : -1);

  let teamId = $state<number | null>(Number(page.url.searchParams.get('tym')) || null);
  let from = $state('');
  let to = $state('');
  let minPa = $state(STATS[initialSort].kind === 'rate' ? 10 : 0);
  let search = $state('');

  let rows = $state<PlayerTotals[] | null>(null);
  let error = $state<string | null>(null);

  async function load() {
    try {
      rows = await battingTotals(league.season!.id, { teamId, from, to, minPa });
      error = null;
    } catch (e) {
      error = errorMessage(e);
    }
  }
  onMount(load);

  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
  const shown = $derived.by(() => {
    if (!rows) return [];
    const q = norm(search.trim());
    if (!q) return rows;
    return rows.filter((r) => norm(league.player(r.player_id)?.name ?? '').includes(q));
  });

  const columns = statColumns<PlayerTotals>(TABLE_STATS);
</script>

<svelte:head>
  <title>Hráči – Pražský přebor mužů</title>
</svelte:head>

<div class="page">
  <h1>Hráči</h1>
  <p class="lead muted">
    Pálkařské statistiky všech hráčů ligy. Řaď klepnutím na záhlaví sloupce, podrž ukazatel nad zkratkou pro vysvětlení.
  </p>

  <Filters bind:teamId bind:from bind:to bind:minPa onchange={load} />

  <label class="search">
    <Icon name="search" size={18} />
    <span class="visually-hidden">Hledat hráče</span>
    <input class="input" type="search" placeholder="Hledat hráče" bind:value={search} />
  </label>

  {#if error}
    <p class="empty">{error}</p>
  {:else if rows === null}
    <p class="muted">Načítám…</p>
  {:else}
    <p class="count muted">{shown.length} hráčů</p>
    <StatTable
      rows={shown}
      rowKey={(r) => r.player_id}
      {columns}
      nameLabel="Hráč"
      nameSort={(r) => league.player(r.player_id)?.name ?? ''}
      bind:sortKey
      bind:sortDir
      caption="Statistiky hráčů"
      empty={minPa > 0 ? `Nikdo nesplňuje limit ${minPa} PA. Sniž ho ve filtru.` : 'Zatím nejsou zapsané žádné statistiky.'}
    >
      {#snippet name(r)}
        {@const pl = league.player(r.player_id)}
        <a class="pl" href="/hraci/{r.player_id}">
          <TeamBadge team={league.team(r.team_id)} size={20} />
          <span>{pl?.name ?? '?'}</span>
        </a>
      {/snippet}
    </StatTable>
  {/if}
</div>

<style>
  .lead {
    margin: 10px 0 20px;
    max-width: 65ch;
  }
  .search {
    position: relative;
    display: block;
    max-width: 360px;
    margin-bottom: 12px;
    color: var(--muted);
  }
  .search :global(svg) {
    position: absolute;
    left: 11px;
    top: 11px;
  }
  .search .input {
    width: 100%;
    padding-left: 36px;
  }
  .count {
    font-size: 13px;
    margin: 0 0 8px;
  }
  .pl {
    display: flex;
    align-items: center;
    gap: 8px;
    text-decoration: none;
  }
  .pl span {
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pl:hover span {
    text-decoration: underline;
  }
</style>
