<script lang="ts">
  import { league } from '#lib/league.svelte.ts';
  import TeamBadge from '#lib/components/TeamBadge.svelte';

  const rows = $derived(
    league.teams
      .map((t) => ({ team: t, s: league.standings.find((s) => s.team_id === t.id), players: league.teamPlayers(t.id).length }))
      .sort((a, b) => (a.s?.position ?? 99) - (b.s?.position ?? 99))
  );
</script>

<svelte:head>
  <title>Týmy – Pražský přebor mužů</title>
</svelte:head>

<div class="page">
  <h1>Týmy</h1>
  <p class="lead muted">Soupisky, odehrané zápasy a týmové statistiky. Soupisku může doplnit kdokoli.</p>

  <ul class="teams">
    {#each rows as r (r.team.id)}
      <li style:--team={r.team.color}>
        <a href="/tymy/{r.team.id}">
          <TeamBadge team={r.team} size={52} />
          <span class="info">
            <span class="name">{r.team.name}</span>
            <span class="meta">
              {#if r.s}{r.s.position}. místo, {r.s.wins}–{r.s.losses}{r.s.draws ? `–${r.s.draws}` : ''}, {r.s.points} b.{/if}
            </span>
            <span class="meta">{r.players} hráčů na soupisce</span>
          </span>
        </a>
      </li>
    {/each}
  </ul>
</div>

<style>
  .lead {
    margin: 10px 0 22px;
  }
  .teams {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 10px;
  }
  @media (min-width: 700px) {
    .teams {
      grid-template-columns: 1fr 1fr;
    }
  }
  a {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px;
    border-radius: var(--radius-m);
    background: var(--surface);
    border: 1px solid var(--line);
    border-top: 4px solid var(--team);
    text-decoration: none;
    transition: border-color 120ms, transform 120ms;
  }
  a:hover {
    border-color: var(--team);
    transform: translateY(-1px);
  }
  .info {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .name {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 24px;
    line-height: 1.05;
  }
  .meta {
    font-size: 14px;
    color: var(--muted);
  }
</style>
