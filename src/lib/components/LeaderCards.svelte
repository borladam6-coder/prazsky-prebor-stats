<script lang="ts">
  // Leaderboards on the overview: one card per stat, the leader big, places 2–5 compact.
  // Rate stats count only players with at least `minPa` plate appearances, and every
  // rate shows the PA next to it so the sample size is visible.
  import { league } from '../league.svelte.ts';
  import { STATS, compareStat, type StatKey } from '../stats.ts';
  import { rate, num } from '../format.ts';
  import type { PlayerTotals } from '../types.ts';
  import TeamBadge from './TeamBadge.svelte';
  import Icon from './Icon.svelte';

  let { totals, minPa = 10 }: { totals: PlayerTotals[]; minPa?: number } = $props();

  const KEYS: StatKey[] = ['avg', 'ops', 'hr', 'rbi', 'sb'];

  const boards = $derived(
    KEYS.map((k) => {
      const def = STATS[k];
      const pool = def.kind === 'rate' ? totals.filter((t) => t.pa >= minPa) : totals;
      const top = pool
        .filter((t) => t[k] !== null && Number(t[k]) > 0)
        .sort((a, b) => compareStat(a[k], b[k], -1))
        .slice(0, 5);
      return { key: k, def, top };
    })
  );
  const show = (k: StatKey, t: PlayerTotals) => (STATS[k].kind === 'rate' ? rate(t[k]) : num(t[k]));
</script>

<div class="boards">
  {#each boards as b (b.key)}
    {@const lead = b.top[0]}
    <section class="card board" aria-label="{b.def.title}: nejlepší pálkaři">
      <header>
        <h3 title={b.def.title}>{b.def.label}</h3>
        {#if b.def.kind === 'rate'}<span class="qual">min. {minPa} PA</span>{/if}
        <a class="all" href="/hraci?sort={b.key}" aria-label="Všichni hráči podle {b.def.label}"><Icon name="chevron" size={18} /></a>
      </header>
      {#if !lead}
        <p class="none">Zatím nikdo.</p>
      {:else}
        {@const p = league.player(lead.player_id)}
        {@const team = league.team(lead.team_id)}
        <a class="lead" href="/hraci/{lead.player_id}" style:--team={team?.color}>
          <span class="who">
            <span class="pn">{p?.name ?? '?'}</span>
            <span class="pt"><TeamBadge {team} size={16} /> {team?.short_name ?? team?.code}{#if b.def.kind === 'rate'} · {lead.pa} PA{/if}</span>
          </span>
          <span class="big num-c">{show(b.key, lead)}</span>
        </a>
        {#if b.top.length > 1}
          <ol class="rest" start="2">
            {#each b.top.slice(1) as t, i (t.player_id)}
              {@const tp = league.player(t.player_id)}
              {@const tt = league.team(t.team_id)}
              <li>
                <span class="rk">{i + 2}</span>
                <a href="/hraci/{t.player_id}" class="rn">{tp?.name ?? '?'}</a>
                <span class="rt">{tt?.short_name ?? tt?.code}{#if b.def.kind === 'rate'} · {t.pa}{/if}</span>
                <span class="rv num-c">{show(b.key, t)}</span>
              </li>
            {/each}
          </ol>
        {/if}
      {/if}
    </section>
  {/each}
</div>

<style>
  /* phones: swipe between the cards; wide screens: all side by side */
  .boards {
    display: grid;
    grid-auto-flow: column;
    grid-auto-columns: minmax(250px, 82%);
    gap: 12px;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    margin: 0 calc(var(--gutter) * -1);
    padding: 2px var(--gutter) 8px;
    scrollbar-width: none;
  }
  .boards::-webkit-scrollbar {
    display: none;
  }
  @media (min-width: 900px) {
    .boards {
      grid-auto-flow: row;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      overflow: visible;
      margin: 0;
      padding: 0;
    }
  }
  .board {
    scroll-snap-align: start;
    padding: 14px 14px 10px;
    min-width: 0;
  }
  header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  h3 {
    font-size: 15px;
    letter-spacing: 0;
  }
  .qual {
    font-size: 11.5px;
    font-weight: 700;
    color: var(--muted);
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--surface-2);
  }
  .all {
    margin-left: auto;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 50%;
    color: var(--muted);
  }
  .all:hover {
    color: var(--ink);
    background: var(--surface-2);
  }
  .lead {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 14px;
    text-decoration: none;
    background:
      linear-gradient(120deg, color-mix(in srgb, var(--team) 16%, transparent), transparent 70%),
      var(--surface-2);
  }
  .who {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .pn {
    font-weight: 800;
    font-size: 16px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .pt {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .big {
    font-weight: 800;
    font-size: 40px;
    line-height: 0.95;
    letter-spacing: -0.02em;
  }
  .rest {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
  }
  .rest li {
    display: grid;
    grid-template-columns: 18px minmax(0, 1fr) auto auto;
    align-items: baseline;
    gap: 8px;
    padding: 7px 4px;
    font-size: 14px;
  }
  .rest li + li {
    border-top: 1px solid var(--line);
  }
  .rk {
    color: var(--faint);
    font-weight: 700;
    font-size: 12.5px;
  }
  .rn {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-decoration: none;
    font-weight: 600;
  }
  .rn:hover {
    text-decoration: underline;
  }
  .rt {
    font-size: 12px;
    color: var(--muted);
  }
  .rv {
    min-width: 3.2em;
    text-align: right;
    font-weight: 800;
  }
  .none {
    margin: 6px 0;
    color: var(--muted);
    font-size: 14px;
  }
</style>
