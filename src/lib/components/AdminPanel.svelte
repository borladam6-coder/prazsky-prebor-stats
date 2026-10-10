<script lang="ts">
  // "Správa zápasu": only for the administrator (unlocked with the admin code).
  // Manual final score and wiping all statistics of the game; both revertable by the admin.
  import { untrack } from 'svelte';
  import { slide } from 'svelte/transition';
  import { admin } from '../admin.svelte.ts';
  import { league } from '../league.svelte.ts';
  import { adminChangeCode, adminResetGame, adminSetScore, errorMessage, WriteCancelled } from '../api.ts';
  import { toasts } from '../toast.svelte.ts';
  import type { Game } from '../types.ts';
  import Icon from './Icon.svelte';

  let {
    game,
    onchanged,
    startOpen = false
  }: { game: Game; onchanged: () => void; /** show the code form right away */ startOpen?: boolean } = $props();

  let open = $state(untrack(() => startOpen));
  let code = $state('');
  let unlockMsg = $state<string | null>(null);
  let busy = $state(false);

  let homeScore = $state('');
  let awayScore = $state('');
  let confirmText = $state('');
  let newCode = $state('');

  const home = $derived(league.team(game.home_team_id));
  const away = $derived(league.team(game.away_team_id));

  $effect(() => {
    // prefill with the current score whenever the game changes
    homeScore = game.home_score?.toString() ?? '';
    awayScore = game.away_score?.toString() ?? '';
  });

  async function unlock(e: SubmitEvent) {
    e.preventDefault();
    busy = true;
    const r = await admin.unlock(code);
    busy = false;
    unlockMsg =
      r === 'ok' ? null
      : r === 'wrong' ? 'Nesprávný kód.'
      : r === 'locked' ? 'Příliš mnoho pokusů. Zkus to za hodinu.'
      : r === 'unset' ? 'Kód správce zatím není nastavený.'
      : 'Nepodařilo se ověřit, zkus to znovu.';
    if (r === 'ok') code = '';
  }

  async function act<T>(fn: () => Promise<T>, ok: string) {
    if (busy) return;
    busy = true;
    try {
      await fn();
      toasts.show(ok);
      await league.loadGames();
      onchanged();
    } catch (e) {
      if (!(e instanceof WriteCancelled)) toasts.show(errorMessage(e), 'error');
    } finally {
      busy = false;
    }
  }

  function parseScore(v: string): number | null {
    const n = Number(v);
    return v.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= 99 ? n : null;
  }
  const h = $derived(parseScore(homeScore));
  const a = $derived(parseScore(awayScore));

  const saveScore = () => act(() => adminSetScore(game.id, h, a), 'Skóre uloženo.');
  const clearScore = () => act(() => adminSetScore(game.id, null, null), 'Ruční skóre zrušeno, platí výsledek ze softball.cz.');
  const reset = () =>
    act(() => adminResetGame(game.id), 'Záznam zápasu smazán. V historii ho jde vrátit.').then(() => (confirmText = ''));
  const changeCode = () =>
    act(() => adminChangeCode(newCode), 'Kód změněn.').then(() => {
      admin.lock();
      newCode = '';
    });
</script>

<section class="admin" aria-labelledby="admin-title">
  {#if !admin.unlocked}
    {#if !open}
      <button type="button" class="btn btn-quiet btn-sm" onclick={() => (open = true)}><Icon name="shield" size={16} /> Správa zápasu</button>
    {:else}
      <form class="card unlock" onsubmit={unlock} transition:slide={{ duration: 180 }}>
        <h2 id="admin-title">Správa zápasu</h2>
        <p class="muted">Jen pro správce webu. Zadej kód správce.</p>
        <div class="row">
          <input class="input" type="password" autocomplete="off" placeholder="Kód správce" bind:value={code} aria-label="Kód správce" />
          <button type="submit" class="btn btn-primary" disabled={busy || code.length < 4}>Odemknout</button>
          <button type="button" class="btn btn-quiet" onclick={() => (open = false)}>Zavřít</button>
        </div>
        {#if unlockMsg}<p class="err">{unlockMsg}</p>{/if}
      </form>
    {/if}
  {:else}
    <div class="card panel" transition:slide={{ duration: 180 }}>
      <div class="head">
        <h2 id="admin-title"><Icon name="shield" size={20} /> Správa zápasu</h2>
        <button type="button" class="btn btn-quiet btn-sm" onclick={() => admin.lock()}>Zamknout</button>
      </div>

      <div class="block">
        <h3>Konečné skóre</h3>
        <p class="muted">
          {#if game.score_override}
            Platí ruční skóre. Ze softball.cz je {game.imported_score?.[0] ?? '–'}:{game.imported_score?.[1] ?? '–'}.
          {:else}
            Teď platí výsledek ze softball.cz. Ruční skóre ho nahradí a import ho nepřepíše.
          {/if}
        </p>
        <div class="score">
          <label><span>{home?.short_name ?? 'Domácí'}</span><input class="input" inputmode="numeric" bind:value={homeScore} /></label>
          <span class="colon">:</span>
          <label><span>{away?.short_name ?? 'Hosté'}</span><input class="input" inputmode="numeric" bind:value={awayScore} /></label>
          <button type="button" class="btn btn-primary btn-sm" disabled={busy || h === null || a === null} onclick={saveScore}>Uložit skóre</button>
          {#if game.score_override}
            <button type="button" class="btn btn-quiet btn-sm" disabled={busy} onclick={clearScore}>Zrušit ruční skóre</button>
          {/if}
        </div>
      </div>

      <div class="block danger">
        <h3>Smazat celý záznam zápasu</h3>
        <p class="muted">
          Smaže všechny statistiky hráčů v tomto zápase (i ručně zapsané), celý živý zápis a ruční skóre.
          Smazání se uloží do historie a správce ho tam může vrátit.
        </p>
        <div class="row">
          <input class="input" placeholder='Pro potvrzení napiš SMAZAT' bind:value={confirmText} aria-label="Potvrzení smazání" />
          <button type="button" class="btn danger-btn" disabled={busy || confirmText.trim().toUpperCase() !== 'SMAZAT'} onclick={reset}>
            <Icon name="trash" size={16} /> Smazat záznam
          </button>
        </div>
      </div>

      <details class="block">
        <summary>Změnit kód správce</summary>
        <div class="row">
          <input class="input" type="password" autocomplete="new-password" placeholder="Nový kód (aspoň 12 znaků)" bind:value={newCode} aria-label="Nový kód" />
          <button type="button" class="btn btn-sm" disabled={busy || newCode.replace(/[^a-z0-9]/gi, '').length < 12} onclick={changeCode}>Změnit</button>
        </div>
      </details>
    </div>
  {/if}
</section>

<style>
  .admin {
    margin-top: 36px;
  }
  .unlock,
  .panel {
    padding: 18px 16px;
  }
  .unlock h2,
  .head h2 {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 20px;
  }
  .unlock p {
    margin: 6px 0 12px;
    font-size: 14px;
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .row .input {
    flex: 1 1 200px;
    min-width: 0;
  }
  .err {
    margin: 10px 0 0;
    color: var(--neg);
    font-weight: 600;
  }
  .block {
    margin-top: 16px;
    padding: 14px;
    border-radius: 16px;
    background: var(--surface-2);
    border: 1px solid var(--line);
  }
  .block h3 {
    font-size: 16px;
  }
  .block p {
    margin: 6px 0 12px;
    font-size: 13.5px;
  }
  .score {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-end;
    gap: 8px;
  }
  .score label {
    display: grid;
    gap: 4px;
    font-size: 12.5px;
    font-weight: 700;
    color: var(--muted);
  }
  .score .input {
    width: 76px;
    text-align: center;
    font-size: 20px;
    font-weight: 800;
  }
  .colon {
    font-size: 24px;
    font-weight: 800;
    padding-bottom: 6px;
  }
  .danger {
    border-color: color-mix(in srgb, var(--neg) 35%, var(--line));
  }
  .danger-btn {
    background: var(--neg);
    border-color: var(--neg);
    color: #fff;
  }
  summary {
    cursor: pointer;
    font-weight: 700;
  }
  details .row {
    margin-top: 10px;
  }
</style>
