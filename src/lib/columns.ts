import type { Column } from './components/StatTable.svelte';
import { STATS, type StatKey } from './stats.ts';

/** Table columns for the given statistics; rows must carry the stat keys as fields. */
export function statColumns<T>(keys: StatKey[]): Column<T>[] {
  return keys.map((k) => ({
    key: k,
    label: STATS[k].label,
    title: STATS[k].title,
    kind: STATS[k].kind,
    lowerIsBetter: STATS[k].lowerIsBetter,
    value: (row: T) => (row as Record<string, number | null>)[k]
  }));
}
