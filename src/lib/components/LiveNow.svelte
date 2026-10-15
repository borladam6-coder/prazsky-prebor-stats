<script lang="ts">
  // "Právě se hraje": games with an active live scoring session, updated in real time.
  import { onMount, type Snippet } from 'svelte';
  import { slide } from 'svelte/transition';
  import { supabase } from '../supabase.ts';
  import { league } from '../league.svelte.ts';
  import { activeLive, gameRuns } from '../api.ts';
  import type { LiveSession } from '../types.ts';
  import LiveCard from './LiveCard.svelte';
  import Scoreboard from './Scoreboard.svelte';

  let { featured = false, fallback }: { featured?: boolean; fallback?: Snippet } = $props();

  let sessions = $state<LiveSession[]>([]);
  let runs = $state(new Map<number, Map<number, number>>());

  async function load() {
    try {
      const list = await activeLive();
      const gameIds = [...new Set(list.map((s) => s.game_id))].filter((id) => league.game(id));
      const r = await Promise.all(gameIds.map(async (id) => [id, await gameRuns(id)] as const));
      sessions = list;
      runs = new Map(r);
    } catch {
      // the live box is optional; the rest of the page works without it
    }
  }

  const games = $derived(
    [...new Set(sessions.map((s) => s.game_id))]
      .map((id) => league.game(id))
      .filter((g) => g !== undefined)
  );

  onMount(() => {
    load();
    if (!supabase) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 500);
    };
    const channel = supabase
      .channel('live-now')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_sessions' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_player_extras' }, refresh)
      .subscribe();
    // drop sessions that went quiet without being finished
    const tick = setInterval(load, 5 * 60_000);
    return () => {
      clearTimeout(timer);
      clearInterval(tick);
      supabase!.removeChannel(channel);
    };
  });
</script>

{#if featured}
  {#if games[0]}
    <Scoreboard game={games[0]} sessions={sessions.filter(s => s.game_id === games[0].id)} runs={runs.get(games[0].id) ?? new Map()} />
    {#if games.length > 1}
      <details class="more-live"><summary>Další živé zápasy ({games.length - 1})</summary>
        {#each games.slice(1) as g (g.id)}
          <LiveCard game={g} sessions={sessions.filter(s => s.game_id === g.id)} runs={runs.get(g.id) ?? new Map()} href="/zapasy/{g.id}/sledovat" cta="Sledovat" />
        {/each}
      </details>
    {/if}
  {:else if fallback}
    {@render fallback()}
  {/if}
{:else if games.length}
  <section class="now" aria-labelledby="now-title" transition:slide={{ duration: 250 }}>
    <h2 id="now-title">Právě se hraje</h2>
    <div class="cards">
      {#each games as g (g.id)}
        <LiveCard
          game={g}
          sessions={sessions.filter((s) => s.game_id === g.id)}
          runs={runs.get(g.id) ?? new Map()}
          href="/zapasy/{g.id}/sledovat"
          cta="Sledovat"
        />
      {/each}
    </div>
  </section>
{/if}

<style>
  .more-live { padding: 10px 0; color: var(--accent-text); font-size: 12px; font-weight: 700; }
  .more-live summary { cursor: pointer; padding: 8px 0; }
  .now {
    margin: 0 0 28px;
  }
  h2 {
    margin-bottom: 12px;
    font-size: 22px;
  }
  .cards {
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr);
  }
  @media (min-width: 760px) {
    .cards {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
