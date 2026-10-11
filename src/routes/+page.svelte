<script lang="ts">
  // Overview at a glance: live games, the next game, latest results, top 3 batters, table.
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { league } from '#lib/league.svelte.ts';
  import { battingTotals, errorMessage } from '#lib/api.ts';
  import { STATS, compareStat, type StatKey } from '#lib/stats.ts';
  import { rate, num, plural, time } from '#lib/format.ts';
  import type { Game, PlayerTotals } from '#lib/types.ts';
  import Standings from '#lib/components/Standings.svelte';
  import TeamBadge from '#lib/components/TeamBadge.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import LiveNow from '#lib/components/LiveNow.svelte';
  import Skeleton from '#lib/components/Skeleton.svelte';

  let totals = $state<PlayerTotals[] | null>(null);
  let loadError = $state<string | null>(null);
  const TOP_STATS: StatKey[] = ['avg', 'ops', 'h', 'hr', 'rbi'];
  let stat = $state<StatKey>('avg');
  /** qualification for rate stats on the overview (the player list has its own setting) */
  const MIN_PA = 10;

  onMount(async () => {
    try {
      const [t] = await Promise.all([battingTotals(league.season!.id), league.loadRecorded()]);
      totals = t;
    } catch (e) {
      loadError = errorMessage(e);
    }
  });

  const seasonRunning = $derived(league.upcomingGames.length > 0);

  // ---------------------------------------------------------------- top 3
  const def = $derived(STATS[stat]);
  const leaders = $derived.by(() => {
    if (!totals) return [];
    const pool = def.kind === 'rate' ? totals.filter((t) => t.pa >= MIN_PA) : totals;
    return pool
      .filter((t) => t[stat] !== null && Number(t[stat]) > 0)
      .sort((a, b) => compareStat(a[stat], b[stat], -1))
      .slice(0, 3);
  });

  // ---------------------------------------------------------------- games
  const recent = $derived(league.playedGames.slice(0, 3));
  const next = $derived(league.upcomingGames[0]);
  const later = $derived(league.upcomingGames.slice(1, 4));
  // a game that can be scored live right now (2 h before until 4 h after the scheduled start)
  const liveCandidate = $derived(
    league.games.find((g) => {
      if (!g.starts_at || g.status === 'cancelled' || g.status === 'canceled') return false;
      const t = new Date(g.starts_at).getTime() - Date.now();
      return t <= 2 * 3600_000 && t >= -4 * 3600_000;
    })
  );
  const firstToRecord = $derived(league.playedGames.find((g) => (league.recorded.get(g.id) ?? 0) < 2) ?? league.playedGames[0]);

  const dayFmt = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', weekday: 'long', day: 'numeric', month: 'numeric' });
  const shortFmt = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', weekday: 'short', day: 'numeric', month: 'numeric' });
  const pragueDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Prague' }).format(d);

  /** "dnes", "zítra", "za 5 dní" or the date */
  function when(iso: string | null): string {
    if (!iso) return 'termín neurčen';
    const d = new Date(iso);
    const days = Math.round((Date.parse(pragueDay(d)) - Date.parse(pragueDay(new Date()))) / 86_400_000);
    if (days === 0) return `dnes v ${time(iso)}`;
    if (days === 1) return `zítra v ${time(iso)}`;
    return `${dayFmt.format(d)}, ${time(iso)}`;
  }
  function inDays(iso: string | null): string | null {
    if (!iso) return null;
    const days = Math.round((Date.parse(pragueDay(new Date(iso))) - Date.parse(pragueDay(new Date()))) / 86_400_000);
    return days >= 2 ? `za ${days} ${plural(days, ['den', 'dny', 'dní'])}` : null;
  }

  const recordedLabel = (g: Game) => {
    const n = league.recorded.get(g.id) ?? 0;
    return n >= 2 ? 'zapsáno' : n === 1 ? 'zapsán 1 tým' : 'bez statistik';
  };
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
    </div>
    <div class="hero-actions rise" style:--i="2">
      {#if liveCandidate}
        <a class="btn btn-primary" href="/zapasy/{liveCandidate.id}/zive"><Icon name="live" size={18} /> Zapisovat živě</a>
      {:else}
        <a class="btn btn-primary" href={firstToRecord ? `/zapasy/${firstToRecord.id}?zapis` : '/zapasy'}><Icon name="plus" size={18} /> Zapsat statistiky</a>
      {/if}
      <a class="btn btn-dark" href="/zapasy?stav=nadchazejici">Rozpis</a>
    </div>
  </section>

  <LiveNow />

  <div class="glance">
    <!-- ------------------------------------------------ next game -->
    <section class="card next rise" style:--i="2" aria-labelledby="next-title" style:--home={league.team(next?.home_team_id)?.color} style:--away={league.team(next?.away_team_id)?.color}>
      <div class="section-head">
        <h2 id="next-title">Další zápas</h2>
        <a class="link-accent" href="/zapasy?stav=nadchazejici">Rozpis</a>
      </div>
      {#if next}
        {@const h = league.team(next.home_team_id)}
        {@const a = league.team(next.away_team_id)}
        <a class="match" href="/zapasy/{next.id}">
          <span class="mt"><TeamBadge team={h} size={44} eager /><span>{h?.short_name ?? h?.name}</span></span>
          <span class="vs">vs</span>
          <span class="mt"><TeamBadge team={a} size={44} eager /><span>{a?.short_name ?? a?.name}</span></span>
        </a>
        <p class="when">
          <strong>{when(next.starts_at)}</strong>
          {#if inDays(next.starts_at)}<span class="pill neutral">{inDays(next.starts_at)}</span>{/if}
        </p>
        {#if next.venue}<p class="muted venue">{next.venue}</p>{/if}
        {#if later.length}
          <ul class="later">
            {#each later as g (g.id)}
              {@const lh = league.team(g.home_team_id)}
              {@const la = league.team(g.away_team_id)}
              <li><a href="/zapasy/{g.id}"><span class="d">{g.starts_at ? shortFmt.format(new Date(g.starts_at)) : '–'}</span><span class="n">{lh?.short_name ?? lh?.name} – {la?.short_name ?? la?.name}</span></a></li>
            {/each}
          </ul>
        {/if}
      {:else}
        <p class="muted">V rozpisu už žádný zápas není.</p>
      {/if}
    </section>

    <!-- ------------------------------------------------ latest results -->
    <section class="card results rise" style:--i="3" aria-labelledby="recent-title">
      <div class="section-head">
        <h2 id="recent-title">Poslední výsledky</h2>
        <a class="link-accent" href="/zapasy">Všechny</a>
      </div>
      {#if recent.length}
        <ul class="res-list">
          {#each recent as g (g.id)}
            {@const h = league.team(g.home_team_id)}
            {@const a = league.team(g.away_team_id)}
            {@const hw = (g.home_score ?? 0) > (g.away_score ?? 0)}
            {@const aw = (g.away_score ?? 0) > (g.home_score ?? 0)}
            <li>
              <a href="/zapasy/{g.id}">
                <span class="row" class:win={hw} class:lose={aw}><TeamBadge team={h} size={24} /><span class="n">{h?.short_name ?? h?.name}</span><span class="s">{g.home_score ?? '–'}</span></span>
                <span class="row" class:win={aw} class:lose={hw}><TeamBadge team={a} size={24} /><span class="n">{a?.short_name ?? a?.name}</span><span class="s">{g.away_score ?? '–'}</span></span>
                <span class="meta"><span>{g.starts_at ? shortFmt.format(new Date(g.starts_at)) : ''}</span><span class="rec" class:ok={(league.recorded.get(g.id) ?? 0) >= 2}>{recordedLabel(g)}</span></span>
              </a>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="muted">Zatím se nehrálo.</p>
      {/if}
    </section>

    <!-- ------------------------------------------------ top 3 -->
    <section class="card leaders rise" style:--i="4" aria-labelledby="leaders-title">
      <div class="section-head">
        <h2 id="leaders-title">Nejlepší pálkaři</h2>
        <a class="link-accent" href="/hraci?sort={stat}">Všichni</a>
      </div>
      <div class="seg" role="group" aria-label="Statistika">
        {#each TOP_STATS as k (k)}
          <button type="button" aria-pressed={stat === k} title={STATS[k].title} onclick={() => (stat = k)}>{STATS[k].label}</button>
        {/each}
      </div>
      {#if loadError}
        <p class="empty">{loadError}</p>
      {:else if totals === null}
        <Skeleton rows={3} height={56} />
      {:else if totals.length === 0}
        <p class="muted none-small">Po prvním zápisu ze zápasu se tu objeví nejlepší pálkaři.</p>
      {:else if leaders.length === 0}
        <p class="muted none-small">Nikdo zatím nemá aspoň {MIN_PA} PA.</p>
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
        {#if def.kind === 'rate'}<p class="muted qual">Hráči s aspoň {MIN_PA} PA.</p>{/if}
      {/if}
    </section>
  </div>

  <div class="table-wrap">
    <Standings />
  </div>
</div>

<style>
  /* ---------- hero */
  .hero {
    display: grid;
    gap: 16px;
    align-items: end;
    margin: 14px 0 20px;
  }
  @media (min-width: 900px) {
    .hero {
      grid-template-columns: 1fr auto;
      margin: 36px 0 28px;
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
    margin-top: 14px;
    font-size: clamp(34px, 8vw, 72px);
  }
  .hero-actions {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 10px;
  }
  .hero-actions .btn {
    padding-inline: 12px;
  }
  @media (min-width: 900px) {
    .hero-actions {
      display: flex;
    }
    .hero-actions .btn {
      padding-inline: 20px;
    }
  }

  /* ---------- at a glance */
  .glance {
    display: grid;
    gap: 14px;
    grid-template-columns: minmax(0, 1fr);
  }
  @media (min-width: 720px) {
    .glance {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .leaders {
      grid-column: 1 / -1;
    }
  }
  @media (min-width: 1100px) {
    .glance {
      grid-template-columns: repeat(3, minmax(0, 1fr));
    }
    .leaders {
      grid-column: auto;
    }
  }
  .glance > .card {
    padding: 18px;
    min-width: 0;
  }
  .glance .section-head {
    margin-bottom: 12px;
  }
  .glance h2 {
    font-size: 19px;
  }

  /* next game */
  .next {
    background:
      radial-gradient(70% 90% at 0% 0%, color-mix(in srgb, var(--home, transparent) 16%, transparent), transparent 60%),
      radial-gradient(70% 90% at 100% 0%, color-mix(in srgb, var(--away, transparent) 16%, transparent), transparent 60%),
      var(--surface);
  }
  .match {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    text-decoration: none;
    color: var(--ink);
  }
  .mt {
    display: grid;
    justify-items: center;
    gap: 6px;
    text-align: center;
    font-weight: 800;
    font-size: 16px;
    letter-spacing: -0.01em;
    min-width: 0;
  }
  .mt span {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .vs {
    font-weight: 700;
    color: var(--faint);
    font-size: 14px;
  }
  .when {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin: 14px 0 0;
    font-size: 15px;
  }
  .when strong::first-letter {
    text-transform: uppercase;
  }
  .venue {
    margin: 4px 0 0;
    text-align: center;
    font-size: 13.5px;
  }
  .later {
    list-style: none;
    margin: 14px 0 0;
    padding: 10px 0 0;
    border-top: 1px dashed var(--line);
    display: grid;
    gap: 2px;
  }
  .later a {
    display: grid;
    grid-template-columns: 74px minmax(0, 1fr);
    gap: 10px;
    padding: 5px 2px;
    font-size: 14px;
    text-decoration: none;
    color: var(--ink);
  }
  .later .d {
    color: var(--muted);
  }
  .later .n {
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .later a:hover .n {
    text-decoration: underline;
  }

  /* results */
  .res-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .res-list a {
    display: grid;
    gap: 4px;
    padding: 10px 12px;
    border-radius: 14px;
    background: var(--surface-2);
    text-decoration: none;
    color: var(--ink);
    transition: background-color 140ms;
  }
  .res-list a:hover {
    background: var(--surface-3);
  }
  .res-list .row {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
  }
  .res-list .n {
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .res-list .s {
    font-weight: 800;
    font-size: 18px;
    min-width: 1.5em;
    text-align: right;
  }
  .res-list .lose {
    color: var(--muted);
  }
  .res-list .lose .n {
    font-weight: 600;
  }
  .meta {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    margin-top: 2px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .rec {
    color: var(--accent-text);
    font-weight: 700;
  }
  .rec.ok {
    color: var(--pos);
  }

  /* leaders */
  .leaders .seg {
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .leaders .seg::-webkit-scrollbar {
    display: none;
  }
  .leaders .seg button {
    flex: 1 0 auto;
  }
  .list {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
  }
  .list li {
    display: grid;
    grid-template-columns: 20px 30px 1fr auto;
    align-items: center;
    gap: 12px;
    padding: 10px 8px;
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
  .qual {
    margin: 8px 0 0;
    font-size: 12.5px;
  }
  .none-small {
    margin: 14px 0 0;
    font-size: 14px;
  }
  .leaders :global(.skeleton-list) {
    margin-top: 12px;
  }

  .table-wrap {
    margin-top: 14px;
  }
</style>
