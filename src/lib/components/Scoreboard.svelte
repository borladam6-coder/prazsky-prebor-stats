<script lang="ts">
  // League standings drawn as a hand-operated ballpark scoreboard: numbers sit in
  // dark slots and flip in once when the page opens. This is the site's signature piece.
  import { league } from '../league.svelte.ts';
  import TeamBadge from './TeamBadge.svelte';

  const rows = $derived(
    [...league.standings].sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
  );
</script>

<section class="board" aria-labelledby="board-title">
  <header>
    <h2 id="board-title">Tabulka</h2>
    <p>Pořadí podle softball.cz</p>
  </header>

  <table>
    <thead>
      <tr>
        <th scope="col" class="pos"><span class="visually-hidden">Pořadí</span></th>
        <th scope="col" class="team">Tým</th>
        <th scope="col" title="Zápasy">Z</th>
        <th scope="col" title="Výhry">V</th>
        <th scope="col" class="wide" title="Remízy">R</th>
        <th scope="col" title="Prohry">P</th>
        <th scope="col" class="wide" title="Skóre">Skóre</th>
        <th scope="col" title="Body">B</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as s, i (s.team_id)}
        {@const team = league.team(s.team_id)}
        <tr style:--i={i} style:--team={team?.color}>
          <td class="pos"><span class="slot small">{s.position ?? '–'}</span></td>
          <th scope="row" class="team">
            <a href="/tymy/{s.team_id}">
              <TeamBadge {team} size={30} eager />
              <span class="full">{team?.name ?? s.team_id}</span>
              <span class="short">{team?.short_name ?? team?.code}</span>
            </a>
          </th>
          <td><span class="slot">{s.games}</span></td>
          <td><span class="slot">{s.wins}</span></td>
          <td class="wide"><span class="slot">{s.draws}</span></td>
          <td><span class="slot">{s.losses}</span></td>
          <td class="wide"><span class="slot score">{s.runs_for}:{s.runs_against}</span></td>
          <td><span class="slot pts">{s.points}</span></td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  .board {
    --slat: rgb(255 255 255 / 0.025);
    background:
      repeating-linear-gradient(90deg, transparent 0 46px, var(--slat) 46px 48px),
      var(--board);
    color: var(--board-ink);
    border-radius: var(--radius-l);
    padding: 18px 14px 14px;
    box-shadow: var(--shadow), inset 0 0 0 1px rgb(255 255 255 / 0.04);
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 0 6px 12px;
  }
  h2 {
    color: var(--board-ink);
    font-size: 30px;
  }
  header p {
    margin: 0;
    font-size: 13px;
    color: var(--board-muted);
  }

  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0 6px;
  }
  thead th {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 15px;
    color: var(--board-muted);
    text-align: center;
    padding: 0 2px 2px;
  }
  thead th.team {
    text-align: left;
    padding-left: 4px;
  }
  td {
    text-align: center;
    padding: 0 2px;
  }
  td.pos {
    width: 34px;
  }
  .team {
    text-align: left;
    width: 100%;
    font-weight: 600;
  }
  .team a {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 8px 4px 4px;
    color: var(--board-ink);
    text-decoration: none;
    border-radius: 8px;
    border-left: 3px solid var(--team);
    min-height: 40px;
  }
  .team a:hover {
    background: rgb(255 255 255 / 0.06);
  }
  .full {
    display: none;
  }
  .short {
    font-size: 15px;
    line-height: 1.15;
  }

  .slot {
    display: inline-block;
    min-width: 1.75em;
    padding: 3px 4px 1px;
    border-radius: 4px;
    background: var(--board-slot);
    box-shadow:
      inset 0 2px 3px rgb(0 0 0 / 0.55),
      0 1px 0 rgb(255 255 255 / 0.06);
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 22px;
    line-height: 1.1;
    color: var(--board-ink);
    font-variant-numeric: tabular-nums;
    transform-origin: 50% 50%;
    animation: flip 520ms cubic-bezier(0.2, 0.8, 0.3, 1.15) both;
    animation-delay: calc(var(--i) * 55ms + 120ms);
  }
  .slot.small {
    min-width: 1.6em;
    font-size: 18px;
    color: var(--board-muted);
  }
  .slot.pts {
    color: var(--amber);
    min-width: 2.1em;
  }
  .slot.score {
    font-size: 18px;
    min-width: 3.6em;
  }

  .wide {
    display: none;
  }

  @keyframes flip {
    from {
      transform: perspective(300px) rotateX(-95deg);
      opacity: 0;
    }
    to {
      transform: perspective(300px) rotateX(0);
      opacity: 1;
    }
  }

  @media (min-width: 560px) {
    .full {
      display: inline;
    }
    .short {
      display: none;
    }
    .wide {
      display: table-cell;
    }
    .board {
      padding: 22px 20px 18px;
    }
  }
</style>
