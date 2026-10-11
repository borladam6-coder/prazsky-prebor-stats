<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  import { goto } from '$app/navigation';
  import { league } from '#lib/league.svelte.ts';
  import { month, day, isoDay } from '#lib/format.ts';
  import GameRow from '#lib/components/GameRow.svelte';
  import TeamBadge from '#lib/components/TeamBadge.svelte';
  import Icon from '#lib/components/Icon.svelte';
  import { TEST_GAME_ID } from '#lib/testgame.ts';

  type View = 'odehrane' | 'nadchazejici' | 'vse';
  /** games with our own statistics (live or entered) vs. only the result from softball.cz */
  type Record = 'vse' | 'ano' | 'ne';

  onMount(() => {
    league.loadRecorded().catch(() => {});
  });

  const teamId = $derived(Number(page.url.searchParams.get('tym')) || null);
  const view = $derived((page.url.searchParams.get('stav') as View) || 'odehrane');
  const record = $derived((page.url.searchParams.get('zapis') as Record) || 'vse');

  function setParam(key: string, value: string | null) {
    const url = new URL(page.url.href);
    if (value === null) url.searchParams.delete(key);
    else url.searchParams.set(key, value);
    goto(url, { replace: true, reset: false });
  }

  const games = $derived.by(() => {
    let list = league.games.filter((g) => !teamId || g.home_team_id === teamId || g.away_team_id === teamId);
    if (view === 'odehrane') list = list.filter((g) => g.status === 'played');
    if (view === 'nadchazejici') list = list.filter((g) => g.status !== 'played');
    if (view !== 'nadchazejici' && record !== 'vse') {
      const want = record === 'ano';
      list = list.filter((g) => (league.recorded.get(g.id) ?? 0) > 0 === want && (want || g.status === 'played'));
    }
    const dir = view === 'nadchazejici' ? 1 : -1;
    return [...list].sort((a, b) => (a.starts_at ?? '9999').localeCompare(b.starts_at ?? '9999') * dir);
  });

  /** months, and in each month one card per day */
  const groups = $derived.by(() => {
    const out: { label: string; days: { key: string; label: string; items: typeof games }[] }[] = [];
    for (const g of games) {
      const label = month(g.starts_at);
      let m = out.at(-1);
      if (!m || m.label !== label) out.push((m = { label, days: [] }));
      const key = isoDay(g.starts_at) ?? 'none';
      const d = m.days.at(-1);
      if (d && d.key === key) d.items.push(g);
      else m.days.push({ key, label: day(g.starts_at), items: [g] });
    }
    return out;
  });
  let helpOpen = $state(false);

  const views: { id: View; label: string }[] = [
    { id: 'odehrane', label: 'Odehrané' },
    { id: 'nadchazejici', label: 'Nadcházející' },
    { id: 'vse', label: 'Vše' }
  ];
  const records: { id: Record; label: string }[] = [
    { id: 'vse', label: 'Všechny' },
    { id: 'ano', label: 'Se zápisem' },
    { id: 'ne', label: 'Jen výsledek' }
  ];
</script>

<svelte:head>
  <title>Zápasy – Pražský přebor mužů</title>
</svelte:head>

<div class="page">
  <div class="head">
    <h1>Zápasy</h1>
    <button type="button" class="help-btn" aria-expanded={helpOpen} aria-label="Co znamenají značky" onclick={() => (helpOpen = !helpOpen)}><Icon name="help" size={20} /></button>
  </div>
  {#if helpOpen}
    <div class="legend card">
      <p>Klepnutím na zápas otevřeš box score, průběh a zápis statistik.</p>
      <ul>
        <li><span class="lm ok"><Icon name="check" size={13} /></span> statistiky zapsané za oba týmy</li>
        <li><span class="lm half">1/2</span> zapsaný jen jeden tým</li>
        <li><span class="lm none">–</span> jen výsledek ze softball.cz</li>
        <li><span class="lm warn"><Icon name="warn" size={13} /></span> runs v zápisu nesedí s výsledkem svazu</li>
      </ul>
    </div>
  {/if}

  <div class="filters">
    <div class="viewrow">
      <div class="seg views" role="group" aria-label="Které zápasy">
        {#each views as v (v.id)}
          <button type="button" aria-pressed={view === v.id} onclick={() => setParam('stav', v.id === 'odehrane' ? null : v.id)}>
            {v.label}
          </button>
        {/each}
      </div>
      {#if view !== 'nadchazejici'}
        <details class="recpick">
          <summary class="chip" class:on={record !== 'vse'}>
            {records.find((r) => r.id === record)?.label}<Icon name="down" size={14} />
          </summary>
          <div class="menu card" role="group" aria-label="Statistiky zápasu">
            {#each records as r (r.id)}
              <button
                type="button"
                aria-pressed={record === r.id}
                onclick={(e) => { setParam('zapis', r.id === 'vse' ? null : r.id); (e.currentTarget.closest('details') as HTMLDetailsElement).open = false; }}
              >{r.label}</button>
            {/each}
          </div>
        </details>
      {/if}
    </div>

    <div class="teams" role="group" aria-label="Tým">
      <button type="button" class="chip" aria-pressed={teamId === null} onclick={() => setParam('tym', null)}>Všechny týmy</button>
      {#each league.teams as t (t.id)}
        <button type="button" class="chip team" aria-pressed={teamId === t.id} onclick={() => setParam('tym', String(t.id))}>
          <TeamBadge team={t} size={20} />
          {t.short_name ?? t.name}
        </button>
      {/each}
    </div>
  </div>

  {#if groups.length === 0}
    <p class="empty">{record !== 'vse' && !league.recordedLoaded ? 'Načítám…' : 'Žádné zápasy pro tento výběr.'}</p>
  {:else}
    {#each groups as grp (grp.label)}
      <section class="month">
        <h2>{grp.label}</h2>
        <div class="days">
          {#each grp.days as d, i (d.key)}
            <div class="card daycard rise" style:--i={Math.min(i, 8)}>
              <div class="dh">{d.label}</div>
              {#each d.items as g (g.id)}
                <GameRow game={g} recorded={league.recorded.get(g.id) ?? 0} focusTeam={teamId} />
              {/each}
            </div>
          {/each}
        </div>
      </section>
    {/each}
  {/if}

  {#if league.game(TEST_GAME_ID)}
    <a class="card try" href="/zapasy/{TEST_GAME_ID}/zive">
      <span class="ti"><Icon name="live" size={22} /></span>
      <span class="tt">
        <strong>Vyzkoušet živý zápis</strong>
        <span class="muted">Testovací zápas s vymyšlenými týmy, nic se nezapočítává.</span>
      </span>
      <Icon name="chevron" size={20} />
    </a>
  {/if}
</div>

<style>
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-bottom: 18px;
  }
  .help-btn {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--muted);
    cursor: pointer;
  }
  .help-btn[aria-expanded='true'] {
    color: var(--ink);
    border-color: var(--line-strong);
  }
  .legend {
    padding: 14px 16px;
    margin-bottom: 18px;
    font-size: 14px;
  }
  .legend p {
    margin: 0 0 8px;
  }
  .legend ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 6px;
    color: var(--muted);
  }
  .legend li {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .lm {
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    border-radius: 50%;
    font-size: 10px;
    font-weight: 800;
  }
  .lm.ok {
    color: var(--hit);
    background: var(--hit-soft);
  }
  .lm.half {
    background: var(--surface-3);
  }
  .lm.warn {
    color: var(--warn);
    background: var(--warn-soft);
  }
  .viewrow {
    display: flex;
    align-items: flex-end;
    gap: 10px;
  }
  .viewrow .seg {
    flex: 1;
    min-width: 0;
    flex-wrap: nowrap;
    overflow-x: auto;
    scrollbar-width: none;
  }
  .viewrow .seg button {
    padding-inline: 10px;
  }
  .recpick {
    position: relative;
    margin-bottom: 4px;
  }
  .recpick summary {
    list-style: none;
    gap: 4px;
    min-height: 34px;
    padding: 4px 10px 4px 12px;
    font-size: 13px;
  }
  .recpick summary::-webkit-details-marker {
    display: none;
  }
  .recpick summary.on {
    background: var(--accent-soft);
    border-color: color-mix(in srgb, var(--accent) 70%, transparent);
    color: var(--ink);
  }
  .recpick .menu {
    position: absolute;
    right: 0;
    top: calc(100% + 6px);
    z-index: 10;
    display: grid;
    min-width: 170px;
    padding: 6px;
  }
  .recpick .menu button {
    padding: 10px 12px;
    border: 0;
    border-radius: 10px;
    background: transparent;
    text-align: left;
    font-weight: 600;
    cursor: pointer;
  }
  .recpick .menu button:hover {
    background: var(--surface-2);
  }
  .recpick .menu button[aria-pressed='true'] {
    background: var(--accent-soft);
  }
  .days {
    display: grid;
    gap: 12px;
  }
  .daycard {
    overflow: hidden;
    padding-bottom: 4px;
  }
  .dh {
    padding: 10px 14px 4px;
    font-size: 12.5px;
    font-weight: 800;
    color: var(--muted);
    text-transform: capitalize;
  }
  .daycard :global(.row + .row) {
    border-top: 1px solid var(--line);
  }
  .try {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 14px;
    margin: 32px 0 0;
    padding: 14px 16px;
    text-decoration: none;
    color: var(--ink);
    border-style: dashed;
    border-color: color-mix(in srgb, var(--accent) 60%, var(--line));
    transition: border-color 160ms, transform 160ms;
  }
  .try:hover {
    border-color: var(--accent);
    transform: translateY(-1px);
  }
  .ti {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border-radius: 14px;
    background: var(--accent-soft);
    color: var(--accent-text);
  }
  .tt {
    display: grid;
    gap: 2px;
    font-size: 14px;
  }
  .tt strong {
    font-size: 16px;
  }
  .filters {
    display: grid;
    gap: 12px;
    margin-bottom: 8px;
  }

  .teams {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    margin: 0 calc(var(--gutter) * -1);
    padding: 2px var(--gutter) 6px;
    scrollbar-width: none;
  }
  .teams::-webkit-scrollbar {
    display: none;
  }
  .chip.team {
    padding-left: 6px;
  }
  .month {
    margin-top: 32px;
  }
  .month h2 {
    margin-bottom: 14px;
  }
  @media (min-width: 900px) {
    .days {
      grid-template-columns: repeat(2, minmax(0, 1fr));
      align-items: start;
    }
  }
</style>
