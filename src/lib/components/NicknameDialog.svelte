<script lang="ts">
  import { identity } from '../identity.svelte.ts';

  let dialog = $state<HTMLDialogElement>();
  let value = $state('');
  let error = $state('');

  $effect(() => {
    if (identity.request && dialog && !dialog.open) {
      value = identity.nickname ?? '';
      error = '';
      dialog.showModal();
    }
  });

  function finish(name: string | null) {
    const req = identity.request;
    identity.request = null;
    dialog?.close();
    req?.resolve(name);
  }

  function submit(e: SubmitEvent) {
    e.preventDefault();
    const v = value.replace(/\s+/g, ' ').trim();
    if (v.length < 2 || v.length > 32) {
      error = 'Přezdívka musí mít 2–32 znaků.';
      return;
    }
    if (/[<>]/.test(v)) {
      error = 'Přezdívka nesmí obsahovat znaky < a >.';
      return;
    }
    identity.setNickname(v);
    finish(v);
  }
</script>

<dialog bind:this={dialog} oncancel={() => finish(null)} aria-labelledby="nick-title">
  <form onsubmit={submit}>
    <h2 id="nick-title">Kdo zapisuje?</h2>
    <p>
      Přezdívka se uloží k tvým změnám v historii, aby ostatní věděli, kdo co zapsal. Stačí ji zadat jednou,
      tenhle prohlížeč si ji zapamatuje.
    </p>
    <label>
      <span>Přezdívka</span>
      <input class="input" bind:value maxlength="32" autocomplete="nickname" required />
    </label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="actions">
      <button type="button" class="btn btn-quiet" onclick={() => finish(null)}>Zrušit</button>
      <button type="submit" class="btn btn-primary">Uložit a pokračovat</button>
    </div>
  </form>
</dialog>

<style>
  dialog {
    width: min(420px, calc(100vw - 32px));
    border: 1px solid var(--line);
    border-radius: var(--radius-l);
    background: var(--surface);
    color: var(--ink);
    padding: 22px;
    box-shadow: var(--shadow);
  }
  dialog::backdrop {
    background: rgb(5 15 10 / 0.55);
    backdrop-filter: blur(2px);
  }
  p {
    color: var(--muted);
    font-size: 15px;
    margin: 10px 0 16px;
  }
  label {
    display: grid;
    gap: 6px;
    font-weight: 600;
    font-size: 14px;
  }
  .error {
    color: var(--red);
    margin: 8px 0 0;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }
</style>
