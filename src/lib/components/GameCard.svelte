<script lang="ts">
  import type { Game } from '../types.ts';
  import { league } from '../league.svelte.ts';
  import { day, time } from '../format.ts';
  import TeamBadge from './TeamBadge.svelte';
  import Icon from './Icon.svelte';

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
  const playable = $derived(league.isPlayable(game));

  const outcome = $derived.by(() => {
    if (!played || focusTeam === null) return null;
    const mine = focusTeam === game.home_team_id ? game.home_score! : game.away_score!;
    const theirs = focusTeam === game.home_team_id ? game.away_score! : game.home_score!;
    return mine > theirs ? 'Výhra' : mine < theirs ? 'Prohra' : 'Remíza';
  });

  const starts = $derived(game.starts_at ? new Date(game.starts_at) : null);
  const weekday = $derived(
    starts ? new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', weekday: 'short' }).format(starts) : ''
  );
  const dm = $derived(
    starts ? new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', day: 'numeric', month: 'numeric' }).format(starts).replace(/\s/g, '') : '–'
  );
</script>

{#if played || playable}
  <a class="card result" href="/zapasy/{game.id}">
    <span class="top">
      <span class="date">{day(game.starts_at)}</span>
      {#if outcome}
        <span class="pill {outcome === 'Výhra' ? 'pos' : outcome === 'Prohra' ? 'neg' : 'neutral'}">{outcome}</span>
      {:else if recorded >= 2}
        <span class="pill pos">Zapsáno</span>
      {:else if recorded === 1}
        <span class="pill warn">Zapsán 1 tým</span>
      {:else}
        <span class="pill warn">Chybí statistiky</span>
      {/if}
    </span>
    <span class="side" class:won={homeWon} class:lost={awayWon}>
      <TeamBadge team={home} size={28} />
      <span class="name">{home?.short_name ?? home?.name}</span>
      <span class="score">{game.home_score ?? '–'}</span>
    </span>
    <span class="side" class:won={awayWon} class:lost={homeWon}>
      <TeamBadge team={away} size={28} />
      <span class="name">{away?.short_name ?? away?.name}</span>
      <span class="score">{game.away_score ?? '–'}</span>
    </span>
  </a>
{:else}
  <a class="card upcoming" href="/zapasy/{game.id}">
    <span class="tile">
      <span class="wd">{weekday}</span>
      <span class="dm">{dm}</span>
    </span>
    <span class="info">
      <span class="vs">
        <strong>{home?.short_name ?? home?.name}</strong>
        <span class="muted">vs</span>
        <strong>{away?.short_name ?? away?.name}</strong>
      </span>
      <span class="meta">
        {game.venue ?? 'Hřiště neuvedeno'}{game.starts_at ? `, ${time(game.starts_at)}` : ''}{game.status === 'rescheduled' ? ', přeloženo' : ''}
      </span>
    </span>
    <span class="go"><Icon name="chevron" size={18} /></span>
  </a>
{/if}

<style>
  .card {
    display: block;
    text-decoration: none;
    transition: border-color 160ms, transform 160ms, background-color 160ms;
  }
  .card:hover {
    border-color: var(--line-strong);
    background: var(--surface-2);
  }
  .card:active {
    transform: scale(0.99);
  }

  .result {
    display: grid;
    gap: 12px;
    padding: 16px 16px 14px;
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .date {
    font-size: 13px;
    color: var(--muted);
  }
  .side {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 15.5px;
  }
  .score {
    font-weight: 800;
    font-size: 22px;
    line-height: 1;
    min-width: 1.5em;
    text-align: right;
  }
  .won .name {
    font-weight: 800;
  }
  .lost .name,
  .lost .score {
    color: var(--muted);
  }

  .upcoming {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 12px 14px 12px 12px;
  }
  .tile {
    display: grid;
    justify-items: center;
    align-content: center;
    width: 64px;
    height: 58px;
    flex-shrink: 0;
    border-radius: 14px;
    background: var(--accent-soft);
  }
  .wd {
    font-size: 12px;
    font-weight: 800;
    color: var(--accent-text);
    line-height: 1;
  }
  .dm {
    font-size: 19px;
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.15;
  }
  .info {
    flex: 1;
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .vs {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    font-size: 15.5px;
  }
  .meta {
    font-size: 13px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .go {
    color: var(--faint);
    display: grid;
  }
</style>
