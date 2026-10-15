<script lang="ts">
  import { league } from '../league.svelte.ts';
  import { day, time, outsWord } from '../format.ts';
  import type { Game, LiveSession } from '../types.ts';
  import TeamBadge from './TeamBadge.svelte';
  import Diamond from './Diamond.svelte';
  import Icon from './Icon.svelte';

  let { game, sessions = [], runs = new Map<number, number>() }: {
    game: Game | undefined;
    sessions?: LiveSession[];
    runs?: Map<number, number>;
  } = $props();
  const live = $derived(sessions.length > 0);
  const current = $derived([...sessions].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0]);
  const home = $derived(league.team(game?.home_team_id));
  const away = $derived(league.team(game?.away_team_id));
  const played = $derived(game?.status === 'played');
  function score(id: number, official: number | null) {
    if (!live) return official == null ? '–' : String(official).padStart(2, '0');
    return runs.has(id) || sessions.some(s => s.team_id === id) ? String(runs.get(id) ?? 0).padStart(2, '0') : '–';
  }
</script>

<section class="scoreboard" aria-label={live ? 'Právě se hraje' : played ? 'Poslední výsledek' : 'Nejbližší zápas'}>
  <header>
    <span class="status" class:live><span class="indicator"></span>{live ? 'Právě se hraje' : played ? 'Dohráno' : 'Příští zápas'}</span>
    <span class="season">SOFTBALL / {league.season?.year ?? ''}</span>
  </header>
  {#if game}
    <div class="matchup">
      <div class="team">
        <TeamBadge team={home} size={68} eager />
        <h2>{home?.short_name ?? home?.name ?? 'Domácí'}</h2>
        <span class="team-role">Domácí</span>
      </div>
      <div class="center">
        {#if live || played}
          <div class="score" aria-label="Skóre {score(game.home_team_id, game.home_score)} ku {score(game.away_team_id, game.away_score)}">
            <span>{score(game.home_team_id, game.home_score)}</span><span class="colon">:</span><span>{score(game.away_team_id, game.away_score)}</span>
          </div>
          <span class="match-note">{current ? `${current.inning}. směna · ${outsWord(current.outs)}` : day(game.starts_at)}</span>
        {:else}
          <span class="match-date">{day(game.starts_at)}</span>
          <strong class="kickoff">{time(game.starts_at) || '—'}</strong>
          <span class="match-note">{game.starts_at ? 'Začátek zápasu' : 'Čekáme na termín'}</span>
        {/if}
      </div>
      <div class="team">
        <TeamBadge team={away} size={68} eager />
        <h2>{away?.short_name ?? away?.name ?? 'Hosté'}</h2>
        <span class="team-role">Hosté</span>
      </div>
      <div class="field">
        {#if current}
          <Diamond bases={[current.runner_1, current.runner_2, current.runner_3]} outs={current.outs} size="small" />
          <span class="field-note">Na pálce<br /><strong>{league.team(current.team_id)?.short_name ?? league.team(current.team_id)?.name}</strong></span>
        {:else}
          <svg viewBox="0 0 160 160" fill="none" aria-hidden="true">
            <path d="M80 139 16 75Q80-25 144 75Z" fill="#102e4b" stroke="#315478" />
            <path d="m80 139-47-47 47-47 47 47Z" fill="#0d223b" stroke="#3288ff" stroke-width="2" />
            <path d="m80 45 6 6-6 6-6-6zm47 41 6 6-6 6-6-6zM33 86l6 6-6 6-6-6z" fill="#73b2ff" />
            <path d="M75 135h10v6l-5 4-5-4Z" fill="#e5efff" />
            <circle cx="80" cy="96" r="5" stroke="#315478" />
          </svg>
          <span class="field-note">Pražský přebor mužů</span>
        {/if}
      </div>
    </div>
    <footer>
      <span class="venue"><Icon name="calendar" size={15} /> {game.venue || 'Místo bude upřesněno'}</span>
      <a href={live ? `/zapasy/${game.id}/sledovat` : `/zapasy/${game.id}`}>
        {live ? 'Sledovat zápas' : played ? 'Detail výsledku' : 'Detail zápasu'} <span aria-hidden="true">↗</span>
      </a>
    </footer>
  {:else}
    <div class="no-game"><span class="empty-icon" aria-hidden="true">◇</span><h2>Hřiště čeká na další zápas.</h2><p>Jakmile bude rozpis připravený, najdeš ho tady.</p><a href="/zapasy">Přejít na zápasy →</a></div>
  {/if}
</section>

<style>
  .scoreboard { --accent: #4a9bff; --surface-3: #244361; --line-strong: #527497; --pos: #b6f078; color: #f7faff; background: #091e33; border: 1px solid #16354f; border-radius: 8px; padding: 24px 28px 0; min-height: 324px; height: 100%; display: flex; flex-direction: column; overflow: hidden; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .status { display: inline-flex; align-items: center; gap: 9px; color: #9bc7ff; font-size: 12px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
  .status.live { color: #bcf579; }
  .indicator { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
  .live .indicator { animation: signal 2s ease-out infinite; }
  .season { color: #91a7be; font-size: 9px; letter-spacing: .15em; }
  .matchup { flex: 1; display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr) 112px; gap: 15px; align-items: center; padding: 30px 0; }
  .team { min-width: 0; display: flex; flex-direction: column; align-items: center; text-align: center; gap: 11px; }
  h2 { font-size: 17px; line-height: 1.2; overflow-wrap: anywhere; }
  .team-role { font-size: 9px; text-transform: uppercase; letter-spacing: .16em; color: #9eb1c6; }
  .center { text-align: center; }
  .score { display: flex; align-items: baseline; justify-content: center; gap: 8px; font-size: clamp(56px,6.7vw,104px); line-height: 1; font-weight: 700; letter-spacing: -.055em; font-family: 'Bahnschrift', 'Arial Narrow', var(--font); font-stretch: condensed; }
  .colon { color: #6484a6; font-size: .6em; }
  .match-note { display: block; margin-top: 12px; color: #a8bdd1; font-size: 12px; }
  .match-date { display: block; color: #a8bdd1; font-size: 11px; margin-bottom: 8px; }
  .kickoff { font-family: var(--display); font-size: clamp(34px,4.2vw,58px); line-height: 1; letter-spacing: -.055em; }
  .field { border-left: 1px solid #254059; padding-left: 15px; text-align: center; }
  .field svg { width: 100%; }
  .field-note { color: #9eb1c6; font-size: 10px; display: block; margin-top: 8px; }
  .field-note strong { color: #e1edfa; font-weight: 600; }
  footer { border-top: 1px solid #274058; padding: 20px 0; display: flex; justify-content: space-between; align-items: center; gap: 12px; font-size: 12px; }
  .venue { color: #a8bdd1; display: flex; align-items: center; gap: 7px; }
  footer a { color: #81b7ff; font-weight: 700; text-decoration: none; white-space: nowrap; }
  footer a span { margin-left: 12px; display: inline-block; transition: transform .2s; }
  footer a:hover span { transform: translate(2px,-2px); }
  .no-game { margin: auto; padding: 30px 0; text-align: center; }
  .empty-icon { color: #6baaff; font-size: 45px; }
  .no-game p { color: #a8bdd1; font-size: 13px; }
  .no-game a { color: #81b7ff; font-size: 13px; }
  @keyframes signal { 0% { box-shadow: 0 0 0 0 #bcf57966; } 80%,100% { box-shadow: 0 0 0 6px #bcf57900; } }
  @media (max-width: 1150px) { .field { display: none; } .matchup { grid-template-columns: minmax(0,1fr) auto minmax(0,1fr); } }
  .team :global(.badge:not(.logo)) { background: #f4f8ff; }
  @media (max-width: 520px) { .scoreboard { padding: 20px 16px 0; min-height: 300px; } .matchup { gap: 7px; padding: 26px 0; } .season { font-size: 8px; letter-spacing: .08em; } h2 { font-size: 14px; } .match-note { font-size: 10px; } .score { font-size: 54px; gap: 4px; } .kickoff { font-size: 38px; } footer { font-size: 11px; } .team :global(.badge) { width: 56px; height: 56px; } }
</style>
