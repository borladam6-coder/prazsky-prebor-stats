<script lang="ts">
  import { fly } from 'svelte/transition';
  import { flip } from 'svelte/animate';
  import { toasts } from '../toast.svelte.ts';
</script>

<div class="toasts" aria-live="polite">
  {#each toasts.list as t (t.id)}
    <div class="toast {t.kind}" role={t.kind === 'error' ? 'alert' : 'status'} in:fly={{ y: 16, duration: 200 }} out:fly={{ y: 8, duration: 150 }} animate:flip={{ duration: 200 }}>
      <span>{t.text}</span>
      {#if t.action}
        <button type="button" onclick={() => { t.action?.run(); toasts.dismiss(t.id); }}>{t.action.label}</button>
      {/if}
      <button type="button" class="x" aria-label="Zavřít" onclick={() => toasts.dismiss(t.id)}>×</button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    left: 50%;
    bottom: calc(var(--nav-h) + 14px + env(safe-area-inset-bottom));
    transform: translateX(-50%);
    z-index: 50;
    display: grid;
    gap: 8px;
    width: min(460px, calc(100vw - 24px));
    pointer-events: none;
  }
  @media (min-width: 900px) {
    .toasts {
      bottom: 24px;
    }
  }
  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 14px;
    border-radius: 16px;
    background: var(--surface-3);
    color: var(--ink);
    border: 1px solid var(--line-strong);
    box-shadow: var(--shadow);
    font-size: 15px;
    border-left: 4px solid var(--pos);
  }
  .toast.error {
    border-left-color: var(--neg);
  }
  span {
    flex: 1;
  }
  button {
    all: unset;
    cursor: pointer;
    font-weight: 700;
    color: var(--accent-text);
  }
  button:focus-visible {
    outline: 2px solid var(--focus);
  }
  .x {
    color: var(--muted);
    font-size: 20px;
    line-height: 1;
    padding: 0 2px;
  }
</style>
