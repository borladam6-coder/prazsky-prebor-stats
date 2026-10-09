<script lang="ts">
  import { league } from '../league.svelte.ts';
  import Icon from './Icon.svelte';

  let {
    teamId = $bindable<number | null>(null),
    from = $bindable(''),
    to = $bindable(''),
    minPa = $bindable(0),
    showTeam = true,
    onchange
  }: {
    teamId?: number | null;
    from?: string;
    to?: string;
    minPa?: number;
    showTeam?: boolean;
    onchange?: () => void;
  } = $props();

  // On phones the filters fold into one button; from tablet width they are always visible.
  let open = $state(false);

  const active = $derived(
    [showTeam && teamId !== null, from !== '', to !== '', minPa > 0].filter(Boolean).length
  );

  const summary = $derived.by(() => {
    const parts: string[] = [];
    if (showTeam && teamId !== null) parts.push(league.team(teamId)?.short_name ?? league.team(teamId)?.name ?? 'tým');
    if (from || to) parts.push('období');
    if (minPa > 0) parts.push(`min. ${minPa} PA`);
    return parts.join(', ');
  });

  function reset() {
    if (showTeam) teamId = null;
    from = '';
    to = '';
    minPa = 0;
    onchange?.();
  }
</script>

<div class="filters-wrap">
  <button type="button" class="toggle btn btn-dark btn-sm" aria-expanded={open} onclick={() => (open = !open)}>
    <Icon name="search" size={16} />
    Filtry{#if active}<span class="count">{active}</span>{/if}
    {#if summary}<span class="sum">{summary}</span>{/if}
  </button>

  <form class="filters" class:open onsubmit={(e) => e.preventDefault()}>
    {#if showTeam}
      <label class="team">
        <span>Tým</span>
        <select class="select" bind:value={teamId} onchange={() => onchange?.()}>
          <option value={null}>Všechny týmy</option>
          {#each league.teams as t (t.id)}<option value={t.id}>{t.name}</option>{/each}
        </select>
      </label>
    {/if}
    <label>
      <span>Od</span>
      <input class="input" type="date" bind:value={from} onchange={() => onchange?.()} />
    </label>
    <label>
      <span>Do</span>
      <input class="input" type="date" bind:value={to} onchange={() => onchange?.()} />
    </label>
    <label class="pa">
      <span>Min. PA</span>
      <input class="input" type="number" min="0" max="300" inputmode="numeric" bind:value={minPa} onchange={() => onchange?.()} />
    </label>
    {#if active}
      <button type="button" class="btn btn-quiet" onclick={reset}>Zrušit filtry</button>
    {/if}
  </form>
</div>

<style>
  .filters-wrap {
    margin: 0 0 16px;
  }
  .toggle {
    max-width: 100%;
  }
  .count {
    display: inline-grid;
    place-items: center;
    min-width: 20px;
    height: 20px;
    border-radius: 999px;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 12px;
  }
  .sum {
    color: var(--muted);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .filters {
    display: none;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
    margin-top: 12px;
    padding: 14px;
    border-radius: var(--r-l);
    background: var(--surface);
    border: 1px solid var(--line);
  }
  .filters.open {
    display: grid;
  }
  label {
    display: grid;
    gap: 4px;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    min-width: 0;
  }
  label .input,
  label .select {
    width: 100%;
    min-width: 0;
  }
  .team {
    grid-column: 1 / -1;
  }

  @media (min-width: 760px) {
    .toggle {
      display: none;
    }
    .filters,
    .filters.open {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      margin-top: 0;
      padding: 0;
      background: none;
      border: 0;
    }
    label {
      flex: 1 1 150px;
    }
    .team {
      flex: 1.4 1 200px;
    }
    .pa {
      flex: 0 1 100px;
    }
  }
</style>
