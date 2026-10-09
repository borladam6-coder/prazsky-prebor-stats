<script lang="ts">
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import { slide, fade } from 'svelte/transition';
  import { league } from '#lib/league.svelte.ts';
  import { supabase } from '#lib/supabase.ts';
  import {
    gameLines, gameEntries, addPlateAppearance, updatePlateAppearance, deletePlateAppearance,
    bumpStat, addPlayer, errorMessage, WriteCancelled
  } from '#lib/api.ts';
  import { statColumns } from '#lib/columns.ts';
  import { BOX_STATS, RESULTS, resultDef } from '#lib/stats.ts';
  import { day, time, date } from '#lib/format.ts';
  import { toasts } from '#lib/toast.svelte.ts';
  import type { GameExtras, PaResult, PlateAppearance, Player, PlayerGameLine, Team } from '#lib/types.ts';
  import StatTable from '#lib/components/StatTable.svelte';
  import TeamBadge from '#lib/components/TeamBadge.svelte';
  import HistoryList from '#lib/components/HistoryList.svelte';
  import Icon from '#lib/components/Icon.svelte';

  const id = $derived(Number(page.params.id));
  const game = $derived(league.game(id));
  const home = $derived(league.team(game?.home_team_id));
  const away = $derived(league.team(game?.away_team_id));
  const playable = $derived(game ? league.isPlayable(game) : false);

  let lines = $state<PlayerGameLine[]>([]);
  let pas = $state<PlateAppearance[]>([]);
  let extras = $state<GameExtras[]>([]);
  let loaded = $state(false);
  let loadError = $state<string | null>(null);

  let tab = $state<'box' | 'entry' | 'history'>('box');
  let entryTeamId = $state<number | null>(null);
  let openPlayer = $state<string | null>(null);
  let busy = $state(false);
  let historyList = $state<{ reload: () => Promise<void> }>();

  async function load() {
    try {
      const [l, e] = await Promise.all([gameLines(id), gameEntries(id)]);
      lines = l;
      pas = e.pas;
      extras = e.extras;
      loadError = null;
    } catch (e) {
      loadError = errorMessage(e);
    } finally {
      loaded = true;
    }
  }

  // Load on open and keep in sync with other people's edits (Supabase Realtime).
  $effect(() => {
    const gameId = id;
    untrack(() => {
      loaded = false;
      lines = [];
      pas = [];
      extras = [];
      openPlayer = null;
      entryTeamId = league.game(gameId)?.home_team_id ?? null;
      load();
    });

    if (!supabase) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        load();
        historyList?.reload();
      }, 400);
    };
    const channel = supabase
      .channel(`game-${gameId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plate_appearances', filter: `game_id=eq.${gameId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_player_extras', filter: `game_id=eq.${gameId}` }, refresh)
      .subscribe();
    return () => {
      clearTimeout(timer);
      supabase!.removeChannel(channel);
    };
  });

  // ------------------------------------------------------------ box score
  const boxColumns = statColumns<PlayerGameLine>(BOX_STATS);

  function teamBox(teamId: number | undefined) {
    const rows = lines.filter((l) => l.team_id === teamId);
    const sum = { ...rows[0] } as PlayerGameLine;
    for (const k of BOX_STATS) (sum as unknown as Record<string, number>)[k] = rows.reduce((a, r) => a + Number(r[k as keyof PlayerGameLine] ?? 0), 0);
    return { rows, totals: rows.length ? sum : null };
  }
  const boxes = $derived(
    [home, away].filter((t): t is Team => !!t).map((t) => ({ team: t, ...teamBox(t.id) }))
  );

  // ------------------------------------------------------------ entry
  const entryTeam = $derived(league.team(entryTeamId));

  const entryPlayers = $derived.by(() => {
    if (!entryTeamId) return [];
    const withData = new Set([...pas.map((p) => p.player_id), ...extras.filter((x) => x.runs || x.stolen_bases).map((x) => x.player_id)]);
    return league.players
      .filter((p) => p.team_id === entryTeamId && (p.active || withData.has(p.id)))
      .sort((a, b) => (a.jersey_number ?? 999) - (b.jersey_number ?? 999) || a.name.localeCompare(b.name, 'cs'));
  });

  const pasOf = (playerId: string) => pas.filter((p) => p.player_id === playerId);
  const extrasOf = (playerId: string) => extras.find((x) => x.player_id === playerId);

  function summary(p: Player) {
    const list = pasOf(p.id);
    const x = extrasOf(p.id);
    const h = list.filter((r) => resultDef(r.result)?.group === 'hit').length;
    const ab = list.filter((r) => ['1B', '2B', '3B', 'HR', 'K', 'OUT', 'FC', 'ROE'].includes(r.result)).length;
    const rbi = list.reduce((a, r) => a + r.rbi, 0);
    const parts = [`${h}/${ab}`];
    if (rbi) parts.push(`${rbi} RBI`);
    if (x?.runs) parts.push(`${x.runs} R`);
    if (x?.stolen_bases) parts.push(`${x.stolen_bases} SB`);
    return list.length || x?.runs || x?.stolen_bases ? parts.join(', ') : 'bez zápisu';
  }

  async function run<T>(action: () => Promise<T>, done?: (r: T) => void) {
    if (busy) return;
    busy = true;
    try {
      const r = await action();
      done?.(r);
      await load();
      historyList?.reload();
    } catch (e) {
      if (!(e instanceof WriteCancelled)) toasts.show(errorMessage(e), 'error');
    } finally {
      busy = false;
    }
  }

  const addResult = (p: Player, code: PaResult) =>
    run(() => addPlateAppearance(id, p.id, code), () => toasts.show(`${p.name}: ${code}`));

  const changeRbi = (pa: PlateAppearance, delta: number) =>
    run(() => updatePlateAppearance(pa, { rbi: Math.max(0, Math.min(4, pa.rbi + delta)) }));

  const changeResult = (pa: PlateAppearance, code: PaResult) => run(() => updatePlateAppearance(pa, { result: code }));

  const removePa = (p: Player, pa: PlateAppearance) =>
    run(
      () => deletePlateAppearance(pa),
      () =>
        toasts.show(`Smazáno: ${pa.result}`, 'ok', {
          label: 'Vrátit',
          run: () => run(() => addPlateAppearance(id, p.id, pa.result, pa.rbi))
        })
    );

  const bump = (p: Player, stat: 'runs' | 'stolen_bases', delta: 1 | -1) => run(() => bumpStat(id, p.id, stat, delta));

  // add a player who is not on the roster yet (e.g. a guest from another team of the club)
  let newName = $state('');
  let newNumber = $state('');
  let addOpen = $state(false);

  function submitPlayer(e: SubmitEvent) {
    e.preventDefault();
    if (!entryTeamId || !league.season) return;
    const jersey = newNumber.trim() === '' ? null : Number(newNumber);
    if (jersey !== null && (!Number.isInteger(jersey) || jersey < 0 || jersey > 99)) {
      toasts.show('Číslo dresu musí být 0–99.', 'error');
      return;
    }
    run(
      () => addPlayer(league.season!.id, entryTeamId!, newName, jersey),
      (p) => {
        league.upsertPlayer(p);
        toasts.show(`Hráč ${p.name} přidán na soupisku.`);
        newName = '';
        newNumber = '';
        addOpen = false;
        openPlayer = p.id;
      }
    );
  }

  const groupClass = (code: string) => resultDef(code)?.group ?? 'out';
</script>

<svelte:head>
  <title>{home?.short_name ?? ''} – {away?.short_name ?? ''} – Pražský přebor mužů</title>
</svelte:head>

<div class="page">
  <a class="back" href="/zapasy"><Icon name="back" size={18} /> Zápasy</a>

  {#if !game}
    <p class="empty">Zápas neexistuje.</p>
  {:else}
    <section class="head" aria-label="Výsledek zápasu">
      <div class="side">
        <TeamBadge team={home} size={44} />
        <a class="tname" href="/tymy/{home?.id}">{home?.name}</a>
        <span class="role">domácí</span>
      </div>
      <div class="score">
        {#if game.home_score !== null && game.away_score !== null}
          <span class="slot">{game.home_score}</span><span class="colon">:</span><span class="slot">{game.away_score}</span>
        {:else}
          <span class="vs">{time(game.starts_at) || '–'}</span>
        {/if}
      </div>
      <div class="side right">
        <TeamBadge team={away} size={44} />
        <a class="tname" href="/tymy/{away?.id}">{away?.name}</a>
        <span class="role">hosté</span>
      </div>
      <p class="info">
        {day(game.starts_at)} {date(game.starts_at)}{game.starts_at ? `, ${time(game.starts_at)}` : ''}{game.venue ? `, ${game.venue}` : ''}
      </p>
    </section>

    <div class="tabs" role="tablist" aria-label="Části zápasu">
      <button type="button" role="tab" aria-selected={tab === 'box'} onclick={() => (tab = 'box')}>Box score</button>
      <button type="button" role="tab" aria-selected={tab === 'entry'} onclick={() => (tab = 'entry')}>Zapsat statistiky</button>
      <button type="button" role="tab" aria-selected={tab === 'history'} onclick={() => (tab = 'history')}>Historie</button>
    </div>

    {#if loadError}
      <p class="empty">{loadError}</p>
    {:else if !loaded}
      <p class="muted loading">Načítám…</p>
    {:else if tab === 'box'}
      <div in:fade={{ duration: 150 }}>
        {#each boxes as b (b.team.id)}
          <section class="box" style:--team={b.team.color}>
            <h2><TeamBadge team={b.team} size={28} /> {b.team.name}</h2>
            {#if b.rows.length === 0}
              <div class="empty">
                <p>Za tento tým zatím nikdo nic nezapsal.</p>
                {#if playable}
                  <button type="button" class="btn btn-primary" onclick={() => { entryTeamId = b.team.id; tab = 'entry'; }}>Zapsat statistiky</button>
                {/if}
              </div>
            {:else}
              <StatTable
                rows={b.rows}
                rowKey={(r) => r.player_id}
                columns={boxColumns}
                nameLabel="Hráč"
                nameSort={(r) => league.player(r.player_id)?.name ?? ''}
                sortKey="pa"
                caption="Box score {b.team.name}"
                totals={b.totals ? { label: 'Celkem', row: b.totals } : null}
              >
                {#snippet name(r)}
                  {@const pl = league.player(r.player_id)}
                  <a class="pl" href="/hraci/{r.player_id}">{pl?.name ?? '?'}{#if pl?.jersey_number != null}<span class="num">#{pl.jersey_number}</span>{/if}</a>
                {/snippet}
              </StatTable>
            {/if}
          </section>
        {/each}
      </div>
    {:else if tab === 'entry'}
      <div in:fade={{ duration: 150 }}>
        {#if !playable}
          <p class="empty">Zápas se ještě nehrál, statistiky půjde zapsat po jeho začátku.</p>
        {:else}
          <div class="team-switch" role="group" aria-label="Tým">
            {#each [home, away] as t (t?.id)}
              {#if t}
                <button type="button" class="tsw" aria-pressed={entryTeamId === t.id} style:--team={t.color} onclick={() => { entryTeamId = t.id; openPlayer = null; }}>
                  <TeamBadge team={t} size={26} />
                  <span>{t.short_name ?? t.name}</span>
                </button>
              {/if}
            {/each}
          </div>

          <p class="hint muted">
            Klepni na hráče a zapisuj jeho příchody na pálku v pořadí, jak šly. Homerun automaticky přidá doběh i RBI.
            Ukradené mety a doběhy uprav tlačítky + a −.
          </p>

          <ul class="players" style:--team={entryTeam?.color}>
            {#each entryPlayers as p (p.id)}
              {@const list = pasOf(p.id)}
              {@const x = extrasOf(p.id)}
              <li class:open={openPlayer === p.id}>
                <button type="button" class="phead" aria-expanded={openPlayer === p.id} onclick={() => (openPlayer = openPlayer === p.id ? null : p.id)}>
                  <span class="jn">{p.jersey_number ?? '–'}</span>
                  <span class="pn">{p.name}{#if !p.active}<span class="inactive"> (mimo soupisku)</span>{/if}</span>
                  <span class="sum">{summary(p)}</span>
                  <span class="chev"><Icon name="chevron" size={18} /></span>
                </button>

                {#if openPlayer === p.id}
                  <div class="pbody" transition:slide={{ duration: 200 }}>
                    <div class="pad" role="group" aria-label="Výsledek na pálce">
                      {#each RESULTS as r (r.code)}
                        <button type="button" class="res g-{r.group}" disabled={busy} onclick={() => addResult(p, r.code)}>
                          <span class="code">{r.code}</span>
                          <span class="lbl">{r.label}</span>
                        </button>
                      {/each}
                    </div>

                    <div class="counters">
                      <div class="counter">
                        <span class="clabel" title="Doběhy">R</span>
                        <button type="button" aria-label="Ubrat doběh" disabled={busy || !x?.runs} onclick={() => bump(p, 'runs', -1)}><Icon name="minus" size={18} /></button>
                        <span class="cval">{x?.runs ?? 0}</span>
                        <button type="button" aria-label="Přidat doběh" disabled={busy} onclick={() => bump(p, 'runs', 1)}><Icon name="plus" size={18} /></button>
                      </div>
                      <div class="counter">
                        <span class="clabel" title="Ukradené mety">SB</span>
                        <button type="button" aria-label="Ubrat ukradenou metu" disabled={busy || !x?.stolen_bases} onclick={() => bump(p, 'stolen_bases', -1)}><Icon name="minus" size={18} /></button>
                        <span class="cval">{x?.stolen_bases ?? 0}</span>
                        <button type="button" aria-label="Přidat ukradenou metu" disabled={busy} onclick={() => bump(p, 'stolen_bases', 1)}><Icon name="plus" size={18} /></button>
                      </div>
                    </div>

                    {#if list.length}
                      <ol class="pas">
                        {#each list as pa, i (pa.id)}
                          <li class="g-{groupClass(pa.result)}" transition:slide={{ duration: 160 }}>
                            <span class="order">{i + 1}.</span>
                            <select
                              class="select rsel"
                              value={pa.result}
                              disabled={busy}
                              aria-label="Výsledek {i + 1}. příchodu"
                              onchange={(e) => changeResult(pa, (e.currentTarget as HTMLSelectElement).value as PaResult)}
                            >
                              {#each RESULTS as r (r.code)}<option value={r.code}>{r.code} – {r.label}</option>{/each}
                            </select>
                            <span class="rbi">
                              <span class="rl">RBI</span>
                              <button type="button" aria-label="Ubrat RBI" disabled={busy || pa.rbi <= (pa.result === 'HR' || pa.result === 'SF' ? 1 : 0)} onclick={() => changeRbi(pa, -1)}><Icon name="minus" size={16} /></button>
                              <span class="rv">{pa.rbi}</span>
                              <button type="button" aria-label="Přidat RBI" disabled={busy || pa.rbi >= 4} onclick={() => changeRbi(pa, 1)}><Icon name="plus" size={16} /></button>
                            </span>
                            <button type="button" class="del" aria-label="Smazat {i + 1}. příchod" disabled={busy} onclick={() => removePa(p, pa)}><Icon name="trash" size={18} /></button>
                          </li>
                        {/each}
                      </ol>
                    {/if}
                  </div>
                {/if}
              </li>
            {/each}
          </ul>

          <div class="addp">
            {#if addOpen}
              <form onsubmit={submitPlayer} transition:slide={{ duration: 180 }}>
                <input class="input" placeholder="Příjmení Jméno" bind:value={newName} required minlength="2" maxlength="60" aria-label="Jméno hráče" />
                <input class="input num-in" placeholder="Číslo" inputmode="numeric" bind:value={newNumber} aria-label="Číslo dresu" />
                <button type="submit" class="btn btn-primary" disabled={busy}>Přidat</button>
                <button type="button" class="btn btn-quiet" onclick={() => (addOpen = false)}>Zrušit</button>
              </form>
            {:else}
              <button type="button" class="btn" onclick={() => (addOpen = true)}><Icon name="plus" size={18} /> Hráč, který není na soupisce</button>
            {/if}
          </div>
        {/if}
      </div>
    {:else}
      <div in:fade={{ duration: 150 }}>
        <HistoryList bind:this={historyList} gameId={id} onreverted={load} />
      </div>
    {/if}
  {/if}
</div>

<style>
  .back {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--muted);
    text-decoration: none;
    font-weight: 600;
    margin-bottom: 14px;
  }
  .back:hover {
    color: var(--ink);
  }

  /* ---------- head: a small scoreboard */
  .head {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 10px;
    padding: 20px 14px 14px;
    border-radius: var(--radius-l);
    background:
      repeating-linear-gradient(90deg, transparent 0 46px, rgb(255 255 255 / 0.025) 46px 48px),
      var(--board);
    color: var(--board-ink);
    box-shadow: var(--shadow);
  }
  .side {
    display: grid;
    justify-items: center;
    gap: 8px;
    text-align: center;
    min-width: 0;
  }
  .tname {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(18px, 4.6vw, 28px);
    line-height: 1;
    color: var(--board-ink);
    text-decoration: none;
    overflow-wrap: anywhere;
  }
  .tname:hover {
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .role {
    font-size: 12px;
    color: var(--board-muted);
  }
  .score {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .slot {
    display: inline-block;
    min-width: 1.4em;
    padding: 4px 6px 1px;
    border-radius: 6px;
    background: var(--board-slot);
    box-shadow: inset 0 3px 4px rgb(0 0 0 / 0.55);
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(40px, 11vw, 64px);
    line-height: 1;
    text-align: center;
    color: var(--amber);
  }
  .colon {
    font-family: var(--font-display);
    font-size: 36px;
    color: var(--board-muted);
  }
  .vs {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 30px;
    color: var(--board-muted);
  }
  .info {
    grid-column: 1 / -1;
    margin: 6px 0 0;
    text-align: center;
    font-size: 14px;
    color: var(--board-muted);
  }

  /* ---------- tabs */
  .tabs {
    display: flex;
    gap: 4px;
    margin: 18px 0 18px;
    border-bottom: 1px solid var(--line);
    overflow-x: auto;
  }
  .tabs button {
    all: unset;
    cursor: pointer;
    padding: 10px 12px;
    font-weight: 600;
    color: var(--muted);
    border-bottom: 3px solid transparent;
    margin-bottom: -1px;
    white-space: nowrap;
  }
  .tabs button[aria-selected='true'] {
    color: var(--ink);
    border-bottom-color: var(--amber);
  }
  .tabs button:focus-visible {
    outline: 2px solid var(--focus);
  }
  .loading {
    padding: 20px 0;
  }

  /* ---------- box score */
  .box {
    margin-bottom: 28px;
  }
  .box h2 {
    display: flex;
    align-items: center;
    gap: 10px;
    font-size: 24px;
    margin-bottom: 10px;
  }
  .box .empty p {
    margin: 0 0 12px;
  }
  .pl {
    text-decoration: none;
  }
  .pl:hover {
    text-decoration: underline;
  }
  .num {
    color: var(--faint);
    margin-left: 6px;
    font-size: 12px;
  }

  /* ---------- entry */
  .team-switch {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .tsw {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: var(--radius-m);
    border: 1px solid var(--line-strong);
    background: var(--surface);
    font-weight: 700;
    cursor: pointer;
    min-width: 0;
  }
  .tsw span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tsw[aria-pressed='true'] {
    border-color: var(--team);
    box-shadow: inset 0 0 0 1px var(--team);
    background: color-mix(in srgb, var(--team) 10%, var(--surface));
  }
  .hint {
    font-size: 14px;
    margin: 12px 0 14px;
    max-width: 70ch;
  }

  .players {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-m);
    background: var(--surface);
    overflow: hidden;
  }
  .players > li {
    border-bottom: 1px solid var(--line);
  }
  .players > li:last-child {
    border-bottom: none;
  }
  .players > li.open {
    background: var(--surface-2);
    box-shadow: inset 3px 0 0 var(--team);
  }
  .phead {
    all: unset;
    box-sizing: border-box;
    display: grid;
    grid-template-columns: 34px 1fr auto 20px;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 12px 14px;
    cursor: pointer;
    min-height: 52px;
  }
  .phead:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
  .jn {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 20px;
    color: var(--muted);
    text-align: center;
  }
  .pn {
    font-weight: 600;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inactive {
    color: var(--faint);
    font-weight: 400;
  }
  .sum {
    font-size: 13px;
    color: var(--muted);
    white-space: nowrap;
  }
  .chev {
    color: var(--faint);
    transition: transform 200ms;
    display: grid;
  }
  .open .chev {
    transform: rotate(90deg);
  }

  .pbody {
    padding: 0 14px 16px;
  }
  .pad {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 6px;
  }
  .res {
    display: grid;
    gap: 1px;
    justify-items: start;
    padding: 8px 8px 7px 10px;
    min-height: 56px;
    border-radius: 8px;
    border: 1px solid var(--line-strong);
    border-left: 5px solid var(--faint);
    background: var(--surface);
    cursor: pointer;
    text-align: left;
    transition: transform 80ms, background-color 120ms;
  }
  .res:hover {
    background: var(--bg);
  }
  .res:active {
    transform: scale(0.97);
  }
  .res[disabled] {
    opacity: 0.55;
    cursor: progress;
  }
  .g-hit {
    border-left-color: var(--ok);
  }
  .g-onbase {
    border-left-color: var(--amber);
  }
  .g-out {
    border-left-color: var(--faint);
  }
  .code {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 22px;
    line-height: 1;
  }
  .lbl {
    font-size: 11.5px;
    color: var(--muted);
    line-height: 1.2;
  }

  .counters {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 12px;
  }
  .counter {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px 4px 12px;
    border-radius: 999px;
    border: 1px solid var(--line-strong);
    background: var(--surface);
  }
  .clabel {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 18px;
    margin-right: 4px;
  }
  .counter button,
  .rbi button,
  .del {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 1px solid var(--line);
    background: var(--surface-2);
    cursor: pointer;
    color: var(--ink);
  }
  .counter button[disabled],
  .rbi button[disabled],
  .del[disabled] {
    opacity: 0.4;
    cursor: default;
  }
  .cval {
    min-width: 22px;
    text-align: center;
    font-weight: 700;
    font-size: 17px;
  }

  .pas {
    list-style: none;
    margin: 14px 0 0;
    padding: 0;
    display: grid;
    gap: 6px;
  }
  .pas li {
    display: grid;
    grid-template-columns: 24px minmax(0, 1fr) auto auto;
    align-items: center;
    gap: 8px;
    padding: 6px 6px 6px 10px;
    border-radius: 8px;
    background: var(--surface);
    border: 1px solid var(--line);
    border-left: 4px solid var(--faint);
  }
  .order {
    font-size: 13px;
    color: var(--muted);
  }
  .rsel {
    min-height: 34px;
    padding: 4px 8px;
    width: 100%;
    font-weight: 600;
  }
  .rbi {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .rl {
    font-size: 12px;
    color: var(--muted);
    margin-right: 2px;
  }
  .rbi button {
    width: 30px;
    height: 30px;
  }
  .rv {
    min-width: 16px;
    text-align: center;
    font-weight: 700;
  }
  .del {
    color: var(--red);
    background: transparent;
    border-color: transparent;
  }

  .addp {
    margin-top: 12px;
  }
  .addp form {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .addp .input {
    flex: 1 1 200px;
  }
  .addp .num-in {
    flex: 0 1 90px;
  }

  @media (max-width: 420px) {
    .pad {
      grid-template-columns: repeat(3, 1fr);
    }
    .sum {
      font-size: 12px;
    }
    .rl {
      display: none;
    }
  }
</style>
