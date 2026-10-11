<script lang="ts">
  // "What happened to the runners?" Prefilled with the usual outcome; one tap per change.
  // Only destinations that are possible are offered (nobody ends behind a runner who was
  // behind him), and moving a runner up pushes the runners ahead of him.
  // An out in the field first asks how it happened (fly, ground, double play, bunt …);
  // the official result (OUT, SF, SH, FC) and the RBI follow from that automatically.
  import { untrack } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import { league } from '../league.svelte.ts';
  import { resultDef } from '../stats.ts';
  import { outsWord, plural } from '../format.ts';
  import {
    applyPlay, batterChoices, cascade, defaultFieldOut, defaultPlay, defaultRbi, destLabel, fieldOutBatterChoices,
    fieldOutLabel, fieldOutResult, fieldOutsFor, FIELD_OUTS, occupied, outsOn, runnerOptions, runsOn, validatePlay,
    type Base, type Bases, type Dest, type FieldOut, type Play
  } from '../live.ts';
  import type { PaResult } from '../types.ts';
  import { FIELD_POSITIONS, type FieldPos } from '../narrate.ts';
  import Icon from './Icon.svelte';

  let {
    result,
    bases,
    outs,
    inning,
    nextSlot,
    lineup,
    runnerFrom = null,
    detailed = false,
    busy = false,
    onconfirm,
    oncancel
  }: {
    result: PaResult | null;
    bases: Bases;
    outs: number;
    inning: number;
    nextSlot: number;
    lineup: string[];
    /** runner-only play started by tapping this runner */
    runnerFrom?: Base | null;
    /** detailed scoring: where the ball went (optional) and every out asks how */
    detailed?: boolean;
    busy?: boolean;
    onconfirm: (play: Play) => void;
    oncancel: () => void;
  } = $props();

  function initial(): Play {
    if (result) return defaultPlay(result, bases, outs);
    // runner-only play: the tapped runner steals the next base; runners ahead of him
    // move up one base when he would land on them, everybody else stays
    const to = new Map<Base, Dest>(occupied(bases).map((b) => [b, b as Dest]));
    if (runnerFrom) {
      let target = runnerFrom + 1;
      to.set(runnerFrom, target as Dest);
      while (target <= 3 && bases[target - 1]) {
        to.set(target as Base, (target + 1) as Dest);
        target++;
      }
    }
    return {
      result: null,
      batterTo: null,
      rbi: 0,
      runners: occupied(bases).map((b) => ({ from: b, to: to.get(b)!, sb: b === runnerFrom }))
    };
  }

  let play = $state<Play>(untrack(initial));
  let rbiTouched = $state(false);

  /** an out in the field with runners on base: first say how it happened */
  const fieldMode = untrack(() => result === 'OUT');
  let kind = $state<FieldOut | null>(null);
  const kinds = untrack(() => fieldOutsFor(bases, outs, detailed));

  /** simple scoring with empty bases: the kind is all there is to say, one tap saves */
  const oneTap = untrack(() => fieldMode && !detailed && occupied(bases).length === 0);

  function chooseKind(k: FieldOut) {
    kind = k;
    play = { ...defaultFieldOut(k, bases, outs), location: play.location ?? null };
    rbiTouched = false;
    if (oneTap && !busy && !validatePlay(play, bases, outs)) onconfirm($state.snapshot(play) as Play);
  }

  /** where the ball went: only for balls in play, only in the detailed scoring, never required */
  const askWhere = untrack(() => detailed && !!result && ['1B', '2B', '3B', 'HR', 'OUT', 'ROE'].includes(result));
  function setWhere(pos: FieldPos) {
    play = { ...play, location: play.location === pos ? null : pos };
  }

  /** after any change: push runners ahead, recompute the official result and the RBI */
  function settle(next: Play) {
    let p = cascade(next);
    if (fieldMode && kind) p = { ...p, result: fieldOutResult(kind, p, outs) };
    play = p;
    syncRbi();
  }

  const batter = $derived(league.player(lineup[nextSlot]));
  const error = $derived(validatePlay(play, bases, outs));
  const runs = $derived(runsOn(play));
  const after = $derived(applyPlay({ inning, outs, bases, nextSlot }, lineup, play));

  function setRunner(from: Base, to: Dest) {
    settle({
      ...play,
      runners: play.runners.map((r) => {
        if (r.from !== from) return r;
        // a stolen base needs a runner-only play and an advance; the tapped runner gets SB by default
        const advancing = !play.result && to > from;
        const sb = advancing && (!!r.sb || (r.from === runnerFrom && !(r.to > r.from)));
        return { ...r, to, sb };
      })
    });
  }

  function toggleSb(from: Base) {
    play.runners = play.runners.map((r) => (r.from === from ? { ...r, sb: !r.sb } : r));
  }

  function setBatter(to: Dest) {
    settle({ ...play, batterTo: to });
  }

  function syncRbi() {
    if (!rbiTouched) play.rbi = defaultRbi(play);
  }

  function changeRbi(delta: number) {
    rbiTouched = true;
    play.rbi = Math.max(0, Math.min(4, runs, play.rbi + delta));
  }

  function basesText(b: (string | null)[]) {
    const on = b.map((x, i) => (x ? `${i + 1}.` : null)).filter((x): x is string => !!x);
    if (on.length === 0) return 'mety prázdné';
    if (on.length === 3) return 'plné mety';
    return `běžec na ${on.join(' a ')} metě`;
  }

  const name = (id: string | null | undefined) => league.player(id)?.name ?? '?';
  const title = $derived.by(() => {
    if (!result) return 'Pohyb běžců';
    if (fieldMode) return kind ? `Out v poli · ${fieldOutLabel(kind, bases).label}` : 'Out v poli';
    const label = resultDef(result)?.label ?? result;
    return label.toUpperCase() === result ? label : `${result} – ${label}`;
  });
  const recorded = $derived(play.result ? `${play.result} – ${resultDef(play.result)?.label ?? ''}` : null);
  const batterOptions = $derived(fieldMode && kind ? fieldOutBatterChoices(kind) : result ? batterChoices(result) : []);

  function submit(e: SubmitEvent) {
    e.preventDefault();
    if (!error && !busy && (!fieldMode || kind)) onconfirm($state.snapshot(play) as Play);
  }
</script>

<div class="backdrop" transition:fade={{ duration: 150 }} onclick={oncancel} aria-hidden="true"></div>
<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" transition:fly={{ y: 40, duration: 220 }}>
<form onsubmit={submit}>
  <header>
    <h2 id="sheet-title">{title}</h2>
    <button type="button" class="x" aria-label="Zavřít" onclick={oncancel}><Icon name="close" size={20} /></button>
  </header>

  {#if askWhere}
    <div class="where">
      <span class="wl">Kam <span class="muted">(nepovinné)</span></span>
      <div class="wpos" role="group" aria-label="Kam letěl míč">
        {#each FIELD_POSITIONS as f (f.pos)}
          <button type="button" class="wp" aria-pressed={play.location === f.pos} title={f.label} onclick={() => setWhere(f.pos)}>{f.pos}</button>
        {/each}
        <button type="button" class="wp none" aria-pressed={!play.location} onclick={() => (play = { ...play, location: null })}>Neuvádět</button>
      </div>
    </div>
  {/if}

  {#if fieldMode}
    {#if !kind}<p class="ask muted">{oneTap ? 'Jak byl pálkař vyautován? Klepnutím se out uloží.' : 'Jak k outu došlo? Podle toho se předvyplní běžci a výsledek se zapíše sám.'}</p>{/if}
    <div class="kinds" class:compact={!!kind} class:big={oneTap} role="group" aria-label="Druh outu">
      {#each FIELD_OUTS.filter((f) => kinds.includes(f.kind)) as f (f.kind)}
        {@const l = fieldOutLabel(f.kind, bases)}
        <button type="button" class="kind" aria-pressed={kind === f.kind} disabled={oneTap && busy} onclick={() => chooseKind(f.kind)}>
          <strong>{l.label}</strong>
          {#if !kind}<span>{l.hint}</span>{/if}
        </button>
      {/each}
    </div>
  {:else}
    <p class="ask muted">Co se stalo{result ? ' s pálkařem a běžci' : ' s běžci'}? Nabízí se jen to, co je možné.</p>
  {/if}

  {#if !fieldMode || kind}
  <div class="rows">
    {#if result && play.batterTo !== null}
      <fieldset class="row">
        <legend><span class="tag">Pálkař</span> {name(batter?.id)}</legend>
        <div class="choices">
          {#each batterOptions as d (d)}
            <button type="button" class="ch" class:out={d === 0} class:home={d === 4} aria-pressed={play.batterTo === d} onclick={() => setBatter(d)}>
              {d === 0 ? 'Out' : d === 4 ? 'Scored' : `${d}. meta`}
            </button>
          {/each}
        </div>
      </fieldset>
    {/if}

    {#each [...play.runners].sort((a, b) => b.from - a.from) as r (r.from)}
      <fieldset class="row">
        <legend><span class="tag">z {r.from}.</span> {name(bases[r.from - 1])}</legend>
        <div class="choices">
          {#each runnerOptions(r.from, play) as d (d)}
            <button type="button" class="ch" class:out={d === 0} class:home={d === 4} aria-pressed={r.to === d} onclick={() => setRunner(r.from, d)}>
              {destLabel(d, r.from)}
            </button>
          {/each}
        </div>
        {#if !result && r.to > r.from}
          <label class="sb">
            <input type="checkbox" checked={!!r.sb} onchange={() => toggleSb(r.from)} />
            Stolen base (SB) – jinak postup na error, wild pitch, passed ball apod.
          </label>
        {/if}
      </fieldset>
    {/each}

    {#if result}
      <div class="rbi">
        <span><strong>RBI</strong> <span class="muted">– runs batted in</span></span>
        <span class="step">
          <button type="button" aria-label="Ubrat RBI" disabled={play.rbi <= 0} onclick={() => changeRbi(-1)}><Icon name="minus" size={18} /></button>
          <span class="val">{play.rbi}</span>
          <button type="button" aria-label="Přidat RBI" disabled={play.rbi >= Math.min(4, runs)} onclick={() => changeRbi(1)}><Icon name="plus" size={18} /></button>
        </span>
      </div>
    {/if}
  </div>

  {/if}

  <!-- what will be recorded stays in view next to the confirm button -->
  <div class="foot">
    {#if !fieldMode || kind}
      <p class="preview" aria-live="polite">
        {#if fieldMode && recorded}<span class="derived">Zapíše se <strong>{recorded}</strong></span>{/if}
        {#if runs}<span class="pill pos">+{runs} {plural(runs, ['run', 'runs', 'runs'])}</span>{/if}
        {#if outsOn(play)}<span class="pill out">{outsWord(outsOn(play))}</span>{/if}
        {#if after.inningOver}
          <span class="end">Konec {inning}. směny</span>
        {:else}
          <span class="muted">Potom {outsWord(after.outs)}, {basesText(after.bases)}</span>
        {/if}
      </p>
    {/if}
    {#if error && (!fieldMode || kind)}<p class="err" role="alert"><Icon name="warn" size={15} /> {error}</p>{/if}
    <div class="actions">
      <button type="button" class="btn btn-quiet" onclick={oncancel}>Zrušit</button>
      {#if !oneTap}
        <button type="submit" class="btn btn-primary" disabled={!!error || busy || (fieldMode && !kind)}><Icon name="check" size={18} /> Uložit</button>
      {/if}
    </div>
  </div>
</form>
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
    padding: 18px 16px 0;
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
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  h2 {
    font-size: 22px;
  }
  .x {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 0;
    background: var(--surface-2);
    cursor: pointer;
  }
  .ask {
    margin: 6px 0 14px;
    font-size: 14px;
  }
  .where {
    display: grid;
    gap: 6px;
    margin: 4px 0 14px;
  }
  .wl {
    font-size: 13px;
    font-weight: 800;
  }
  .wpos {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 6px;
  }
  .wp {
    min-height: 40px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--ink);
    font-weight: 800;
    font-size: 14px;
    cursor: pointer;
  }
  .wp[aria-pressed='true'] {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--ink);
  }
  .wp.none {
    padding: 0 2px;
    font-weight: 700;
    font-size: 11.5px;
    color: var(--muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .kinds {
    display: grid;
    gap: 8px;
    margin-bottom: 14px;
  }
  @media (min-width: 520px) {
    .kinds {
      grid-template-columns: 1fr 1fr;
    }
  }
  .kind {
    display: grid;
    gap: 2px;
    padding: 12px 14px;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--ink);
    text-align: left;
    cursor: pointer;
    transition: border-color 140ms, background-color 140ms;
  }
  .kind strong {
    font-size: 16px;
  }
  /* one tap saves: two big buttons side by side */
  .kinds.big {
    grid-template-columns: 1fr 1fr;
  }
  .kinds.big .kind {
    min-height: 96px;
    align-content: center;
    padding: 16px;
  }
  .kinds.big .kind strong {
    font-size: 20px;
  }
  .kinds.compact {
    grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
    grid-auto-rows: 1fr;
    gap: 6px;
  }
  .kinds.compact .kind {
    padding: 8px 10px;
    text-align: center;
    align-content: center;
    line-height: 1.15;
  }
  .kinds.compact .kind strong {
    font-size: 13.5px;
  }
  .kind span {
    font-size: 12.5px;
    color: var(--muted);
    line-height: 1.35;
  }
  .kind[aria-pressed='true'] {
    border-color: var(--accent);
    background: var(--accent-soft);
  }
  .derived {
    flex-basis: 100%;
    font-size: 14px;
  }
  .rows {
    display: grid;
    gap: 12px;
  }
  .row {
    margin: 0;
    padding: 12px;
    border: 1px solid var(--line);
    border-radius: 16px;
    background: var(--surface-2);
    min-width: 0;
  }
  legend {
    float: left;
    width: 100%;
    margin-bottom: 10px;
    font-weight: 800;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tag {
    display: inline-block;
    margin-right: 6px;
    padding: 1px 8px;
    border-radius: 999px;
    background: var(--surface-3);
    color: var(--muted);
    font-size: 12px;
    font-weight: 700;
    vertical-align: 1px;
  }
  .choices {
    clear: both;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(76px, 1fr));
    gap: 6px;
  }
  .ch {
    min-height: 44px;
    padding: 6px 8px;
    border-radius: 12px;
    border: 1px solid var(--line);
    background: var(--surface);
    font-weight: 700;
    font-size: 14px;
    cursor: pointer;
    transition: background-color 140ms, border-color 140ms, color 140ms;
  }
  .ch {
    line-height: 1.15;
  }
  /* one selection style; only the outcome of a runner keeps its meaning colour */
  .ch[aria-pressed='true'] {
    background: var(--accent-soft);
    border-color: var(--accent);
    color: var(--ink);
  }
  .ch.out[aria-pressed='true'] {
    background: var(--out);
    border-color: var(--out);
    color: #fff;
  }
  .ch.home[aria-pressed='true'] {
    background: var(--hit);
    border-color: var(--hit);
    color: #06140c;
  }
  .sb {
    display: flex;
    gap: 8px;
    align-items: flex-start;
    margin-top: 10px;
    font-size: 13px;
    color: var(--muted);
  }
  .sb input {
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
    flex: none;
    margin: 0;
  }
  .rbi {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 8px 4px 0;
    font-size: 14px;
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
    cursor: pointer;
  }
  .step button[disabled] {
    opacity: 0.35;
    cursor: default;
  }
  .val {
    min-width: 20px;
    text-align: center;
    font-weight: 800;
    font-size: 20px;
  }
  .foot {
    position: sticky;
    bottom: 0;
    z-index: 2;
    margin: 14px -16px 0;
    padding: 10px 16px calc(12px + env(safe-area-inset-bottom));
    background: var(--surface);
    border-top: 1px solid var(--line);
  }
  .preview {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 8px;
    margin: 0 0 10px;
    font-size: 13.5px;
  }
  .pill.out {
    background: var(--out-soft);
    color: var(--out);
  }
  .end {
    font-weight: 700;
    color: var(--out);
  }
  .err {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 0 0 10px;
    color: var(--warn);
    font-weight: 600;
    font-size: 14px;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
  .actions .btn-primary {
    flex: 1 1 auto;
    max-width: 240px;
  }
</style>
