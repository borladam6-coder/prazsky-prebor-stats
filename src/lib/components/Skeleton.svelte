<script lang="ts">
  // Grey placeholder rows while data loads (the page keeps its shape, nothing jumps).
  let {
    rows = 4,
    height = 48,
    card = false,
    label = 'Načítám'
  }: { rows?: number; height?: number; card?: boolean; label?: string } = $props();
</script>

<div class="skeleton-list" class:card aria-busy="true" aria-label={label} role="status">
  {#each Array(rows) as _, i (i)}
    <span class="bar" style:height="{height}px" style:--d="{i * 90}ms"></span>
  {/each}
</div>

<style>
  .skeleton-list {
    display: grid;
    gap: 8px;
  }
  .skeleton-list.card {
    padding: 14px;
    border: 1px solid var(--line);
    border-radius: var(--r-l);
    background: var(--surface);
  }
  .bar {
    display: block;
    border-radius: 12px;
    background: linear-gradient(90deg, var(--surface-2) 0%, var(--surface-3) 40%, var(--surface-2) 80%);
    background-size: 200% 100%;
    animation: shimmer 1.3s ease-in-out infinite;
    animation-delay: var(--d);
  }
  .bar:nth-child(3n + 2) {
    width: 92%;
  }
  .bar:nth-child(3n) {
    width: 84%;
  }
  @keyframes shimmer {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar {
      animation: none;
    }
  }
</style>
