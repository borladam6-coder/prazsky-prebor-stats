// Play-by-play in English, like an official game log:
//   "Lehký Lukáš grounds into a double play to shortstop. Krátký Karel forced out at 2nd. Lehký Lukáš out at 1st."
// Built from what the scorer recorded (result, kind of out, where the ball went, where
// every runner ended). Pure functions, unit-tested.

import type { PaResult } from './types.ts';

export type PlayKind = 'fly' | 'line' | 'pop' | 'ground' | 'fc' | 'dp' | 'bunt';
export type FieldPos = 'P' | 'C' | '1B' | '2B' | '3B' | 'SS' | 'LF' | 'CF' | 'RF';

export const FIELD_POSITIONS: { pos: FieldPos; label: string; fielder: string }[] = [
  { pos: 'LF', label: 'left field', fielder: 'left fielder' },
  { pos: 'CF', label: 'center field', fielder: 'center fielder' },
  { pos: 'RF', label: 'right field', fielder: 'right fielder' },
  { pos: '3B', label: 'third base', fielder: 'third baseman' },
  { pos: 'SS', label: 'shortstop', fielder: 'shortstop' },
  { pos: '2B', label: 'second base', fielder: 'second baseman' },
  { pos: '1B', label: 'first base', fielder: 'first baseman' },
  { pos: 'P', label: 'pitcher', fielder: 'pitcher' },
  { pos: 'C', label: 'catcher', fielder: 'catcher' }
];
const where = (pos: FieldPos | null) => (pos ? FIELD_POSITIONS.find((p) => p.pos === pos)!.label : null);
const fielder = (pos: FieldPos | null) => (pos ? FIELD_POSITIONS.find((p) => p.pos === pos)!.fielder : null);

export interface RunnerDetail {
  from: number;
  to: number;
  sb?: boolean;
  player: string | null;
}

export interface PlayDetail {
  inning: number;
  outsBefore: number;
  batterId: string | null;
  /** result as recorded with the play (may have been edited since) */
  result: PaResult | null;
  kind: PlayKind | null;
  location: FieldPos | null;
  batterTo: number | null;
  runners: RunnerDetail[];
}

const BASE = ['home', '1st', '2nd', '3rd', 'home'];
const HIT_BASES: Partial<Record<PaResult, number>> = { '1B': 1, '2B': 2, '3B': 3, HR: 4 };
export const isHit = (r: PaResult | null | undefined) => !!r && r in HIT_BASES;
const flyLike = (k: PlayKind | null) => k === 'fly' || k === 'line' || k === 'pop';

/** What the batter did, e.g. "singles to left field", "grounds into a double play". */
function batterPhrase(d: PlayDetail, result: PaResult, runs: number): string {
  const to = where(d.location);
  const at = (verb: string) => (to ? `${verb} to ${to}` : verb);
  // an edited result drops the recorded kind; where the ball went stays, but who made
  // the error or fielded it is not known then
  const edited = result !== d.result;
  const kind = edited ? null : d.kind;
  const by = edited ? null : fielder(d.location);
  switch (result) {
    case '1B':
      return at('singles');
    case '2B':
      return at('doubles');
    case '3B':
      return at('triples');
    case 'HR':
      if (runs >= 4) return to ? `hits a grand slam to ${to}` : 'hits a grand slam';
      return `${at('homers')}${runs === 1 ? '' : ` (${runs}-run home run)`}`;
    case 'BB':
      return 'walks';
    case 'HBP':
      return 'is hit by a pitch';
    case 'CI':
      return "reaches on catcher's interference";
    case 'K':
      return (d.batterTo ?? 0) > 0 ? 'strikes out but reaches on a dropped third strike' : 'strikes out';
    case 'ROE':
      return by ? `reaches on an error by the ${by}` : 'reaches on an error';
    case 'FC':
      return by ? `reaches on a fielder's choice, fielded by the ${by}` : "reaches on a fielder's choice";
    case 'SF':
      return at('hits a sacrifice fly');
    case 'SH':
      return at('lays down a sacrifice bunt');
    case 'OUT':
      if (kind === 'dp') return at('grounds into a double play');
      if (kind === 'line') return at('lines out');
      if (kind === 'pop') return at('pops out');
      if (kind === 'fly') return at('flies out');
      if (kind === 'ground') return at('grounds out');
      if (kind === 'bunt') return at('bunts out');
      return to ? `is out, ${to}` : 'is out';
  }
}

/** Was this runner forced to run (every base behind him taken, the batter running)? */
function forcedRunner(d: PlayDetail, from: number, result: PaResult): boolean {
  const ballOnGround = !flyLike(d.kind) && result !== 'K' && result !== 'SF';
  const batterRuns = d.batterTo !== null && (d.batterTo > 0 || ballOnGround);
  if (!batterRuns) return false;
  for (let b = 1; b < from; b++) if (!d.runners.some((r) => r.from === b)) return false;
  return true;
}

/**
 * One sentence (or a few short ones) describing the play.
 * `result` is the current result (after edits), `name` turns a player id into a name.
 */
export function narrate(d: PlayDetail, result: PaResult | null, name: (id: string | null) => string): string {
  const parts: string[] = [];
  const runs = d.runners.filter((r) => r.to === 4).length + (d.batterTo === 4 ? 1 : 0);
  const batter = name(d.batterId);

  if (result) {
    parts.push(`${batter} ${batterPhrase(d, result, runs)}`);
  }

  // runners, lead runner first
  const runners = [...d.runners].sort((a, b) => b.from - a.from);
  for (const r of runners) {
    const who = name(r.player);
    if (r.to === 4) {
      parts.push(r.sb && !result && r.from === 3 ? `${who} steals home` : `${who} scores`);
    } else if (r.to === 0) {
      if (!result) parts.push(`${who} caught stealing ${BASE[r.from + 1]}`);
      // a line drive or a pop up catches the runner off the base; on a fly ball he is
      // usually thrown out after tagging up
      else if (d.kind === 'line' || d.kind === 'pop') parts.push(`${who} doubled off ${BASE[r.from]}`);
      else if (d.kind === 'fly' || result === 'SF') parts.push(`${who} out at ${BASE[r.from + 1]} after tagging up`);
      else if (forcedRunner(d, r.from, result)) parts.push(`${who} forced out at ${BASE[r.from + 1]}`);
      else parts.push(`${who} out at ${BASE[r.from + 1]}`);
    } else if (r.to > r.from) {
      if (r.sb && !result) parts.push(r.to === r.from + 1 ? `${who} steals ${BASE[r.to]}` : `${who} steals ${BASE[r.from + 1]}, to ${BASE[r.to]}`);
      else if (!result) parts.push(`${who} advances to ${BASE[r.to]}`);
      else parts.push(`${who} to ${BASE[r.to]}`);
    }
  }

  // the batter beyond the base of his hit, or out at a base (double play, stretching a hit)
  if (result && d.batterTo !== null) {
    const nominal = HIT_BASES[result] ?? (['BB', 'HBP', 'ROE', 'FC', 'CI'].includes(result) ? 1 : 0);
    if (d.batterTo === 4 && result !== 'HR') parts.push(`${batter} scores`);
    else if (d.batterTo > nominal && d.batterTo < 4 && nominal > 0) parts.push(`${batter} to ${BASE[d.batterTo]}`);
    else if (d.batterTo === 0 && isHit(result)) parts.push(`${batter} out at ${BASE[nominal + 1]}`);
    else if (d.batterTo === 0 && (d.kind === 'dp' || d.runners.some((r) => r.to === 0)) && !flyLike(d.kind)) parts.push(`${batter} out at 1st`);
  }

  return parts.map((p) => `${p}.`).join(' ');
}

export interface HalfSummary {
  runs: number;
  hits: number;
  errors: number;
  /** runners left on base when the half ended (null while it is still going or unknown) */
  lob: number | null;
}

/** Totals of one half-inning, like the line under each half in an official game log. */
export function halfSummary(
  plays: { kind: 'play' | 'adjust'; result: PaResult | null; runs: number; inningEnded: boolean; detail?: PlayDetail | null }[]
): HalfSummary {
  const runs = plays.reduce((a, p) => a + p.runs, 0);
  const hits = plays.filter((p) => p.kind === 'play' && isHit(p.result)).length;
  const errors = plays.filter((p) => p.kind === 'play' && p.result === 'ROE').length;
  const last = [...plays].reverse().find((p) => p.kind === 'play');
  let lob: number | null = null;
  if (last?.inningEnded && last.detail) {
    const d = last.detail;
    lob = d.runners.filter((r) => r.to >= 1 && r.to <= 3).length + (d.batterTo !== null && d.batterTo >= 1 && d.batterTo <= 3 ? 1 : 0);
  }
  return { runs, hits, errors, lob };
}
