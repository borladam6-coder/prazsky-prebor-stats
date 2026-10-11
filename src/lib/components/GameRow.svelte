<script lang="ts">
  // One game as a compact row inside a day card (games list): home – score – away.
  // A small marker on the right says whether our statistics exist for it.
  import type { Game } from '../types.ts';
  import { league } from '../league.svelte.ts';
  import { time } from '../format.ts';
  import TeamBadge from './TeamBadge.svelte';
  import Icon from './Icon.svelte';

  let { game, recorded = 0, focusTeam = null }: { game: Game; recorded?: number; focusTeam?: number | null } = $props();

  const home = $derived(league.team(game.home_team_id));
  const away = $derived(league.team(game.away_team_id));
  const played = $derived(game.home_score !== null && game.away_score !== null);
  const homeWon = $derived(played && game.home_score! > game.away_score!);
  const awayWon = $derived(played && game.away_score! > game.home_score!);
  const mismatch = $derived(league.scoreMismatch(game).length > 0);
  const outcome = $derived.by(() => {
    if (!played || focusTeam === null) return null;
    const mine = focusTeam === game.home_team_id ? game.home_score! : game.away_score!;
    const theirs = focusTeam === game.home_team_id ? game.away_score! : game.home_score!;
    return mine > theirs ? 'W' : mine < theirs ? 'L' : 'T';
  });
</script>

<a class="row" href="/zapasy/{game.id}">
  <span class="team home" class:won={homeWon} class:lost={awayWon}>
    <span class="nm">{home?.short_name ?? home?.name}</span>
    <TeamBadge team={home} size={24} />
  </span>
  {#if played}
    <span class="score num-c">
      <span class:lost={awayWon}>{game.home_score}</span><span class="colon">:</span><span class:lost={homeWon}>{game.away_score}</span>
    </span>
  {:else}
    <span class="score time num-c">{time(game.starts_at) || '–'}</span>
  {/if}
  <span class="team away" class:won={awayWon} class:lost={homeWon}>
    <TeamBadge team={away} size={24} />
    <span class="nm">{away?.short_name ?? away?.name}</span>
  </span>
  <span class="mark">
    {#if outcome}
      <span class="wl {outcome}" title={outcome === 'W' ? 'Výhra' : outcome === 'L' ? 'Prohra' : 'Remíza'}>{outcome}</span>
    {:else if mismatch}
      <span class="m warn" title="Runs v zápisu nesedí s výsledkem nahlášeným svazu"><Icon name="warn" size={15} /></span>
    {:else if played && recorded >= 2}
      <span class="m ok" title="Zapsané statistiky obou týmů"><Icon name="check" size={15} /></span>
    {:else if played && recorded === 1}
      <span class="m half" title="Zapsané statistiky jednoho týmu">1/2</span>
    {:else if played}
      <span class="m none" title="Jen výsledek ze softball.cz">–</span>
    {/if}
  </span>
</a>

<style>
  .row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) 28px;
    align-items: center;
    gap: 10px;
    min-height: 52px;
    padding: 8px 10px 8px 14px;
    text-decoration: none;
    color: var(--ink);
    transition: background-color 140ms;
  }
  .row:hover {
    background: var(--surface-2);
  }
  .team {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .home {
    justify-content: flex-end;
    text-align: right;
  }
  .nm {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 15px;
  }
  .won .nm {
    font-weight: 800;
  }
  .lost {
    color: var(--muted);
  }
  .score {
    display: flex;
    align-items: baseline;
    justify-content: center;
    min-width: 64px;
    font-weight: 800;
    font-size: 22px;
    line-height: 1;
  }
  .colon {
    margin: 0 3px;
    color: var(--faint);
  }
  .score.time {
    font-size: 16px;
    color: var(--muted);
  }
  .mark {
    display: grid;
    place-items: center;
  }
  .m,
  .wl {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    font-size: 11px;
    font-weight: 800;
  }
  .m.ok {
    color: var(--hit);
    background: var(--hit-soft);
  }
  .m.half {
    color: var(--muted);
    background: var(--surface-3);
    font-size: 10px;
  }
  .m.none {
    color: var(--faint);
  }
  .m.warn {
    color: var(--warn);
    background: var(--warn-soft);
  }
  .wl.W {
    color: var(--hit);
    background: var(--hit-soft);
  }
  .wl.L {
    color: var(--out);
    background: var(--out-soft);
  }
  .wl.T {
    color: var(--muted);
    background: var(--surface-3);
  }
</style>
