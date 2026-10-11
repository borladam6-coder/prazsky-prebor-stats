<script lang="ts">
  // Result buttons of the live scoring: big codes only. Holding a button shows its full
  // name (a long press does not record anything); on a computer the name is a tooltip.
  // SF, SH and FC have no button: "OUT" asks how the out happened and they follow from it.
  import { fade } from 'svelte/transition';
  import { resultDef } from '../stats.ts';
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

  // rows: hits · reached without a hit · outs (the most common results get the biggest buttons)
  const PAD: PaResult[] = ['1B', '2B', '3B', 'HR', 'BB', 'HBP', 'ROE', 'K', 'OUT'];
  /** grid columns (of 12) each button takes, and which edge its name tip sticks to */
  const SPAN: Record<string, number> = { '1B': 3, '2B': 3, '3B': 3, HR: 3, BB: 4, HBP: 4, ROE: 4, K: 4, OUT: 8 };
  const EDGE: Record<string, 'left' | 'right' | ''> = { '1B': 'left', BB: 'left', K: 'left', HR: 'right', ROE: 'right', OUT: 'right' };
  const LABELS: Partial<Record<PaResult, string>> = {
    OUT: 'Out v poli: fly out, ground out, fielder’s choice, double play, sacrifice bunt',
    ROE: 'Reached on error'
  };
  const buttons = PAD.map((code) => ({ code, label: LABELS[code] ?? resultDef(code)?.label ?? code, group: resultDef(code)?.group ?? 'out' }));

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
  {#each buttons as r (r.code)}
    <button
      type="button"
      class="res g-{r.group} edge-{EDGE[r.code] ?? ''}"
      class:big={r.code === 'OUT' || r.code === 'K'}
      style:grid-column="span {SPAN[r.code]}"
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
    grid-template-columns: repeat(12, minmax(0, 1fr));
    gap: 7px;
  }
  .res {
    position: relative;
    display: grid;
    place-items: center;
    min-height: 50px;
    padding: 6px 4px;
    border-radius: 14px;
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    font-weight: 800;
    font-size: 21px;
    font-stretch: 88%;
    letter-spacing: -0.01em;
    cursor: pointer;
    user-select: none;
    -webkit-user-select: none;
    -webkit-touch-callout: none;
    touch-action: manipulation;
    transition: transform 90ms, background-color 140ms, border-color 140ms, opacity 140ms;
  }
  /* hits: green tone, reached without a hit: blue tone, outs: neutral with a thin muted red line */
  .res.g-hit {
    background: color-mix(in srgb, var(--hit) 13%, var(--surface));
    border-color: color-mix(in srgb, var(--hit) 22%, transparent);
    color: var(--hit);
  }
  .res.g-onbase {
    background: color-mix(in srgb, var(--onbase) 13%, var(--surface));
    border-color: color-mix(in srgb, var(--onbase) 22%, transparent);
    color: var(--onbase);
  }
  .res.g-out::before {
    content: '';
    position: absolute;
    left: 14px;
    right: 14px;
    bottom: 7px;
    height: 2px;
    border-radius: 2px;
    background: var(--out);
    opacity: 0.45;
  }
  .res.big {
    min-height: 58px;
    font-size: 23px;
  }
  /* a gap between the groups: hits, on base, outs */
  .res:nth-child(5),
  .res:nth-child(8) {
    margin-top: 4px;
  }
  .res:nth-child(6),
  .res:nth-child(7),
  .res:nth-child(9) {
    margin-top: 4px;
  }
  .res:hover {
    filter: brightness(1.06);
    border-color: var(--line-strong);
  }
  .res:active {
    transform: scale(0.96);
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
    font-stretch: 100%;
    letter-spacing: 0;
    width: max-content;
    max-width: 210px;
    white-space: normal;
    pointer-events: none;
    box-shadow: var(--shadow);
  }
  /* edge buttons: keep the name on screen */
  .edge-left .tip {
    left: 0;
    transform: none;
  }
  .edge-right .tip {
    left: auto;
    right: 0;
    transform: none;
  }
  @media (min-width: 640px) {
    .res {
      min-height: 56px;
      font-size: 22px;
    }
    .res.big {
      min-height: 60px;
    }
  }
</style>
