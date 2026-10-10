<script lang="ts">
  // Result buttons of the live scoring: big codes only. Holding a button shows its full
  // name (a long press does not record anything); on a computer the name is a tooltip.
  import { fade } from 'svelte/transition';
  import { RESULTS } from '../stats.ts';
  import type { PaResult } from '../types.ts';

  let {
    disabled = false,
    allowed,
    onpick
  }: {
    disabled?: boolean;
    allowed: (code: PaResult) => boolean;
    onpick: (code: PaResult) => void;
  } = $props();

  let tip = $state<PaResult | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  /** the press was a long one: the following click only showed the name */
  let suppress = false;

  function down(code: PaResult) {
    clearTimeout(timer);
    suppress = false;
    timer = setTimeout(() => {
      suppress = true;
      tip = code;
      clearTimeout(hideTimer);
      hideTimer = setTimeout(() => (tip = null), 1600);
    }, 420);
  }

  function up() {
    clearTimeout(timer);
  }

  function click(code: PaResult) {
    if (suppress) {
      suppress = false;
      return;
    }
    tip = null;
    onpick(code);
  }
</script>

<div class="pad" role="group" aria-label="Výsledek na pálce">
  {#each RESULTS as r (r.code)}
    <button
      type="button"
      class="res g-{r.group}"
      title={r.label}
      aria-label="{r.code}, {r.label}"
      disabled={disabled || !allowed(r.code)}
      onpointerdown={() => down(r.code)}
      onpointerup={up}
      onpointerleave={up}
      onpointercancel={up}
      oncontextmenu={(e) => e.preventDefault()}
      onclick={() => click(r.code)}
    >
      {r.code}
      {#if tip === r.code}
        <span class="tip" role="tooltip" transition:fade={{ duration: 120 }}>{r.label}</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .pad {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 7px;
  }
  .res {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 54px;
    padding: 6px 4px;
    border-radius: 15px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    font-weight: 800;
    font-size: 21px;
    letter-spacing: -0.02em;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    touch-action: manipulation;
    transition: transform 90ms, background-color 140ms, border-color 140ms, opacity 140ms;
  }
  .res::before {
    content: '';
    position: absolute;
    left: 10px;
    right: 10px;
    bottom: 7px;
    height: 3px;
    border-radius: 3px;
    background: var(--faint);
    opacity: 0.55;
  }
  .res.g-hit::before {
    background: var(--pos);
    opacity: 1;
  }
  .res.g-onbase::before {
    background: var(--accent);
    opacity: 1;
  }
  .res:hover {
    border-color: var(--line-strong);
    background: var(--surface-3);
  }
  .res:active {
    transform: scale(0.95);
  }
  .res[disabled] {
    opacity: 0.28;
    cursor: default;
    transform: none;
  }
  .tip {
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    z-index: 5;
    padding: 6px 10px;
    border-radius: 10px;
    background: var(--pill-active-bg);
    color: var(--pill-active-ink);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0;
    white-space: nowrap;
    pointer-events: none;
    box-shadow: var(--shadow);
  }
  /* edge columns: keep the name on screen */
  .res:nth-child(4n + 1) .tip {
    left: 0;
    transform: none;
  }
  .res:nth-child(4n) .tip {
    left: auto;
    right: 0;
    transform: none;
  }
  @media (min-width: 640px) {
    .res {
      min-height: 60px;
      font-size: 22px;
    }
  }
</style>
