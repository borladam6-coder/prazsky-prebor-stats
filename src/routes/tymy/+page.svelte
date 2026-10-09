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
    {#each rows as r, i (r.team.id)}
      <li class="rise" style:--team={r.team.color} style:--i={i}>
        <a class="card" href="/tymy/{r.team.id}">
          <TeamBadge team={r.team} size={56} eager />
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
    margin: 14px 0 26px;
    font-size: 17px;
  }
  .teams {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr);
  }
  @media (min-width: 700px) {
    .teams {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (min-width: 1050px) {
    .teams {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
  a {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 18px;
    height: 100%;
    text-decoration: none;
    background:
      radial-gradient(90% 140% at 0% 0%, color-mix(in srgb, var(--team) 18%, transparent), transparent 60%),
      var(--surface);
    transition: border-color 160ms, transform 160ms;
  }
  a:hover {
    border-color: color-mix(in srgb, var(--team) 60%, transparent);
    transform: translateY(-2px);
  }
  .info {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .name {
    font-weight: 800;
    font-size: 20px;
    letter-spacing: -0.02em;
    line-height: 1.1;
  }
  .meta {
    font-size: 14px;
    color: var(--muted);
  }
</style>
