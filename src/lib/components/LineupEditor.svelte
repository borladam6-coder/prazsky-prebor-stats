<script lang="ts">
  // Batting order: tap players from the roster, reorder, replace (substitution), add a new player.
  import { untrack } from 'svelte';
  import { flip } from 'svelte/animate';
  import { slide } from 'svelte/transition';
  import { league } from '../league.svelte.ts';
  import { addPlayer, errorMessage, WriteCancelled } from '../api.ts';
  import { toasts } from '../toast.svelte.ts';
  import Icon from './Icon.svelte';

  let {
    teamId,
    initial = [],
    nextSlot = null,
    saveLabel,
    busy = false,
    onsave,
    oncancel = undefined
  }: {
    teamId: number;
    initial?: string[];
    /** index of the batter who is up next (shown when editing a running game) */
    nextSlot?: number | null;
    saveLabel: string;
    busy?: boolean;
    onsave: (lineup: string[], nextSlot: number | null) => void;
    oncancel?: () => void;
  } = $props();

  let order = $state<string[]>(untrack(() => [...initial]));
  let up = $state<number | null>(untrack(() => nextSlot));
  let replacing = $state<number | null>(null);

  const team = $derived(league.team(teamId));
  const roster = $derived(
    league
      .teamPlayers(teamId)
      .filter((p) => !order.includes(p.id))
      .sort((a, b) => (a.jersey_number ?? 999) - (b.jersey_number ?? 999) || a.name.localeCompare(b.name, 'cs'))
  );

  function pick(id: string) {
    if (replacing !== null) {
      order[replacing] = id;
      replacing = null;
    } else if (order.length < 20) {
      order = [...order, id];
    }
  }

  function move(i: number, d: -1 | 1) {
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j], next[i]];
    order = next;
    if (up === i) up = j;
    else if (up === j) up = i;
  }

  function remove(i: number) {
    order = order.filter((_, k) => k !== i);
    if (replacing === i) replacing = null;
    if (up !== null) up = order.length ? (up > i ? up - 1 : Math.min(up, order.length - 1)) : null;
  }

  // new player (not on the roster yet)
  let addOpen = $state(false);
  let newName = $state('');
  let newNumber = $state('');
  let adding = $state(false);

  async function submitPlayer(e: SubmitEvent) {
    e.preventDefault();
    if (!league.season) return;
    const jersey = newNumber.trim() === '' ? null : Number(newNumber);
    if (jersey !== null && (!Number.isInteger(jersey) || jersey < 0 || jersey > 99)) {
      toasts.show('Číslo dresu musí být 0–99.', 'error');
      return;
    }
    adding = true;
    try {
      const p = await addPlayer(league.season.id, teamId, newName, jersey);
      league.upsertPlayer(p);
      pick(p.id);
      toasts.show(`Hráč ${p.name} přidán na soupisku.`);
      newName = '';
      newNumber = '';
      addOpen = false;
    } catch (err) {
      if (!(err instanceof WriteCancelled)) toasts.show(errorMessage(err), 'error');
    } finally {
      adding = false;
    }
  }

  const player = (id: string) => league.player(id);
</script>

<div class="editor" style:--team={team?.color}>
  <section class="card order">
    <header>
      <h2>Pořadí pálkařů</h2>
      <span class="muted count">{order.length} / 20</span>
    </header>

    {#if order.length === 0}
      <p class="hint muted">Klepni na hráče ze soupisky v pořadí, v jakém půjdou na pálku.</p>
    {:else}
      <ol>
        {#each order as id, i (id)}
          {@const p = player(id)}
          <li animate:flip={{ duration: 180 }} class:replacing={replacing === i} class:up={up === i}>
            <span class="slot">{i + 1}</span>
            <span class="jn">{p?.jersey_number ?? '–'}</span>
            <span class="pn">
              {p?.name ?? '?'}
              {#if up === i}<span class="pill warn">na pálce</span>{/if}
            </span>
            <span class="tools">
              {#if nextSlot !== null && up !== i}
                <button type="button" title="Tento hráč jde teď na pálku" aria-label="{p?.name} jde teď na pálku" onclick={() => (up = i)}><Icon name="player" size={17} /></button>
              {/if}
              <button type="button" aria-label="Posunout {p?.name} výš" disabled={i === 0} onclick={() => move(i, -1)}><Icon name="up" size={18} /></button>
              <button type="button" aria-label="Posunout {p?.name} níž" disabled={i === order.length - 1} onclick={() => move(i, 1)}><Icon name="down" size={18} /></button>
              <button type="button" aria-label="Vystřídat {p?.name}" aria-pressed={replacing === i} onclick={() => (replacing = replacing === i ? null : i)}><Icon name="swap" size={17} /></button>
              <button type="button" class="rm" aria-label="Odebrat {p?.name}" onclick={() => remove(i)}><Icon name="close" size={17} /></button>
            </span>
          </li>
        {/each}
      </ol>
    {/if}
  </section>

  <section class="card bench">
    <header>
      <h2>{replacing !== null ? `Kdo nahradí: ${player(order[replacing])?.name ?? ''}` : 'Soupiska'}</h2>
      {#if replacing !== null}<button type="button" class="btn btn-quiet btn-sm" onclick={() => (replacing = null)}>Zrušit střídání</button>{/if}
    </header>
    {#if roster.length === 0}
      <p class="hint muted">Všichni hráči ze soupisky už jsou v pořadí.</p>
    {:else}
      <ul>
        {#each roster as p (p.id)}
          <li>
            <button type="button" onclick={() => pick(p.id)} disabled={replacing === null && order.length >= 20}>
              <span class="jn">{p.jersey_number ?? '–'}</span>
              <span class="pn">{p.name}</span>
              <Icon name={replacing !== null ? 'swap' : 'plus'} size={18} />
            </button>
          </li>
        {/each}
      </ul>
    {/if}

    <div class="addp">
      {#if addOpen}
        <form onsubmit={submitPlayer} transition:slide={{ duration: 180 }}>
          <input class="input" placeholder="Příjmení Jméno" bind:value={newName} required minlength="2" maxlength="60" aria-label="Jméno hráče" />
          <input class="input num-in" placeholder="Číslo" inputmode="numeric" bind:value={newNumber} aria-label="Číslo dresu" />
          <button type="submit" class="btn btn-primary" disabled={adding}>Přidat</button>
          <button type="button" class="btn btn-quiet" onclick={() => (addOpen = false)}>Zrušit</button>
        </form>
      {:else}
        <button type="button" class="btn btn-sm" onclick={() => (addOpen = true)}><Icon name="plus" size={16} /> Hráč, který není na soupisce</button>
      {/if}
    </div>
  </section>

  <div class="save">
    {#if oncancel}<button type="button" class="btn btn-dark" onclick={oncancel}>Zpět</button>{/if}
    <button type="button" class="btn btn-primary" disabled={busy || order.length === 0} onclick={() => onsave([...order], up)}>
      <Icon name="check" size={18} /> {saveLabel}
    </button>
  </div>
</div>

<style>
  .editor {
    display: grid;
    gap: 14px;
  }
  @media (min-width: 860px) {
    .editor {
      grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
      align-items: start;
    }
    .save {
      grid-column: 1 / -1;
    }
  }
  .card {
    padding: 16px 12px 12px;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 0 6px 10px;
  }
  h2 {
    font-size: 20px;
  }
  .count {
    font-size: 13px;
  }
  .hint {
    margin: 4px 6px 8px;
    font-size: 14px;
  }
  ol,
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  ol li {
    display: grid;
    grid-template-columns: 22px 32px minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 8px;
    border-radius: 14px;
    background: var(--surface-2);
    border: 1px solid transparent;
  }
  ol li.up {
    border-color: var(--accent);
  }
  ol li.replacing {
    border-color: var(--team, var(--accent));
    background: color-mix(in srgb, var(--team, var(--accent)) 14%, var(--surface-2));
  }
  .slot {
    font-weight: 800;
    color: var(--muted);
    text-align: center;
  }
  .jn {
    display: grid;
    place-items: center;
    height: 30px;
    border-radius: 9px;
    background: var(--surface-3);
    font-weight: 800;
    font-size: 14px;
    color: var(--muted);
  }
  .pn {
    min-width: 0;
    font-weight: 700;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  ul .pn {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .pn .pill {
    margin-left: 6px;
  }
  .tools {
    display: flex;
    gap: 0;
  }
  .tools button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 36px;
    border-radius: 50%;
    border: 0;
    background: transparent;
    cursor: pointer;
    color: var(--muted);
  }
  .tools button:hover {
    background: var(--surface-3);
    color: var(--ink);
  }
  .tools button[disabled] {
    opacity: 0.3;
    cursor: default;
  }
  .tools button[aria-pressed='true'] {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .tools .rm:hover {
    color: var(--neg);
    background: var(--neg-soft);
  }
  ul button {
    display: grid;
    grid-template-columns: 34px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    width: 100%;
    min-height: 46px;
    padding: 6px 10px 6px 8px;
    border-radius: 14px;
    border: 0;
    background: transparent;
    text-align: left;
    cursor: pointer;
    color: var(--ink);
  }
  ul button:hover {
    background: var(--surface-2);
  }
  ul button[disabled] {
    opacity: 0.4;
    cursor: default;
  }
  ul button :global(svg) {
    color: var(--accent-text);
  }
  .addp {
    margin-top: 10px;
    padding: 0 6px;
  }
  .addp form {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .addp .input {
    flex: 1 1 180px;
  }
  .addp .num-in {
    flex: 0 1 90px;
  }
  .save {
    position: sticky;
    bottom: calc(var(--nav-h) + 10px + env(safe-area-inset-bottom));
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 10px;
    border-radius: 20px;
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border: 1px solid var(--line);
    z-index: 5;
  }
  .save .btn-primary {
    flex: 1 1 auto;
    max-width: 320px;
  }
  @media (min-width: 900px) {
    .save {
      bottom: 16px;
    }
  }
</style>
