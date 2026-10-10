<script lang="ts">
  // Live scoring: pick the team, set the batting order, then record batter after batter.
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { untrack } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { league } from '#lib/league.svelte.ts';
  import { supabase } from '#lib/supabase.ts';
  import {
    liveOfGame, gameEntries, liveStart, liveSetLineup, liveSetState, liveFinish, livePlay, liveUndo,
    gamePlayLog, liveDeletePlay, liveRewind, liveAdjustRuns, updatePlateAppearance, revertGroup,
    errorMessage, WriteCancelled
  } from '#lib/api.ts';
  import { RESULTS, resultDef } from '#lib/stats.ts';
  import { defaultPlay, runsOn, type Base, type Bases, type Play } from '#lib/live.ts';
  import { battingTeam } from '#lib/plays.ts';
  import { outsWord, plural, time } from '#lib/format.ts';
  import { toasts } from '#lib/toast.svelte.ts';
  import type { GameExtras, LiveLineup, LiveSession, PaResult, PlateAppearance } from '#lib/types.ts';
  import type { PlayItem } from '#lib/plays.ts';
  import TeamBadge from '#lib/components/TeamBadge.svelte';
  import Diamond from '#lib/components/Diamond.svelte';
  import PlaySheet from '#lib/components/PlaySheet.svelte';
  import LineupEditor from '#lib/components/LineupEditor.svelte';
  import PlayLog from '#lib/components/PlayLog.svelte';
  import EditPlaySheet from '#lib/components/EditPlaySheet.svelte';
  import Icon from '#lib/components/Icon.svelte';

  const id = $derived(Number(page.params.id));
  const game = $derived(league.game(id));
  const home = $derived(league.team(game?.home_team_id));
  const away = $derived(league.team(game?.away_team_id));
  /**
   * Two ways of scoring, chosen at the start:
   *  - ?rezim=tym&tym=ID  one team only: the batting order just moves on, no switching
   *  - ?rezim=zapas       the whole game: lineups of both teams first, then the bat
   *                       switches after three outs (visitors top, home bottom)
   */
  const chosenId = $derived(Number(page.url.searchParams.get('tym')) || null);
  const scoring = $derived<'game' | 'team' | null>(
    page.url.searchParams.get('rezim') === 'zapas' ? 'game' : chosenId ? 'team' : null
  );

  /** Live scoring opens two hours before the scheduled start (same rule as the database). */
  const open = $derived.by(() => {
    if (!game || game.status === 'cancelled' || game.status === 'canceled') return false;
    if (game.status === 'played') return true;
    return !!game.starts_at && new Date(game.starts_at).getTime() <= Date.now() + 2 * 3600_000;
  });
  const started = $derived(!!game && league.isPlayable(game));

  let sessions = $state<LiveSession[]>([]);
  let lineups = $state<LiveLineup[]>([]);
  let pas = $state<PlateAppearance[]>([]);
  let extras = $state<GameExtras[]>([]);
  let loaded = $state(false);
  let loadError = $state<string | null>(null);
  let busy = $state(false);

  let mode = $state<'score' | 'lineup' | 'state' | 'restart'>('score');
  let sheet = $state<{ result: PaResult | null; runnerFrom: Base | null } | null>(null);
  let confirmFinish = $state(false);
  /** short summary of the last saved play, shown on the scoreboard (toasts would cover the pad) */
  let lastPlay = $state<string | null>(null);
  let historyList = $state<{ reload: () => Promise<void> }>();
  let plays = $state<PlayItem[]>([]);
  let editing = $state<PlayItem | null>(null);

  async function load() {
    try {
      const [l, e] = await Promise.all([liveOfGame(id), gameEntries(id)]);
      plays = await gamePlayLog(id, e.pas);
      sessions = l.sessions;
      lineups = l.lineups;
      pas = e.pas;
      extras = e.extras;
      loadError = null;
    } catch (err) {
      loadError = errorMessage(err);
    } finally {
      loaded = true;
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
      timer = setTimeout(() => {
        load();
        historyList?.reload();
      }, 300);
    };
    const filter = `game_id=eq.${gameId}`;
    const channel = supabase
      .channel(`live-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_sessions', filter }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_lineups', filter }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plate_appearances', filter }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_player_extras', filter }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_run_adjustments', filter }, refresh)
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase!.removeChannel(channel);
    };
  });

  // keep the phone screen on while scoring
  $effect(() => {
    if (!session || session.finished || typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        lock = null;
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') acquire();
    };
    acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release().catch(() => {});
    };
  });

  // ------------------------------------------------------------ derived state
  // Both teams scored on this device → a normal scorebook: the visitors bat in the top
  // of the inning, the home team in the bottom, and after three outs the bat switches.
  const running = (tid: number | undefined) => sessions.find((s) => s.team_id === tid && !s.finished);
  const homeS = $derived(running(game?.home_team_id));
  const awayS = $derived(running(game?.away_team_id));
  const fullGame = $derived(scoring === 'game' && !!homeS && !!awayS);
  const teamId = $derived(scoring === 'game' ? (fullGame ? battingTeam(homeS, awayS) : null) : chosenId);
  const team = $derived(league.team(teamId));
  const half = $derived(fullGame ? (teamId === game?.away_team_id ? 'horní' : 'dolní') : null);

  // announce the switch of the batting team
  let prevBatting: number | null = null;
  let lastWasUndo = false;
  $effect(() => {
    const b = fullGame ? teamId : null;
    untrack(() => {
      if (b && prevBatting && b !== prevBatting) {
        sheet = null;
        mode = 'score';
        const name = league.team(b)?.name ?? '';
        lastPlay = lastWasUndo ? `Akce vrácena, na pálce je znovu ${name}.` : `Konec poloviny směny. Na pálce ${name}.`;
      }
      prevBatting = b;
    });
  });

  const session = $derived(sessions.find((s) => s.team_id === teamId) ?? null);
  const lineup = $derived(lineups.find((l) => l.team_id === teamId)?.players ?? []);
  const bases = $derived<Bases>(session ? [session.runner_1, session.runner_2, session.runner_3] : [null, null, null]);
  const occupiedCount = $derived(bases.filter(Boolean).length);
  const at = (offset: number) => (lineup.length ? lineup[((session?.next_slot ?? 0) + offset) % lineup.length] : null);
  const batter = $derived(league.player(at(0)));
  const onDeck = $derived(lineup.length > 1 ? league.player(at(1)) : undefined);
  const inHole = $derived(lineup.length > 2 ? league.player(at(2)) : undefined);

  function runsOf(tid: number | undefined) {
    if (!tid) return 0;
    return extras.reduce((sum, x) => sum + (league.player(x.player_id)?.team_id === tid ? x.runs : 0), 0);
  }
  const ourRuns = $derived(runsOf(teamId ?? undefined));
  const opponentId = $derived(game ? (teamId === game.home_team_id ? game.away_team_id : game.home_team_id) : undefined);
  const opponentScored = $derived(
    sessions.some((s) => s.team_id === opponentId) || extras.some((x) => league.player(x.player_id)?.team_id === opponentId)
  );

  function lineOf(playerId: string | undefined) {
    if (!playerId) return '';
    const list = pas.filter((p) => p.player_id === playerId);
    const x = extras.find((e) => e.player_id === playerId);
    if (!list.length && !x?.runs && !x?.stolen_bases) return 'dnes poprvé na pálce';
    const h = list.filter((r) => resultDef(r.result)?.group === 'hit').length;
    const ab = list.filter((r) => ['1B', '2B', '3B', 'HR', 'K', 'OUT', 'FC', 'ROE'].includes(r.result)).length;
    const parts = [`${h}/${ab}`, ...list.map((r) => r.result)];
    const rbi = list.reduce((a, r) => a + r.rbi, 0);
    if (rbi) parts.push(`${rbi} RBI`);
    if (x?.runs) parts.push(`${x.runs} R`);
    if (x?.stolen_bases) parts.push(`${x.stolen_bases} SB`);
    return parts.join(' · ');
  }

  // which results make sense right now
  function allowed(code: PaResult): boolean {
    if (!session) return false;
    if (code === 'FC') return occupiedCount > 0;
    if (code === 'SF') return !!bases[2] && session.outs < 2;
    if (code === 'SH') return occupiedCount > 0 && session.outs < 2;
    return true;
  }
  const QUICK: PaResult[] = ['1B', '2B', '3B', 'HR', 'BB', 'HBP', 'K', 'OUT'];

  // ------------------------------------------------------------ actions
  function setScoring(next: { rezim: 'zapas' } | { rezim: 'tym'; tym: number } | null) {
    const url = new URL(page.url.href);
    url.searchParams.delete('rezim');
    url.searchParams.delete('tym');
    if (next) {
      url.searchParams.set('rezim', next.rezim);
      if (next.rezim === 'tym') url.searchParams.set('tym', String(next.tym));
    }
    mode = 'score';
    sheet = null;
    pendingAway = null;
    goto(url, { replace: false, reset: false });
  }
  const setTeam = (tid: number | null) => setScoring(tid ? { rezim: 'tym', tym: tid } : null);

  // ------------------------------------------------------------ whole game: both lineups first
  /** lineup of the visitors kept until the home lineup is done, then both start together */
  let pendingAway = $state<string[] | null>(null);
  const gameAllFinished = $derived(
    scoring === 'game' && !!game && [game.home_team_id, game.away_team_id].every((t) => sessions.find((s) => s.team_id === t)?.finished)
  );
  let gameRestart = $state(false);
  /** which lineup the setup asks for: visitors first, then home */
  const setupTeam = $derived.by(() => {
    if (scoring !== 'game' || !game || fullGame || (gameAllFinished && !gameRestart)) return null;
    if (!awayS && pendingAway === null) return game.away_team_id;
    if (!homeS) return game.home_team_id;
    return game.away_team_id;
  });

  async function startGame(homeIds: string[] | null, awayIds: string[] | null) {
    if (!game) return;
    await run(async () => {
      // a team already scored by someone else keeps going; the other joins at the right inning
      if (awayIds && !running(game.away_team_id)) {
        const s = await liveStart(id, game.away_team_id, awayIds);
        const other = running(game.home_team_id);
        if (other) {
          const inning = joinInning(other, false);
          if (inning !== s.inning) await liveSetState(s, { inning, outs: 0, bases: [null, null, null], nextSlot: 0 });
        }
      }
      if (homeIds && !running(game.home_team_id)) {
        const s = await liveStart(id, game.home_team_id, homeIds);
        const other = running(game.away_team_id) ?? (awayIds ? { inning: 1, outs: 0, runner_1: null, runner_2: null, runner_3: null } as LiveSession : null);
        if (other) {
          const inning = joinInning(other, true);
          if (inning !== s.inning) await liveSetState(s, { inning, outs: 0, bases: [null, null, null], nextSlot: 0 });
        }
      }
    }, () => {
      pendingAway = null;
      gameRestart = false;
      mode = 'score';
      lastPlay = 'Zápas začal. Na pálce jsou hosté.';
    });
  }

  function saveSetupLineup(ids: string[]) {
    if (!game) return;
    if (setupTeam === game.away_team_id) {
      if (running(game.home_team_id)) startGame(null, ids);
      else pendingAway = ids;
    } else {
      startGame(ids, pendingAway);
    }
  }

  const reopenGame = () =>
    run(async () => {
      for (const s of sessions.filter((x) => x.finished)) await liveFinish(s, false);
    }, () => (lastPlay = 'Pokračuješ v zápisu zápasu.'));

  async function run<T>(action: () => Promise<T>, done?: (r: T) => void): Promise<boolean> {
    if (busy) return false;
    busy = true;
    try {
      const r = await action();
      done?.(r);
      await load();
      historyList?.reload();
      return true;
    } catch (e) {
      if (e instanceof WriteCancelled) return false;
      toasts.show(errorMessage(e), 'error');
      await load(); // e.g. someone else scored in the meantime
      return false;
    } finally {
      busy = false;
    }
  }

  function describe(play: Play, batterName: string | undefined) {
    const runs = runsOn(play);
    const head = play.result ? `${batterName ?? 'Pálkař'}: ${play.result}` : 'Pohyb běžců';
    return runs ? `${head} · +${runs} ${plural(runs, ['bod', 'body', 'bodů'])}` : head;
  }

  async function submit(play: Play) {
    if (!session) return;
    const name = batter?.name;
    lastWasUndo = false;
    const ok = await run(
      () => livePlay(session, play),
      () => (lastPlay = describe(play, name))
    );
    if (ok) sheet = null;
  }

  function tapResult(code: PaResult) {
    if (!session || busy) return;
    toasts.list = [];
    if (occupiedCount === 0 && QUICK.includes(code)) {
      submit(defaultPlay(code, bases, session.outs));
    } else {
      sheet = { result: code, runnerFrom: null };
    }
  }

  const undo = () => {
    const s = session;
    if (!s) return;
    lastWasUndo = true;
    run(() => liveUndo(s, fullGame), () => (lastPlay = 'Poslední akce vrácena.'));
  };

  /**
   * Inning for a team that joins while the other team is already scored, so that the
   * visitors bat in the top and the home team in the bottom of the same inning.
   * A half counts as "in progress" when it has outs or runners; otherwise it just ended.
   */
  function joinInning(other: LiveSession, joiningIsHome: boolean): number {
    const inProgress = other.outs > 0 || !!(other.runner_1 || other.runner_2 || other.runner_3);
    if (joiningIsHome) return inProgress || other.inning === 1 ? other.inning : other.inning - 1;
    return inProgress ? other.inning + 1 : other.inning;
  }

  const start = (ids: string[]) =>
    run(async () => {
      const other = running(opponentId);
      const s = await liveStart(id, teamId!, ids);
      if (other && game) {
        const inning = joinInning(other, teamId === game.home_team_id);
        if (inning !== s.inning) {
          await liveSetState(s, { inning, outs: 0, bases: [null, null, null], nextSlot: 0 });
        }
      }
    }, () => {
      mode = 'score';
      lastPlay = 'Zápis začal. Hodně štěstí!';
    });

  const saveLineup = (ids: string[], next: number | null) =>
    run(() => liveSetLineup(session!, ids, next), () => {
      mode = 'score';
      lastPlay = 'Pořadí pálkařů uloženo.';
    });

  const finish = (finished: boolean) =>
    run(async () => {
      // with both teams scored here, ending the game ends both sessions
      const targets = finished && fullGame ? [awayS!, homeS!] : [session!];
      for (const t of targets) await liveFinish(t, finished);
    }, () => {
      confirmFinish = false;
      toasts.show(finished ? 'Živý zápis ukončen. Statistiky zůstávají v box score.' : 'Pokračuješ v zápisu.');
    });

  // manual state correction
  let fix = $state({ inning: 1, outs: 0, bases: [null, null, null] as (string | null)[], nextSlot: 0 });
  function openFix() {
    if (!session) return;
    fix = { inning: session.inning, outs: session.outs, bases: [...bases], nextSlot: session.next_slot };
    mode = 'state';
  }
  const saveFix = () =>
    run(() => liveSetState(session!, fix), () => {
      mode = 'score';
      lastPlay = 'Stav opraven.';
    });

  // ------------------------------------------------------------ corrections of earlier plays
  const editingPa = $derived(editing?.paId ? (pas.find((p) => p.id === editing!.paId) ?? null) : null);
  const latestPlayId = $derived([...plays].reverse().find((p) => p.kind === 'play')?.id ?? null);
  const closeEdit = () => (editing = null);

  const saveResult = (pa: PlateAppearance, result: PaResult, rbi: number) =>
    run(() => updatePlateAppearance(pa, { result, rbi }), () => {
      lastPlay = 'Výsledek akce opraven.';
      closeEdit();
    });

  const adjust = (playerId: string, delta: 1 | -1) => {
    const p = editing;
    if (!p) return;
    run(() => liveAdjustRuns(id, p.teamId, p.inning, playerId, delta), () => {
      lastPlay = `Doběh ${delta > 0 ? 'přidán' : 'odebrán'} (${p.inning}. směna).`;
      closeEdit();
    });
  };

  const deletePlay = () => {
    const p = editing;
    if (!p) return;
    run(() => liveDeletePlay(id, p.id), () => {
      lastPlay = 'Akce smazána.';
      closeEdit();
    });
  };

  const rewind = () => {
    const p = editing;
    if (!p) return;
    lastWasUndo = true;
    run(() => liveRewind(id, p.id), (n) => {
      lastPlay = `Zápis vrácen o ${n} ${plural(n, ['akci', 'akce', 'akcí'])}.`;
      closeEdit();
    });
  };

  const cancelAdjust = () => {
    const p = editing;
    if (!p) return;
    run(() => revertGroup(p.id), () => {
      lastPlay = 'Oprava zrušena.';
      closeEdit();
    });
  };

  // every switch of the screen starts at the top (the lineup editor is long)
  $effect(() => {
    void mode;
    void teamId;
    void session?.finished;
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  });

  const teamRoster = $derived(teamId ? league.teamPlayers(teamId, true) : []);
  const statusOf = (tid: number | undefined) => sessions.find((s) => s.team_id === tid);
</script>

<svelte:head>
  <title>Živě: {home?.short_name ?? ''} – {away?.short_name ?? ''} – Pražský přebor mužů</title>
</svelte:head>

<div class="page live">
  <a class="back" href="/zapasy/{id}"><Icon name="back" size={18} /> Detail zápasu</a>

  {#if !game}
    <p class="empty">Zápas neexistuje.</p>
  {:else}
    <header class="title" class:compact={!!session && !session.finished && mode === 'score'}>
      <span class="badge"><span class="pulse"></span> Živý zápis</span>
      <h1>{home?.short_name ?? home?.name} – {away?.short_name ?? away?.name}</h1>
    </header>

    {#if loadError}
      <p class="empty">{loadError}</p>
    {:else if !loaded}
      <p class="muted">Načítám…</p>
    {:else if !open}
      <p class="empty">Živý zápis se otevře 2 hodiny před začátkem zápasu{game.starts_at ? ` (začátek v ${time(game.starts_at)})` : ''}.</p>
    {:else if scoring === null}
      <!-- ---------------------------------------------------------- choose the way of scoring -->
      <div class="modes">
        <button type="button" class="card mode rise" onclick={() => setScoring({ rezim: 'zapas' })}>
          <span class="mi"><Icon name="board" size={24} /></span>
          <span class="tinfo">
            <span class="tn">Zapisovat celý zápas</span>
            <span class="ts">Oba týmy na jednom telefonu. Nejdřív sestavy hostů i domácích, pak se pálka po 3 outech sama střídá.</span>
          </span>
          <Icon name="chevron" size={20} />
        </button>
        <a class="card mode watch rise" style:--i="1" href="/zapasy/{id}/sledovat">
          <span class="mi"><Icon name="live" size={24} /></span>
          <span class="tinfo">
            <span class="tn">Jen sledovat</span>
            <span class="ts">Skóre, směny, kdo je na pálce a průběh zápasu, bez zapisování.</span>
          </span>
          <Icon name="chevron" size={20} />
        </a>
      </div>

      <h2 class="sub-h">Zapisovat jen jeden tým</h2>
      <p class="lead muted">Klikáš pálkaře svého týmu jednoho po druhém, pořadí se samo posouvá. Soupeř se nepřepíná.</p>
      <div class="pick">
        {#each [away, home] as t, i (t?.id)}
          {#if t}
            {@const s = statusOf(t.id)}
            <button type="button" class="card tpick rise" style:--team={t.color} style:--i={i + 2} onclick={() => setTeam(t.id)}>
              <TeamBadge team={t} size={52} eager />
              <span class="tinfo">
                <span class="tn">{t.name}</span>
                <span class="ts">
                  {i === 0 ? 'hosté' : 'domácí'} ·
                  {#if !s}zápis nezačal{:else if s.finished}zápis ukončen{:else}<span class="pill warn">běží: {s.inning}. směna, {outsWord(s.outs)}</span>{/if}
                </span>
              </span>
              <Icon name="chevron" size={20} />
            </button>
          {/if}
        {/each}
      </div>
    {:else if scoring === 'game' && gameAllFinished && !gameRestart}
      <!-- ---------------------------------------------------------- whole game finished -->
      <div class="card done" in:fade={{ duration: 150 }}>
        <Icon name="flag" size={28} />
        <h2>Živý zápis zápasu je ukončený</h2>
        <p class="muted">Všechny zápisy jsou v box score zápasu. Pokud se ještě hraje, můžeš pokračovat.</p>
        <div class="row">
          <a class="btn btn-dark" href="/zapasy/{id}">Box score</a>
          <button type="button" class="btn" disabled={busy} onclick={() => (gameRestart = true)}>Začít znovu</button>
          <button type="button" class="btn btn-primary" disabled={busy} onclick={reopenGame}>Pokračovat v zápisu</button>
        </div>
      </div>
      {#if plays.length}
        <section class="feed">
          <div class="feed-head"><h2>Průběh zápasu</h2></div>
          <PlayLog {plays} awayTeamId={game.away_team_id} onedit={(p) => (editing = p)} />
        </section>
      {/if}
    {:else if setupTeam}
      <!-- ---------------------------------------------------------- whole game: lineups of both teams -->
      {@const st = league.team(setupTeam)}
      {@const isAway = setupTeam === game.away_team_id}
      <ol class="steps" aria-label="Příprava zápasu">
        {#each [away, home] as t, i (t?.id)}
          {#if t}
            {@const done = !!running(t.id) || (i === 0 && pendingAway !== null)}
            <li class:current={t.id === setupTeam} class:done>
              <span class="num">{done ? '✓' : i + 1}</span>
              <span><strong>{i === 0 ? 'Hosté' : 'Domácí'}</strong> {t.short_name ?? t.name}{#if running(t.id)} · už se zapisuje{/if}</span>
              {#if i === 0 && pendingAway !== null && !running(t.id)}
                <button type="button" class="btn btn-quiet btn-sm" onclick={() => (pendingAway = null)}>Upravit</button>
              {/if}
            </li>
          {/if}
        {/each}
      </ol>
      <div class="teamline">
        <TeamBadge team={st} size={30} />
        <strong>{st?.name}</strong>
        <span class="muted">{isAway ? 'hosté, pálí jako první' : 'domácí, pálí v dolní polovině'}</span>
      </div>
      {#key setupTeam}
        <LineupEditor
          teamId={setupTeam}
          initial={isAway && pendingAway ? pendingAway : (lineups.find((l) => l.team_id === setupTeam)?.players ?? [])}
          saveLabel={isAway && !running(game.home_team_id) ? 'Pokračovat na sestavu domácích' : 'Začít zápas'}
          {busy}
          onsave={(ids) => saveSetupLineup(ids)}
          oncancel={() => setScoring(null)}
        />
      {/key}
    {:else if !team}
      <p class="empty">Načítám stav zápisu…</p>
    {:else if !session || mode === 'restart'}
      <!-- ---------------------------------------------------------- start: lineup -->
      <div class="teamline">
        <TeamBadge {team} size={30} />
        <strong>{team.name}</strong>
        <button type="button" class="btn btn-quiet btn-sm" onclick={() => setScoring(null)}>Změnit režim</button>
      </div>
      <p class="lead muted">Sestav pořadí pálkařů. Během zápasu ho jde kdykoli upravit (střídání, další hráč).</p>
      <LineupEditor
        teamId={team.id}
        initial={lineup}
        saveLabel={session ? 'Začít znovu od 1. směny' : 'Začít zápis'}
        {busy}
        onsave={(ids) => start(ids)}
        oncancel={session ? () => (mode = 'score') : undefined}
      />
    {:else if session.finished}
      <!-- ---------------------------------------------------------- finished -->
      <div class="card done" in:fade={{ duration: 150 }}>
        <Icon name="flag" size={28} />
        <h2>Živý zápis za {team.short_name ?? team.name} je ukončený</h2>
        <p class="muted">Všechny zápisy jsou v box score zápasu. Pokud se ještě hraje, můžeš pokračovat.</p>
        <div class="row">
          <a class="btn btn-dark" href="/zapasy/{id}">Box score</a>
          <button type="button" class="btn" disabled={busy} onclick={() => (mode = 'restart')}>Začít znovu</button>
          <button type="button" class="btn btn-primary" disabled={busy} onclick={() => finish(false)}>Pokračovat v zápisu</button>
        </div>
      </div>
      {#if plays.length}
        <section class="feed">
          <div class="feed-head"><h2>Průběh zápasu</h2></div>
          <p class="muted feed-hint">I po skončení jde u každé akce opravit výsledek nebo doběhy, případně akci smazat.</p>
          <PlayLog {plays} awayTeamId={game.away_team_id} onedit={(p) => (editing = p)} />
        </section>
      {/if}
    {:else if mode === 'lineup'}
      <!-- ---------------------------------------------------------- lineup edit -->
      <div class="teamline"><TeamBadge {team} size={30} /><strong>{team.name}</strong></div>
      <LineupEditor
        teamId={team.id}
        initial={lineup}
        nextSlot={session.next_slot}
        saveLabel="Uložit pořadí"
        {busy}
        onsave={saveLineup}
        oncancel={() => (mode = 'score')}
      />
    {:else if mode === 'state'}
      <!-- ---------------------------------------------------------- state fix -->
      <section class="card fix" in:fade={{ duration: 150 }}>
        <h2>Opravit stav: {team.short_name ?? team.name}</h2>
        <p class="muted">Pro případy, kdy se něco stalo mimo běžný zápis: náhradní běžec, špatně zapsané outy, přeskočený pálkař.</p>
        <div class="grid">
          <label>
            <span>Směna</span>
            <span class="step">
              <button type="button" aria-label="Předchozí směna" disabled={fix.inning <= 1} onclick={() => fix.inning--}><Icon name="minus" size={18} /></button>
              <span class="val">{fix.inning}.</span>
              <button type="button" aria-label="Další směna" disabled={fix.inning >= 30} onclick={() => fix.inning++}><Icon name="plus" size={18} /></button>
            </span>
          </label>
          <div class="lbl">
            <span>Outy</span>
            <div class="seg" role="group" aria-label="Outy">
              {#each [0, 1, 2] as n (n)}<button type="button" aria-pressed={fix.outs === n} onclick={() => (fix.outs = n)}>{n}</button>{/each}
            </div>
          </div>
          {#each [0, 1, 2] as b (b)}
            <label>
              <span>{b + 1}. meta</span>
              <select class="select" bind:value={fix.bases[b]}>
                <option value={null}>prázdná</option>
                {#each teamRoster as p (p.id)}<option value={p.id}>{p.jersey_number != null ? `#${p.jersey_number} ` : ''}{p.name}</option>{/each}
              </select>
            </label>
          {/each}
          <label>
            <span>Na pálce</span>
            <select class="select" bind:value={fix.nextSlot}>
              {#each lineup as pid, i (pid)}<option value={i}>{i + 1}. {league.player(pid)?.name}</option>{/each}
            </select>
          </label>
        </div>
        <div class="row end">
          <button type="button" class="btn btn-quiet" onclick={() => (mode = 'score')}>Zrušit</button>
          <button type="button" class="btn btn-primary" disabled={busy} onclick={saveFix}><Icon name="check" size={18} /> Uložit stav</button>
        </div>
      </section>
    {:else}
      <!-- ---------------------------------------------------------- scoring -->
      <section class="board card" style:--team={team.color} in:fade={{ duration: 150 }}>
        <div class="sb">
          <div class="inn">
            <span class="k">Směna</span>
            <span class="v">{session.inning}.{#if half}<span class="half" title="{half} polovina">{half === 'horní' ? '▲' : '▼'}</span>{/if}</span>
          </div>
          {#if fullGame}
            {#each [away, home] as t (t?.id)}
              {#if t}
                <div class="runs" class:bat={t.id === teamId}>
                  <span class="k"><TeamBadge team={t} size={18} /> {t.short_name ?? t.code}</span>
                  <span class="v">{runsOf(t.id)}</span>
                </div>
              {/if}
            {/each}
          {:else}
            <div class="runs">
              <span class="k"><TeamBadge {team} size={18} /> {team.short_name ?? team.code}</span>
              <span class="v">{ourRuns}</span>
            </div>
          {/if}
          {#if !fullGame && opponentScored}
            <div class="runs opp">
              <span class="k"><TeamBadge team={league.team(opponentId)} size={18} /> {league.team(opponentId)?.short_name ?? ''}</span>
              <span class="v">{runsOf(opponentId)}</span>
            </div>
          {/if}
          <button type="button" class="undo" disabled={busy} onclick={undo} aria-label="Vrátit poslední akci">
            <Icon name="undo" size={20} /><span>Zpět</span>
          </button>
        </div>

        <Diamond {bases} outs={session.outs} onrunner={(b) => (sheet = { result: null, runnerFrom: b })} />
        {#if lastPlay}
          {#key lastPlay}<p class="last" in:fade={{ duration: 200 }}><Icon name="check" size={16} /> {lastPlay}</p>{/key}
        {/if}
      </section>

      {#key session.team_id + ':' + session.next_slot + ':' + session.version}
        <section class="atbat card" in:fly={{ x: 24, duration: 220 }}>
          <span class="jn" aria-hidden="true">{batter?.jersey_number ?? '–'}</span>
          <span class="info">
            <span class="k">{fullGame ? `Na pálce · ${team.short_name ?? team.name}` : 'Na pálce'}</span>
            <span class="nm">{batter?.name ?? 'Neznámý hráč'}</span>
            <span class="today">{lineOf(batter?.id)}</span>
          </span>
          <span class="next muted">
            {#if onDeck}Další: <strong>{onDeck.name}</strong>{/if}{#if inHole}, pak {inHole.name}{/if}
          </span>
        </section>
      {/key}

      <div class="pad" role="group" aria-label="Výsledek na pálce">
        {#each RESULTS as r (r.code)}
          <button type="button" class="res g-{r.group}" disabled={busy || !allowed(r.code)} onclick={() => tapResult(r.code)}>
            <span class="code">{r.code}</span>
            <span class="lbl">{r.label}</span>
          </button>
        {/each}
      </div>

      <div class="tools">
        <button type="button" class="btn btn-dark btn-sm" disabled={busy || occupiedCount === 0} onclick={() => (sheet = { result: null, runnerFrom: ([3, 2, 1] as Base[]).find((b) => bases[b - 1]) ?? null })}>
          <Icon name="swap" size={16} /> Pohyb běžců
        </button>
        <button type="button" class="btn btn-dark btn-sm" disabled={busy} onclick={() => (mode = 'lineup')}><Icon name="player" size={16} /> Pořadí a střídání</button>
        <button type="button" class="btn btn-dark btn-sm" disabled={busy} onclick={openFix}><Icon name="tune" size={16} /> Opravit stav</button>

        {#if confirmFinish}
          <span class="confirm">
            <button type="button" class="btn btn-sm danger" disabled={busy} onclick={() => finish(true)}>{fullGame ? 'Ukončit zápis obou týmů' : 'Opravdu ukončit'}</button>
            <button type="button" class="btn btn-quiet btn-sm" onclick={() => (confirmFinish = false)}>Ne</button>
          </span>
        {:else}
          <button type="button" class="btn btn-quiet btn-sm" onclick={() => (confirmFinish = true)}><Icon name="flag" size={16} /> Ukončit zápis</button>
        {/if}
      </div>

      {#if !started}
        <p class="note">Zápas podle rozpisu ještě nezačal ({time(game.starts_at)}), výsledky na pálce půjde uložit až od začátku.</p>
      {/if}

      <section class="feed">
        <div class="feed-head">
          <h2>Průběh zápasu</h2>
          <a class="link-accent" href="/zapasy/{id}?historie">Historie změn</a>
        </div>
        <p class="muted feed-hint">Tužkou u akce opravíš výsledek, doběhy ve směně, akci smažeš nebo k ní vrátíš celý zápis.</p>
        <PlayLog {plays} awayTeamId={game.away_team_id} onedit={(p) => (editing = p)} />
      </section>
    {/if}
  {/if}
</div>

{#if editing}
  <EditPlaySheet
    play={editing}
    pa={editingPa}
    awayTeamId={game?.away_team_id}
    isLatest={editing.id === latestPlayId}
    canRewind={sessions.length > 0 && !sessions.some((x) => x.finished)}
    {busy}
    onsaveresult={saveResult}
    onadjust={adjust}
    ondelete={deletePlay}
    onrewind={rewind}
    oncanceladjust={cancelAdjust}
    onclose={closeEdit}
  />
{/if}

{#if sheet && session && !session.finished}
  <PlaySheet
    result={sheet.result}
    runnerFrom={sheet.runnerFrom}
    {bases}
    outs={session.outs}
    inning={session.inning}
    nextSlot={session.next_slot}
    {lineup}
    {busy}
    onconfirm={submit}
    oncancel={() => (sheet = null)}
  />
{/if}

<style>
  .back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--muted);
    text-decoration: none;
    font-weight: 600;
    margin-bottom: 12px;
  }
  .title {
    display: grid;
    gap: 10px;
    margin-bottom: 18px;
  }
  .title h1 {
    font-size: clamp(30px, 7vw, 48px);
  }
  .title.compact {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
  }
  .title.compact h1 {
    font-size: 20px;
    letter-spacing: -0.02em;
  }
  .badge {
    justify-self: start;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 4px 12px 4px 10px;
    border-radius: 999px;
    background: var(--neg-soft);
    color: var(--neg);
    font-weight: 800;
    font-size: 13px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--neg);
    animation: pulse 1.6s ease-out infinite;
  }
  @keyframes pulse {
    0% {
      box-shadow: 0 0 0 0 color-mix(in srgb, var(--neg) 70%, transparent);
    }
    100% {
      box-shadow: 0 0 0 10px transparent;
    }
  }
  .lead {
    margin: 0 0 16px;
    font-size: 16px;
    max-width: 60ch;
  }

  /* team picker */
  .pick {
    display: grid;
    gap: 12px;
  }
  @media (min-width: 700px) {
    .pick {
      grid-template-columns: 1fr 1fr;
    }
  }
  .tpick {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 14px;
    padding: 18px;
    text-align: left;
    cursor: pointer;
    background:
      radial-gradient(90% 140% at 0% 0%, color-mix(in srgb, var(--team) 20%, transparent), transparent 60%),
      var(--surface);
    color: var(--ink);
    transition: border-color 160ms, transform 160ms;
  }
  .tpick:hover {
    border-color: color-mix(in srgb, var(--team) 60%, transparent);
    transform: translateY(-2px);
  }
  .tinfo {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .tn {
    font-weight: 800;
    font-size: 20px;
    letter-spacing: -0.02em;
  }
  .ts {
    font-size: 14px;
    color: var(--muted);
  }
  .modes {
    display: grid;
    gap: 12px;
    margin-bottom: 30px;
  }
  @media (min-width: 760px) {
    .modes {
      grid-template-columns: 1fr 1fr;
    }
  }
  .mode {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 14px;
    padding: 18px;
    text-align: left;
    text-decoration: none;
    color: var(--ink);
    cursor: pointer;
    border-color: color-mix(in srgb, var(--accent) 45%, var(--line));
    background:
      radial-gradient(90% 140% at 0% 0%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 60%),
      var(--surface);
    transition: transform 160ms, border-color 160ms;
  }
  .mode:hover {
    transform: translateY(-2px);
    border-color: var(--accent);
  }
  .mode.watch {
    border-color: color-mix(in srgb, var(--neg) 40%, var(--line));
    background:
      radial-gradient(90% 140% at 0% 0%, color-mix(in srgb, var(--neg) 12%, transparent), transparent 60%),
      var(--surface);
  }
  .mode.watch:hover {
    border-color: var(--neg);
  }
  .mi {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    border-radius: 16px;
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .watch .mi {
    background: var(--neg-soft);
    color: var(--neg);
  }
  .sub-h {
    font-size: 20px;
    margin-bottom: 6px;
  }
  .steps {
    list-style: none;
    margin: 0 0 18px;
    padding: 0;
    display: grid;
    gap: 8px;
  }
  .steps li {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--muted);
    font-size: 14.5px;
  }
  .steps li.current {
    border-color: var(--accent);
    color: var(--ink);
  }
  .steps li.done {
    color: var(--ink);
  }
  .steps .num {
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    flex: none;
    border-radius: 50%;
    background: var(--surface-3);
    font-weight: 800;
    font-size: 13px;
  }
  .steps .current .num {
    background: var(--accent);
    color: var(--accent-ink);
  }
  .steps .done .num {
    background: var(--pos);
    color: #06140c;
  }
  .steps li .btn {
    margin-left: auto;
  }
  .teamline {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }

  /* finished */
  .done {
    padding: 24px 20px;
    display: grid;
    gap: 8px;
    justify-items: start;
  }
  .done h2 {
    font-size: 22px;
  }
  .done p {
    margin: 0 0 8px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .row.end {
    justify-content: flex-end;
    margin-top: 16px;
  }

  /* state fix */
  .fix {
    padding: 20px 16px;
  }
  .fix h2 {
    margin-bottom: 6px;
  }
  .fix > p {
    margin: 0 0 16px;
    font-size: 14px;
  }
  .grid {
    display: grid;
    gap: 12px;
    grid-template-columns: 1fr 1fr;
  }
  .grid label,
  .grid .lbl {
    display: grid;
    gap: 6px;
    font-size: 13px;
    font-weight: 700;
    color: var(--muted);
    min-width: 0;
  }
  .grid .select {
    width: 100%;
    min-width: 0;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .step button {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 0;
    background: var(--surface-3);
    color: var(--ink);
    cursor: pointer;
  }
  .step button[disabled] {
    opacity: 0.35;
  }
  .step .val {
    min-width: 34px;
    text-align: center;
    font-weight: 800;
    font-size: 20px;
    color: var(--ink);
  }

  /* scoreboard */
  .board {
    padding: 14px 14px 10px;
    background:
      radial-gradient(100% 120% at 0% 0%, color-mix(in srgb, var(--team) 16%, transparent), transparent 60%),
      var(--surface);
  }
  .sb {
    display: flex;
    align-items: stretch;
    gap: 8px;
    margin-bottom: 6px;
  }
  .inn,
  .runs {
    display: grid;
    gap: 2px;
    padding: 8px 12px;
    border-radius: 14px;
    background: var(--surface-2);
    min-width: 0;
  }
  .k {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 700;
    color: var(--muted);
    white-space: nowrap;
  }
  .v {
    font-size: 30px;
    font-weight: 800;
    letter-spacing: -0.04em;
    line-height: 1;
  }
  .runs.opp .v {
    color: var(--muted);
  }
  .runs.bat {
    box-shadow: inset 0 0 0 1.5px var(--accent);
  }
  .half {
    font-size: 15px;
    margin-left: 3px;
    color: var(--accent-text);
    vertical-align: 6px;
  }
  .undo {
    margin-left: auto;
    display: grid;
    justify-items: center;
    align-content: center;
    gap: 2px;
    min-width: 64px;
    padding: 6px 10px;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: var(--surface-2);
    font-weight: 700;
    font-size: 12px;
    cursor: pointer;
  }
  .undo:hover {
    border-color: var(--line-strong);
  }
  .undo[disabled] {
    opacity: 0.5;
  }

  .last {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 2px 0;
    font-size: 13.5px;
    font-weight: 600;
    color: var(--muted);
  }
  .last :global(svg) {
    color: var(--pos);
    flex: none;
  }
  .board :global(.diamond) {
    max-width: 280px;
  }
  @media (max-width: 640px) {
    .board :global(.diamond) {
      max-width: 230px;
    }
    .back {
      margin-bottom: 8px;
    }
  }

  /* at bat */
  .atbat {
    margin-top: 10px;
    padding: 12px 14px;
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    column-gap: 12px;
    row-gap: 6px;
    border-left: 4px solid var(--accent);
  }
  .jn {
    display: grid;
    place-items: center;
    min-width: 50px;
    height: 50px;
    padding: 0 6px;
    border-radius: 14px;
    background: var(--accent);
    color: var(--accent-ink);
    font-weight: 800;
    font-size: 24px;
  }
  .info {
    display: grid;
    gap: 1px;
    min-width: 0;
  }
  .nm {
    font-weight: 800;
    font-size: clamp(20px, 5.4vw, 28px);
    letter-spacing: -0.03em;
    line-height: 1.08;
    overflow-wrap: anywhere;
  }
  .today {
    font-size: 13px;
    font-weight: 600;
  }
  .next {
    grid-column: 1 / -1;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* result pad */
  .pad {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 7px;
    margin-top: 10px;
  }
  .res {
    display: grid;
    gap: 2px;
    justify-items: start;
    align-content: start;
    padding: 10px 6px 8px 11px;
    min-height: 62px;
    border-radius: 15px;
    border: 1px solid var(--line);
    background: var(--surface);
    cursor: pointer;
    text-align: left;
    position: relative;
    overflow: hidden;
    color: var(--ink);
    transition: transform 90ms, background-color 140ms, border-color 140ms, opacity 140ms;
  }
  .res::before {
    content: '';
    position: absolute;
    left: 0;
    top: 11px;
    bottom: 11px;
    width: 3px;
    border-radius: 0 3px 3px 0;
    background: var(--faint);
  }
  .res.g-hit::before {
    background: var(--pos);
  }
  .res.g-onbase::before {
    background: var(--accent);
  }
  .res:hover {
    border-color: var(--line-strong);
    background: var(--surface-3);
  }
  .res:active {
    transform: scale(0.95);
  }
  .res[disabled] {
    opacity: 0.3;
    cursor: default;
    transform: none;
  }
  .code {
    font-weight: 800;
    font-size: 21px;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .lbl {
    font-size: 11px;
    color: var(--muted);
    line-height: 1.15;
  }
  /* narrow phones: codes only, so the whole pad fits on one screen */
  @media (max-width: 429px) {
    .res {
      min-height: 52px;
      justify-items: center;
      align-content: center;
      padding: 8px 4px;
    }
    .code {
      font-size: 22px;
    }
    .lbl {
      position: absolute !important;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
    }
  }

  .tools {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 14px;
  }
  .confirm {
    display: inline-flex;
    gap: 4px;
  }
  .danger {
    background: var(--neg);
    border-color: var(--neg);
    color: #fff;
  }
  .note {
    margin: 14px 0 0;
    font-size: 14px;
    color: var(--accent-text);
  }
  .feed {
    margin-top: 32px;
  }
  .feed-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }
  .feed h2 {
    font-size: 20px;
  }
  .feed-hint {
    margin: 6px 0 12px;
    font-size: 13.5px;
  }

  @media (min-width: 900px) {
    .live {
      max-width: 860px;
    }
  }
  @media (max-width: 400px) {
    .v {
      font-size: 26px;
    }
    .inn,
    .runs {
      padding: 6px 10px;
    }
  }
</style>
