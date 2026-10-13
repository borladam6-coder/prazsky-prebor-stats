// Live scoring logic: default runner advancement, RBI suggestion and validation.
// Pure functions without Svelte imports so they can be unit-tested with node --test.
// The database (live_play) enforces the same rules; this only makes the UI helpful.

import type { PaResult } from './types.ts';
import type { FieldPos, PlayKind } from './narrate.ts';

/** 0 = out, 1–3 = base, 4 = scored. */
export type Dest = 0 | 1 | 2 | 3 | 4;
export type Base = 1 | 2 | 3;

/** Runner (player id) on each base. */
export type Bases = [string | null, string | null, string | null];

export interface RunnerMove {
  from: Base;
  to: Dest;
  /** stolen base (counts in the statistics); always equal to why === 'sb' when why is set */
  sb?: boolean;
  /** why the runner moved or was put out (play-by-play only, except SB) */
  why?: RunnerWhy | null;
}

/**
 * Why a runner moved without a batted ball (sb, wp, pb), was put out without one
 * (cs = caught stealing, po = picked off) or was put out for interference on a batted ball.
 */
export type RunnerWhy = 'sb' | 'wp' | 'pb' | 'cs' | 'po' | 'int';
export const ADVANCE_WHY: { why: RunnerWhy; label: string; title: string }[] = [
  { why: 'sb', label: 'SB', title: 'Stolen base' },
  { why: 'wp', label: 'WP', title: 'Wild pitch' },
  { why: 'pb', label: 'PB', title: 'Passed ball' }
];
export const OUT_WHY: { why: RunnerWhy; label: string; title: string }[] = [
  { why: 'cs', label: 'CS', title: 'Caught stealing' },
  { why: 'po', label: 'Pickoff', title: 'Picked off' }
];

/** Runner interference on a batted ball: hit by the ball (batter gets 1B) or hindered a fielder (FC). */
export type InterferenceKind = 'rhit' | 'rint';
export const INTERFERENCE: { kind: InterferenceKind; result: PaResult; label: string; hint: string }[] = [
  { kind: 'rhit', result: '1B', label: 'Běžec trefen odpáleným míčem', hint: 'Běžec je out, pálkař na 1. metu a dostane 1B (hit).' },
  { kind: 'rint', result: 'FC', label: 'Běžec bránil polaři', hint: 'Běžec je out, pálkař na 1. metu, zapíše se FC (AB bez hitu).' }
];
export const isInterference = (k: string | null | undefined): k is InterferenceKind => k === 'rhit' || k === 'rint';

/** Chip for a play without a batter: the reason of the first runner that has one. */
export function runnerPlayChip(runners: { sb?: boolean; why?: string | null }[] | null | undefined): string {
  for (const r of runners ?? []) {
    const w = [...ADVANCE_WHY, ...OUT_WHY].find((x) => x.why === r.why);
    if (w) return w.why === 'po' ? 'PO' : w.label;
    if (r.sb) return 'SB';
  }
  return 'BĚH';
}

export interface Play {
  result: PaResult | null;
  batterTo: Dest | null;
  runners: RunnerMove[];
  rbi: number;
  /** how the ball was put in play (for the play-by-play; not part of the statistics) */
  kind?: PlayKind | null;
  /** where the ball went (optional, detailed scoring) */
  location?: FieldPos | null;
  /** why the batter got past the base of his hit (optional): on an error or on the throw */
  extra?: BatterExtra | null;
}

export type BatterExtra = 'error' | 'throw';
const HIT_BASE: Partial<Record<PaResult, number>> = { '1B': 1, '2B': 2, '3B': 3 };
/** base the result alone gives the batter (1 for a walk, 2 for a double …), 0 for an out */
export function nominalBase(result: PaResult): number {
  return HIT_BASE[result] ?? (['BB', 'HBP', 'ROE', 'FC', 'CI'].includes(result) ? 1 : result === 'HR' ? 4 : 0);
}
/** the batter is out after a hit: thrown out trying for one more base */
export const outAfterHit = (p: Pick<Play, 'result' | 'batterTo'>) => !!p.result && p.result in HIT_BASE && p.batterTo === 0;

/** Where a batter may end up with a given result (inclusive range). */
export const BATTER_RANGE: Record<PaResult, [Dest, Dest]> = {
  // a hit stays a hit when the batter is then put out trying for one more base (0)
  '1B': [0, 4],
  '2B': [0, 4],
  '3B': [0, 4],
  HR: [4, 4],
  BB: [1, 4],
  HBP: [1, 4],
  FC: [1, 4],
  ROE: [1, 4],
  K: [0, 4], // a dropped third strike lets the batter run
  OUT: [0, 0],
  SF: [0, 0],
  SH: [0, 1],
  CI: [1, 4] // catcher's interference: batter awarded first base
};

/** From this inning on every half starts with a runner on 2nd (tie-breaker). */
export const TIEBREAK_INNING = 8;
/** A regular game has this many innings. */
export const REGULATION_INNINGS = 7;

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
    case 'CI':
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

/**
 * A dropped third strike lets the batter run only with first base empty or two outs.
 */
export function mayRunOnDroppedThird(bases: Bases, outs: number): boolean {
  return !bases[0] || outs >= 2;
}

/** The play makes the third out. */
export const endsInning = (play: Pick<Play, 'batterTo' | 'runners'>, outs: number) => outs + outsOn(play) >= 3;

/**
 * Runs on a play that ends the inning count only when the third out is a runner put out
 * without a force (a time play). They never count when the batter is out (strikeout,
 * caught fly, ground out before first) or a runner is forced out.
 */
export function runsCountOnThirdOut(play: Pick<Play, 'result' | 'batterTo' | 'runners'>, bases: Bases): boolean {
  if (!play.result) return true; // runner-only play: e.g. caught stealing after a run scored
  // runner interference: the ball is dead, the out ends the play
  if (play.runners.some((r) => r.why === 'int')) return false;
  // batter out after a hit (tagged trying for one more base) is a time play too
  if (play.batterTo === null || (play.batterTo === 0 && !outAfterHit(play))) return false;
  for (const r of play.runners) {
    if (r.to !== 0) continue;
    let forcedOut = true;
    for (let b = 1; b < r.from; b++) if (!bases[b - 1]) forcedOut = false;
    if (forcedOut) return false;
  }
  return true;
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
    if (r.sb && (play.result || r.to === 0 || r.to === r.from)) return 'Stolen base lze zapsat jen mimo odpal a jen s postupem běžce.';
    if (r.why && !!r.sb !== (r.why === 'sb')) return 'Stolen base nesouhlasí s důvodem postupu.';
    if ((r.why === 'sb' || r.why === 'wp' || r.why === 'pb') && (play.result || r.to === 0 || r.to <= r.from)) {
      return 'SB, WP a PB jde zapsat jen u postupu běžce mimo odpal.';
    }
    if ((r.why === 'cs' || r.why === 'po') && (play.result || r.to !== 0)) return 'Caught stealing a pickoff jde zapsat jen u outu běžce mimo odpal.';
    if (r.why === 'int' && (!isInterference(play.kind) || r.to !== 0)) return 'Interference jde zapsat jen u outu běžce při odpalu.';
    if (r.to >= 1 && r.to <= 3) {
      if (taken.has(r.to)) return 'Na jedné metě nemohou být dva běžci.';
      taken.add(r.to);
    }
    pairs.push({ from: r.from, to: r.to });
  }
  for (const b of on) if (!seen.has(b)) return `Chybí, co se stalo s běžcem na ${b}. metě.`;

  if (isInterference(play.kind)) {
    const def = INTERFERENCE.find((i) => i.kind === play.kind)!;
    if (play.result !== def.result || play.batterTo !== 1 || play.runners.filter((r) => r.why === 'int').length !== 1) {
      return 'Při interference běžce je jeden běžec out a pálkař na 1. metě.';
    }
  }

  if (!play.result) {
    if (play.batterTo !== null || play.rbi) return 'Bez výsledku na pálce nejde zapsat pálkaře ani RBI.';
    if (!play.runners.some((r) => r.to !== r.from)) return 'Žádný běžec se neposunul.';
  } else {
    if ((play.result === 'SF' || play.result === 'SH') && outs >= 2) return 'Sacrifice jde jen při méně než 2 outech.';
    if (play.result === 'K' && (play.batterTo ?? 0) > 0 && !mayRunOnDroppedThird(bases, outs)) {
      return 'Na dropped third strike smí pálkař běžet jen při volné 1. metě nebo při 2 outech.';
    }
    const [lo, hi] = BATTER_RANGE[play.result];
    if (play.batterTo === null || play.batterTo < lo || play.batterTo > hi) return 'Pálkař s tímto výsledkem nemůže skončit na zadané metě.';
    if (play.batterTo >= 1 && play.batterTo <= 3) {
      if (taken.has(play.batterTo)) return 'Na jedné metě nemohou být dva běžci.';
    }
    pairs.push({ from: 0, to: play.batterTo });
    const runs = runsOn(play);
    if (play.result === 'SF' && runs === 0) return 'U sacrifice fly musí aspoň jeden běžec skórovat.';
    if ((play.result === 'HR' || play.result === 'SF') && play.rbi < 1) return 'HR i SF mají vždy aspoň 1 RBI.';
    if (play.rbi < 0 || play.rbi > Math.min(4, runs)) return 'RBI nemůže být víc než runs v této akci.';
  }

  for (const a of pairs) {
    for (const b of pairs) {
      if (a.from < b.from && a.to !== 0 && b.to !== 0 && !(a.to < b.to || (a.to === 4 && b.to === 4))) {
        return 'Běžec nemůže předběhnout běžce před sebou.';
      }
    }
  }
  if (outs + outsOn(play) > 3) return 'V jedné směně nemohou být víc než 3 outy.';
  if (endsInning(play, outs) && runsOn(play) > 0 && !runsCountOnThirdOut(play, bases)) {
    return 'Při 3. outu, kdy je out pálkař nebo force out, se run nepočítá.';
  }
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
    const inning = state.inning + 1;
    // tie-breaker: the last batter of the previous half starts on 2nd
    const bases: Bases = [null, inning >= TIEBREAK_INNING && lineup.length ? lineup[(nextSlot - 1 + lineup.length) % lineup.length] : null, null];
    return { inning, outs: 0, bases, nextSlot, runs, inningOver: true };
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
export function batterChoices(result: PaResult, bases?: Bases, outs?: number): Dest[] {
  const [lo, hi] = BATTER_RANGE[result];
  if (result === 'K' && bases && outs !== undefined && !mayRunOnDroppedThird(bases, outs)) return [0];
  return ([0, 1, 2, 3, 4] as Dest[]).filter((d) => d >= lo && d <= hi);
}

export const destLabel = (d: Dest, from?: number): string =>
  d === 0 ? 'Out' : d === 4 ? 'Scored' : d === from ? `Zůstal (${d}.)` : `${d}. meta`;

// ---------------------------------------------------------------------------------
// Only possible destinations
//
// A runner can never end behind (or on the same base as) anybody who was behind him:
// with a runner on 1st and a double (batter on 2nd) he can only be on 3rd, score,
// or be out. The lower bound follows from the batter and the runners behind him.
// ---------------------------------------------------------------------------------

/** Possible destinations of the runner from `from`, given where everyone behind him ended. */
export function runnerOptions(from: Base, play: Pick<Play, 'result' | 'batterTo' | 'runners'>): Dest[] {
  const behind: Dest[] = play.runners.filter((r) => r.from < from).map((r) => r.to);
  if (play.result && play.batterTo !== null) behind.push(play.batterTo);
  const safe = behind.filter((d) => d !== 0);
  if (safe.includes(4)) return [0, 4];
  const lowest = Math.max(from, ...safe.map((d) => d + 1)) as Dest;
  return [0, ...([1, 2, 3, 4] as Dest[]).filter((d) => d >= lowest)];
}

/**
 * Pushes runners ahead when somebody behind them moved up (processed from the back,
 * so a chain of forced runners moves together). Runners that are out stay out.
 */
export function cascade<T extends Pick<Play, 'result' | 'batterTo' | 'runners'>>(play: T): T {
  const runners = [...play.runners].sort((a, b) => a.from - b.from);
  const out: RunnerMove[] = [];
  for (const r of runners) {
    const opts = runnerOptions(r.from, { ...play, runners: out });
    if (r.to === 0 || opts.includes(r.to)) {
      out.push(r);
    } else {
      const to = opts.find((d) => d > 0 && d >= r.to) ?? opts.find((d) => d > 0) ?? 4;
      out.push({ ...r, to, sb: r.sb && to > r.from, why: r.why && to > r.from ? r.why : null });
    }
  }
  return { ...play, runners: play.runners.map((r) => out.find((x) => x.from === r.from)!) };
}

// ---------------------------------------------------------------------------------
// Out in the field: the scorer says what happened, the official result follows
// ---------------------------------------------------------------------------------

/** How the ball was put in play when the batting side made an out (or tried to). */
export type FieldOut = PlayKind;

/** `detailed`: offered only in the detailed scoring (in the simple one "Fly out" covers them) */
export const FIELD_OUTS: { kind: FieldOut; label: string; hint: string; detailed?: boolean }[] = [
  { kind: 'fly', label: 'Fly out', hint: 'Chycený fly, line drive nebo pop up. Běžci zůstávají; run po tag-upu = sacrifice fly.' },
  { kind: 'line', label: 'Line out', hint: 'Chycený line drive. Běžec mimo metu může být doubled off.', detailed: true },
  { kind: 'pop', label: 'Pop out', hint: 'Chycený pop up v infieldu.', detailed: true },
  { kind: 'ground', label: 'Ground out', hint: 'Míč po zemi, pálkař out na 1. metě (force out), forced runners postoupí.' },
  { kind: 'fc', label: 'Fielder’s choice', hint: 'Out běžce (force out), pálkař je na metě.' },
  { kind: 'dp', label: 'Double play', hint: 'Out pálkaře i běžce v jedné akci. Bez RBI.' },
  { kind: 'bunt', label: 'Sacrifice bunt', hint: 'Pálkař out, běžci postoupí o metu.' }
];

const flyBall = (k: FieldOut) => k === 'fly' || k === 'line' || k === 'pop';

/**
 * Field outs that make sense in this situation. Without runners the simple scoring asks
 * only fly ball or ground ball (one tap saves it); the detailed one offers every kind.
 */
export function fieldOutsFor(bases: Bases, outs: number, detailed = false): FieldOut[] {
  const on = occupied(bases).length;
  if (!on && !detailed) return ['fly', 'ground'];
  return FIELD_OUTS.filter((f) => detailed || !f.detailed)
    .map((f) => f.kind)
    .filter((k) => {
      if (k === 'fc') return on > 0;
      if (k === 'dp') return on > 0 && outs < 2;
      if (k === 'bunt') return detailed || outs < 2;
      return true;
    });
}

/** Button label: without runners a bunt is no sacrifice, just a bunt out. */
export function fieldOutLabel(kind: FieldOut, bases: Bases): { label: string; hint: string } {
  const f = FIELD_OUTS.find((x) => x.kind === kind)!;
  if (kind === 'bunt' && occupied(bases).length === 0) return { label: 'Bunt out', hint: 'Pálkař out po buntu.' };
  if (occupied(bases).length === 0 && (kind === 'fly' || kind === 'ground')) {
    return { label: f.label, hint: kind === 'fly' ? 'Chycený míč ze vzduchu.' : 'Míč po zemi, pálkař vyautován na 1. metě.' };
  }
  return { label: f.label, hint: f.hint };
}

/** Where the batter may end in a field out of this kind. */
export function fieldOutBatterChoices(kind: FieldOut): Dest[] {
  return flyBall(kind) ? [0] : [0, 1];
}

/**
 * The official result of a field out, from what happened:
 *  - caught fly, a run scores, fewer than 2 outs before → SF (sacrifice fly)
 *  - bunt, batter out, runners advanced, nobody else out, fewer than 2 outs → SH
 *  - batter safe while the defence went for a runner → FC
 *  - otherwise an out (OUT), a double play included
 */
export function fieldOutResult(kind: FieldOut, play: Pick<Play, 'batterTo' | 'runners'>, outsBefore: number): PaResult {
  const runnersOut = play.runners.filter((r) => r.to === 0).length;
  const advanced = play.runners.some((r) => r.to > r.from);
  if (play.batterTo !== null && play.batterTo > 0) return 'FC';
  // a caught fly ball or line drive with a run scoring after the catch
  if ((kind === 'fly' || kind === 'line') && runnersOut === 0 && outsBefore < 2 && runsOn(play) > 0) return 'SF';
  if (kind === 'bunt' && runnersOut === 0 && outsBefore < 2 && advanced) return 'SH';
  return 'OUT';
}

/** The usual course of a field out of this kind (the scorer adjusts the rest). */
export function defaultFieldOut(kind: FieldOut, bases: Bases, outs: number): Play {
  const on = occupied(bases);
  const f = forced(bases);
  const moves = new Map<Base, Dest>(on.map((b) => [b, b as Dest]));
  let batterTo: Dest = 0;
  // the runner thrown out on a force play: from 1st if there is one, else the lead runner
  const victim: Base | undefined = bases[0] ? 1 : on[on.length - 1];

  switch (kind) {
    case 'fly':
    case 'line':
    case 'pop':
      break; // runners hold; a tag-up is set by the scorer
    case 'ground':
      for (const b of on) if (f.has(b)) moves.set(b, clamp(b + 1));
      break;
    case 'fc':
      batterTo = 1;
      if (victim) moves.set(victim, 0);
      for (const b of on) if (b !== victim && f.has(b)) moves.set(b, clamp(b + 1));
      break;
    case 'dp':
      if (victim) moves.set(victim, 0);
      for (const b of on) if (b !== victim && f.has(b)) moves.set(b, clamp(b + 1));
      break;
    case 'bunt':
      for (const b of on) moves.set(b, clamp(b + 1));
      break;
  }

  let runners: RunnerMove[] = on.map((b) => ({ from: b, to: moves.get(b)! }));
  const playOuts = (batterTo === 0 ? 1 : 0) + runners.filter((r) => r.to === 0).length;
  if (outs + playOuts >= 3) runners = runners.map((r) => (r.to === 0 ? r : { ...r, to: r.from }));

  const base = { batterTo, runners };
  const play: Play = { result: fieldOutResult(kind, base, outs), batterTo, runners, rbi: 0, kind };
  play.rbi = defaultRbi(play);
  return cascade(play);
}

/**
 * Runner interference on a batted ball: the lead runner is out (the scorer picks another
 * one if needed), the batter gets 1st, runners behind are pushed only as far as needed.
 */
export function defaultInterference(kind: InterferenceKind, bases: Bases, outs: number): Play {
  const on = occupied(bases);
  const victim = on[on.length - 1];
  const runners: RunnerMove[] = on.map((b) => (b === victim ? { from: b, to: 0, why: 'int' } : { from: b, to: b }));
  const def = INTERFERENCE.find((i) => i.kind === kind)!;
  // the ball is dead: nobody moves beyond what the batter on 1st forces (also on the third out)
  const play: Play = cascade({ result: def.result, batterTo: 1, runners, rbi: 0, kind });
  play.rbi = defaultRbi(play);
  return play;
}

/**
 * Interference: the runner put out carries why 'int', nobody else does
 * (after the scorer changed who was out).
 */
export function markInterference(play: Play): Play {
  return { ...play, runners: play.runners.map((r) => ({ ...r, sb: false, why: r.to === 0 ? 'int' : null })) };
}
