<script lang="ts">
  import { page } from '$app/state';
  import { untrack } from 'svelte';
  import { fade, slide } from 'svelte/transition';
  import { league } from '#lib/league.svelte.ts';
  import {
    battingTotals, teamBattingTotals, addPlayer, updatePlayer, setPlayerActive, errorMessage, WriteCancelled
  } from '#lib/api.ts';
  import { statColumns } from '#lib/columns.ts';
  import { TABLE_STATS } from '#lib/stats.ts';
  import { toasts } from '#lib/toast.svelte.ts';
  import type { Player, PlayerTotals, TeamTotals } from '#lib/types.ts';
  import StatTable from '#lib/components/StatTable.svelte';
  import TeamBadge from '#lib/components/TeamBadge.svelte';
  import GameRow from '#lib/components/GameRow.svelte';
  import Filters from '#lib/components/Filters.svelte';
  import Icon from '#lib/components/Icon.svelte';

  const id = $derived(Number(page.params.id));
  const team = $derived(league.team(id));
  const standing = $derived(league.standings.find((s) => s.team_id === id));

  let tab = $state<'stats' | 'games' | 'roster'>('stats');

  // ------------------------------------------------------------ stats
  let from = $state('');
  let to = $state('');
  let minPa = $state(0);
  let rows = $state<PlayerTotals[] | null>(null);
  let totals = $state<TeamTotals | null>(null);
  let statsError = $state<string | null>(null);

  async function loadStats() {
    if (!league.season) return;
    try {
      const f = { teamId: id, from, to };
      const [p, t] = await Promise.all([
        battingTotals(league.season.id, { ...f, minPa }),
        teamBattingTotals(league.season.id, f)
      ]);
      rows = p;
      totals = t[0] ?? null;
      statsError = null;
    } catch (e) {
      statsError = errorMessage(e);
    }
  }

  // reload when another team is opened; filter changes call loadStats() directly
  $effect(() => {
    void id;
    untrack(() => {
      rows = null;
      totals = null;
      loadStats();
      league.loadRecorded().catch(() => {});
    });
  });

  const columns = statColumns<PlayerTotals>(TABLE_STATS);

  // ------------------------------------------------------------ games
  const games = $derived(
    league.games
      .filter((g) => g.home_team_id === id || g.away_team_id === id)
      .sort((a, b) => (b.starts_at ?? '').localeCompare(a.starts_at ?? ''))
  );

  // ------------------------------------------------------------ roster
  const roster = $derived(
    league
      .teamPlayers(id, true)
      .sort((a, b) => Number(b.active) - Number(a.active) || (a.jersey_number ?? 999) - (b.jersey_number ?? 999) || a.name.localeCompare(b.name, 'cs'))
  );

  let busy = $state(false);
  let editing = $state<string | null>(null);
  let editName = $state('');
  let editNumber = $state('');
  let newName = $state('');
  let newNumber = $state('');

  function parseJersey(v: string): number | null | undefined {
    if (v.trim() === '') return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 99 ? n : undefined;
  }

  async function guarded(fn: () => Promise<Player>, ok: string) {
    if (busy) return;
    busy = true;
    try {
      const p = await fn();
      league.upsertPlayer(p);
      toasts.show(ok);
      return p;
    } catch (e) {
      if (!(e instanceof WriteCancelled)) toasts.show(errorMessage(e), 'error');
    } finally {
      busy = false;
    }
  }

  async function submitNew(e: SubmitEvent) {
    e.preventDefault();
    const jersey = parseJersey(newNumber);
    if (jersey === undefined) return toasts.show('Číslo dresu musí být 0–99.', 'error');
    const p = await guarded(() => addPlayer(league.season!.id, id, newName, jersey), 'Hráč přidán.');
    if (p) {
      newName = '';
      newNumber = '';
    }
  }

  function startEdit(p: Player) {
    editing = p.id;
    editName = p.name;
    editNumber = p.jersey_number === null ? '' : String(p.jersey_number);
  }

  async function saveEdit(e: SubmitEvent, p: Player) {
    e.preventDefault();
    const jersey = parseJersey(editNumber);
    if (jersey === undefined) return toasts.show('Číslo dresu musí být 0–99.', 'error');
    const r = await guarded(() => updatePlayer(p, editName, jersey), 'Uloženo.');
    if (r) editing = null;
  }

  const toggleActive = (p: Player) =>
    guarded(() => setPlayerActive(p, !p.active), p.active ? `${p.name} vyřazen ze soupisky.` : `${p.name} je zpět na soupisce.`);
</script>

<svelte:head>
  <title>{team?.name ?? 'Tým'} – Pražský přebor mužů</title>
</svelte:head>

<div class="page">
  <a class="back" href="/tymy"><Icon name="back" size={18} /> Týmy</a>

  {#if !team}
    <p class="empty">Tým neexistuje.</p>
  {:else}
    <header class="head" style:--team={team.color}>
      <TeamBadge {team} size={72} />
      <div>
        <h1>{team.name}</h1>
        {#if standing}
          <p class="rec">
            <span class="pos">{standing.position}.</span> místo, {standing.wins} výher, {standing.losses} proher{standing.draws ? `, ${standing.draws} remíz` : ''},
            skóre {standing.runs_for}:{standing.runs_against}
          </p>
        {/if}
      </div>
    </header>

    <div class="tabs" role="tablist" aria-label="Části týmu">
      <button type="button" role="tab" aria-selected={tab === 'stats'} onclick={() => (tab = 'stats')}>Statistiky</button>
      <button type="button" role="tab" aria-selected={tab === 'games'} onclick={() => (tab = 'games')}>Zápasy</button>
      <button type="button" role="tab" aria-selected={tab === 'roster'} onclick={() => (tab = 'roster')}>Soupiska</button>
    </div>

    {#if tab === 'stats'}
      <div in:fade={{ duration: 150 }}>
        <Filters bind:from bind:to bind:minPa showTeam={false} onchange={loadStats} />
        {#if statsError}
          <p class="empty">{statsError}</p>
        {:else if rows === null}
          <p class="muted">Načítám…</p>
        {:else}
          <StatTable
            {rows}
            rowKey={(r) => r.player_id}
            {columns}
            nameLabel="Hráč"
            nameSort={(r) => league.player(r.player_id)?.name ?? ''}
            sortKey="ops"
            caption="Statistiky hráčů {team.name}"
            totals={totals ? { label: 'Tým celkem', row: totals as unknown as PlayerTotals } : null}
            empty="Pro tento výběr zatím nejsou žádné statistiky."
          >
            {#snippet name(r)}
              {@const pl = league.player(r.player_id)}
              <a class="pl" href="/hraci/{r.player_id}">{pl?.name ?? '?'}{#if pl?.jersey_number != null}<span class="num">#{pl.jersey_number}</span>{/if}</a>
            {/snippet}
          </StatTable>
          {#if minPa > 0 && totals}
            <p class="note muted">Řádek „Tým celkem“ zahrnuje všechny hráče, i ty pod limitem PA.</p>
          {/if}
        {/if}
      </div>
    {:else if tab === 'games'}
      <div class="panel list" in:fade={{ duration: 150 }}>
        {#each games as g (g.id)}
          <GameRow game={g} recorded={league.recorded.get(g.id) ?? 0} focusTeam={id} />
        {:else}
          <p class="empty">Žádné zápasy.</p>
        {/each}
      </div>
    {:else}
      <div in:fade={{ duration: 150 }}>
        <form class="add" onsubmit={submitNew}>
          <input class="input" placeholder="Příjmení Jméno" bind:value={newName} required minlength="2" maxlength="60" aria-label="Jméno nového hráče" />
          <input class="input num-in" placeholder="Číslo" inputmode="numeric" bind:value={newNumber} aria-label="Číslo dresu" />
          <button type="submit" class="btn btn-primary" disabled={busy}><Icon name="plus" size={18} /> Přidat hráče</button>
        </form>

        <ul class="roster">
          {#each roster as p (p.id)}
            <li class:inactive={!p.active} transition:slide={{ duration: 160 }}>
              {#if editing === p.id}
                <form class="edit" onsubmit={(e) => saveEdit(e, p)}>
                  <input class="input num-in" bind:value={editNumber} inputmode="numeric" aria-label="Číslo dresu" />
                  <input class="input" bind:value={editName} required minlength="2" maxlength="60" aria-label="Jméno" />
                  <button type="submit" class="btn btn-primary" disabled={busy} aria-label="Uložit"><Icon name="check" size={18} /></button>
                  <button type="button" class="btn btn-quiet" onclick={() => (editing = null)} aria-label="Zrušit"><Icon name="close" size={18} /></button>
                </form>
              {:else}
                <span class="jn">{p.jersey_number ?? '–'}</span>
                <a class="pn" href="/hraci/{p.id}">{p.name}</a>
                <span class="src">{p.source === 'manual' ? 'přidán ručně' : ''}{!p.active ? ' mimo soupisku' : ''}</span>
                <span class="acts">
                  <button type="button" class="btn btn-quiet" onclick={() => startEdit(p)} aria-label="Upravit {p.name}"><Icon name="pencil" size={18} /></button>
                  <button type="button" class="btn btn-quiet" disabled={busy} onclick={() => toggleActive(p)}>
                    {p.active ? 'Vyřadit' : 'Vrátit'}
                  </button>
                </span>
              {/if}
            </li>
          {/each}
        </ul>
        <p class="note muted">
          Soupisky se každých 6 hodin přebírají ze softball.cz. Ruční úpravy import nepřepíše. Vyřazený hráč zůstává ve statistikách.
        </p>
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
  .head {
    display: flex;
    align-items: center;
    gap: 18px;
    padding-bottom: 18px;
    border-bottom: 4px solid var(--team);
  }
  .head h1 {
    font-size: clamp(32px, 8vw, 56px);
  }
  .rec {
    margin: 8px 0 0;
    color: var(--muted);
  }
  .pos {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 20px;
    color: var(--ink);
  }
  .tabs {
    display: flex;
    gap: 4px;
    margin: 18px 0;
    border-bottom: 1px solid var(--line);
  }
  .tabs button {
    all: unset;
    cursor: pointer;
    padding: 10px 12px;
    font-weight: 600;
    color: var(--muted);
    border-bottom: 3px solid transparent;
    margin-bottom: -1px;
  }
  .tabs button[aria-selected='true'] {
    color: var(--ink);
    border-bottom-color: var(--amber);
  }
  .tabs button:focus-visible {
    outline: 2px solid var(--focus);
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
  .note {
    font-size: 13px;
    margin-top: 10px;
  }
  .list {
    overflow: hidden;
  }
  .list :global(.row:last-child) {
    border-bottom: none;
  }

  .add {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 14px;
  }
  .add .input {
    flex: 1 1 200px;
  }
  .num-in {
    flex: 0 0 76px;
    width: 76px;
  }
  .roster {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-m);
    background: var(--surface);
  }
  .roster li {
    display: grid;
    grid-template-columns: 36px 1fr auto auto;
    align-items: center;
    gap: 10px;
    padding: 6px 8px 6px 12px;
    border-bottom: 1px solid var(--line);
    min-height: 52px;
  }
  .roster li:last-child {
    border-bottom: none;
  }
  .roster li.inactive {
    color: var(--faint);
  }
  .jn {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 20px;
    text-align: center;
  }
  .pn {
    font-weight: 600;
    text-decoration: none;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inactive .pn {
    font-weight: 400;
    text-decoration: line-through;
  }
  .src {
    font-size: 12px;
    color: var(--faint);
  }
  .acts {
    display: flex;
    gap: 2px;
  }
  .edit {
    grid-column: 1 / -1;
    display: flex;
    gap: 6px;
  }
  .edit .input:not(.num-in) {
    flex: 1;
    min-width: 0;
  }
  @media (max-width: 520px) {
    .src {
      display: none;
    }
    .roster li {
      grid-template-columns: 32px 1fr auto;
    }
  }
</style>
