<script lang="ts">
  // Play-by-play of a live-scored game on the game page, with corrections: the result
  // and RBI of a play (e.g. a hit that was really an error), runs in an inning, deleting
  // the latest play or every play from one on. Works after the scoring ended too; the
  // scoring stays finished. Continuing the scoring itself is done on the live page.
  import {
    liveDeletePlay, liveDeleteFrom, liveAdjustRuns, updatePlateAppearance, revertGroup,
    errorMessage, isNetworkError, WriteCancelled
  } from '../api.ts';
  import { toasts } from '../toast.svelte.ts';
  import { plural } from '../format.ts';
  import type { PlayItem } from '../plays.ts';
  import type { PaResult, PlateAppearance } from '../types.ts';
  import PlayLog from './PlayLog.svelte';
  import EditPlaySheet from './EditPlaySheet.svelte';

  let {
    gameId,
    awayTeamId,
    plays,
    pas,
    onchanged
  }: {
    gameId: number;
    awayTeamId: number | undefined;
    plays: PlayItem[];
    pas: PlateAppearance[];
    onchanged: () => Promise<void> | void;
  } = $props();

  let editing = $state<PlayItem | null>(null);
  let busy = $state(false);
  const editingPa = $derived(editing?.paId ? (pas.find((p) => p.id === editing!.paId) ?? null) : null);
  const latestPlayId = $derived([...plays].reverse().find((p) => p.kind === 'play')?.id ?? null);
  const close = () => (editing = null);

  async function run<T>(action: () => Promise<T>, message: (r: T) => string) {
    if (busy) return;
    busy = true;
    try {
      const r = await action();
      toasts.show(message(r));
      close();
    } catch (e) {
      if (!(e instanceof WriteCancelled)) {
        toasts.show(isNetworkError(e) ? 'Bez signálu. Oprava jde uložit jen s připojením.' : errorMessage(e), 'error');
      }
    } finally {
      busy = false;
      await onchanged();
    }
  }

  const saveResult = (pa: PlateAppearance, result: PaResult, rbi: number) =>
    run(() => updatePlateAppearance(pa, { result, rbi }), () => `Opraveno: ${pa.result} → ${result}${rbi !== pa.rbi ? `, ${rbi} RBI` : ''}.`);

  const adjust = (playerId: string, delta: 1 | -1) => {
    const p = editing;
    if (p) run(() => liveAdjustRuns(gameId, p.teamId, p.inning, playerId, delta), () => `Run ${delta > 0 ? 'přidán' : 'odebrán'} (${p.inning}. směna).`);
  };

  const deletePlay = () => {
    const p = editing;
    if (p) run(() => liveDeletePlay(gameId, p.id), () => 'Akce smazána, stav je jako před ní.');
  };

  const deleteFrom = () => {
    const p = editing;
    if (p) run(() => liveDeleteFrom(gameId, p.id), (n) => `Smazáno ${n} ${plural(n, ['akce', 'akce', 'akcí'])}.`);
  };

  const cancelAdjust = () => {
    const p = editing;
    if (p) run(() => revertGroup(p.id), () => 'Oprava zrušena.');
  };
</script>

<p class="muted hint">Tužkou u akce opravíš výsledek (třeba hit, který byl ve skutečnosti error), RBI nebo runs. Všechno je v historii a dá se vrátit.</p>
<PlayLog {plays} {awayTeamId} onedit={(p) => (editing = p)} />

{#if editing}
  <EditPlaySheet
    play={editing}
    pa={editingPa}
    {awayTeamId}
    isLatest={editing.id === latestPlayId}
    canRewind={false}
    {busy}
    onsaveresult={saveResult}
    onadjust={adjust}
    ondelete={deletePlay}
    ondeletefrom={deleteFrom}
    onrewind={() => {}}
    oncanceladjust={cancelAdjust}
    onclose={close}
  />
{/if}

<style>
  .hint {
    font-size: 14px;
    margin: 0 0 14px;
    max-width: 70ch;
  }
</style>
