<script lang="ts">
  // Watching a game live: scoreboard, line score, field, batter, play-by-play, lineups.
  // Read-only; updates itself through Supabase Realtime.
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { league } from '#lib/league.svelte.ts';
  import { supabase } from '#lib/supabase.ts';
  import { liveOfGame, gameEntries, gamePlayLog, errorMessage, LIVE_STALE_MS } from '#lib/api.ts';
  import { battingTeam, byHalfInning, lineScore, type PlayItem } from '#lib/plays.ts';
  import { resultDef } from '#lib/stats.ts';
  import { longDate, plural, time } from '#lib/format.ts';
  import type { GameExtras, LiveLineup, LiveSession, PlateAppearance, Team } from '#lib/types.ts';
  import TeamBadge from '#lib/components/TeamBadge.svelte';
  import Diamond from '#lib/components/Diamond.svelte';
  import Icon from '#lib/components/Icon.svelte';

  const id = $derived(Number(page.params.id));
  const game = $derived(league.game(id));
  const home = $derived(league.team(game?.home_team_id));
  const away = $derived(league.team(game?.away_team_id));

  let sessions = $state<LiveSession[]>([]);
  let lineups = $state<LiveLineup[]>([]);
  let pas = $state<PlateAppearance[]>([]);
  let extras = $state<GameExtras[]>([]);
  let plays = $state<PlayItem[]>([]);
  let loaded = $state(false);
  let loadError = $state<string | null>(null);
  let now = $state(Date.now());

  async function load() {
    try {
      const [l, e, p] = await Promise.all([liveOfGame(id), gameEntries(id), gamePlayLog(id)]);
      sessions = l.sessions;
      lineups = l.lineups;
      pas = e.pas;
      extras = e.extras;
      plays = p;
      loadError = null;
    } catch (err) {
      loadError = errorMessage(err);
    } finally {
      loaded = true;
      now = Date.now();
    }
  }

  $effect(() => {
    const gameId = id;
    untrack(() => {
      loaded = false;
      load();
    });
    if (!supabase) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 300);
    };
    const filter = `game_id=eq.${gameId}`;
    const channel = supabase
      .channel(`watch-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_sessions', filter }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_lineups', filter }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plate_appearances', filter }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_player_extras', filter }, refresh)
      .subscribe();
    // fallback when realtime is unavailable (and to age out a quiet session)
    const tick = setInterval(load, 60_000);
    return () => {
      clearTimeout(timer);
      clearInterval(tick);
      supabase!.removeChannel(channel);
    };
  });

  // ------------------------------------------------------------ state
  const running = (tid: number | undefined) =>
    sessions.find((s) => s.team_id === tid && !s.finished && now - new Date(s.updated_at).getTime() < LIVE_STALE_MS);
  const homeS = $derived(running(game?.home_team_id));
  const awayS = $derived(running(game?.away_team_id));
  const isLive = $derived(!!homeS || !!awayS);
  const battingId = $derived(battingTeam(homeS, awayS));
  const session = $derived(sessions.find((s) => s.team_id === battingId) ?? null);
  const half = $derived(battingId === game?.away_team_id ? 'horní' : 'dolní');
  const lineupOf = (tid: number | undefined) => lineups.find((l) => l.team_id === tid)?.players ?? [];
  const battingLineup = $derived(lineupOf(battingId ?? undefined));
  const at = (offset: number) =>
    battingLineup.length && session ? battingLineup[(session.next_slot + offset) % battingLineup.length] : null;
  const batter = $derived(league.player(at(0)));
  const onDeck = $derived(battingLineup.length > 1 ? league.player(at(1)) : undefined);
  const inHole = $derived(battingLineup.length > 2 ? league.player(at(2)) : undefined);

  const teamOf = (playerId: string) => league.player(playerId)?.team_id;
  const runsOf = (tid: number | undefined) =>
    extras.reduce((a, x) => a + (teamOf(x.player_id) === tid ? x.runs : 0), 0);
  const hitsOf = (tid: number | undefined) =>
    pas.filter((p) => teamOf(p.player_id) === tid && resultDef(p.result)?.group === 'hit').length;
  const recordedTeams = $derived(
    new Set([...pas.map((p) => teamOf(p.player_id)), ...extras.map((x) => teamOf(x.player_id)), ...sessions.map((s) => s.team_id)])
  );

  const line = $derived(lineScore(plays));
  const innings = $derived(
    Math.max(7, session?.inning ?? 0, ...[...line.values()].map((r) => r.length))
  );
  const halves = $derived(byHalfInning(plays));
  const teams = $derived([away, home].filter((t): t is Team => !!t));

  // lineup tab: follows the batting team until the viewer picks one
  let pickedTeam = $state<number | null>(null);
  const shownTeam = $derived(pickedTeam ?? battingId ?? game?.away_team_id ?? null);

  function lineupRows(tid: number | null) {
    if (!tid) return [];
    const order = lineupOf(tid);
    const others = [...new Set([...pas.map((p) => p.player_id), ...extras.map((x) => x.player_id)])]
      .filter((pid) => teamOf(pid) === tid && !order.includes(pid));
    return [...order, ...others].map((pid, i) => {
      const list = pas.filter((p) => p.player_id === pid);
      const x = extras.find((e) => e.player_id === pid);
      const ab = list.filter((r) => ['1B', '2B', '3B', 'HR', 'K', 'OUT', 'FC', 'ROE'].includes(r.result)).length;
      const h = list.filter((r) => resultDef(r.result)?.group === 'hit').length;
      const s = sessions.find((ss) => ss.team_id === tid);
      const base = s ? [s.runner_1, s.runner_2, s.runner_3].indexOf(pid) + 1 : 0;
      return {
        pid,
        slot: i < order.length ? i + 1 : null,
        player: league.player(pid),
        results: list.map((r) => r.result),
        ab,
        h,
        r: x?.runs ?? 0,
        rbi: list.reduce((a, r) => a + r.rbi, 0),
        sb: x?.stolen_bases ?? 0,
        up: tid === battingId && pid === batter?.id,
        base
      };
    });
  }
  const rows = $derived(lineupRows(shownTeam));

  const name = (pid: string | null) => league.player(pid)?.name ?? '?';
  const short = (pid: string | null) => name(pid).split(' ')[0];
  const outsWord = (n: number) => `${n} ${plural(n, ['aut', 'auty', 'autů'])}`;
  const team = (tid: number | null | undefined) => league.team(tid);
</script>

<svelte:head>
  <title>{away?.short_name ?? ''} – {home?.short_name ?? ''} živě – Pražský přebor mužů</title>
</svelte:head>

<div class="page watch">
  <div class="top">
    <a class="back" href="/zapasy/{id}"><Icon name="back" size={18} /> Detail zápasu</a>
    <a class="btn btn-dark btn-sm" href="/zapasy/{id}/zive"><Icon name="pencil" size={16} /> Zapisovat</a>
  </div>

  {#if !game}
    <p class="empty">Zápas neexistuje.</p>
  {:else if loadError}
    <p class="empty">{loadError}</p>
  {:else if !loaded}
    <div class="card bug skeleton" aria-busy="true"></div>
  {:else}
    <!-- -------------------------------------------------------------- scorebug -->
    <section class="card bug" style:--away={away?.color} style:--home={home?.color} aria-label="Skóre">
      <div class="state">
        {#if isLive}
          <span class="live"><span class="pulse"></span> Živě</span>
        {:else if plays.length}
          <span class="pill neutral">Živý zápis skončil</span>
        {:else}
          <span class="pill neutral">{longDate(game.starts_at)}{game.starts_at ? `, ${time(game.starts_at)}` : ''}</span>
        {/if}
      </div>

      {#each teams as t, i (t.id)}
        <div class="side" class:right={i === 1} class:bat={isLive && t.id === battingId}>
          <TeamBadge team={t} size={54} eager />
          <span class="tn">{t.short_name ?? t.name}</span>
          <span class="role">{i === 0 ? 'hosté' : 'domácí'}</span>
          {#key runsOf(t.id)}
            <span class="score" class:none={!recordedTeams.has(t.id)} in:fly={{ y: -10, duration: 260 }}>
              {recordedTeams.has(t.id) ? runsOf(t.id) : '–'}
            </span>
          {/key}
        </div>
      {/each}

      <div class="mid">
        {#if isLive && session}
          <span class="inning">{session.inning}.<small>{half === 'horní' ? '▲' : '▼'}</small></span>
          <span class="muted small">{half} polovina</span>
          <span class="outs" aria-label={outsWord(session.outs)}>
            {#each [0, 1, 2] as n (n)}<span class="dot" class:on={n < session.outs}></span>{/each}
          </span>
        {:else}
          <span class="vs">:</span>
        {/if}
      </div>
    </section>

    {#if !isLive && !plays.length}
      <div class="card idle" in:fade>
        <Icon name="live" size={26} />
        <h2>Živý zápis tohoto zápasu zatím neběží</h2>
        <p class="muted">Jakmile ho někdo spustí, uvidíš tu průběh zápasu směnu po směně, kdo je na pálce a kdo na metách.</p>
        <a class="btn btn-primary" href="/zapasy/{id}/zive"><Icon name="pencil" size={18} /> Začít zapisovat</a>
      </div>
    {/if}

    <!-- -------------------------------------------------------------- field + batter -->
    {#if isLive && session}
      <section class="field" in:fade>
        <div class="card diamond-card" style:--team={team(battingId)?.color}>
          <span class="label"><TeamBadge team={team(battingId)} size={18} /> {team(battingId)?.short_name ?? ''} na pálce</span>
          <Diamond bases={[session.runner_1, session.runner_2, session.runner_3]} outs={session.outs} />
        </div>
        <div class="card batter-card">
          {#key batter?.id}
            <div class="now" in:fly={{ x: 20, duration: 240 }}>
              <span class="label">Na pálce</span>
              <div class="who">
                <span class="jn">{batter?.jersey_number ?? '–'}</span>
                <span class="nm">{batter?.name ?? '—'}</span>
              </div>
              {#if batter}
                {@const r = rows.find((x) => x.pid === batter.id) ?? lineupRows(battingId).find((x) => x.pid === batter.id)}
                <span class="today">
                  {#if r && r.results.length}Dnes {r.h}/{r.ab}{#each r.results as res, i (i)}<span class="chip-r g-{resultDef(res)?.group}">{res}</span>{/each}{:else}Dnes poprvé na pálce{/if}
                </span>
              {/if}
            </div>
          {/key}
          <div class="queue">
            {#if onDeck}<span><span class="label">Další</span> {onDeck.name}</span>{/if}
            {#if inHole}<span><span class="label">Pak</span> {inHole.name}</span>{/if}
          </div>
        </div>
      </section>
    {/if}

    <!-- -------------------------------------------------------------- line score -->
    {#if plays.length || isLive}
      <section class="card linescore" aria-label="Skóre po směnách">
        <div class="ls-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col" class="tcol">Směna</th>
                {#each Array(innings) as _, i (i)}<th scope="col" class:cur={isLive && session?.inning === i + 1}>{i + 1}</th>{/each}
                <th scope="col" class="tot">R</th>
                <th scope="col" class="tot">H</th>
              </tr>
            </thead>
            <tbody>
              {#each teams as t (t.id)}
                {@const row = line.get(t.id) ?? []}
                {@const s = sessions.find((x) => x.team_id === t.id)}
                <tr>
                  <th scope="row" class="tcol"><TeamBadge team={t} size={20} /> {t.short_name ?? t.code}</th>
                  {#each Array(innings) as _, i (i)}
                    {@const played = i < row.length || (s && (i + 1 < s.inning))}
                    <td class:cur={isLive && t.id === battingId && session?.inning === i + 1} class:runs={(row[i] ?? 0) > 0}>
                      {played ? (row[i] ?? 0) : ''}
                    </td>
                  {/each}
                  <td class="tot strong">{recordedTeams.has(t.id) ? runsOf(t.id) : '–'}</td>
                  <td class="tot">{recordedTeams.has(t.id) ? hitsOf(t.id) : '–'}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </section>
    {/if}

    <div class="cols">
      <!-- ------------------------------------------------------------ play by play -->
      {#if halves.length}
        <section class="feed" aria-labelledby="feed-title">
          <h2 id="feed-title">Průběh zápasu</h2>
          {#each halves as h (h.key)}
            {@const t = team(h.teamId)}
            <div class="half" style:--team={t?.color} animate:flip={{ duration: 200 }}>
              <header>
                <span class="hn">{h.inning}. směna {h.teamId === game.away_team_id ? '▲' : '▼'}</span>
                <span class="ht"><TeamBadge team={t} size={18} /> {t?.short_name ?? ''}</span>
                {#if h.runs}<span class="pill pos">+{h.runs} {plural(h.runs, ['bod', 'body', 'bodů'])}</span>{/if}
              </header>
              <ol>
                {#each h.plays as p (p.id)}
                  <li in:fly={{ y: -8, duration: 220 }}>
                    <span class="res-chip g-{p.result ? resultDef(p.result)?.group : 'run'}">{p.result ?? 'SB'}</span>
                    <span class="desc">
                      {#if p.result}
                        <strong>{name(p.batter)}</strong> <span class="muted">{resultDef(p.result)?.label}</span>
                      {:else}
                        <strong>Pohyb běžců</strong>
                      {/if}
                      <span class="extra">
                        {#if p.stole.length}<span>ukradená meta: {p.stole.map(short).join(', ')}</span>{/if}
                        {#if p.scored.length}<span class="sc">doběh: {p.scored.map(short).join(', ')}</span>{/if}
                        {#if p.rbi}<span>{p.rbi} RBI</span>{/if}
                        {#if p.inningEnded}<span class="end">3. aut, konec poloviny</span>{:else if p.outs}<span class="out">{p.outs === 1 ? `${p.outsAfter}. aut` : `${p.outs} auty (${p.outsAfter} celkem)`}</span>{/if}
                      </span>
                    </span>
                    {#if p.runs}<span class="plus">+{p.runs}</span>{/if}
                  </li>
                {/each}
              </ol>
            </div>
          {/each}
        </section>
      {/if}

      <!-- ------------------------------------------------------------ lineups -->
      {#if recordedTeams.size}
        <section class="lineups" aria-labelledby="lu-title">
          <div class="lu-head">
            <h2 id="lu-title">Sestavy</h2>
            <div class="seg" role="group" aria-label="Tým">
              {#each teams as t (t.id)}
                <button type="button" aria-pressed={shownTeam === t.id} onclick={() => (pickedTeam = t.id)}>{t.short_name ?? t.code}</button>
              {/each}
            </div>
          </div>
          {#if rows.length === 0}
            <p class="empty">Za tento tým zatím není zapsaná sestava.</p>
          {:else}
            <ol class="card lu">
              {#each rows as r (r.pid)}
                <li class:up={r.up}>
                  <span class="slot">{r.slot ?? ''}</span>
                  <span class="jn2">{r.player?.jersey_number ?? '–'}</span>
                  <span class="pn">
                    <a href="/hraci/{r.pid}">{r.player?.name ?? '?'}</a>
                    {#if r.up}<span class="pill warn">na pálce</span>{/if}
                    {#if r.base}<span class="pill neutral">na {r.base}. metě</span>{/if}
                    <span class="chips">{#each r.results as res, i (i)}<span class="chip-r g-{resultDef(res)?.group}">{res}</span>{/each}</span>
                  </span>
                  <span class="line">
                    <span><b>{r.h}</b>/{r.ab}</span>
                    {#if r.r}<span>{r.r} R</span>{/if}
                    {#if r.rbi}<span>{r.rbi} RBI</span>{/if}
                    {#if r.sb}<span>{r.sb} SB</span>{/if}
                  </span>
                </li>
              {/each}
            </ol>
          {/if}
        </section>
      {/if}
    </div>
  {/if}
</div>

<style>
  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 14px;
  }
  .back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--muted);
    text-decoration: none;
    font-weight: 600;
  }
  .label {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 700;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .small {
    font-size: 12.5px;
  }

  /* ---------------------------------------------------------- scorebug */
  .bug {
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    grid-template-areas:
      'state state state'
      'a mid h';
    align-items: center;
    gap: 6px 10px;
    padding: 16px 14px 20px;
    overflow: hidden;
    background:
      radial-gradient(70% 130% at 0% 100%, color-mix(in srgb, var(--away) 28%, transparent), transparent 65%),
      radial-gradient(70% 130% at 100% 100%, color-mix(in srgb, var(--home) 28%, transparent), transparent 65%),
      var(--surface);
  }
  .bug.skeleton {
    min-height: 220px;
  }
  .state {
    grid-area: state;
    display: flex;
    justify-content: center;
    margin-bottom: 6px;
  }
  .live {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px 4px 10px;
    border-radius: 999px;
    background: var(--neg);
    color: #fff;
    font-weight: 800;
    font-size: 12.5px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #fff;
    animation: pulse 1.6s ease-out infinite;
  }
  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 rgb(255 255 255 / 0.7);
    }
    100% {
      box-shadow: 0 0 0 9px transparent;
    }
  }
  .side {
    grid-area: a;
    display: grid;
    justify-items: center;
    gap: 4px;
    text-align: center;
    min-width: 0;
    padding: 10px 4px;
    border-radius: 18px;
    transition: background-color 300ms;
  }
  .side.right {
    grid-area: h;
  }
  .side.bat {
    background: color-mix(in srgb, var(--accent) 9%, transparent);
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 55%, transparent);
  }
  .tn {
    margin-top: 4px;
    font-weight: 800;
    font-size: clamp(16px, 4.2vw, 22px);
    letter-spacing: -0.02em;
    line-height: 1.1;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .role {
    font-size: 12px;
    color: var(--muted);
  }
  .score {
    font-size: clamp(56px, 16vw, 92px);
    font-weight: 800;
    letter-spacing: -0.06em;
    line-height: 0.95;
    margin-top: 4px;
  }
  .score.none {
    color: var(--faint);
  }
  .mid {
    grid-area: mid;
    display: grid;
    justify-items: center;
    gap: 6px;
  }
  .inning {
    font-size: 34px;
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 1;
  }
  .inning small {
    font-size: 16px;
    margin-left: 2px;
    color: var(--accent-text);
    vertical-align: 10px;
  }
  .vs {
    font-size: 40px;
    font-weight: 800;
    color: var(--faint);
  }
  .outs {
    display: flex;
    gap: 5px;
  }
  .dot {
    width: 11px;
    height: 11px;
    border-radius: 50%;
    border: 1.5px solid var(--faint);
    transition: background-color 200ms, border-color 200ms;
  }
  .dot.on {
    background: var(--neg);
    border-color: var(--neg);
  }

  .idle {
    margin-top: 14px;
    padding: 24px 20px;
    display: grid;
    justify-items: start;
    gap: 8px;
  }
  .idle h2 {
    font-size: 21px;
  }
  .idle p {
    margin: 0 0 6px;
  }

  /* ---------------------------------------------------------- field */
  .field {
    display: grid;
    gap: 12px;
    margin-top: 12px;
  }
  @media (min-width: 720px) {
    .field {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }
  }
  .diamond-card {
    padding: 14px 14px 10px;
    background:
      radial-gradient(90% 120% at 50% 0%, color-mix(in srgb, var(--team) 14%, transparent), transparent 65%),
      var(--surface);
  }
  .diamond-card :global(.diamond) {
    max-width: 300px;
  }
  @media (max-width: 719px) {
    .diamond-card {
      padding: 12px 12px 6px;
    }
    .diamond-card :global(.diamond) {
      max-width: 240px;
    }
  }
  .batter-card {
    padding: 16px;
    display: grid;
    align-content: space-between;
    gap: 14px;
    border-left: 4px solid var(--accent);
  }
  .now {
    display: grid;
    gap: 6px;
  }
  .who {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .jn {
    display: grid;
    place-items: center;
    min-width: 52px;
    height: 52px;
    padding: 0 6px;
    border-radius: 15px;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 800;
    font-size: 24px;
  }
  .nm {
    font-weight: 800;
    font-size: clamp(22px, 6vw, 30px);
    letter-spacing: -0.03em;
    line-height: 1.05;
    overflow-wrap: anywhere;
  }
  .today {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 5px;
    font-size: 14px;
    font-weight: 600;
  }
  .queue {
    display: grid;
    gap: 4px;
    font-size: 14px;
    font-weight: 600;
  }
  .queue .label {
    min-width: 46px;
  }

  /* result chips (shared) */
  .chip-r,
  .res-chip {
    display: inline-grid;
    place-items: center;
    min-width: 30px;
    padding: 2px 6px;
    border-radius: 7px;
    font-size: 11.5px;
    font-weight: 800;
    background: var(--surface-3);
    color: var(--muted);
  }
  .g-hit {
    background: var(--pos-soft);
    color: var(--pos);
  }
  .g-onbase {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .g-run {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    color: var(--accent-text);
  }

  /* ---------------------------------------------------------- line score */
  .linescore {
    margin-top: 12px;
    padding: 6px 0;
  }
  .ls-scroll {
    overflow-x: auto;
  }
  .linescore table {
    width: 100%;
    border-collapse: collapse;
    font-size: 15px;
    font-variant-numeric: tabular-nums;
  }
  .linescore th,
  .linescore td {
    padding: 9px 6px;
    text-align: center;
    min-width: 26px;
  }
  .linescore thead th {
    font-size: 12px;
    color: var(--faint);
    font-weight: 700;
  }
  .linescore tbody tr + tr {
    border-top: 1px solid var(--line);
  }
  .tcol {
    position: sticky;
    left: 0;
    background: var(--surface);
    text-align: left !important;
    padding-left: 14px !important;
    white-space: nowrap;
    font-weight: 800;
  }
  tbody .tcol {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .linescore td {
    color: var(--muted);
  }
  .linescore td.runs {
    color: var(--ink);
    font-weight: 800;
  }
  .linescore .cur {
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .tot {
    border-left: 1px solid var(--line);
    font-weight: 700;
    color: var(--ink) !important;
  }
  .tot.strong {
    font-size: 18px;
    font-weight: 800;
  }
  .linescore th.tot:last-child,
  .linescore td.tot:last-child {
    padding-right: 14px;
  }

  /* ---------------------------------------------------------- feed + lineups */
  .cols {
    display: grid;
    gap: 28px;
    margin-top: 28px;
  }
  @media (min-width: 960px) {
    .cols {
      grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
      align-items: start;
    }
  }
  .feed h2,
  .lineups h2 {
    font-size: 22px;
  }
  .feed h2 {
    margin-bottom: 12px;
  }
  .half {
    margin-bottom: 12px;
    border-radius: var(--r-l);
    background: var(--surface);
    border: 1px solid var(--line);
    overflow: hidden;
  }
  .half header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: linear-gradient(90deg, color-mix(in srgb, var(--team) 18%, transparent), transparent 70%);
    border-bottom: 1px solid var(--line);
  }
  .hn {
    font-weight: 800;
  }
  .ht {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-weight: 700;
    color: var(--muted);
    margin-right: auto;
  }
  .half ol {
    list-style: none;
    margin: 0;
    padding: 4px 0;
  }
  .half li {
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr) auto;
    align-items: start;
    gap: 10px;
    padding: 9px 14px;
  }
  .half li + li {
    border-top: 1px dashed var(--line);
  }
  .res-chip {
    min-width: 40px;
    padding: 5px 6px;
    font-size: 13px;
  }
  .desc {
    display: grid;
    gap: 3px;
    min-width: 0;
    font-size: 14.5px;
  }
  .desc .muted {
    font-size: 13px;
    margin-left: 4px;
  }
  .extra {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 10px;
    font-size: 12.5px;
    color: var(--muted);
  }
  .extra .sc {
    color: var(--pos);
    font-weight: 700;
  }
  .extra .out {
    color: var(--neg);
    font-weight: 600;
  }
  .extra .end {
    color: var(--neg);
    font-weight: 800;
  }
  .plus {
    font-weight: 800;
    font-size: 18px;
    color: var(--pos);
  }

  .lu-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 12px;
  }
  .lu {
    list-style: none;
    margin: 0;
    padding: 6px;
  }
  .lu li {
    display: grid;
    grid-template-columns: 20px 32px minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    padding: 9px 8px;
    border-radius: 14px;
  }
  .lu li + li {
    margin-top: 2px;
  }
  .lu li.up {
    background: var(--accent-soft);
  }
  .slot {
    font-weight: 800;
    color: var(--faint);
    text-align: center;
  }
  .jn2 {
    display: grid;
    place-items: center;
    height: 30px;
    border-radius: 9px;
    background: var(--surface-3);
    font-weight: 800;
    font-size: 14px;
    color: var(--muted);
  }
  .pn {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 8px;
    min-width: 0;
  }
  .pn a {
    font-weight: 700;
    text-decoration: none;
  }
  .pn a:hover {
    text-decoration: underline;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
    flex-basis: 100%;
  }
  .chips:empty {
    display: none;
  }
  .line {
    display: grid;
    justify-items: end;
    font-size: 12.5px;
    color: var(--muted);
    white-space: nowrap;
  }
  .line b {
    color: var(--ink);
    font-size: 15px;
  }

  @media (min-width: 900px) {
    .watch {
      max-width: 1100px;
    }
    .bug {
      padding: 22px 28px 28px;
    }
  }
</style>
