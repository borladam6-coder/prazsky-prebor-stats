<script lang="ts">
  import type { Team } from '../types.ts';

  let { team, size = 32, eager = false }: { team: Team | undefined; size?: number; eager?: boolean } = $props();

  // Logos are hosted by the association. If one is missing or fails, show the team's initials.
  let failed = $state(false);
  const initials = $derived((team?.code ?? '?').slice(0, 2).toUpperCase());
</script>

<span class="badge" class:logo={team?.logo_url && !failed} style:--size="{size}px" style:--team={team?.color ?? 'var(--faint)'} title={team?.name}>
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
  .ini {
    color: #fff;
    font-weight: 800;
    font-size: calc(var(--size) * 0.36);
    letter-spacing: -0.02em;
  }
</style>
