<script lang="ts">
  // Three short tips shown the first time somebody scores on this device (and from the menu).
  // The described part of the page is lifted above a dim backdrop.
  import { fade, fly } from 'svelte/transition';
  import Icon from './Icon.svelte';

  let { force = false, onclose }: { force?: boolean; onclose: () => void } = $props();

  const KEY = 'pps.hints.scoring';
  const STEPS = [
    {
      target: 'pad',
      at: 'top',
      title: 'Výsledek pálkaře',
      text: 'Klepni na výsledek. Když nikdo není na metě, uloží se hned. Jinak se zeptám, kam doběhli běžci. Podržením tlačítka uvidíš celý název.'
    },
    {
      target: 'field',
      at: 'bottom',
      title: 'Běžci na metách',
      text: 'Klepnutím na běžce zapíšeš ukradenou metu nebo jiný postup mimo odpal.'
    },
    {
      target: 'undo',
      at: 'bottom',
      title: 'Spletl ses?',
      text: 'Zpět vrátí poslední akci. Starší akce opravíš tužkou v průběhu zápasu. Bez signálu se akce uloží v telefonu a odešlou se samy.'
    }
  ] as const;

  let dismissed = $state(readSeen());
  let step = $state(0);
  const open = $derived(force || !dismissed);
  const cur = $derived(STEPS[step]);

  function readSeen(): boolean {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return true;
    }
  }

  function close() {
    dismissed = true;
    step = 0;
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      /* private mode: shows again next time, that is fine */
    }
    onclose();
  }

  // lift the described element above the backdrop
  $effect(() => {
    if (!open) return;
    const el = document.querySelector<HTMLElement>(`[data-hint="${cur.target}"]`);
    el?.classList.add('hint-target');
    if (el && cur.target !== 'pad') el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return () => el?.classList.remove('hint-target');
  });
</script>

{#if open}
  <div class="dim" transition:fade={{ duration: 150 }} aria-hidden="true" onclick={close}></div>
  {#key step}
    <div class="tip card {cur.at}" role="dialog" aria-modal="true" aria-labelledby="hint-title" in:fly={{ y: cur.at === 'top' ? -12 : 12, duration: 200 }}>
      <div class="head">
        <span class="n">{step + 1}/{STEPS.length}</span>
        <h2 id="hint-title">{cur.title}</h2>
        <button type="button" class="x" aria-label="Zavřít nápovědu" onclick={close}><Icon name="close" size={18} /></button>
      </div>
      <p>{cur.text}</p>
      <div class="actions">
        {#if step < STEPS.length - 1}
          <button type="button" class="btn btn-quiet btn-sm" onclick={close}>Přeskočit</button>
          <button type="button" class="btn btn-primary btn-sm" onclick={() => step++}>Další <Icon name="chevron" size={16} /></button>
        {:else}
          <button type="button" class="btn btn-primary btn-sm" onclick={close}><Icon name="check" size={16} /> Rozumím</button>
        {/if}
      </div>
    </div>
  {/key}
{/if}

<style>
  .dim {
    position: fixed;
    inset: 0;
    z-index: 50;
    background: rgb(5 10 8 / 0.6);
  }
  :global(.hint-target) {
    position: relative;
    z-index: 51 !important;
    border-radius: 18px;
    box-shadow: 0 0 0 3px var(--accent), 0 0 0 9999px transparent;
  }
  .tip {
    position: fixed;
    z-index: 52;
    left: 50%;
    transform: translateX(-50%);
    width: min(440px, calc(100vw - 24px));
    padding: 16px 16px 14px;
    box-shadow: var(--shadow);
  }
  .tip.top {
    top: calc(14px + env(safe-area-inset-top));
  }
  .tip.bottom {
    bottom: calc(var(--nav-h) + 16px + env(safe-area-inset-bottom));
  }
  @media (min-width: 900px) {
    .tip.top,
    .tip.bottom {
      top: auto;
      bottom: 28px;
    }
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .n {
    font-size: 12px;
    font-weight: 800;
    color: var(--accent-text);
    background: var(--accent-soft);
    padding: 2px 8px;
    border-radius: 999px;
  }
  h2 {
    font-size: 18px;
    margin-right: auto;
  }
  .x {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border-radius: 50%;
    border: 0;
    background: var(--surface-2);
    color: var(--ink);
    cursor: pointer;
  }
  p {
    margin: 8px 0 12px;
    font-size: 14.5px;
    line-height: 1.45;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
