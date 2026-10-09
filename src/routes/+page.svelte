<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { league } from '#lib/league.svelte.ts';
  import { battingTotals, errorMessage } from '#lib/api.ts';
  import { LEADER_STATS, STATS, compareStat, type StatKey } from '#lib/stats.ts';
  import { rate, num, plural } from '#lib/format.ts';
  import { countUp, czNumber } from '#lib/motion.ts';
  import type { PlayerTotals } from '#lib/types.ts';
  import Standings from '#lib/components/Standings.svelte';
  import GameCard from '#lib/components/GameCard.svelte';
  import TeamBadge from '#lib/components/TeamBadge.svelte';
  import Icon from '#lib/components/Icon.svelte';

  let totals = $state<PlayerTotals[] | null>(null);
  let loadError = $state<string | null>(null);
  let stat = $state<StatKey>('avg');
  let minPa = $state(10);

  onMount(async () => {
    try {
      const [t] = await Promise.all([battingTotals(league.season!.id), league.loadRecorded()]);
      totals = t;
    } catch (e) {
      loadError = errorMessage(e);
    }
  });

  // ---------------------------------------------------------------- headline numbers
  const table = $derived([...league.standings].sort((a, b) => (a.position ?? 99) - (b.position ?? 99)));
  const leader = $derived(table[0]);
  const leaderTeam = $derived(league.team(leader?.team_id));
  const lead = $derived(leader ? leader.points - Math.max(0, ...table.slice(1).map((s) => s.points)) : 0);

  const played = $derived(league.games.filter((g) => g.home_score !== null && g.away_score !== null));
  const totalRuns = $derived(played.reduce((a, g) => a + g.home_score! + g.away_score!, 0));
  const runsPerGame = $derived(played.length ? totalRuns / played.length : 0);
  const seasonRunning = $derived(league.upcomingGames.length > 0);

  // ---------------------------------------------------------------- leaders
  const def = $derived(STATS[stat]);
  const leaders = $derived.by(() => {
    if (!totals) return [];
    const pool = def.kind === 'rate' ? totals.filter((t) => t.pa >= minPa) : totals;
    return pool
      .filter((t) => t[stat] !== null && Number(t[stat]) > 0)
      .sort((a, b) => compareStat(a[stat], b[stat], -1))
      .slice(0, 5);
  });

  const recent = $derived(league.playedGames.slice(0, 4));
  const upcoming = $derived(league.upcomingGames.slice(0, 6));
  const firstToRecord = $derived(league.playedGames.find((g) => (league.recorded.get(g.id) ?? 0) < 2) ?? league.playedGames[0]);
</script>

<svelte:head>
  <title>Pražský přebor mužů – statistiky</title>
</svelte:head>

<div class="page">
  <section class="hero">
    <div class="hero-text">
      <span class="status rise">
        <span class="dot" class:off={!seasonRunning}></span>
        {seasonRunning ? 'Sezóna probíhá' : 'Sezóna skončila'}, softball muži
      </span>
      <h1 class="rise" style:--i="1">{league.season?.name ?? 'Pražský přebor mužů'}</h1>
      <p class="rise" style:--i="2">
        Pálkařské statistiky všech týmů. Zapisuje je kdokoli po zápase, každá změna se ukládá do historie a dá se vrátit.
      </p>
    </div>
    <div class="hero-actions rise" style:--i="3">
      <a class="btn btn-dark" href="/zapasy?stav=nadchazejici">Rozpis zápasů</a>
      <a class="btn btn-primary" href={firstToRecord ? `/zapasy/${firstToRecord.id}?zapis` : '/zapasy'}>
        <Icon name="plus" size={18} /> Zapsat statistiky
      </a>
    </div>
  </section>

  <section class="kpis" aria-label="Sezóna v číslech">
    {#if leader && leaderTeam}
      <a class="card kpi leader rise" style:--i="2" style:--team={leaderTeam.color} href="/tymy/{leaderTeam.id}">
        <span class="kpi-top">
          <span class="label-accent">Lídr tabulky</span>
          {#if lead > 0}<span class="muted small">náskok {lead} {plural(lead, ['bod', 'body', 'bodů'])}</span>{/if}
        </span>
        <span class="leader-main">
          <TeamBadge team={leaderTeam} size={58} eager />
          <span>
            <span class="leader-name">{leaderTeam.name}</span>
            <span class="muted">{leader.points} bodů, {leader.wins} výher, {leader.losses} proher</span>
          </span>
        </span>
        <span class="leader-chips">
          <span class="pill neutral">{Math.round((leader.games ? leader.wins / leader.games : 0) * 100)} % výher</span>
          <span class="pill neutral">Skóre {leader.runs_for}:{leader.runs_against}</span>
          <span class="pill warn">{leader.runs_for - leader.runs_against >= 0 ? '+' : '−'}{Math.abs(leader.runs_for - leader.runs_against)}</span>
        </span>
        <span class="ring" aria-hidden="true"></span>
      </a>
    {/if}
    <div class="card kpi rise" style:--i="3">
      <span class="muted small">Odehrané zápasy</span>
      <span class="big"><span use:countUp={{ value: played.length }}></span><small>z {league.games.length}, {league.teams.length} týmů</small></span>
    </div>
    <div class="card kpi rise" style:--i="4">
      <span class="muted small" title="Průměrný součet bodů (doběhů) obou týmů v jednom zápase">Bodů na zápas</span>
      <span class="big"><span use:countUp={{ value: runsPerGame, decimals: 1 }}></span><small>{czNumber(totalRuns)} celkem</small></span>
    </div>
  </section>

  <div class="grid">
    <Standings />

    <section class="card leaders" aria-labelledby="leaders-title">
      <div class="section-head">
        <h2 id="leaders-title">Nejlepší pálkaři</h2>
        <a class="link-accent" href="/hraci?sort={stat}">Všichni</a>
      </div>

      <div class="seg" role="group" aria-label="Statistika">
        {#each LEADER_STATS as k (k)}
          <button type="button" aria-pressed={stat === k} title={STATS[k].title} onclick={() => (stat = k)}>{STATS[k].label}</button>
        {/each}
      </div>

      {#if def.kind === 'rate'}
        <label class="minpa">
          <span>Minimálně</span>
          <input class="input" type="number" min="0" max="200" inputmode="numeric" bind:value={minPa} />
          <span>PA</span>
        </label>
      {/if}

      {#if loadError}
        <p class="empty">{loadError}</p>
      {:else if totals === null}
        <ol class="list" aria-busy="true">
          {#each Array(5) as _, i (i)}<li class="skeleton"></li>{/each}
        </ol>
      {:else if totals.length === 0}
        <div class="none">
          <span class="none-icon"><Icon name="board" size={22} /></span>
          <h3>Zatím žádné statistiky</h3>
          <p>Po prvním zápisu ze zápasu se tu objeví žebříček pálkařů.</p>
          <a class="btn btn-primary btn-sm" href={firstToRecord ? `/zapasy/${firstToRecord.id}?zapis` : '/zapasy'}>Vybrat zápas a zapsat</a>
        </div>
      {:else if leaders.length === 0}
        <p class="none-small">Nikdo nemá aspoň {minPa} PA. Sniž limit.</p>
      {:else}
        <ol class="list">
          {#each leaders as l, i (l.player_id)}
            {@const p = league.player(l.player_id)}
            {@const team = league.team(l.team_id)}
            <li animate:flip={{ duration: 260 }} in:fade={{ duration: 160 }} class:first={i === 0}>
              <span class="rank">{i + 1}</span>
              <TeamBadge {team} size={30} />
              <a class="who" href="/hraci/{l.player_id}">
                <span class="pname">{p?.name ?? 'Neznámý hráč'}</span>
                <span class="pteam">{team?.short_name ?? team?.name}, {l.pa} PA</span>
              </a>
              <span class="val">{def.kind === 'rate' ? rate(l[stat]) : num(l[stat])}</span>
            </li>
          {/each}
        </ol>
      {/if}
    </section>
  </div>

  <section class="section" aria-labelledby="recent-title">
    <div class="section-head">
      <h2 id="recent-title">Poslední výsledky</h2>
      <a class="link-accent" href="/zapasy">Všechny zápasy</a>
    </div>
    {#if recent.length}
      <div class="cards4">
        {#each recent as g (g.id)}<GameCard game={g} recorded={league.recorded.get(g.id) ?? 0} />{/each}
      </div>
    {:else}
      <p class="empty">Zatím se nehrálo.</p>
    {/if}
  </section>

  <section class="section" aria-labelledby="next-title">
    <div class="section-head">
      <h2 id="next-title">Nadcházející zápasy</h2>
      <a class="link-accent" href="/zapasy?stav=nadchazejici">Rozpis</a>
    </div>
    {#if upcoming.length}
      <div class="cards3">
        {#each upcoming as g (g.id)}<GameCard game={g} />{/each}
      </div>
    {:else}
      <p class="empty">V rozpisu už žádný zápas není.</p>
    {/if}
  </section>
</div>

<style>
  /* ---------- hero */
  .hero {
    display: grid;
    gap: 24px;
    align-items: end;
    margin: 20px 0 32px;
  }
  @media (min-width: 900px) {
    .hero {
      grid-template-columns: 1fr auto;
      margin: 44px 0 40px;
    }
  }
  .status {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 5px 12px;
    border-radius: 999px;
    border: 1px solid var(--line);
    background: var(--surface);
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--pos);
    box-shadow: 0 0 0 3px var(--pos-soft);
    animation: pulse 2.4s ease-in-out infinite;
  }
  .dot.off {
    background: var(--faint);
    box-shadow: none;
    animation: none;
  }
  @keyframes pulse {
    50% {
      box-shadow: 0 0 0 6px transparent;
    }
  }
  h1 {
    margin-top: 18px;
    font-size: clamp(44px, 9vw, 88px);
  }
  .hero-text p {
    margin: 18px 0 0;
    max-width: 52ch;
    font-size: 17px;
    color: var(--muted);
  }
  .hero-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }

  /* ---------- kpis */
  .kpis {
    display: grid;
    gap: 14px;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
  @media (min-width: 900px) {
    .kpis {
      grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr);
    }
  }
  .kpi {
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    gap: 18px;
    min-height: 170px;
    padding: 20px;
    overflow: hidden;
    text-decoration: none;
  }
  .small {
    font-size: 13.5px;
  }
  .big {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 10px;
  }
  .big > span {
    font-size: clamp(40px, 7vw, 56px);
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 1;
  }
  .big small {
    font-size: 14px;
    color: var(--muted);
  }

  .leader {
    grid-column: 1 / -1;
    background:
      radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--team) 26%, transparent), transparent 55%),
      var(--surface);
    transition: border-color 160ms;
  }
  .leader:hover {
    border-color: var(--line-strong);
  }
  @media (min-width: 900px) {
    .leader {
      grid-column: auto;
    }
  }
  .kpi-top {
    display: flex;
    justify-content: space-between;
    gap: 12px;
    position: relative;
    z-index: 1;
  }
  .label-accent {
    font-size: 13.5px;
    font-weight: 700;
    color: var(--accent-text);
  }
  .leader-main {
    display: flex;
    align-items: center;
    gap: 16px;
    position: relative;
    z-index: 1;
  }
  .leader-main > span {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .leader-name {
    font-size: clamp(22px, 3.4vw, 30px);
    font-weight: 800;
    letter-spacing: -0.03em;
    line-height: 1.05;
  }
  .leader-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    position: relative;
    z-index: 1;
  }
  .leader-chips .pill {
    padding: 6px 12px;
    font-size: 13px;
  }
  .ring {
    position: absolute;
    right: -70px;
    top: -10px;
    width: 230px;
    height: 230px;
    border-radius: 50%;
    border: 26px solid color-mix(in srgb, var(--team) 22%, transparent);
    pointer-events: none;
  }

  /* ---------- standings + leaders */
  .grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 14px;
    margin-top: 14px;
  }
  @media (min-width: 1000px) {
    .grid {
      grid-template-columns: minmax(0, 1.75fr) minmax(0, 1fr);
      align-items: start;
    }
  }
  .leaders {
    padding: 22px;
  }
  .leaders .seg button {
    flex: 1 0 calc(16% - 4px);
  }
  .minpa {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 14px;
    font-size: 14px;
    color: var(--muted);
  }
  .minpa .input {
    width: 70px;
    min-height: 40px;
    padding: 6px 10px;
    font-weight: 700;
  }

  .none {
    display: grid;
    justify-items: center;
    text-align: center;
    gap: 8px;
    margin-top: 16px;
    padding: 28px 18px;
    border-radius: 16px;
    background: var(--surface-2);
  }
  .none-icon {
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border-radius: 14px;
    background: var(--accent-soft);
    color: var(--accent-text);
    margin-bottom: 6px;
  }
  .none p {
    margin: 0 0 10px;
    color: var(--muted);
    font-size: 14px;
    max-width: 30ch;
  }
  .none-small {
    margin-top: 16px;
    color: var(--muted);
  }

  .list {
    list-style: none;
    margin: 14px 0 0;
    padding: 0;
  }
  .list li {
    display: grid;
    grid-template-columns: 20px 30px 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 11px 8px;
    border-radius: 12px;
  }
  .list li.first {
    background: var(--accent-soft);
  }
  .rank {
    font-weight: 800;
    color: var(--faint);
    text-align: center;
  }
  .first .rank {
    color: var(--accent-text);
  }
  .who {
    display: grid;
    min-width: 0;
    text-decoration: none;
  }
  .pname {
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .who:hover .pname {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .pteam {
    font-size: 13px;
    color: var(--muted);
  }
  .val {
    font-weight: 800;
    font-size: 22px;
    letter-spacing: -0.02em;
  }
  .first .val {
    color: var(--accent-text);
  }
  .skeleton {
    height: 52px;
    margin-bottom: 4px;
    background: linear-gradient(90deg, var(--surface-2), var(--surface-3), var(--surface-2));
    background-size: 200% 100%;
    animation: shimmer 1.2s linear infinite;
  }
  @keyframes shimmer {
    to {
      background-position: -200% 0;
    }
  }

  /* ---------- game cards */
  .cards4,
  .cards3 {
    display: grid;
    gap: 12px;
    grid-template-columns: minmax(0, 1fr);
  }
  @media (min-width: 620px) {
    .cards4,
    .cards3 {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
  @media (min-width: 1000px) {
    .cards4 {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }
    .cards3 {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
  }
</style>
