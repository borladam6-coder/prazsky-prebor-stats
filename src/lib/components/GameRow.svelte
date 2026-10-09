<script lang="ts">
  import type { Game } from '../types.ts';
  import { league } from '../league.svelte.ts';
  import { day, time } from '../format.ts';
  import TeamBadge from './TeamBadge.svelte';

  let {
    game,
    recorded = 0,
    focusTeam = null
  }: { game: Game; recorded?: number; focusTeam?: number | null } = $props();

  const home = $derived(league.team(game.home_team_id));
  const away = $derived(league.team(game.away_team_id));
  const played = $derived(game.home_score !== null && game.away_score !== null);
  const homeWon = $derived(played && game.home_score! > game.away_score!);
  const awayWon = $derived(played && game.away_score! > game.home_score!);

  // From the point of view of one team (team page): win / loss / draw marker.
  const outcome = $derived.by(() => {
    if (!played || focusTeam === null) return null;
    const mine = focusTeam === game.home_team_id ? game.home_score! : game.away_score!;
    const theirs = focusTeam === game.home_team_id ? game.away_score! : game.home_score!;
    return mine > theirs ? 'V' : mine < theirs ? 'P' : 'R';
  });
</script>

<a class="row" href="/zapasy/{game.id}">
  <span class="when">
    <span class="d">{day(game.starts_at)}</span>
    <span class="t">{played ? '' : time(game.starts_at)}</span>
  </span>

  <span class="teams">
    <span class="side" class:won={homeWon}>
      <TeamBadge team={home} size={24} />
      <span class="name">{home?.short_name ?? home?.name}</span>
      {#if played}<span class="score">{game.home_score}</span>{/if}
    </span>
    <span class="side" class:won={awayWon}>
      <TeamBadge team={away} size={24} />
      <span class="name">{away?.short_name ?? away?.name}</span>
      {#if played}<span class="score">{game.away_score}</span>{/if}
    </span>
  </span>

  <span class="meta">
    {#if outcome}<span class="outcome o-{outcome}">{outcome}</span>{/if}
    {#if played || league.isPlayable(game)}
      <span class="rec" class:none={recorded === 0} title="Týmy se zapsanými statistikami">
        {recorded === 0 ? 'bez statistik' : recorded === 1 ? 'zapsán 1 tým' : 'zapsány oba týmy'}
      </span>
    {:else if game.status === 'rescheduled'}
      <span class="rec">přeloženo</span>
    {/if}
  </span>
</a>

<style>
  .row {
    display: grid;
    grid-template-columns: 64px 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    text-decoration: none;
    border-bottom: 1px solid var(--line);
    background: var(--surface);
    transition: background-color 120ms;
  }
  .row:hover {
    background: var(--surface-2);
  }
  .when {
    display: grid;
    font-size: 13px;
    color: var(--muted);
    line-height: 1.3;
  }
  .d {
    font-weight: 600;
    color: var(--ink);
  }
  .teams {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .side {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    color: var(--muted);
  }
  .side.won {
    color: var(--ink);
    font-weight: 700;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .score {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 20px;
    line-height: 1;
    min-width: 1.4em;
    text-align: right;
  }
  .meta {
    display: grid;
    justify-items: end;
    gap: 4px;
  }
  .rec {
    font-size: 12px;
    color: var(--ok);
    white-space: nowrap;
  }
  .rec.none {
    color: var(--faint);
  }
  .outcome {
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    border-radius: 6px;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 15px;
    color: #fff;
  }
  .o-V {
    background: var(--ok);
  }
  .o-P {
    background: var(--red);
  }
  .o-R {
    background: var(--faint);
  }
  @media (max-width: 420px) {
    .row {
      grid-template-columns: 52px 1fr auto;
      gap: 10px;
      padding: 12px 12px;
    }
    .rec {
      display: none;
    }
  }
</style>
