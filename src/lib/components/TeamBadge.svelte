<script lang="ts">
  import type { Team } from '../types.ts';

  let { team, size = 32 }: { team: Team | undefined; size?: number } = $props();

  // Logos are hosted by the association. If one fails to load, fall back to the team code.
  let failed = $state(false);
</script>

<span
  class="badge"
  style:--size="{size}px"
  style:--team={team?.color ?? 'var(--faint)'}
  title={team?.name}
>
  {#if team?.logo_url && !failed}
    <img
      src={team.logo_url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      onerror={() => (failed = true)}
    />
  {:else}
    <span class="code">{team?.code.slice(0, 4) ?? '?'}</span>
  {/if}
</span>

<style>
  .badge {
    position: relative;
    display: inline-grid;
    place-items: center;
    flex-shrink: 0;
    width: var(--size);
    height: var(--size);
    border-radius: 28%;
    background: #fff;
    box-shadow:
      0 0 0 2px var(--team),
      0 1px 2px rgb(0 0 0 / 0.2);
    overflow: hidden;
  }
  img {
    width: 84%;
    height: 84%;
    object-fit: contain;
  }
  .code {
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    background: var(--team);
    color: #fff;
    font-family: var(--font-display);
    font-weight: 800;
    font-size: calc(var(--size) * 0.36);
    letter-spacing: 0.02em;
  }
</style>
