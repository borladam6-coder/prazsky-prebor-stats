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
  <meta name="theme-color" content="#0756ec" />
  <meta name="description" content="Komunitní pálkařské statistiky Pražského přeboru mužů v softballu." />
</svelte:head>

<a class="skip" href="#main">Přeskočit na obsah</a>

<div class="top-wrap">
  <header class="top">
    <a class="brand" href="/" aria-label="Pražský přebor, přehled">
      <img src={favicon} alt="" width="30" height="30" />
      <span class="word">PRAŽSKÝ PŘEBOR</span>
      {#if league.season}<span class="year">{league.season.year}</span>{/if}
    </a>

    <nav class="nav-desktop" aria-label="Hlavní">
      {#each nav as item (item.href)}
        <a href={item.href} aria-current={isActive(item.href) ? 'page' : undefined}>{item.label}</a>
      {/each}
    </nav>

    <a class="record btn btn-primary" href="/zapasy" aria-label="Zapsat zápas"><span>Zapsat zápas</span><Icon name="plus" size={17} /></a>

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
  <a class="link-accent" href="/zapasy/-1/zive">Vyzkoušet zápis</a>
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
  .skip { position:absolute; left:8px; top:-60px; z-index:100; padding:8px 12px; background:var(--accent); color:var(--accent-ink); border-radius:6px; font-weight:700; }
  .skip:focus { top:8px; }
  .top-wrap { position:sticky; top:0; z-index:20; padding-top:env(safe-area-inset-top); background:var(--surface); border-bottom:1px solid var(--line); }
  .top { max-width:var(--max); margin:auto; display:flex; align-items:center; gap:12px; padding:18px var(--gutter); }
  .brand { display:flex; align-items:center; gap:10px; text-decoration:none; margin-right:auto; min-width:0; }
  .word { font-family:var(--display); font-size:17px; font-weight:800; letter-spacing:-.04em; white-space:nowrap; }
  .year { color:var(--muted); font-size:11px; padding:4px 7px; border:1px solid var(--line); border-radius:4px; }
  .nav-desktop { display:flex; gap:24px; margin-right:auto; margin-left:auto; align-self:stretch; }
  .nav-desktop a { position:relative; display:flex; align-items:center; color:var(--muted); font-size:14px; text-decoration:none; font-weight:600; padding-inline:4px; }
  .nav-desktop a:hover { color:var(--accent-text); }
  .nav-desktop a[aria-current='page'] { color:var(--accent-text); }
  .nav-desktop a[aria-current='page']::after { content:''; position:absolute; bottom:-19px; left:0; right:0; height:3px; background:var(--accent); border-radius:3px; }
  .record { font-size:12px; min-height:40px; padding:8px 15px; gap:10px; }
  .theme { display:grid; place-items:center; width:36px; height:36px; flex-shrink:0; border:1px solid var(--line); border-radius:7px; background:var(--surface); color:var(--muted); cursor:pointer; transition:color .15s,background .15s; }
  .theme:hover { color:var(--accent-text); background:var(--surface-2); }
  .nav-mobile { display:none; }
  .foot { max-width:var(--max); margin:20px auto 0; padding:24px var(--gutter) 32px; border-top:1px solid var(--line); display:flex; flex-wrap:wrap; justify-content:space-between; gap:12px 20px; font-size:11px; color:var(--muted); }
  .foot .link-accent { font-size:11px; }
  .note { flex-basis:100%; margin:0; font-size:10px; line-height:1.7; }
  .load-error { max-width:560px; padding:28px; }
  .load-error p { color:var(--muted); }
  @media (max-width:1050px) { .nav-desktop { gap:14px; } .year { display:none; } }
  @media (max-width:899px) {
    .top { padding-block:12px; gap:8px; }
    .nav-desktop { display:none; }
    .nav-mobile { position:fixed; bottom:0; left:0; right:0; z-index:30; display:grid; grid-template-columns:repeat(4,1fr); padding-bottom:env(safe-area-inset-bottom); background:var(--surface); border-top:1px solid var(--line); }
    .nav-mobile a { position:relative; display:grid; justify-items:center; gap:4px; min-height:var(--nav-h); padding:12px 2px 9px; color:var(--muted); text-decoration:none; font-size:10px; font-weight:600; }
    .nav-mobile a[aria-current='page'] { color:var(--accent-text); background:var(--accent-soft); }
    .nav-mobile a[aria-current='page']::before { content:''; position:absolute; top:0; width:24px; height:3px; background:var(--accent); border-radius:0 0 3px 3px; }
    .foot { padding-bottom:calc(var(--nav-h) + 24px + env(safe-area-inset-bottom)); }
    :global(html.scoring) .top-wrap { display:none; }
  }
  :global(html.has-dock) .nav-mobile { display:none; }
  @media (max-width:520px) { .record { min-height:36px; padding:8px; } .record span { display:none; } .word { font-size:16px; } .brand { gap:8px; } }
  @media (max-width:359px) { .word { font-size:13px; } .theme { width:32px; height:34px; } .brand { gap:6px; } }
</style>
