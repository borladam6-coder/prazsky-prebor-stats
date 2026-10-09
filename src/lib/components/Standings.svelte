<script lang="ts">
  // League table from softball.cz with win share bars and run difference.
  import { league } from '../league.svelte.ts';
  import TeamBadge from './TeamBadge.svelte';

  const rows = $derived(
    [...league.standings]
      .sort((a, b) => (a.position ?? 99) - (b.position ?? 99))
      .map((s) => ({
        ...s,
        share: s.games ? s.wins / s.games : 0,
        diff: s.runs_for - s.runs_against
      }))
  );
</script>

<section class="card standings" aria-labelledby="standings-title">
  <header>
    <h2 id="standings-title">Tabulka</h2>
    <span class="src">Pořadí podle <a href="https://softball.cz/ligy/PPM" rel="noopener">softball.cz</a></span>
  </header>

  <table>
    <thead>
      <tr>
        <th scope="col" class="pos">#</th>
        <th scope="col" class="team">Tým</th>
        <th scope="col" class="games" title="Zápasy">Z</th>
        <th scope="col" title="Výhry">V</th>
        <th scope="col" title="Prohry">P</th>
        <th scope="col" class="share" title="Podíl výher">Úspěšnost</th>
        <th scope="col" class="wide" title="Skóre (body dané : obdržené)">Skóre</th>
        <th scope="col" title="Rozdíl skóre">+/−</th>
        <th scope="col" class="pts" title="Body v tabulce">Body</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as s, i (s.team_id)}
        {@const team = league.team(s.team_id)}
        <tr class="rise" class:leader={i === 0} style:--i={i}>
          <td class="pos">{s.position ?? '–'}</td>
          <th scope="row" class="team">
            <a href="/tymy/{s.team_id}">
              <TeamBadge {team} size={30} eager />
              <span class="full">{team?.name ?? s.team_id}</span>
              <span class="short">{team?.short_name ?? team?.code}</span>
            </a>
          </th>
          <td class="dim games">{s.games}</td>
          <td class="strong">{s.wins}</td>
          <td class="dim">{s.losses}</td>
          <td class="share">
            <span class="sharebox">
              <span class="bar"><span class="fill" style:--w={s.share} style:--i={i}></span></span>
              <span class="pct">{Math.round(s.share * 100)} %</span>
            </span>
          </td>
          <td class="wide dim">{s.runs_for}:{s.runs_against}</td>
          <td><span class="pill {s.diff >= 0 ? 'pos' : 'neg'}">{s.diff > 0 ? '+' : s.diff < 0 ? '−' : ''}{Math.abs(s.diff)}</span></td>
          <td class="pts">{s.points}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  .standings {
    padding: 22px 10px 12px;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 0 12px 14px;
  }
  .src {
    font-size: 13px;
    color: var(--muted);
  }
  .src a {
    color: var(--accent-text);
  }

  table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0 4px;
    font-size: 15px;
  }
  thead th {
    font-size: 12.5px;
    font-weight: 600;
    color: var(--faint);
    text-align: center;
    padding: 0 6px 6px;
  }
  thead th.team,
  thead th.share {
    text-align: left;
  }
  td,
  th {
    text-align: center;
    padding: 10px 6px;
  }
  tbody td:first-child {
    border-radius: 12px 0 0 12px;
  }
  tbody td:last-child {
    border-radius: 0 12px 12px 0;
  }
  tbody tr:hover td,
  tbody tr:hover th {
    background: var(--surface-2);
  }
  .pos {
    width: 34px;
    color: var(--muted);
    text-align: left;
    padding-left: 12px;
  }
  .team {
    text-align: left;
    width: 100%;
    font-weight: 700;
  }
  .team a {
    display: flex;
    align-items: center;
    gap: 12px;
    text-decoration: none;
    min-width: 0;
  }
  .team a:hover .full,
  .team a:hover .short {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .full {
    display: none;
    white-space: nowrap;
  }
  .short {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dim {
    color: var(--muted);
  }
  .strong {
    font-weight: 800;
  }
  .share {
    display: none;
  }
  .sharebox {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 150px;
  }
  .bar {
    flex: 1;
    height: 6px;
    border-radius: 3px;
    background: var(--surface-3);
    overflow: hidden;
  }
  .fill {
    display: block;
    height: 100%;
    width: calc(var(--w) * 100%);
    border-radius: 3px;
    background: var(--faint);
    transform-origin: left;
    animation: grow 900ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    animation-delay: calc(var(--i) * 45ms + 150ms);
  }
  .pct {
    font-size: 13px;
    font-weight: 700;
    min-width: 3.2em;
    text-align: right;
  }
  .wide {
    display: none;
  }
  .pts {
    font-weight: 800;
    font-size: 18px;
    padding-right: 12px;
  }
  thead th.pts {
    font-size: 12.5px;
    font-weight: 600;
  }

  .leader td,
  .leader th {
    background: var(--accent-soft);
  }
  .leader .pos,
  .leader .pts {
    color: var(--accent-text);
  }
  .leader .fill {
    background: var(--accent);
  }

  @keyframes grow {
    from {
      transform: scaleX(0);
    }
  }

  @media (min-width: 640px) {
    .full {
      display: inline;
    }
    .short {
      display: none;
    }
    .wide {
      display: table-cell;
    }
  }
  @media (min-width: 760px) {
    .share {
      display: table-cell;
    }
  }
  /* phones: fixed column widths so long team names truncate instead of wrapping */
  @media (max-width: 639px) {
    .standings {
      padding: 16px 6px 8px;
    }
    header {
      padding: 0 10px 10px;
    }
    table {
      table-layout: fixed;
      font-size: 14.5px;
    }
    td,
    th {
      padding: 9px 3px;
    }
    .pos {
      width: 26px;
      padding-left: 8px;
    }
    thead th:nth-child(4),
    thead th:nth-child(5) {
      width: 28px;
    }
    thead th:nth-child(8) {
      width: 54px;
    }
    .pts,
    thead th.pts {
      width: 40px;
      padding-right: 8px;
    }
    .games {
      display: none;
    }
    .team {
      width: auto;
    }
    .team a {
      gap: 9px;
    }
    .pill {
      padding: 3px 7px;
      font-size: 12px;
    }
    .pts {
      font-size: 16px;
    }
  }
</style>
