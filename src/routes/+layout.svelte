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

  let { children, data }: LayoutProps = $props();

  onMount(() => theme.init());

  const nav = [
    { href: '/', label: 'Přehled', icon: 'board' },
    { href: '/zapasy', label: 'Zápasy', icon: 'calendar' },
    { href: '/tymy', label: 'Týmy', icon: 'shield' },
    { href: '/hraci', label: 'Hráči', icon: 'player' },
    { href: '/historie', label: 'Historie', icon: 'history' }
  ] as const;

  const isActive = (href: string) =>
    href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href);

  const themeLabel = $derived(
    theme.mode === 'system' ? 'Vzhled podle systému' : theme.mode === 'light' ? 'Světlý vzhled' : 'Tmavý vzhled'
  );
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <meta name="theme-color" content="#17352a" />
  <meta name="description" content="Komunitní pálkařské statistiky Pražského přeboru mužů v softballu." />
</svelte:head>

<a class="skip" href="#main">Přeskočit na obsah</a>

<header class="top">
  <div class="top-inner">
    <a class="brand" href="/" aria-label="Pražský přebor, přehled">
      <img src={favicon} alt="" width="32" height="32" />
      <span class="word">Pražský přebor</span>
      {#if league.season}<span class="year">{league.season.year}</span>{/if}
    </a>

    <nav class="nav-desktop" aria-label="Hlavní">
      {#each nav as item (item.href)}
        <a href={item.href} aria-current={isActive(item.href) ? 'page' : undefined}>{item.label}</a>
      {/each}
    </nav>

    <button type="button" class="theme" onclick={() => theme.toggle()} aria-label={themeLabel} title={themeLabel}>
      <Icon name={theme.mode === 'system' ? 'auto' : theme.mode === 'light' ? 'sun' : 'moon'} />
    </button>
  </div>
</header>

<main id="main">
  {#if data.loadError}
    <div class="page">
      <div class="load-error" role="alert">
        <h1>Data se nepodařilo načíst</h1>
        <p>{data.loadError}</p>
        <button type="button" class="btn btn-primary" onclick={() => location.reload()}>Zkusit znovu</button>
      </div>
    </div>
  {:else}
    {@render children()}
  {/if}
</main>

<nav class="nav-mobile" aria-label="Hlavní">
  {#each nav as item (item.href)}
    <a href={item.href} aria-current={isActive(item.href) ? 'page' : undefined}>
      <Icon name={item.icon} size={22} />
      <span>{item.label}</span>
    </a>
  {/each}
</nav>

<footer class="foot">
  <p>
    Komunitní projekt bez napojení na Českou softballovou asociaci. Tabulka, rozpis a soupisky pochází z
    <a href="https://softball.cz/ligy/PPM" rel="noopener">softball.cz</a>, pálkařské statistiky zapisují hráči sami.
  </p>
</footer>

<NicknameDialog />
<Toasts />

<style>
  .skip {
    position: absolute;
    left: 8px;
    top: -60px;
    z-index: 100;
    padding: 8px 12px;
    background: var(--amber);
    color: #10241b;
    border-radius: 6px;
    font-weight: 700;
  }
  .skip:focus {
    top: 8px;
  }

  .top {
    position: sticky;
    top: 0;
    z-index: 20;
    background: color-mix(in srgb, var(--bg) 88%, transparent);
    backdrop-filter: saturate(1.4) blur(10px);
    border-bottom: 1px solid var(--line);
  }
  .top-inner {
    max-width: var(--max);
    margin: 0 auto;
    padding: 10px var(--gutter);
    padding-top: calc(10px + env(safe-area-inset-top));
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .brand {
    display: flex;
    align-items: center;
    gap: 10px;
    text-decoration: none;
    margin-right: auto;
  }
  .word {
    font-family: var(--font-display);
    font-weight: 800;
    font-size: 24px;
    line-height: 1;
  }
  .year {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 16px;
    color: var(--amber-ink);
    border: 1.5px solid currentColor;
    border-radius: 4px;
    padding: 1px 5px 0;
  }

  .nav-desktop {
    display: none;
    gap: 4px;
  }
  .nav-desktop a {
    padding: 8px 12px;
    border-radius: 8px;
    text-decoration: none;
    font-weight: 600;
    color: var(--muted);
  }
  .nav-desktop a:hover {
    color: var(--ink);
  }
  .nav-desktop a[aria-current='page'] {
    color: var(--ink);
    background: var(--surface);
    box-shadow: inset 0 -2px 0 var(--amber);
  }

  .theme {
    display: grid;
    place-items: center;
    width: 40px;
    height: 40px;
    border-radius: 10px;
    border: 1px solid var(--line);
    background: var(--surface);
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
    grid-template-columns: repeat(5, 1fr);
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--board);
    border-top: 1px solid rgb(255 255 255 / 0.06);
  }
  .nav-mobile a {
    display: grid;
    justify-items: center;
    gap: 2px;
    padding: 9px 2px 8px;
    min-height: var(--nav-h);
    color: var(--board-muted);
    text-decoration: none;
    font-size: 11.5px;
    font-weight: 600;
  }
  .nav-mobile a[aria-current='page'] {
    color: var(--amber);
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
    margin: 0 auto;
    padding: 0 var(--gutter) calc(var(--nav-h) + 32px);
    color: var(--faint);
    font-size: 13px;
  }
  .foot p {
    max-width: 70ch;
    border-top: 1px solid var(--line);
    padding-top: 16px;
    margin: 0;
  }
  @media (min-width: 900px) {
    .foot {
      padding-bottom: 40px;
    }
  }

  .load-error {
    max-width: 560px;
    padding: 28px 0;
  }
  .load-error p {
    color: var(--muted);
  }
</style>
