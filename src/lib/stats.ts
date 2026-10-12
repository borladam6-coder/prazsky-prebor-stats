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
  games: { key: 'games', label: 'G', title: 'Games', kind: 'count' },
  pa: { key: 'pa', label: 'PA', title: 'Plate appearances', kind: 'count' },
  ab: { key: 'ab', label: 'AB', title: 'At bats (bez BB, HBP, SF, SH)', kind: 'count' },
  h: { key: 'h', label: 'H', title: 'Hits', kind: 'count' },
  singles: { key: 'singles', label: '1B', title: 'Singles', kind: 'count' },
  doubles: { key: 'doubles', label: '2B', title: 'Doubles', kind: 'count' },
  triples: { key: 'triples', label: '3B', title: 'Triples', kind: 'count' },
  hr: { key: 'hr', label: 'HR', title: 'Home runs', kind: 'count' },
  tb: { key: 'tb', label: 'TB', title: 'Total bases', kind: 'count' },
  rbi: { key: 'rbi', label: 'RBI', title: 'Runs batted in', kind: 'count' },
  r: { key: 'r', label: 'R', title: 'Runs', kind: 'count' },
  bb: { key: 'bb', label: 'BB', title: 'Base on balls', kind: 'count' },
  k: { key: 'k', label: 'K', title: 'Strikeouts', kind: 'count', lowerIsBetter: true },
  hbp: { key: 'hbp', label: 'HBP', title: 'Hit by pitch', kind: 'count' },
  sf: { key: 'sf', label: 'SF', title: 'Sacrifice flies', kind: 'count' },
  sh: { key: 'sh', label: 'SH', title: 'Sacrifice bunts', kind: 'count' },
  sb: { key: 'sb', label: 'SB', title: 'Stolen bases', kind: 'count' },
  avg: { key: 'avg', label: 'AVG', title: 'Batting average = H / AB', kind: 'rate' },
  obp: { key: 'obp', label: 'OBP', title: 'On-base percentage = (H + BB + HBP) / (AB + BB + HBP + SF)', kind: 'rate' },
  slg: { key: 'slg', label: 'SLG', title: 'Slugging = TB / AB', kind: 'rate' },
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

// Official English scorebook names (the codes are the usual scoring abbreviations).
export const RESULTS: ResultDef[] = [
  { code: '1B', label: 'Single', group: 'hit' },
  { code: '2B', label: 'Double', group: 'hit' },
  { code: '3B', label: 'Triple', group: 'hit' },
  { code: 'HR', label: 'Home run', group: 'hit' },
  { code: 'BB', label: 'Base on balls', group: 'onbase' },
  { code: 'HBP', label: 'Hit by pitch', group: 'onbase' },
  { code: 'K', label: 'Strikeout', group: 'out' },
  { code: 'OUT', label: 'Out', group: 'out' },
  { code: 'SF', label: 'Sacrifice fly', group: 'out' },
  { code: 'SH', label: 'Sacrifice bunt', group: 'out' },
  { code: 'CI', label: "Catcher's interference", group: 'onbase' },
  { code: 'FC', label: "Fielder's choice", group: 'out' },
  { code: 'ROE', label: 'Reached on error', group: 'out' }
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
