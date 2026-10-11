<script module lang="ts">
  export interface Column<R> {
    key: string;
    label: string;
    title?: string;
    kind: 'count' | 'rate';
    value: (row: R) => number | string | null | undefined;
    lowerIsBetter?: boolean;
  }
</script>

<script lang="ts" generics="T">
  import type { Snippet } from 'svelte';
  import { flip } from 'svelte/animate';
  import { compareStat } from '../stats.ts';
  import { rate as fmtRate, num } from '../format.ts';
  import { tablePrefs } from '../tableprefs.svelte.ts';
  import Icon from './Icon.svelte';

  interface Props {
    rows: T[];
    rowKey: (row: T) => string | number;
    columns: Column<T>[];
    /** First (sticky) column: usually a player or team. */
    nameLabel: string;
    name: Snippet<[T]>;
    nameSort?: (row: T) => string;
    sortKey?: string;
    sortDir?: 1 | -1;
    totals?: { label: string; row: T } | null;
    caption?: string;
    empty?: string;
    onsort?: (key: string, dir: 1 | -1) => void;
    /** columns shown on a phone unless "Všechny statistiky" is on */
    essential?: string[];
  }

  let {
    rows,
    rowKey,
    columns,
    nameLabel,
    name,
    nameSort,
    sortKey = $bindable(''),
    sortDir = $bindable(-1),
    totals = null,
    caption,
    empty = 'Nic k zobrazení.',
    onsort,
    essential = ['pa', 'h', 'hr', 'rbi', 'avg', 'ops']
  }: Props = $props();

  // phone: key columns only (plus the one the table is sorted by)
  const reducible = $derived(tablePrefs.narrow && columns.filter((c) => essential.includes(c.key)).length < columns.length);
  const visible = $derived(
    reducible && !tablePrefs.all ? columns.filter((c) => essential.includes(c.key) || c.key === sortKey) : columns
  );

  const sorted = $derived.by(() => {
    if (sortKey === '__name' && nameSort) {
      return [...rows].sort((a, b) => nameSort(a).localeCompare(nameSort(b), 'cs') * sortDir);
    }
    const col = columns.find((c) => c.key === sortKey);
    if (!col) return rows;
    return [...rows].sort((a, b) => {
      const d = compareStat(col.value(a), col.value(b), sortDir);
      return d !== 0 ? d : nameSort ? nameSort(a).localeCompare(nameSort(b), 'cs') : 0;
    });
  });

  function sortBy(key: string, lowerIsBetter = false) {
    if (sortKey === key) {
      sortDir = sortDir === 1 ? -1 : 1;
    } else {
      sortKey = key;
      sortDir = key === '__name' || lowerIsBetter ? 1 : -1;
    }
    onsort?.(sortKey, sortDir);
  }

  const ariaSort = (key: string) =>
    sortKey === key ? (sortDir === 1 ? 'ascending' : 'descending') : 'none';

  const show = (c: Column<T>, row: T) => (c.kind === 'rate' ? fmtRate(c.value(row) as number | null) : num(c.value(row) as number));
</script>

{#if rows.length === 0}
  <p class="empty">{empty}</p>
{:else}
  {#if reducible}
    <div class="cols">
      <button type="button" class="btn btn-quiet btn-sm" aria-pressed={tablePrefs.all} onclick={() => tablePrefs.toggle()}>
        <Icon name="tune" size={16} />
        {tablePrefs.all ? 'Jen hlavní statistiky' : `Všechny statistiky (${columns.length})`}
      </button>
    </div>
  {/if}
  <!-- svelte-ignore a11y_no_noninteractive_tabindex (scrollable region must be keyboard-reachable) -->
  <div class="wrap" role="region" aria-label={caption ?? nameLabel} tabindex="0">
    <table>
      {#if caption}<caption class="visually-hidden">{caption}</caption>{/if}
      <thead>
        <tr>
          <th scope="col" class="name" aria-sort={nameSort ? ariaSort('__name') : undefined}>
            {#if nameSort}
              <button type="button" onclick={() => sortBy('__name')}>{nameLabel}</button>
            {:else}
              {nameLabel}
            {/if}
          </th>
          {#each visible as c (c.key)}
            <th scope="col" aria-sort={ariaSort(c.key)} class:active={sortKey === c.key} class:rate={c.kind === 'rate'}>
              <button type="button" title={c.title} onclick={() => sortBy(c.key, c.lowerIsBetter)}>
                {c.label}
                <span class="arrow" aria-hidden="true">{sortKey === c.key ? (sortDir === -1 ? '▾' : '▴') : ''}</span>
              </button>
            </th>
          {/each}
        </tr>
      </thead>
      <tbody>
        {#each sorted as row (rowKey(row))}
          <tr animate:flip={{ duration: 280 }}>
            <th scope="row" class="name">{@render name(row)}</th>
            {#each visible as c (c.key)}
              <td class:active={sortKey === c.key} class:rate={c.kind === 'rate'}>{show(c, row)}</td>
            {/each}
          </tr>
        {/each}
      </tbody>
      {#if totals}
        <tfoot>
          <tr>
            <th scope="row" class="name">{totals.label}</th>
            {#each visible as c (c.key)}
              <td class:rate={c.kind === 'rate'}>{show(c, totals.row)}</td>
            {/each}
          </tr>
        </tfoot>
      {/if}
    </table>
  </div>
{/if}

<style>
  .cols {
    display: flex;
    justify-content: flex-end;
    margin: -4px 0 6px;
  }
  .wrap {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
    border: 1px solid var(--line);
    border-radius: var(--r-l);
    background: var(--surface);
    box-shadow: var(--shadow);
    overscroll-behavior-x: contain;
  }
  table {
    border-collapse: separate;
    border-spacing: 0;
    width: 100%;
    font-size: 14.5px;
    font-variant-numeric: tabular-nums;
  }
  th,
  td {
    padding: 11px 10px;
    text-align: right;
    white-space: nowrap;
    border-bottom: 1px solid var(--line);
    background: var(--surface);
  }
  tbody tr:last-child th,
  tbody tr:last-child td {
    border-bottom: none;
  }
  thead th {
    position: sticky;
    top: 0;
    z-index: 2;
    color: var(--faint);
    font-weight: 600;
    font-size: 12.5px;
    padding: 0;
  }
  thead th button {
    all: unset;
    box-sizing: border-box;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 2px;
    width: 100%;
    padding: 14px 10px 10px;
    cursor: pointer;
  }
  thead th button:hover {
    color: var(--ink);
  }
  thead th button:focus-visible {
    outline: 2px solid var(--focus);
    outline-offset: -2px;
  }
  thead th.name button {
    justify-content: flex-start;
  }
  thead th.active {
    color: var(--accent-text);
  }
  .arrow {
    width: 0.7em;
    font-size: 10px;
  }
  .name {
    position: sticky;
    left: 0;
    z-index: 1;
    text-align: left;
    font-weight: 600;
    min-width: 160px;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    padding-left: 16px;
  }
  thead th.name {
    z-index: 3;
    padding-left: 6px;
  }
  thead th.name:not(:has(button)) {
    padding: 14px 10px 10px 16px;
  }
  td.active {
    background: var(--surface-2);
    font-weight: 800;
    color: var(--ink);
  }
  td {
    color: var(--muted);
  }
  td.rate {
    color: var(--ink);
    font-weight: 700;
  }
  tbody tr:hover th,
  tbody tr:hover td {
    background: var(--surface-2);
  }
  tfoot th,
  tfoot td {
    font-weight: 800;
    color: var(--ink);
    background: var(--surface-2);
    border-top: 1px solid var(--line-strong);
    border-bottom: none;
  }
  @media (max-width: 520px) {
    th,
    td {
      padding: 10px 8px;
    }
    .name {
      min-width: 132px;
      max-width: 160px;
      padding-left: 12px;
    }
  }
</style>
