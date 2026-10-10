<script lang="ts">
  import '../app.css';
  import favicon from '#lib/assets/favicon.svg';
  import { page } from '$app/state';
  import { onMount } from 'svelte';
  import type { LayoutProps } from './$types';
  import { league } from '#lib/league.svelte.ts';
  import { theme } from '#lib/theme.svelte.ts';
  import Icon from '#lib/components/Icon.svelte';
  import NicknameDialog from '#lib/components/NicknameDialog.svelte';
  import Toasts from '#lib/components/Toasts.svelte';
  import Search from '#lib/components/Search.svelte';

  let { children, data }: LayoutProps = $props();

  onMount(() => {
    theme.init();
    // app shell offline + installable app (see static/sw.js)
    if ('serviceWorker' in navigator && !import.meta.env.DEV) navigator.serviceWorker.register('/sw.js').catch(() => {});
  });

  // History of changes is in the footer and in each game, not in the main menu.
  const nav = [
    { href: '/', label: 'Přehled', icon: 'board' },
    { href: '/zapasy', label: 'Zápasy', icon: 'calendar' },
    { href: '/tymy', label: 'Týmy', icon: 'shield' },
    { href: '/hraci', label: 'Hráči', icon: 'player' }
  ] as const;

  let searchOpen = $state(false);

  const isActive = (href: string) =>
    href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);

  const themeLabel = $derived(
    theme.mode === 'system' ? 'Vzhled podle systému' : theme.mode === 'light' ? 'Světlý vzhled' : 'Tmavý vzhled'
  );
</script>

<svelte:window
  onkeydown={(e) => {
    const t = e.target as HTMLElement | null;
    const typing = t?.closest?.('input, textarea, select, [contenteditable]');
    if (e.key === '/' && !typing && !searchOpen) {
      e.preventDefault();
      searchOpen = true;
    }
  }}
/>

<svelte:head>
  <link rel="icon" href={favicon} />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-title" content="Přebor" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <meta name="theme-color" content="#0a0b0a" />
  <meta name="description" content="Komunitní pálkařské statistiky Pražského přeboru mužů v softballu." />
</svelte:head>

<a class="skip" href="#main">Přeskočit na obsah</a>

<div class="top-wrap">
  <header class="top">
    <a class="brand" href="/" aria-label="Pražský přebor, přehled">
      <img src={favicon} alt="" width="30" height="30" />
      <span class="word">Pražský přebor</span>
      {#if league.season}<span class="year">{league.season.year}</span>{/if}
    </a>

    <nav class="nav-desktop" aria-label="Hlavní">
      {#each nav as item (item.href)}
        <a href={item.href} aria-current={isActive(item.href) ? 'page' : undefined}>{item.label}</a>
      {/each}
    </nav>

    <button type="button" class="theme" onclick={() => (searchOpen = true)} aria-label="Hledat hráče nebo tým" title="Hledat (/)">
      <Icon name="search" size={19} />
    </button>
    <button type="button" class="theme" onclick={() => theme.toggle()} aria-label={themeLabel} title={themeLabel}>
      <Icon name={theme.mode === 'system' ? 'auto' : theme.mode === 'light' ? 'sun' : 'moon'} size={19} />
    </button>
  </header>
</div>

<main id="main">
  {#if data.loadError}
    <div class="page">
      <div class="load-error card" role="alert">
        <h2>Data se nepodařilo načíst</h2>
        <p>{data.loadError}</p>
        <button type="button" class="btn btn-primary" onclick={() => location.reload()}>Zkusit znovu</button>
      </div>
    </div>
  {:else}
    {@render children()}
  {/if}
</main>

<footer class="foot">
  <span>{league.season?.name ?? 'Pražský přebor mužů'} {league.season?.year ?? ''}, komunitní statistiky</span>
  <a class="link-accent" href="/historie">Historie změn</a>
  <p class="note">
    Bez napojení na Českou softballovou asociaci. Tabulka, rozpis a soupisky pochází z
    <a href="https://softball.cz/ligy/PPM" rel="noopener">softball.cz</a>, pálkařské statistiky zapisují hráči sami.
  </p>
</footer>

<nav class="nav-mobile" aria-label="Hlavní">
  {#each nav as item (item.href)}
    <a href={item.href} aria-current={isActive(item.href) ? 'page' : undefined}>
      <Icon name={item.icon} size={22} />
      <span>{item.label}</span>
    </a>
  {/each}
</nav>

{#if searchOpen}<Search onclose={() => (searchOpen = false)} />{/if}
<NicknameDialog />
<Toasts />

<style>
  .skip {
    position: absolute;
    left: 8px;
    top: -60px;
    z-index: 100;
    padding: 8px 12px;
    background: var(--accent);
    color: var(--accent-ink);
    border-radius: 8px;
    font-weight: 700;
  }
  .skip:focus {
    top: 8px;
  }

  .top-wrap {
    position: sticky;
    top: 0;
    z-index: 20;
    padding-top: env(safe-area-inset-top);
    /* phones: solid background, a blur behind a sticky bar makes scrolling stutter */
    background: color-mix(in srgb, var(--bg) 97%, transparent);
    border-bottom: 1px solid var(--line);
  }
  .top {
    max-width: var(--max);
    margin: 0 auto;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px var(--gutter);
  }
  @media (min-width: 900px) {
    .top-wrap {
      padding: 12px var(--gutter) 0;
      background: none;
      backdrop-filter: none;
      -webkit-backdrop-filter: none;
      border-bottom: 0;
    }
    .top {
      padding: 8px 8px 8px 14px;
      border-radius: 22px;
      background: color-mix(in srgb, var(--surface) 82%, transparent);
      backdrop-filter: saturate(1.4) blur(14px);
      -webkit-backdrop-filter: saturate(1.4) blur(14px);
      border: 1px solid var(--line);
      box-shadow: var(--shadow);
    }
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    text-decoration: none;
    margin-right: auto;
  }
  .word {
    font-weight: 800;
    font-size: 19px;
    letter-spacing: -0.02em;
  }
  .year {
    font-weight: 700;
    font-size: 12.5px;
    color: var(--accent-text);
    background: var(--accent-soft);
    border-radius: 999px;
    padding: 2px 9px;
  }

  .nav-desktop {
    display: none;
    gap: 2px;
  }
  .nav-desktop a {
    padding: 10px 18px;
    border-radius: 999px;
    text-decoration: none;
    font-weight: 600;
    font-size: 15px;
    color: var(--muted);
    transition: color 140ms, background-color 140ms;
  }
  .nav-desktop a:hover {
    color: var(--ink);
  }
  .nav-desktop a[aria-current='page'] {
    color: var(--pill-active-ink);
    background: var(--pill-active-bg);
  }

  .theme {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 50%;
    border: 1px solid var(--line);
    background: var(--surface-2);
    color: var(--ink);
    cursor: pointer;
  }

  .nav-mobile {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 30;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    padding-bottom: env(safe-area-inset-bottom);
    background: color-mix(in srgb, var(--surface) 97%, transparent);
    border-top: 1px solid var(--line);
  }
  .nav-mobile a {
    display: grid;
    justify-items: center;
    gap: 3px;
    padding: 9px 2px 8px;
    min-height: var(--nav-h);
    color: var(--faint);
    text-decoration: none;
    font-size: 11.5px;
    font-weight: 700;
  }
  .nav-mobile a[aria-current='page'] {
    color: var(--accent-text);
  }
  /* live scoring: the result pad takes the place of the menu */
  :global(html.has-dock) .nav-mobile {
    display: none;
  }

  @media (min-width: 900px) {
    .nav-desktop {
      display: flex;
    }
    .nav-mobile {
      display: none;
    }
  }

  .foot {
    max-width: var(--max);
    margin: 24px auto 0;
    padding: 24px var(--gutter) calc(var(--nav-h) + 28px);
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    gap: 8px 20px;
    font-size: 14px;
    color: var(--faint);
  }
  .note {
    flex-basis: 100%;
    margin: 0;
    max-width: 70ch;
    font-size: 13px;
  }
  @media (min-width: 900px) {
    .foot {
      padding-bottom: 40px;
    }
  }

  .load-error {
    max-width: 560px;
    padding: 28px;
  }
  .load-error p {
    color: var(--muted);
  }
</style>
