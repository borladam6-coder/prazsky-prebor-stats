// Live scoring logic: default runner advancement, RBI suggestion and validation.
// Pure functions without Svelte imports so they can be unit-tested with node --test.
// The database (live_play) enforces the same rules; this only makes the UI helpful.

import type { PaResult } from './types.ts';

/** 0 = out, 1–3 = base, 4 = scored. */
export type Dest = 0 | 1 | 2 | 3 | 4;
export type Base = 1 | 2 | 3;

/** Runner (player id) on each base. */
export type Bases = [string | null, string | null, string | null];

export interface RunnerMove {
  from: Base;
  to: Dest;
  sb?: boolean;
}

export interface Play {
  result: PaResult | null;
  batterTo: Dest | null;
  runners: RunnerMove[];
  rbi: number;
}

/** Where a batter may end up with a given result (inclusive range). */
export const BATTER_RANGE: Record<PaResult, [Dest, Dest]> = {
  '1B': [1, 4],
  '2B': [2, 4],
  '3B': [3, 4],
  HR: [4, 4],
  BB: [1, 4],
  HBP: [1, 4],
  FC: [1, 4],
  ROE: [1, 4],
  K: [0, 4], // a dropped third strike lets the batter run
  OUT: [0, 0],
  SF: [0, 0],
  SH: [0, 1]
};

export const occupied = (bases: Bases): Base[] =>
  ([1, 2, 3] as Base[]).filter((b) => bases[b - 1] !== null);

/** Runners that must advance when the batter reaches first base. */
export function forced(bases: Bases): Set<Base> {
  const f = new Set<Base>();
  if (bases[0]) {
    f.add(1);
    if (bases[1]) {
      f.add(2);
      if (bases[2]) f.add(3);
    }
  }
  return f;
}

const clamp = (n: number): Dest => Math.min(4, Math.max(0, n)) as Dest;

/**
 * The usual outcome of a result: e.g. a single moves only forced runners
 * (four singles in a row = one run), a double moves everyone two bases.
 * The scorer can change any runner afterwards.
 */
export function defaultPlay(result: PaResult, bases: Bases, outs: number): Play {
  const on = occupied(bases);
  const f = forced(bases);
  const moves = new Map<Base, Dest>(on.map((b) => [b, b as Dest]));
  let batterTo: Dest;

  switch (result) {
    case '1B':
    case 'BB':
    case 'HBP':
    case 'ROE':
      batterTo = 1;
      for (const b of on) if (f.has(b)) moves.set(b, clamp(b + 1));
      break;
    case 'FC':
      batterTo = 1;
      if (bases[0]) {
        // most common fielder's choice: runner from first forced out at second
        moves.set(1, 0);
        for (const b of on) if (b !== 1 && f.has(b)) moves.set(b, clamp(b + 1));
      } else if (on.length) {
        moves.set(on[on.length - 1], 0); // lead runner out
      }
      break;
    case '2B':
      batterTo = 2;
      for (const b of on) moves.set(b, clamp(b + 2));
      break;
    case '3B':
      batterTo = 3;
      for (const b of on) moves.set(b, 4);
      break;
    case 'HR':
      batterTo = 4;
      for (const b of on) moves.set(b, 4);
      break;
    case 'SF':
      batterTo = 0;
      if (bases[2]) moves.set(3, 4);
      break;
    case 'SH':
      batterTo = 0;
      for (const b of on) moves.set(b, clamp(b + 1));
      break;
    default: // K, OUT
      batterTo = 0;
  }

  let runners: RunnerMove[] = on.map((b) => ({ from: b, to: moves.get(b)! }));

  // No run scores when the play ends the inning (force out / batter out);
  // the remaining runners are left where they were, the bases are cleared anyway.
  const playOuts = (batterTo === 0 ? 1 : 0) + runners.filter((r) => r.to === 0).length;
  if (outs + playOuts >= 3) {
    runners = runners.map((r) => (r.to === 0 ? r : { ...r, to: r.from }));
  }

  const play: Play = { result, batterTo, runners, rbi: 0 };
  play.rbi = defaultRbi(play);
  return play;
}

export function runsOn(play: Pick<Play, 'batterTo' | 'runners'>): number {
  return play.runners.filter((r) => r.to === 4).length + (play.batterTo === 4 ? 1 : 0);
}

export function outsOn(play: Pick<Play, 'batterTo' | 'runners'>): number {
  return play.runners.filter((r) => r.to === 0).length + (play.batterTo === 0 ? 1 : 0);
}

/**
 * RBI suggestion: every run on the play counts, except on an error (ROE),
 * a strikeout or a double play. HR and SF always have at least one.
 */
export function defaultRbi(play: Pick<Play, 'result' | 'batterTo' | 'runners'>): number {
  if (!play.result) return 0;
  const runs = runsOn(play);
  let rbi = play.result === 'ROE' || play.result === 'K' || outsOn(play) >= 2 ? 0 : runs;
  if (play.result === 'HR' || play.result === 'SF') rbi = Math.max(rbi, 1);
  return Math.min(rbi, 4, runs);
}

/** Returns a Czech error message, or null when the play is valid. Mirrors live_play(). */
export function validatePlay(play: Play, bases: Bases, outs: number): string | null {
  const on = occupied(bases);
  const seen = new Set<number>();
  const taken = new Set<number>();
  const pairs: { from: number; to: number }[] = [];

  for (const r of play.runners) {
    if (seen.has(r.from)) return 'Běžec je v zápisu dvakrát.';
    seen.add(r.from);
    if (!bases[r.from - 1]) return `Na ${r.from}. metě nikdo není.`;
    if (r.to !== 0 && r.to < r.from) return 'Běžec nemůže couvat.';
    if (r.sb && (play.result || r.to === 0 || r.to === r.from)) return 'Ukradenou metu lze zapsat jen mimo odpal a jen s postupem běžce.';
    if (r.to >= 1 && r.to <= 3) {
      if (taken.has(r.to)) return 'Na jedné metě nemohou být dva běžci.';
      taken.add(r.to);
    }
    pairs.push({ from: r.from, to: r.to });
  }
  for (const b of on) if (!seen.has(b)) return `Chybí, co se stalo s běžcem na ${b}. metě.`;

  if (!play.result) {
    if (play.batterTo !== null || play.rbi) return 'Bez výsledku na pálce nejde zapsat pálkaře ani RBI.';
    if (!play.runners.some((r) => r.to !== r.from)) return 'Žádný běžec se neposunul.';
  } else {
    if ((play.result === 'SF' || play.result === 'SH') && outs >= 2) return 'Obětovaný odpal jde jen při méně než 2 autech.';
    const [lo, hi] = BATTER_RANGE[play.result];
    if (play.batterTo === null || play.batterTo < lo || play.batterTo > hi) return 'Pálkař s tímto výsledkem nemůže skončit na zadané metě.';
    if (play.batterTo >= 1 && play.batterTo <= 3) {
      if (taken.has(play.batterTo)) return 'Na jedné metě nemohou být dva běžci.';
    }
    pairs.push({ from: 0, to: play.batterTo });
    const runs = runsOn(play);
    if (play.result === 'SF' && runs === 0) return 'Při obětovaném odpalu do pole musí doběhnout aspoň jeden běžec.';
    if ((play.result === 'HR' || play.result === 'SF') && play.rbi < 1) return 'HR i SF mají vždy aspoň 1 RBI.';
    if (play.rbi < 0 || play.rbi > Math.min(4, runs)) return 'RBI nemůže být víc než doběhů v této akci.';
  }

  for (const a of pairs) {
    for (const b of pairs) {
      if (a.from < b.from && a.to !== 0 && b.to !== 0 && !(a.to < b.to || (a.to === 4 && b.to === 4))) {
        return 'Běžec nemůže předběhnout běžce před sebou.';
      }
    }
  }
  if (outs + outsOn(play) > 3) return 'V jedné směně nemohou být víc než 3 auty.';
  return null;
}

export interface LiveState {
  inning: number;
  outs: number;
  bases: Bases;
  nextSlot: number;
}

/** State after the play (same as the database computes). */
export function applyPlay(state: LiveState, lineup: string[], play: Play): LiveState & { runs: number; inningOver: boolean } {
  const total = state.outs + outsOn(play);
  const nextSlot = play.result ? (state.nextSlot + 1) % lineup.length : state.nextSlot;
  const runs = runsOn(play);
  if (total >= 3) {
    return { inning: state.inning + 1, outs: 0, bases: [null, null, null], nextSlot, runs, inningOver: true };
  }
  const bases: Bases = [null, null, null];
  for (const r of play.runners) if (r.to >= 1 && r.to <= 3) bases[r.to - 1] = state.bases[r.from - 1];
  if (play.result && play.batterTo !== null && play.batterTo >= 1 && play.batterTo <= 3) {
    bases[play.batterTo - 1] = lineup[state.nextSlot];
  }
  return { inning: state.inning, outs: total, bases, nextSlot, runs, inningOver: false };
}

/** Destinations offered for a runner starting on `from` (out, stay, further bases, home). */
export const runnerChoices = (from: Base): Dest[] => [0, ...([1, 2, 3, 4] as Dest[]).filter((d) => d >= from)];

/** Destinations offered for the batter with a given result. */
export function batterChoices(result: PaResult): Dest[] {
  const [lo, hi] = BATTER_RANGE[result];
  return ([0, 1, 2, 3, 4] as Dest[]).filter((d) => d >= lo && d <= hi);
}

export const destLabel = (d: Dest, from?: number): string =>
  d === 0 ? 'Aut' : d === 4 ? 'Doběhl' : d === from ? `Zůstal (${d}.)` : `${d}. meta`;
