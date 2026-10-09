<script lang="ts">
  // Small stroke icon set (24×24 grid), drawn for this site.
  type Name =
    | 'board' | 'calendar' | 'shield' | 'player' | 'history' | 'sun' | 'moon' | 'auto'
    | 'chevron' | 'back' | 'plus' | 'minus' | 'undo' | 'pencil' | 'close' | 'check' | 'search' | 'trash'
    | 'live' | 'up' | 'down' | 'swap' | 'flag' | 'tune';

  let { name, size = 20 }: { name: Name; size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#if name === 'board'}
    <rect x="3" y="4" width="18" height="14" rx="2" /><path d="M7 9h2M7 13h2M12 9h5M12 13h5M8 21h8" />
  {:else if name === 'calendar'}
    <rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" />
  {:else if name === 'shield'}
    <path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6l7-3z" />
  {:else if name === 'player'}
    <circle cx="12" cy="8" r="3.5" /><path d="M5 20c.8-3.6 3.6-6 7-6s6.2 2.4 7 6" />
  {:else if name === 'history'}
    <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" /><path d="M4 4v4.5h4.5M12 8v4.5l3 2" />
  {:else if name === 'sun'}
    <circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
  {:else if name === 'moon'}
    <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />
  {:else if name === 'auto'}
    <circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17" /><path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
  {:else if name === 'chevron'}
    <path d="M9 6l6 6-6 6" />
  {:else if name === 'back'}
    <path d="M15 6l-6 6 6 6" />
  {:else if name === 'plus'}
    <path d="M12 5v14M5 12h14" />
  {:else if name === 'minus'}
    <path d="M5 12h14" />
  {:else if name === 'undo'}
    <path d="M9 14L4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  {:else if name === 'pencil'}
    <path d="M4 20l4-1L19 8a2.1 2.1 0 0 0-3-3L5 16l-1 4z" />
  {:else if name === 'close'}
    <path d="M6 6l12 12M18 6L6 18" />
  {:else if name === 'check'}
    <path d="M5 12.5l4.5 4.5L19 7.5" />
  {:else if name === 'search'}
    <circle cx="11" cy="11" r="6.5" /><path d="M16 16l4.5 4.5" />
  {:else if name === 'trash'}
    <path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13" />
  {:else if name === 'live'}
    <circle cx="12" cy="12" r="2.5" fill="currentColor" /><path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14" />
  {:else if name === 'up'}
    <path d="M6 15l6-6 6 6" />
  {:else if name === 'down'}
    <path d="M6 9l6 6 6-6" />
  {:else if name === 'swap'}
    <path d="M7 4L4 7l3 3M4 7h12M17 20l3-3-3-3M20 17H8" />
  {:else if name === 'flag'}
    <path d="M5 21V4M5 4h11l-2 4 2 4H5" />
  {:else if name === 'tune'}
    <path d="M4 7h9M17 7h3M4 17h3M11 17h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="17" r="2" />
  {/if}
</svg>
