<script lang="ts">
  // Strip on the test game pages: what it is and a button that wipes it for the next person.
  import { testReset, errorMessage, WriteCancelled } from '../api.ts';
  import { toasts } from '../toast.svelte.ts';
  import Icon from './Icon.svelte';

  let { onreset }: { onreset?: () => void } = $props();

  let confirm = $state(false);
  let busy = $state(false);

  async function reset() {
    busy = true;
    try {
      await testReset();
      toasts.show('Testovací zápas je vynulovaný, můžeš začít znovu.');
      confirm = false;
      onreset?.();
    } catch (e) {
      if (!(e instanceof WriteCancelled)) toasts.show(errorMessage(e), 'error');
    } finally {
      busy = false;
    }
  }
</script>

<div class="test" role="note">
  <span class="ic"><Icon name="flag" size={18} /></span>
  <span class="tx">
    <strong>Testovací zápas</strong>
    <span>Vymyšlené týmy na vyzkoušení zápisu. Nic se nezapočítává do tabulky ani statistik.</span>
  </span>
  {#if confirm}
    <span class="act">
      <button type="button" class="btn btn-sm danger" disabled={busy} onclick={reset}>Vynulovat</button>
      <button type="button" class="btn btn-quiet btn-sm" onclick={() => (confirm = false)}>Ne</button>
    </span>
  {:else}
    <button type="button" class="btn btn-sm act" onclick={() => (confirm = true)}><Icon name="undo" size={16} /> Vynulovat zápas</button>
  {/if}
</div>

<style>
  .test {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    gap: 6px 12px;
    margin-bottom: 14px;
    padding: 12px 14px;
    border-radius: var(--r-l);
    border: 1px dashed color-mix(in srgb, var(--accent) 70%, var(--line));
    background: var(--accent-soft);
  }
  @media (min-width: 640px) {
    .test {
      grid-template-columns: auto minmax(0, 1fr) auto;
    }
  }
  .ic {
    display: grid;
    place-items: center;
    width: 36px;
    height: 36px;
    border-radius: 12px;
    background: var(--accent);
    color: var(--accent-ink);
  }
  .tx {
    display: grid;
    gap: 2px;
    font-size: 13.5px;
    min-width: 0;
  }
  .tx strong {
    font-size: 15px;
  }
  .tx span {
    color: var(--muted);
  }
  .act {
    grid-column: 1 / -1;
    justify-self: start;
    display: inline-flex;
    gap: 6px;
  }
  @media (min-width: 640px) {
    .act {
      grid-column: auto;
      justify-self: end;
    }
  }
  .danger {
    background: var(--neg);
    border-color: var(--neg);
    color: #fff;
  }
</style>
