<script lang="ts">
  // Quick search of players and teams (header button or the "/" key). Works on data
  // already in memory, without diacritics: "korcak" finds "Korčák".
  import { onMount } from 'svelte';
  import { fade, fly } from 'svelte/transition';
  import { goto } from '$app/navigation';
  import { league } from '../league.svelte.ts';
  import TeamBadge from './TeamBadge.svelte';
  import Icon from './Icon.svelte';

  let { onclose }: { onclose: () => void } = $props();

  let q = $state('');
  let active = $state(0);
  let input = $state<HTMLInputElement>();

  const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

  interface Hit {
    href: string;
    title: string;
    sub: string;
    teamId: number | null;
    kind: 'player' | 'team';
  }

  const hits = $derived.by((): Hit[] => {
    const words = fold(q).trim().split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const match = (text: string) => {
      const t = fold(text);
      return words.every((w) => t.includes(w));
    };
    const starts = (text: string) => fold(text).split(/\s+/).some((p) => p.startsWith(words[0]));
    const teams = league.teams
      .filter((t) => match(`${t.name} ${t.short_name ?? ''} ${t.code ?? ''}`))
      .map((t) => ({ href: `/tymy/${t.id}`, title: t.name, sub: 'tým', teamId: t.id, kind: 'team' as const }));
    const players = league.players
      .filter((p) => match(`${p.name} ${p.jersey_number ?? ''}`))
      .sort((a, b) => Number(starts(b.name)) - Number(starts(a.name)) || Number(b.active) - Number(a.active) || a.name.localeCompare(b.name, 'cs'))
      .slice(0, 12)
      .map((p) => {
        const t = league.team(p.team_id);
        return {
          href: `/hraci/${p.id}`,
          title: p.name,
          sub: `${t?.short_name ?? t?.name ?? ''}${p.jersey_number != null ? ` · #${p.jersey_number}` : ''}`,
          teamId: p.team_id,
          kind: 'player' as const
        };
      });
    return [...teams.slice(0, 4), ...players];
  });

  $effect(() => {
    void q;
    active = 0;
  });

  function open(h: Hit | undefined) {
    if (!h) return;
    onclose();
    goto(h.href);
  }

  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = Math.min(active + 1, hits.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = Math.max(active - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      open(hits[active]);
    }
  }

  onMount(() => input?.focus());
</script>

<div class="backdrop" transition:fade={{ duration: 120 }} onclick={onclose} aria-hidden="true"></div>
<div class="dlg card" role="dialog" aria-modal="true" aria-label="Hledat" transition:fly={{ y: -12, duration: 180 }}>
  <label class="field">
    <Icon name="search" size={20} />
    <input
      bind:this={input}
      bind:value={q}
      onkeydown={key}
      type="search"
      placeholder="Hráč, tým nebo číslo dresu"
      autocomplete="off"
      spellcheck="false"
      aria-label="Hledat hráče nebo tým"
      aria-controls="search-results"
      aria-activedescendant={hits.length ? `hit-${active}` : undefined}
    />
    <button type="button" class="x" aria-label="Zavřít" onclick={onclose}><Icon name="close" size={18} /></button>
  </label>

  {#if q.trim() && hits.length === 0}
    <p class="none">Nic nenalezeno.</p>
  {:else if hits.length}
    <ul id="search-results" role="listbox">
      {#each hits as h, i (h.href)}
        <li id="hit-{i}" role="option" aria-selected={i === active}>
          <a href={h.href} class:active={i === active} onclick={(e) => { e.preventDefault(); open(h); }} onmouseenter={() => (active = i)}>
            <TeamBadge team={league.team(h.teamId)} size={h.kind === 'team' ? 30 : 26} />
            <span class="t">
              <strong>{h.title}</strong>
              <small>{h.sub}</small>
            </span>
            <Icon name="chevron" size={18} />
          </a>
        </li>
      {/each}
    </ul>
  {:else}
    <p class="none">Napiš část jména, třeba „nova“ najde Nováka i Novotného.</p>
  {/if}
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 60;
    background: rgb(5 10 8 / 0.5);
  }
  .dlg {
    position: fixed;
    z-index: 61;
    top: calc(12px + env(safe-area-inset-top));
    left: 50%;
    transform: translateX(-50%);
    width: min(560px, calc(100vw - 24px));
    max-height: calc(100dvh - 40px);
    display: flex;
    flex-direction: column;
    padding: 8px;
    box-shadow: var(--shadow);
  }
  @media (min-width: 900px) {
    .dlg {
      top: 12vh;
    }
  }
  .field {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 4px 4px 4px 12px;
    border-radius: 14px;
    background: var(--surface-2);
    color: var(--muted);
  }
  input {
    flex: 1;
    min-width: 0;
    height: 46px;
    border: 0;
    background: transparent;
    color: var(--ink);
    font: inherit;
    font-size: 17px;
    font-weight: 600;
    outline: none;
  }
  input::-webkit-search-cancel-button {
    display: none;
  }
  .x {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border: 0;
    border-radius: 50%;
    background: transparent;
    color: var(--muted);
    cursor: pointer;
  }
  ul {
    list-style: none;
    margin: 6px 0 0;
    padding: 0;
    overflow-y: auto;
  }
  a {
    display: grid;
    grid-template-columns: 30px minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    padding: 9px 10px;
    border-radius: 12px;
    text-decoration: none;
    color: var(--ink);
  }
  a.active {
    background: var(--surface-2);
  }
  a :global(svg) {
    color: var(--faint);
  }
  .t {
    display: grid;
    min-width: 0;
  }
  .t strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .t small {
    color: var(--muted);
    font-size: 13px;
  }
  .none {
    margin: 0;
    padding: 18px 12px 12px;
    color: var(--muted);
    font-size: 14px;
  }
</style>
