<script lang="ts">
  // Corrections of one play of the live scoring: result and RBI, runs in its inning,
  // delete the play, or rewind the game to it. Everything is logged and revertable.
  import { untrack } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { league } from '../league.svelte.ts';
  import { RESULTS } from '../stats.ts';
  import type { PlayItem } from '../plays.ts';
  import type { PaResult, PlateAppearance } from '../types.ts';
  import Icon from './Icon.svelte';

  let {
    play,
    pa,
    awayTeamId,
    isLatest,
    canRewind = true,
    busy = false,
    onsaveresult,
    onadjust,
    ondelete,
    onrewind,
    oncanceladjust,
    onclose
  }: {
    play: PlayItem;
    /** current plate appearance of the play (null for runner-only plays) */
    pa: PlateAppearance | null;
    awayTeamId: number | undefined;
    isLatest: boolean;
    /** rewinding needs a running live scoring (finished sessions cannot be rewound) */
    canRewind?: boolean;
    busy?: boolean;
    onsaveresult: (pa: PlateAppearance, result: PaResult, rbi: number) => void;
    onadjust: (playerId: string, delta: 1 | -1) => void;
    ondelete: () => void;
    onrewind: () => void;
    oncanceladjust: () => void;
    onclose: () => void;
  } = $props();

  let result = $state<PaResult>(untrack(() => pa?.result ?? '1B'));
  let rbi = $state(untrack(() => pa?.rbi ?? 0));
  let addPlayer = $state('');
  let confirm = $state<'delete' | 'rewind' | null>(null);

  const changed = $derived(!!pa && (result !== pa.result || rbi !== pa.rbi));
  const team = $derived(league.team(play.teamId));
  const roster = $derived(
    league.players
      .filter((p) => p.team_id === play.teamId && p.active)
      .sort((a, b) => a.name.localeCompare(b.name, 'cs'))
  );
  const name = (pid: string | null) => league.player(pid)?.name ?? '?';
  const minRbi = $derived(result === 'HR' || result === 'SF' ? 1 : 0);

  $effect(() => {
    if (rbi < minRbi) rbi = minRbi;
  });
</script>

<div class="backdrop" transition:fade={{ duration: 150 }} onclick={onclose} aria-hidden="true"></div>
<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="edit-title" transition:fly={{ y: 40, duration: 220 }}>
  <header>
    <div>
      <h2 id="edit-title">{play.kind === 'adjust' ? 'Oprava doběhů' : 'Upravit akci'}</h2>
      <p class="muted sub">
        {play.inning}. směna {play.teamId === awayTeamId ? '▲' : '▼'} · {team?.short_name ?? team?.name}
        {#if play.kind === 'play'} · {play.result ? `${name(play.batter)}: ${play.result}` : 'pohyb běžců'}{/if}
      </p>
    </div>
    <button type="button" class="x" aria-label="Zavřít" onclick={onclose}><Icon name="close" size={20} /></button>
  </header>

  {#if play.kind === 'adjust'}
    <p>
      {#if play.scored.length}Přidaný doběh: <strong>{name(play.scored[0])}</strong>{/if}
      {#if play.removed.length}Odebraný doběh: <strong>{name(play.removed[0])}</strong>{/if}
    </p>
    <div class="actions">
      <button type="button" class="btn btn-quiet" onclick={onclose}>Zavřít</button>
      <button type="button" class="btn" disabled={busy} onclick={oncanceladjust}><Icon name="undo" size={18} /> Zrušit tuto opravu</button>
    </div>
  {:else}
    {#if pa}
      <section>
        <h3>Výsledek pálkaře</h3>
        <div class="row">
          <select class="select" bind:value={result} aria-label="Výsledek">
            {#each RESULTS as r (r.code)}<option value={r.code}>{r.code} – {r.label}</option>{/each}
          </select>
          <span class="step" aria-label="RBI">
            <span class="sl">RBI</span>
            <button type="button" aria-label="Ubrat RBI" disabled={rbi <= minRbi} onclick={() => rbi--}><Icon name="minus" size={16} /></button>
            <span class="val">{rbi}</span>
            <button type="button" aria-label="Přidat RBI" disabled={rbi >= 4} onclick={() => rbi++}><Icon name="plus" size={16} /></button>
          </span>
        </div>
        <button type="button" class="btn btn-primary btn-sm save" disabled={!changed || busy} onclick={() => onsaveresult(pa, result, rbi)}>
          <Icon name="check" size={16} /> Uložit výsledek
        </button>
        <p class="hint muted">Mění jen statistiku pálkaře. Pozice běžců na metách zůstanou.</p>
      </section>
    {:else if play.result}
      <p class="hint muted">Zápis tohoto pálkaře už byl smazaný.</p>
    {/if}

    <section>
      <h3>Doběhy v {play.inning}. směně</h3>
      {#if play.scored.length}
        <ul class="runs">
          {#each play.scored as pid, i (pid + i)}
            <li>
              <span>{name(pid)}</span>
              <button type="button" class="btn btn-quiet btn-sm" disabled={busy} onclick={() => onadjust(pid, -1)}>−1 doběh</button>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="hint muted">V této akci nikdo nedoběhl.</p>
      {/if}
      <div class="row">
        <select class="select" bind:value={addPlayer} aria-label="Hráč, kterému přidat doběh">
          <option value="">Přidat doběh hráči…</option>
          {#each roster as p (p.id)}<option value={p.id}>{p.jersey_number != null ? `#${p.jersey_number} ` : ''}{p.name}</option>{/each}
        </select>
        <button type="button" class="btn btn-sm" disabled={!addPlayer || busy} onclick={() => { onadjust(addPlayer, 1); addPlayer = ''; }}>
          <Icon name="plus" size={16} /> Doběh
        </button>
      </div>
      <p class="hint muted">Oprava se zapíše do {play.inning}. směny, takže sedí i skóre po směnách.</p>
    </section>

    <section class="danger">
      {#if confirm === 'delete'}
        <p><strong>Smazat tuto akci?</strong> Zmizí její zápis pálkaře, doběhy i ukradené mety. Stav na metách se nemění.</p>
        <div class="actions">
          <button type="button" class="btn btn-quiet" onclick={() => (confirm = null)}>Ne</button>
          <button type="button" class="btn danger-btn" disabled={busy} onclick={ondelete}>Ano, smazat akci</button>
        </div>
      {:else if confirm === 'rewind'}
        <p><strong>Vrátit zápis k této akci?</strong> Všechny pozdější akce zápasu se vrátí a zápis bude pokračovat odsud.</p>
        <div class="actions">
          <button type="button" class="btn btn-quiet" onclick={() => (confirm = null)}>Ne</button>
          <button type="button" class="btn danger-btn" disabled={busy} onclick={onrewind}>Ano, vrátit sem</button>
        </div>
      {:else}
        <div class="actions start">
          <button type="button" class="btn btn-sm" onclick={() => (confirm = 'delete')}><Icon name="trash" size={16} /> Smazat akci</button>
          {#if canRewind && !isLatest}
            <button type="button" class="btn btn-sm" onclick={() => (confirm = 'rewind')}><Icon name="undo" size={16} /> Vrátit zápis sem</button>
          {/if}
        </div>
        <p class="hint muted">Všechno se zapíše do historie a dá se vrátit.</p>
      {/if}
    </section>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    background: rgb(5 10 8 / 0.55);
    backdrop-filter: blur(2px);
  }
  .sheet {
    position: fixed;
    z-index: 41;
    left: 0;
    right: 0;
    bottom: 0;
    max-height: 88dvh;
    overflow-y: auto;
    padding: 18px 16px calc(16px + env(safe-area-inset-bottom));
    border-radius: 24px 24px 0 0;
    background: var(--surface);
    border: 1px solid var(--line-strong);
    box-shadow: var(--shadow);
  }
  @media (min-width: 640px) {
    .sheet {
      left: 50%;
      right: auto;
      bottom: 50%;
      width: min(540px, calc(100vw - 32px));
      transform: translate(-50%, 50%);
      border-radius: 24px;
    }
  }
  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  h2 {
    font-size: 22px;
  }
  .sub {
    margin: 4px 0 0;
    font-size: 14px;
  }
  .x {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    flex: none;
    border-radius: 50%;
    border: 0;
    background: var(--surface-2);
    cursor: pointer;
  }
  section {
    margin-top: 16px;
    padding: 14px;
    border-radius: 16px;
    background: var(--surface-2);
    border: 1px solid var(--line);
  }
  h3 {
    font-size: 15px;
    margin-bottom: 10px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  .row .select {
    flex: 1 1 200px;
    min-width: 0;
  }
  .step {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .sl {
    font-size: 13px;
    font-weight: 700;
    color: var(--muted);
  }
  .step button {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    border: 0;
    background: var(--surface-3);
    color: var(--ink);
    cursor: pointer;
  }
  .step button[disabled] {
    opacity: 0.35;
  }
  .val {
    min-width: 18px;
    text-align: center;
    font-weight: 800;
    font-size: 18px;
  }
  .save {
    margin-top: 10px;
  }
  .hint {
    margin: 8px 0 0;
    font-size: 13px;
  }
  .runs {
    list-style: none;
    margin: 0 0 10px;
    padding: 0;
    display: grid;
    gap: 4px;
  }
  .runs li {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-weight: 700;
  }
  .danger {
    border-color: color-mix(in srgb, var(--neg) 35%, var(--line));
  }
  .danger p {
    margin: 0 0 10px;
    font-size: 14px;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 12px;
  }
  .actions.start {
    justify-content: flex-start;
    margin-top: 0;
  }
  .danger-btn {
    background: var(--neg);
    border-color: var(--neg);
    color: #fff;
  }
</style>
