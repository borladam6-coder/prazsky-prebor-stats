<script lang="ts">
  // One game being scored live: score from the box score, inning, outs and runners.
  import { league } from '../league.svelte.ts';
  import { plural } from '../format.ts';
  import type { Game, LiveSession } from '../types.ts';
  import TeamBadge from './TeamBadge.svelte';
  import Diamond from './Diamond.svelte';
  import Icon from './Icon.svelte';

  let {
    game,
    sessions,
    runs,
    href,
    cta
  }: {
    game: Game;
    sessions: LiveSession[];
    runs: Map<number, number>;
    href: string;
    cta: string;
  } = $props();

  // the team that batted last is the one shown on the diamond
  const current = $derived([...sessions].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]);
  const batting = $derived(league.team(current?.team_id));
  const teams = $derived([league.team(game.home_team_id), league.team(game.away_team_id)]);
  const scored = (teamId: number | undefined) =>
    teamId !== undefined && (runs.has(teamId) || sessions.some((s) => s.team_id === teamId));
</script>

<a class="card live" {href} style:--team={batting?.color}>
  <span class="top">
    <span class="badge"><span class="pulse"></span> Živě</span>
    {#if current}
      <span class="muted">{current.inning}. směna, {current.outs} {plural(current.outs, ['aut', 'auty', 'autů'])}</span>
    {/if}
  </span>

  <span class="body">
    <span class="teams">
      {#each teams as t (t?.id)}
        {#if t}
          <span class="trow" class:bat={t.id === current?.team_id}>
            <TeamBadge team={t} size={30} />
            <span class="tn">{t.short_name ?? t.name}</span>
            <span class="r">{scored(t.id) ? (runs.get(t.id) ?? 0) : '–'}</span>
          </span>
        {/if}
      {/each}
      {#if batting}<span class="who muted">Na pálce {batting.short_name ?? batting.name}</span>{/if}
    </span>
    {#if current}
      <span class="mini"><Diamond bases={[current.runner_1, current.runner_2, current.runner_3]} outs={current.outs} size="small" /></span>
    {/if}
  </span>

  <span class="cta">{cta} <Icon name="chevron" size={18} /></span>
</a>

<style>
  .live {
    display: grid;
    gap: 10px;
    padding: 16px;
    text-decoration: none;
    background:
      radial-gradient(90% 130% at 100% 0%, color-mix(in srgb, var(--team, var(--neg)) 18%, transparent), transparent 60%),
      var(--surface);
    border-color: color-mix(in srgb, var(--neg) 40%, var(--line));
    transition: transform 160ms, border-color 160ms;
  }
  .live:hover {
    transform: translateY(-2px);
    border-color: var(--neg);
  }
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    font-size: 13.5px;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 3px 10px 3px 9px;
    border-radius: 999px;
    background: var(--neg-soft);
    color: var(--neg);
    font-weight: 800;
    font-size: 12px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .pulse {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--neg);
    animation: pulse 1.6s ease-out infinite;
  }
  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--neg) 70%, transparent);
    }
    100% {
      box-shadow: 0 0 0 9px transparent;
    }
  }
  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
  }
  .teams {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .trow {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
  }
  .tn {
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bat .tn {
    font-weight: 800;
  }
  .r {
    font-weight: 800;
    font-size: 26px;
    letter-spacing: -0.03em;
    line-height: 1;
    min-width: 1.4em;
    text-align: right;
  }
  .who {
    font-size: 13px;
  }
  .mini {
    width: 130px;
  }
  .cta {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    justify-self: end;
    font-weight: 700;
    font-size: 14px;
    color: var(--accent-text);
  }
</style>
