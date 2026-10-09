<script lang="ts">
  import { league } from '../league.svelte.ts';

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

  const anySet = $derived(teamId !== null || from !== '' || to !== '' || minPa > 0);

  function reset() {
    if (showTeam) teamId = null;
    from = '';
    to = '';
    minPa = 0;
    onchange?.();
  }
</script>

<form class="filters" onsubmit={(e) => e.preventDefault()}>
  {#if showTeam}
    <label>
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
  {#if anySet}
    <button type="button" class="btn btn-quiet" onclick={reset}>Zrušit filtry</button>
  {/if}
</form>

<style>
  .filters {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 10px;
    margin: 0 0 16px;
  }
  label {
    display: grid;
    gap: 4px;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    flex: 1 1 140px;
  }
  label .input,
  label .select {
    width: 100%;
  }
  .pa {
    flex: 0 1 96px;
  }
</style>
