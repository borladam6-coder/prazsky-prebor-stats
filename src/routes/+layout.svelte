<script lang="ts">
  import favicon from '#lib/assets/favicon.svg';
  import type { LayoutProps } from './$types';

  let { children }: LayoutProps = $props();
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
  <meta name="theme-color" content="#0B0D12" media="(prefers-color-scheme: dark)" />
  <meta name="theme-color" content="#F6F7F9" media="(prefers-color-scheme: light)" />
</svelte:head>

{@render children()}

<style>
  :global(:root) {
    --bg: #f6f7f9;
    --surface: #ffffff;
    --text: #12151c;
    --muted: #5b6474;
    --line: #e3e6ec;
    --accent: #0090ff;
    --danger: #e5484d;
    --ok: #30a46c;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #0b0d12;
      --surface: #14171f;
      --text: #eceef3;
      --muted: #9aa3b2;
      --line: #252a35;
    }
  }
  :global(*) {
    box-sizing: border-box;
  }
  :global(body) {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    -webkit-font-smoothing: antialiased;
  }
</style>
