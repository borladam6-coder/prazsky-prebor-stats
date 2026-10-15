<script lang="ts">
  import { onMount } from 'svelte';
  import { league } from '../league.svelte.ts';
  import { battingTotals, errorMessage } from '../api.ts';
  import { STATS, compareStat, type StatKey } from '../stats.ts';
  import { day, time, rate, num } from '../format.ts';
  import type { PlayerTotals } from '../types.ts';
  import Standings from './Standings.svelte';
  import TeamBadge from './TeamBadge.svelte';
  import LiveNow from './LiveNow.svelte';
  import Scoreboard from './Scoreboard.svelte';
  import Skeleton from './Skeleton.svelte';

  let totals = $state<PlayerTotals[] | null>(null);
  let loadError = $state<string | null>(null);
  let stat = $state<StatKey>('avg');
  const TOP_STATS: StatKey[] = ['avg', 'ops', 'h', 'hr', 'rbi'];
  const MIN_PA = 10;
  async function loadTotals() {
    loadError = null;
    try { totals = await battingTotals(league.season!.id); }
    catch (e) { loadError = errorMessage(e); }
  }
  onMount(() => {
    void loadTotals();
    void league.loadRecorded().catch(() => {});
  });
  const upcoming = $derived(league.upcomingGames.filter(g => !['cancelled', 'canceled'].includes(g.status)));
  const recent = $derived(league.playedGames.slice(0, 3));
  const def = $derived(STATS[stat]);
  const leaders = $derived((totals ?? [])
    .filter(t => (def.kind !== 'rate' || t.pa >= MIN_PA) && t[stat] !== null && Number(t[stat]) > 0)
    .sort((a,b) => compareStat(a[stat], b[stat], -1))
    .slice(0, 3));
  const star = $derived(leaders[0]);
  const player = $derived(league.player(star?.player_id));
  const team = $derived(league.team(star?.team_id));
  const initials = $derived((player?.name ?? '').split(/\s+/).filter(Boolean).slice(0,2).map(s=>s[0]).join(''));
  const statName = $derived(STATS[stat].title);
</script>

<svelte:head><title>Pražský přebor mužů – výsledky a statistiky</title></svelte:head>

<div class="page dashboard">
  <header class="intro rise">
    <div><p class="eyebrow">Dobrý den, fanoušci.</p><h1>Všechno podstatné.<br class="mobile-break" /> Na jednom hřišti.</h1></div>
    <span class="season-label">SOFTBALL MUŽI <span>/</span> {league.season?.year}</span>
  </header>
  <div class="dashboard-grid">
    <div class="spotlight rise" style:--i="1">
      <LiveNow featured>
        {#snippet fallback()}<Scoreboard game={upcoming[0] ?? recent[0]} />{/snippet}
      </LiveNow>
    </div>
    <section class="card schedule rise" style:--i="2" aria-labelledby="schedule-title">
      <div class="section-head"><h2 id="schedule-title">Na programu</h2><a class="link-accent" href="/zapasy?stav=nadchazejici">Celý rozpis <span aria-hidden="true">↗</span></a></div>
      {#if upcoming.length}
        <ol class="fixtures">
          {#each upcoming.slice(0,3) as g (g.id)}
            {@const home = league.team(g.home_team_id)}{@const away = league.team(g.away_team_id)}
            <li><a class="fixture" href="/zapasy/{g.id}">
              <span class="fixture-date"><strong>{day(g.starts_at)}</strong><span>{time(g.starts_at)}</span><small>{g.venue || 'Místo neurčeno'}</small></span>
              <span class="fixture-teams"><span><TeamBadge team={home} size={24} /><strong>{home?.short_name ?? home?.name}</strong></span><span><TeamBadge team={away} size={24} /><strong>{away?.short_name ?? away?.name}</strong></span></span>
              <span class="fixture-arrow" aria-hidden="true">↗</span>
            </a></li>
          {/each}
        </ol>
      {:else}
        <div class="schedule-empty"><span aria-hidden="true">◇</span><h3>Další termín zatím není.</h3><p>Prohlédni si výsledky odehraných zápasů.</p><a class="link-accent" href="/zapasy">Výsledky →</a></div>
      {/if}
    </section>
    <div class="standings-slot rise" style:--i="3"><Standings /></div>
    <section class="player-card rise" style:--i="4" aria-labelledby="leader-title">
      {#if star}<img class="batter-art" src="/images/batter-cutout.webp" alt="" aria-hidden="true" width="640" height="960" loading="lazy" decoding="async" /><span class="art-caption">Ilustrační motiv</span>{/if}
      <div class="player-head"><h2 id="leader-title">Lídr sezóny</h2><a href="/hraci?sort={stat}">Všichni hráči <span aria-hidden="true">↗</span></a></div>
      <div class="metric-tabs" role="group" aria-label="Vybrat statistiku lídra sezóny">
        {#each TOP_STATS as key}<button type="button" aria-pressed={stat === key} title={STATS[key].title} onclick={() => stat = key}>{STATS[key].label}</button>{/each}
      </div>
      {#if loadError}
        <div class="player-empty" role="status"><h3>Statistiky se nepodařilo načíst.</h3><p>{loadError}</p><button class="retry" type="button" onclick={loadTotals}>Zkusit znovu →</button></div>
      {:else if totals === null}
        <div class="player-empty" aria-label="Načítání statistik"><Skeleton rows={3} height={44} /></div>
      {:else if star}
        <a class="player-feature" href="/hraci/{star.player_id}">
          <div class="player-stat"><strong class="metric">{def.kind === 'rate' ? rate(star[stat]) : num(star[stat])}</strong><span class="metric-label">{statName}</span></div>
          <div class="monogram" aria-hidden="true"><span class="diamond-outline"></span><span class="initials">{initials || 'PP'}</span></div>
          <div class="player-identity"><h3>{player?.name ?? 'Neznámý hráč'}</h3><span><TeamBadge {team} size={22} />{team?.short_name ?? team?.name}</span></div>
        </a>
        <dl class="player-numbers"><div><dt>Zápasy</dt><dd>{star.games}</dd></div><div><dt>H</dt><dd>{star.h}</dd></div><div><dt>RBI</dt><dd>{star.rbi}</dd></div><div><dt>HR</dt><dd>{star.hr}</dd></div></dl>
        <p class="qualification">{def.kind === 'rate' ? `Minimálně ${MIN_PA} vystoupení na pálce (PA).` : 'Podle statistik zapsaných v této sezóně.'}</p>
      {:else}
        <div class="player-empty"><span class="empty-diamond" aria-hidden="true">◇</span><h3>{totals.length ? 'Na první kvalifikované hráče čekáme.' : 'Každý odpal se počítá.'}</h3><p>{totals.length ? `Pro tuto statistiku zatím nikdo nesplňuje podmínky${def.kind === 'rate' ? ` (alespoň ${MIN_PA} PA)` : ''}.` : 'Po zapsání statistik se tady objeví nejlepší hráči přeboru.'}</p><a href="/zapasy">Přejít na zápasy →</a></div>
      {/if}
    </section>
  </div>
  <section class="recent-section rise" style:--i="5" aria-labelledby="results-title">
    <div class="section-head"><div><p class="eyebrow small">ZE HŘIŠTĚ</p><h2 id="results-title">Poslední výsledky</h2></div><a href="/zapasy" class="link-accent">Všechny zápasy ↗</a></div>
    {#if recent.length}
      <div class="results-grid">
        {#each recent as g (g.id)}
          {@const home = league.team(g.home_team_id)}{@const away = league.team(g.away_team_id)}
          <a class="result card" href="/zapasy/{g.id}">
            <div class="result-meta"><span>{day(g.starts_at)}</span><span class="finished">Dohráno</span></div>
            <div class="result-row" class:winner={(g.home_score ?? 0) > (g.away_score ?? 0)}><TeamBadge team={home} size={28} /><span>{home?.short_name ?? home?.name}</span><strong>{g.home_score ?? '–'}</strong></div>
            <div class="result-row" class:winner={(g.away_score ?? 0) > (g.home_score ?? 0)}><TeamBadge team={away} size={28} /><span>{away?.short_name ?? away?.name}</span><strong>{g.away_score ?? '–'}</strong></div>
            <div class="result-bottom"><span>{!league.recordedLoaded ? 'Statistiky zápasu' : (league.recorded.get(g.id) ?? 0) >= 2 ? 'Statistiky obou týmů' : (league.recorded.get(g.id) ?? 0) === 1 ? 'Statistiky jednoho týmu' : 'Zatím bez statistik'}</span><span aria-hidden="true">↗</span></div>
          </a>
        {/each}
      </div>
    {:else}<p class="empty">První výsledky se objeví po odehrání zápasů.</p>{/if}
  </section>
</div>

<style>
  .dashboard { padding-top: 34px; }
  .intro { display: flex; justify-content: space-between; align-items: end; gap: 20px; margin-bottom: 28px; }
  .eyebrow { color: var(--accent-text); font-size: 14px; font-weight: 700; margin: 0 0 9px; }
  h1 { font-size: clamp(28px,3.2vw,46px); line-height: 1.12; letter-spacing: -.045em; }
  .mobile-break { display: none; }
  .season-label { font-size: 9px; white-space: nowrap; letter-spacing: .12em; color: var(--muted); padding-bottom: 5px; }
  .season-label span { color: var(--accent-text); padding-inline: 7px; }
  .dashboard-grid { display: grid; grid-template-columns: minmax(0,1.85fr) minmax(0,1fr); gap: 20px; align-items: stretch; }
  .spotlight { min-width: 0; display: flex; flex-direction: column; }
  .spotlight :global(.scoreboard) { flex: 1; height: auto; }
  .schedule { padding: 22px 22px 8px; }
  .section-head h2, .player-head h2 { font-size: 21px; line-height: 1.2; letter-spacing: -.035em; }
  .section-head { align-items: center; margin-bottom: 16px; }
  .link-accent { font-size: 12px; white-space: nowrap; }
  .link-accent span { margin-left: 8px; }
  .fixtures { list-style: none; padding: 0; margin: 0; }
  .fixtures li + li { border-top: 1px solid var(--line); }
  .fixture { display: grid; grid-template-columns: 74px minmax(0,1fr) 14px; gap: 10px; align-items: center; padding: 15px 0; text-decoration: none; }
  .fixture-date { display: flex; flex-direction: column; font-size: 12px; line-height: 1.5; }
  .fixture-date strong { font-size: 12px; }
  .fixture-date small { color: var(--muted); font-size: 11px; margin-top: 4px; overflow-wrap: anywhere; }
  .fixture-teams { min-width: 0; display: grid; gap: 9px; }
  .fixture-teams > span { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .fixture-teams strong { font-size: 14px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .fixture-arrow { color: var(--accent-text); transition: transform .2s; }
  .fixture:hover .fixture-arrow { transform: translate(2px,-2px); }
  .fixture:hover .fixture-teams { color: var(--accent-text); }
  .schedule-empty { padding: 24px 0; color: var(--muted); font-size: 13px; }
  .schedule-empty > span { color: var(--accent-text); font-size: 32px; }
  .schedule-empty h3 { margin-top: 10px; color: var(--ink); font-size: 17px; }
  .standings-slot { min-width: 0; container-type: inline-size; }
  .standings-slot :global(.standings) { min-height: 100%; }
  .player-card { position: relative; overflow: hidden; isolation: isolate; padding: 22px 24px 17px; border-radius: 8px; color: #fff; background: #0756ec; border: 1px solid #1969ff; display: flex; flex-direction: column; min-height: 390px; }
  .batter-art { position: absolute; z-index: -1; right: -48px; bottom: 106px; width: 78%; height: 72%; object-fit: contain; object-position: right bottom; pointer-events: none; }
  .art-caption { position: absolute; z-index: 3; bottom: 12px; right: 12px; color: #fff; background: #084bca; padding: 2px 5px; font-size: 8px; border-radius: 3px; }
  .player-head, .metric-tabs, .player-numbers, .qualification { position: relative; }
  .player-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
  .player-head h2 { color: #fff; }
  .player-head a { font-size: 10px; text-decoration: none; color: #e3edff; white-space: nowrap; }
  .player-head a span { margin-left: 4px; }
  .metric-tabs { display: flex; align-self: start; gap: 4px; margin-top: 18px; padding: 3px; border: 1px solid #ffffff33; border-radius: 6px; }
  .metric-tabs button { color: #e6efff; background: #0756ec; border: 0; border-radius: 3px; font-size: 11px; font-weight: 700; min-height: 30px; min-width: 38px; cursor: pointer; transition: color .15s,background .15s; }
  .metric-tabs button[aria-pressed='true'] { color: #0649c8; background: #fff; }
  .metric-tabs button:hover { background: #ffffff22; }
  .metric-tabs button[aria-pressed='true']:hover { background: #fff; }
  .player-card :global(:focus-visible) { outline-color: #fff; }
  .player-feature { position: relative; flex: 1; display: block; text-decoration: none; padding: 20px 0 18px; min-height: 198px; }
  .player-stat { position: relative; z-index: 1; }
  .metric { font-family: 'Bahnschrift', 'Arial Narrow', var(--font); font-stretch: condensed; font-size: clamp(78px,7.4vw,110px); line-height: .95; letter-spacing: -.065em; font-weight: 700; text-shadow: 0 2px 15px #0643b033; }
  .metric-label { display: block; margin-top: 7px; font-size: 9px; text-transform: uppercase; letter-spacing: .12em; }
  .monogram { position: absolute; right: -6px; top: 26px; width: 145px; height: 145px; display: none; place-items: center; pointer-events: none; }
  .diamond-outline { position: absolute; inset: 20px; border: 2px solid #ffffff25; transform: rotate(45deg); }
  .diamond-outline::after { content: ''; position: absolute; inset: 10px; border: 1px solid #ffffff20; }
  .initials { font-family: var(--display); font-size: 76px; font-weight: 800; letter-spacing: -.1em; color: #ffffff24; transform: rotate(-8deg); }
  .player-identity { margin-top: 22px; position: relative; z-index: 1; width: 64%; text-shadow: 0 1px 8px #0344c1; }
  .player-identity h3 { font-size: 24px; max-width: 100%; overflow-wrap: anywhere; }
  .player-identity > span { display: flex; align-items: center; gap: 8px; color: #e0eaff; font-size: 11px; margin-top: 9px; }
  .player-numbers { display: grid; grid-template-columns: repeat(4,1fr); padding-top: 15px; border-top: 1px solid #ffffff33; margin: 0; gap: 12px; background: #0756ec; }
  .player-numbers div { display: flex; flex-direction: column-reverse; gap: 4px; }
  .player-numbers dt { color: #e0eaff; font-size: 8px; text-transform: uppercase; letter-spacing: .08em; }
  .player-numbers dd { margin: 0; font-size: 21px; font-weight: 700; }
  .qualification { font-size: 9px; color: #dce8ff; margin: 13px 0 0; padding-right: 70px; }
  .player-empty { padding: 20px 0; font-size: 13px; line-height: 1.6; margin-block: auto; }
  .player-empty h3 { font-size: 22px; line-height: 1.2; }
  .player-empty p { color: #e0eaff; }
  .player-empty a, .retry { color: #fff; font-size: 12px; font-weight: 700; }
  .retry { background: none; border: 1px solid #ffffff66; padding: 9px 12px; border-radius: 5px; cursor: pointer; }
  .empty-diamond { display: block; font-size: 65px; line-height: 1.2; color: #ffffff70; }
  .recent-section { margin-top: 32px; }
  .small { font-size: 9px; letter-spacing: .15em; margin-bottom: 6px; }
  .results-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 20px; }
  .result { padding: 18px 22px 0; text-decoration: none; transition: border-color .2s, transform .2s; }
  .result:hover { border-color: var(--accent); transform: translateY(-2px); }
  .result-meta { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 15px; color: var(--muted); font-size: 10px; }
  .finished { font-size: 8px; text-transform: uppercase; letter-spacing: .08em; background: var(--surface-2); padding: 2px 6px; border-radius: 3px; }
  .result-row { display: grid; grid-template-columns: 28px minmax(0,1fr) auto; align-items: center; gap: 11px; margin-bottom: 10px; font-size: 13px; color: var(--muted); }
  .result-row > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .result-row strong { font-size: 25px; font-family: var(--display); }
  .result-row.winner { color: var(--ink); font-weight: 700; }
  .winner strong { color: var(--accent-text); }
  .result-bottom { display: flex; justify-content: space-between; border-top: 1px solid var(--line); margin-top: 15px; padding: 12px 0; font-size: 10px; color: var(--muted); }
  .result-bottom > span:last-child { color: var(--accent-text); }
  @media (max-width: 1050px) { .dashboard-grid { grid-template-columns: minmax(0,1.5fr) minmax(0,1fr); gap: 16px; } .season-label { display: none; } .schedule { padding-inline: 18px; } }
  @media (max-width: 800px) { .dashboard-grid { grid-template-columns: minmax(0,1fr); } .player-card { min-height: 340px; } .schedule { padding-bottom: 10px; } .fixture { grid-template-columns: 90px 1fr 20px; } .fixture-teams strong { font-size: 14px; } .player-feature { min-height: 210px; } .monogram { right: 20px; width: 180px; height: 180px; } .initials { font-size: 100px; } .metric { font-size: 90px; } .results-grid { grid-template-columns: 1fr; gap: 12px; } .dashboard { padding-top: 24px; } h1 { font-size: 33px; } }
  @media (max-width: 480px) { .intro { margin-bottom: 22px; } .eyebrow { font-size: 12px; } h1 { font-size: 29px; } .mobile-break { display: initial; } .section-head h2 { font-size: 20px; } .player-card { padding: 22px; } .metric { font-size: 78px; } .monogram { right: -5px; width: 150px; height: 150px; } .initials { font-size: 84px; } }
</style>
