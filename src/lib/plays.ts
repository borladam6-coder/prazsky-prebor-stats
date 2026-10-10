// Play-by-play of a live game, rebuilt from the change history.
// Every live play is one change group: the session row (inning, outs), the plate
// appearance and the runs / stolen bases it produced. Reverted plays are skipped.
// Pure functions (no Svelte) so they can be unit-tested.

import type { PaResult } from './types.ts';

export interface LogGroup {
  id: string;
  at: string;
  action: string;
  actor_name: string | null;
  reverted_by_group_id: string | null;
}

export interface LogEntry {
  id: number;
  group_id: string;
  table_name: string;
  action: string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown>;
  is_derived: boolean;
}

export interface PlayItem {
  id: string;
  /** a play, or a manual correction of runs in an inning */
  kind: 'play' | 'adjust';
  /** plate appearance of this play (for editing) */
  paId: string | null;
  /** result or RBI changed after the play was recorded */
  edited: boolean;
  /** the plate appearance was deleted later */
  paDeleted: boolean;
  /** runs taken away by a correction */
  removed: string[];
  at: string;
  actor: string | null;
  teamId: number;
  inning: number;
  outsBefore: number;
  outsAfter: number;
  /** this play made the third out */
  inningEnded: boolean;
  batter: string | null;
  result: PaResult | null;
  rbi: number;
  scored: string[];
  stole: string[];
  runs: number;
  outs: number;
}

const num = (v: unknown) => Number(v ?? 0);

/** Current (not deleted) plate appearances of the game, so that later edits show in the play log. */
export type CurrentPas = Map<string, { result: PaResult; rbi: number; deleted: boolean }>;

export function buildPlays(groups: LogGroup[], entries: LogEntry[], current?: CurrentPas): PlayItem[] {
  const byGroup = new Map<string, LogEntry[]>();
  for (const e of entries) {
    const list = byGroup.get(e.group_id);
    if (list) list.push(e);
    else byGroup.set(e.group_id, [e]);
  }

  const plays: PlayItem[] = [];
  for (const g of groups) {
    if (g.reverted_by_group_id) continue;
    const list = byGroup.get(g.id) ?? [];

    if (g.action === 'live_adjust') {
      const adj = list.find((e) => e.table_name === 'live_run_adjustments' && e.action === 'insert');
      if (!adj) continue;
      const a = adj.new_data;
      const player = String(a.player_id);
      const delta = num(a.delta);
      plays.push({
        id: g.id, kind: 'adjust', paId: null, edited: false, paDeleted: false,
        at: g.at, actor: g.actor_name, teamId: num(a.team_id), inning: num(a.inning),
        outsBefore: 0, outsAfter: 0, inningEnded: false, batter: null, result: null, rbi: 0,
        scored: delta > 0 ? [player] : [], removed: delta < 0 ? [player] : [], stole: [], runs: delta, outs: 0
      });
      continue;
    }
    if (g.action !== 'live_play') continue;
    const session = list.find((e) => e.table_name === 'live_sessions' && e.old_data);
    if (!session) continue;
    const o = session.old_data!;
    const n = session.new_data;
    const inningEnded = num(n.inning) > num(o.inning);

    const pa = list.find((e) => e.table_name === 'plate_appearances' && e.action === 'insert');
    const scored: string[] = [];
    const stole: string[] = [];
    for (const e of list) {
      if (e.table_name !== 'game_player_extras') continue;
      const before = e.old_data ?? {};
      const player = String(e.new_data.player_id);
      for (let i = num(before.runs); i < num(e.new_data.runs); i++) scored.push(player);
      for (let i = num(before.stolen_bases); i < num(e.new_data.stolen_bases); i++) stole.push(player);
    }

    const outsBefore = num(o.outs);
    const outsAfter = inningEnded ? 3 : num(n.outs);
    const paId = pa ? String(pa.new_data.id) : null;
    const now = paId ? current?.get(paId) : undefined;
    const recorded = pa ? (String(pa.new_data.result) as PaResult) : null;
    const recordedRbi = pa ? num(pa.new_data.rbi) : 0;
    plays.push({
      id: g.id,
      kind: 'play',
      paId,
      edited: !!now && !now.deleted && (now.result !== recorded || now.rbi !== recordedRbi),
      // a plate appearance missing from the current list was deleted later
      paDeleted: !!paId && !!current && (!now || now.deleted),
      removed: [],
      at: g.at,
      actor: g.actor_name,
      teamId: num(n.team_id),
      inning: num(o.inning),
      outsBefore,
      outsAfter,
      inningEnded,
      batter: pa ? String(pa.new_data.player_id) : null,
      result: now && !now.deleted ? now.result : recorded,
      rbi: now && !now.deleted ? now.rbi : recordedRbi,
      scored,
      stole,
      runs: scored.length,
      outs: outsAfter - outsBefore
    });
  }
  return plays.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/** Runs per inning for each team: teamId → [runs in 1st, runs in 2nd, …]. */
export function lineScore(plays: PlayItem[]): Map<number, number[]> {
  const m = new Map<number, number[]>();
  for (const p of plays) {
    const row = m.get(p.teamId) ?? [];
    while (row.length < p.inning) row.push(0);
    row[p.inning - 1] += p.runs;
    m.set(p.teamId, row);
  }
  return m;
}

export interface HalfInning {
  key: string;
  teamId: number;
  inning: number;
  plays: PlayItem[];
  runs: number;
}

/** Plays grouped by half-inning, newest half first and newest play first. */
export function byHalfInning(plays: PlayItem[]): HalfInning[] {
  const halves: HalfInning[] = [];
  for (const p of plays) {
    const last = halves.at(-1);
    if (last && last.teamId === p.teamId && last.inning === p.inning) {
      last.plays.push(p);
      last.runs += p.runs;
    } else {
      halves.push({ key: `${p.teamId}:${p.inning}:${p.id}`, teamId: p.teamId, inning: p.inning, plays: [p], runs: p.runs });
    }
  }
  return halves.reverse().map((h) => ({ ...h, plays: [...h.plays].reverse() }));
}

/**
 * Which team is batting. With both teams scored, the visitors bat in the top and the
 * home team in the bottom: the visitors are up while their inning is not ahead.
 */
export function battingTeam(
  home: { team_id: number; inning: number } | undefined,
  away: { team_id: number; inning: number } | undefined
): number | null {
  if (home && away) return away.inning <= home.inning ? away.team_id : home.team_id;
  return (away ?? home)?.team_id ?? null;
}
