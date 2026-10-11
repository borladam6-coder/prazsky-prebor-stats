<script lang="ts">
  // League table from softball.cz: team colour stripe, PCT, games behind and the form of
  // the last five games (W/L letters, so it does not rely on colour).
  import { league } from '../league.svelte.ts';
  import { rate } from '../format.ts';
  import TeamBadge from './TeamBadge.svelte';

  const sorted = $derived([...league.standings].sort((a, b) => (a.position ?? 99) - (b.position ?? 99)));
  const top = $derived(sorted[0]);

  function form(teamId: number): ('W' | 'L' | 'T')[] {
    return league.games
      .filter((g) => (g.home_team_id === teamId || g.away_team_id === teamId) && g.home_score !== null && g.away_score !== null)
      .sort((a, b) => (b.starts_at ?? '').localeCompare(a.starts_at ?? ''))
      .slice(0, 5)
      .reverse()
      .map((g) => {
        const mine = g.home_team_id === teamId ? g.home_score! : g.away_score!;
        const theirs = g.home_team_id === teamId ? g.away_score! : g.home_score!;
        return mine > theirs ? 'W' : mine < theirs ? 'L' : 'T';
      });
  }

  const rows = $derived(
    sorted.map((s) => {
      const gb = top ? (top.wins - s.wins + (s.losses - top.losses)) / 2 : 0;
      return {
        ...s,
        pct: s.games ? s.wins / s.games : null,
        gb: gb <= 0 ? '–' : Number.isInteger(gb) ? String(gb) : gb.toFixed(1),
        diff: s.runs_for - s.runs_against,
        form: form(s.team_id)
      };
    })
  );
</script>

<section class="card standings" aria-labelledby="standings-title">
  <header>
    <h2 id="standings-title">Tabulka</h2>
    <span class="src">podle <a href="https://softball.cz/ligy/PPM" rel="noopener">softball.cz</a></span>
  </header>

  <table>
    <thead>
      <tr>
        <th scope="col" class="pos">#</th>
        <th scope="col" class="team">Tým</th>
        <th scope="col" title="Wins">W</th>
        <th scope="col" title="Losses">L</th>
        <th scope="col" class="num" title="Winning percentage">PCT</th>
        <th scope="col" class="num" title="Games behind: zápasy za prvním">GB</th>
        <th scope="col" class="formh" title="Posledních 5 zápasů">Forma</th>
        <th scope="col" class="wide num" title="Runs scored : runs allowed">RS:RA</th>
        <th scope="col" class="wide num" title="Run differential">+/−</th>
        <th scope="col" class="pts" title="Body v tabulce">Body</th>
      </tr>
    </thead>
    <tbody>
      {#each rows as s, i (s.team_id)}
        {@const team = league.team(s.team_id)}
        <tr class="rise" style:--i={i} style:--team={team?.color ?? 'var(--faint)'}>
          <td class="pos">{s.position ?? '–'}</td>
          <th scope="row" class="team">
            <a href="/tymy/{s.team_id}">
              <TeamBadge {team} size={26} eager />
              <span class="full">{team?.name ?? s.team_id}</span>
              <span class="short">{team?.short_name ?? team?.code}</span>
            </a>
          </th>
          <td class="strong">{s.wins}</td>
          <td class="dim">{s.losses}</td>
          <td class="num">{rate(s.pct)}</td>
          <td class="num dim">{s.gb}</td>
          <td class="form" aria-label="Forma: {s.form.join(' ') || 'zatím bez zápasů'}">
            {#each s.form as f, j (j)}<span class="f {f}">{f}</span>{/each}
          </td>
          <td class="wide num dim">{s.runs_for}:{s.runs_against}</td>
          <td class="wide num diff" class:plus={s.diff > 0} class:minus={s.diff < 0}>{s.diff > 0 ? '+' : s.diff < 0 ? '−' : ''}{Math.abs(s.diff)}</td>
          <td class="pts num-c">{s.points}</td>
        </tr>
      {/each}
    </tbody>
  </table>
</section>

<style>
  .standings {
    padding: 20px 10px 10px;
  }
  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding: 0 12px 12px;
  }
  .src {
    font-size: 13px;
    color: var(--muted);
  }
  .src a {
    color: inherit;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14.5px;
    font-variant-numeric: tabular-nums;
  }
  thead th {
    font-size: 12px;
    font-weight: 600;
    color: var(--faint);
    text-align: center;
    padding: 0 4px 8px;
  }
  thead th.team {
    text-align: left;
  }
  td,
  th {
    text-align: center;
    padding: 9px 4px;
  }
  tbody tr + tr td,
  tbody tr + tr th {
    border-top: 1px solid var(--line);
  }
  tbody tr:hover td,
  tbody tr:hover th {
    background: var(--surface-2);
  }
  /* team colour as a thin stripe at the row edge */
  .pos {
    width: 30px;
    color: var(--muted);
    text-align: left;
    padding-left: 10px;
    box-shadow: inset 3px 0 0 var(--team);
  }
  .team {
    text-align: left;
    font-weight: 700;
  }
  .team a {
    display: flex;
    align-items: center;
    gap: 10px;
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
  .num {
    text-align: right;
  }
  thead th.num {
    text-align: right;
  }
  .dim {
    color: var(--muted);
  }
  .strong {
    font-weight: 800;
  }
  .form {
    white-space: nowrap;
  }
  .f {
    display: inline-grid;
    place-items: center;
    width: 15px;
    height: 15px;
    margin: 0 1px;
    border-radius: 4px;
    font-size: 9.5px;
    font-weight: 800;
  }
  .f.W {
    background: var(--hit-soft);
    color: var(--hit);
  }
  .f.L {
    background: var(--out-soft);
    color: var(--out);
  }
  .f.T {
    background: var(--surface-3);
    color: var(--muted);
  }
  .diff.plus {
    color: var(--hit);
    font-weight: 700;
  }
  .diff.minus {
    color: var(--out);
    font-weight: 700;
  }
  .wide {
    display: none;
  }
  .pts {
    font-weight: 800;
    font-size: 18px;
    padding-right: 10px;
    text-align: right;
  }
  thead th.pts {
    font-size: 12px;
    font-weight: 600;
    text-align: right;
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
  @media (max-width: 639px) {
    .standings {
      padding: 14px 4px 6px;
    }
    header {
      padding: 0 10px 8px;
    }
    table {
      font-size: 14px;
    }
    td,
    th {
      padding: 9px 3px;
    }
    .team a {
      gap: 7px;
    }
    .pts {
      font-size: 16px;
      padding-right: 8px;
    }
  }
  /* narrow phones: the form says more than games behind */
  @media (max-width: 420px) {
    thead th:nth-child(6),
    tbody td:nth-child(6) {
      display: none;
    }
    .f {
      width: 14px;
      margin: 0;
    }
  }
  @media (max-width: 340px) {
    .formh,
    .form {
      display: none;
    }
  }
</style>
