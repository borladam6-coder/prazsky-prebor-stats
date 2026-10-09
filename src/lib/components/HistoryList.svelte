<script lang="ts">
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import { history, revertGroup, errorMessage, WriteCancelled } from '../api.ts';
  import { describe } from '../describe.ts';
  import { ago, stamp } from '../format.ts';
  import { toasts } from '../toast.svelte.ts';
  import type { ChangeEntry, ChangeGroup } from '../types.ts';
  import Icon from './Icon.svelte';

  let {
    gameId = undefined,
    onreverted = undefined,
    limit = 30
  }: { gameId?: number; onreverted?: () => void; limit?: number } = $props();

  let groups = $state<ChangeGroup[]>([]);
  let entries = $state<ChangeEntry[]>([]);
  let loading = $state(true);
  let more = $state(false);
  let error = $state<string | null>(null);
  let busy = $state<string | null>(null);

  export async function reload() {
    loading = true;
    try {
      const r = await history({ gameId, limit });
      groups = r.groups;
      entries = r.entries;
      more = r.groups.length === limit;
      error = null;
    } catch (e) {
      error = errorMessage(e);
    } finally {
      loading = false;
    }
  }

  async function loadMore() {
    const last = groups.at(-1);
    if (!last) return;
    loading = true;
    try {
      const r = await history({ gameId, limit, before: last.at });
      groups = [...groups, ...r.groups];
      entries = [...entries, ...r.entries];
      more = r.groups.length === limit;
    } catch (e) {
      toasts.show(errorMessage(e), 'error');
    } finally {
      loading = false;
    }
  }

  async function revert(g: ChangeGroup) {
    busy = g.id;
    try {
      await revertGroup(g.id);
      toasts.show('Změna vrácena.');
      await reload();
      onreverted?.();
    } catch (e) {
      if (!(e instanceof WriteCancelled)) toasts.show(errorMessage(e), 'error');
    } finally {
      busy = null;
    }
  }

  onMount(reload);

  const byGroup = $derived.by(() => {
    const m = new Map<string, ChangeEntry[]>();
    for (const e of entries) {
      const list = m.get(e.group_id);
      if (list) list.push(e);
      else m.set(e.group_id, [e]);
    }
    return m;
  });
</script>

{#if error}
  <p class="empty">{error}</p>
{:else if !loading && groups.length === 0}
  <p class="empty">Zatím žádné změny.</p>
{:else}
  <ol class="log">
    {#each groups as g (g.id)}
      {@const d = describe(g, byGroup.get(g.id) ?? [])}
      <li class:reverted={!!g.reverted_by_group_id} class:system={g.source !== 'web'} transition:slide={{ duration: 180 }}>
        <div class="what">
          <span class="title">{d.title}</span>
          <span class="meta">
            <span class="who">{g.source === 'web' ? (g.actor_name ?? 'neznámý') : 'automaticky'}</span>
            <time datetime={g.at} title={stamp(g.at)}>{ago(g.at)}</time>
            {#if d.context && !gameId}
              <a href="/zapasy/{d.gameId}">{d.context}</a>
            {/if}
            {#if g.reverted_by_group_id}<span class="tag">vráceno</span>{/if}
          </span>
        </div>
        {#if g.source === 'web' && !g.reverted_by_group_id}
          <button type="button" class="btn btn-quiet undo" disabled={busy !== null} onclick={() => revert(g)} title="Vrátit tuto změnu">
            <Icon name="undo" size={18} />
            <span>{busy === g.id ? 'Vracím…' : 'Vrátit'}</span>
          </button>
        {/if}
      </li>
    {/each}
  </ol>
  {#if more}
    <button type="button" class="btn more" disabled={loading} onclick={loadMore}>{loading ? 'Načítám…' : 'Starší změny'}</button>
  {/if}
{/if}

<style>
  .log {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--r-l);
    background: var(--surface);
    overflow: hidden;
  }
  li {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-bottom: 1px solid var(--line);
  }
  li:last-child {
    border-bottom: none;
  }
  .what {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 3px;
  }
  .title {
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .meta {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 13px;
    color: var(--muted);
  }
  .who {
    color: var(--ink);
    font-weight: 600;
  }
  .meta a {
    color: var(--muted);
  }
  .tag {
    color: var(--accent-text);
    font-weight: 700;
  }
  li.reverted .title {
    text-decoration: line-through;
    text-decoration-color: var(--faint);
    color: var(--muted);
  }
  li.system .title {
    color: var(--muted);
    font-weight: 500;
  }
  .undo {
    flex-shrink: 0;
  }
  .more {
    margin-top: 12px;
  }
  @media (max-width: 480px) {
    .undo span {
      display: none;
    }
  }
</style>
