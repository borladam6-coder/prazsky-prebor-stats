<script lang="ts">
  import type { Team } from '../types.ts';

  let { team, size = 32, eager = false }: { team: Team | undefined; size?: number; eager?: boolean } = $props();

  // Logos are hosted by the association. If one is missing or fails, show the team's initials.
  let failed = $state(false);
  const initials = $derived((team?.code ?? '?').slice(0, 2).toUpperCase());

  /** relative luminance (WCAG) of a #rrggbb colour; null when it is not one */
  function luminance(hex: string | undefined): number | null {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
    if (!m) return null;
    const [r, g, b] = [0, 2, 4].map((i) => {
      const c = parseInt(m[1].slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  // light team colours (yellow, white …) get dark initials and a thin outline
  const light = $derived((luminance(team?.color) ?? 0) > 0.42);
</script>

<span class="badge" class:logo={team?.logo_url && !failed} class:light style:--size="{size}px" style:--team={team?.color ?? 'var(--faint)'} title={team?.name}>
  {#if team?.logo_url && !failed}
    <img
      src={team.logo_url}
      alt=""
      width={size}
      height={size}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      referrerpolicy="no-referrer"
      onerror={() => (failed = true)}
    />
  {:else}
    <span class="ini">{initials}</span>
  {/if}
</span>

<style>
  .badge {
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;
    width: var(--size);
    height: var(--size);
    border-radius: calc(var(--size) * 0.28);
    background: var(--team);
    overflow: hidden;
  }
  .badge.logo {
    background: #fff;
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.06);
  }
  img {
    width: 80%;
    height: 80%;
    object-fit: contain;
  }
  .badge.light {
    box-shadow: inset 0 0 0 1px rgb(0 0 0 / 0.18);
  }
  .badge.light .ini {
    color: #14160f;
  }
  .ini {
    color: #fff;
    font-weight: 800;
    font-size: calc(var(--size) * 0.36);
    letter-spacing: -0.02em;
  }
</style>
