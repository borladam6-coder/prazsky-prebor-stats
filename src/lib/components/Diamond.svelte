<script lang="ts">
  // Infield with the runners on base. Tapping a runner starts a runner-only play.
  import { league } from '../league.svelte.ts';

  let {
    bases,
    outs = 0,
    onrunner = undefined,
    size = 'normal'
  }: {
    bases: (string | null)[];
    outs?: number;
    onrunner?: (base: 1 | 2 | 3) => void;
    size?: 'normal' | 'small';
  } = $props();

  // label position of each base (percent of the box)
  const spots = [
    { base: 1 as const, x: 80, y: 54 },
    { base: 2 as const, x: 50, y: 18 },
    { base: 3 as const, x: 20, y: 54 }
  ];

  function label(id: string | null) {
    const p = league.player(id);
    if (!p) return '';
    const surname = p.name.split(' ')[0];
    return p.jersey_number != null ? `#${p.jersey_number} ${surname}` : surname;
  }
</script>

<div class="diamond {size}">
  <svg viewBox="0 0 200 160" aria-hidden="true">
    <path class="grass" d="M100 150 L170 84 L100 18 L30 84 Z" />
    <path class="line" d="M100 150 L170 84 L100 18 L30 84 Z" />
    {#each [{ b: 1, x: 170, y: 84 }, { b: 2, x: 100, y: 18 }, { b: 3, x: 30, y: 84 }] as s (s.b)}
      <rect class="base" class:on={!!bases[s.b - 1]} x={s.x - 9} y={s.y - 9} width="18" height="18" rx="3" transform="rotate(45 {s.x} {s.y})" />
    {/each}
    <path class="home" d="M92 144 h16 v6 l-8 7 l-8 -7 z" />
  </svg>

  {#each spots as s (s.base)}
    {@const id = bases[s.base - 1]}
    {#if id && size === 'normal'}
      {#if onrunner}
        <button type="button" class="runner" style:left="{s.x}%" style:top="{s.y}%" onclick={() => onrunner(s.base)} aria-label="Běžec na {s.base}. metě: {league.player(id)?.name}. Klepni pro pohyb běžce.">
          {label(id)}
        </button>
      {:else}
        <span class="runner" style:left="{s.x}%" style:top="{s.y}%">{label(id)}</span>
      {/if}
    {/if}
  {/each}

  <span class="outs" aria-label="{outs} autů">
    {#each [0, 1, 2] as i (i)}<span class="dot" class:on={i < outs}></span>{/each}
    <span class="ol">auty</span>
  </span>
</div>

<style>
  .diamond {
    position: relative;
    width: 100%;
    max-width: 340px;
    aspect-ratio: 200 / 160;
    margin: 0 auto;
  }
  .diamond.small {
    max-width: 170px;
  }
  svg {
    width: 100%;
    height: 100%;
    display: block;
  }
  .grass {
    fill: color-mix(in srgb, var(--pos) 9%, transparent);
  }
  .line {
    fill: none;
    stroke: var(--line-strong);
    stroke-width: 2;
  }
  .base {
    fill: var(--surface-3);
    stroke: var(--line-strong);
    stroke-width: 1.5;
    transition: fill 220ms, stroke 220ms;
  }
  .base.on {
    fill: var(--accent);
    stroke: var(--accent);
    filter: drop-shadow(0 0 6px color-mix(in srgb, var(--accent) 60%, transparent));
  }
  .home {
    fill: var(--surface-3);
    stroke: var(--line-strong);
  }
  .runner {
    position: absolute;
    transform: translate(-50%, -50%);
    max-width: 46%;
    padding: 5px 10px;
    border-radius: 999px;
    border: 1px solid var(--accent);
    background: var(--surface);
    color: var(--ink);
    font-weight: 800;
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    box-shadow: var(--shadow);
    animation: pop 260ms cubic-bezier(0.2, 0.8, 0.2, 1.2) both;
  }
  button.runner {
    cursor: pointer;
  }
  button.runner:hover {
    background: var(--accent-soft);
  }
  .small .runner {
    font-size: 11px;
    padding: 2px 7px;
  }
  .outs {
    position: absolute;
    right: 0;
    bottom: 2px;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .small .outs {
    display: none;
  }
  .dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    border: 1.5px solid var(--faint);
    transition: background-color 200ms, border-color 200ms;
  }
  .dot.on {
    background: var(--neg);
    border-color: var(--neg);
  }
  .ol {
    font-size: 12px;
    color: var(--muted);
    margin-left: 2px;
  }
  @keyframes pop {
    from {
      opacity: 0;
      transform: translate(-50%, -30%) scale(0.85);
    }
  }
</style>
