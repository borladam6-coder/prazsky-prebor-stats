// Statistic definitions shared by tables, leaderboards and the entry pad.
// Formulas live in the database (views); the browser only displays them.

import type { PaResult } from './types.ts';

export type StatKey =
  | 'games' | 'pa' | 'ab' | 'h' | 'singles' | 'doubles' | 'triples' | 'hr' | 'tb'
  | 'rbi' | 'r' | 'bb' | 'k' | 'hbp' | 'sf' | 'sh' | 'sb'
  | 'avg' | 'obp' | 'slg' | 'ops';

export interface StatDef {
  key: StatKey;
  label: string;
  title: string;
  kind: 'count' | 'rate';
  /** true when a lower value is better (strikeouts) */
  lowerIsBetter?: boolean;
}

export const STATS: Record<StatKey, StatDef> = {
  games: { key: 'games', label: 'Z', title: 'Zápasy', kind: 'count' },
  pa: { key: 'pa', label: 'PA', title: 'Příchody na pálku', kind: 'count' },
  ab: { key: 'ab', label: 'AB', title: 'Oficiální příchody na pálku (bez BB, HBP, SF, SH)', kind: 'count' },
  h: { key: 'h', label: 'H', title: 'Úspěšné odpaly', kind: 'count' },
  singles: { key: 'singles', label: '1B', title: 'Jednometové odpaly', kind: 'count' },
  doubles: { key: 'doubles', label: '2B', title: 'Dvoumetové odpaly', kind: 'count' },
  triples: { key: 'triples', label: '3B', title: 'Třímetové odpaly', kind: 'count' },
  hr: { key: 'hr', label: 'HR', title: 'Homeruny', kind: 'count' },
  tb: { key: 'tb', label: 'TB', title: 'Celkem met z odpalů', kind: 'count' },
  rbi: { key: 'rbi', label: 'RBI', title: 'Doběhy zajištěné pálkařem', kind: 'count' },
  r: { key: 'r', label: 'R', title: 'Doběhy', kind: 'count' },
  bb: { key: 'bb', label: 'BB', title: 'Mety za bally', kind: 'count' },
  k: { key: 'k', label: 'K', title: 'Strikeouty', kind: 'count', lowerIsBetter: true },
  hbp: { key: 'hbp', label: 'HBP', title: 'Zásahy nadhozem', kind: 'count' },
  sf: { key: 'sf', label: 'SF', title: 'Obětované odpaly do pole', kind: 'count' },
  sh: { key: 'sh', label: 'SH', title: 'Obětované bunty', kind: 'count' },
  sb: { key: 'sb', label: 'SB', title: 'Ukradené mety', kind: 'count' },
  avg: { key: 'avg', label: 'AVG', title: 'Pálkařský průměr = H / AB', kind: 'rate' },
  obp: { key: 'obp', label: 'OBP', title: 'Procento na metě = (H + BB + HBP) / (AB + BB + HBP + SF)', kind: 'rate' },
  slg: { key: 'slg', label: 'SLG', title: 'Síla odpalu = TB / AB', kind: 'rate' },
  ops: { key: 'ops', label: 'OPS', title: 'OBP + SLG', kind: 'rate' }
};

/** Column order of a full batting table. */
export const TABLE_STATS: StatKey[] = [
  'games', 'pa', 'ab', 'h', 'singles', 'doubles', 'triples', 'hr', 'rbi', 'r',
  'bb', 'k', 'hbp', 'sf', 'sh', 'sb', 'avg', 'obp', 'slg', 'ops'
];

/** Column order of a single-game box score. */
export const BOX_STATS: StatKey[] = [
  'pa', 'ab', 'h', 'singles', 'doubles', 'triples', 'hr', 'rbi', 'r', 'bb', 'k', 'hbp', 'sf', 'sh', 'sb'
];

/** Stats offered on the home page leaderboard. */
export const LEADER_STATS: StatKey[] = ['avg', 'obp', 'slg', 'ops', 'h', 'hr', 'rbi', 'r', 'sb', 'bb'];

export interface ResultDef {
  code: PaResult;
  label: string;
  group: 'hit' | 'onbase' | 'out';
}

export const RESULTS: ResultDef[] = [
  { code: '1B', label: 'Jednometový', group: 'hit' },
  { code: '2B', label: 'Dvoumetový', group: 'hit' },
  { code: '3B', label: 'Třímetový', group: 'hit' },
  { code: 'HR', label: 'Homerun', group: 'hit' },
  { code: 'BB', label: 'Meta za bally', group: 'onbase' },
  { code: 'HBP', label: 'Zásah nadhozem', group: 'onbase' },
  { code: 'K', label: 'Strikeout', group: 'out' },
  { code: 'OUT', label: 'Aut v poli', group: 'out' },
  { code: 'SF', label: 'Obětovaný do pole', group: 'out' },
  { code: 'SH', label: 'Obětovaný bunt', group: 'out' },
  { code: 'FC', label: 'Volba polaře', group: 'out' },
  { code: 'ROE', label: 'Chyba obrany', group: 'out' }
];

export const resultDef = (code: string) => RESULTS.find((r) => r.code === code);

/** Sort helper: numbers descending (or ascending), NULL always last. */
export function compareStat(a: unknown, b: unknown, dir: 1 | -1): number {
  const an = a === null || a === undefined ? null : Number(a);
  const bn = b === null || b === undefined ? null : Number(b);
  if (an === null && bn === null) return 0;
  if (an === null) return 1;
  if (bn === null) return -1;
  return (an - bn) * dir;
}
