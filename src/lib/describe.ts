// Human-readable descriptions of history entries.

import type { ChangeEntry, ChangeGroup } from './types.ts';
import { league } from './league.svelte.ts';
import { resultDef } from './stats.ts';

export interface Described {
  title: string;
  context: string | null;
  gameId: number | null;
}

function playerName(id: unknown): string {
  const p = league.player(typeof id === 'string' ? id : null);
  return p ? p.name : 'neznámý hráč';
}

function gameLabel(id: number | null): string | null {
  const g = league.game(id);
  if (!g) return null;
  const h = league.team(g.home_team_id);
  const a = league.team(g.away_team_id);
  return `${h?.short_name ?? h?.name ?? '?'} – ${a?.short_name ?? a?.name ?? '?'}`;
}

const res = (code: unknown) => {
  const d = resultDef(String(code));
  return d ? `${d.code} (${d.label.toLowerCase()})` : String(code);
};

function describeEntry(e: ChangeEntry): string {
  const n = e.new_data;
  const o = e.old_data ?? {};
  if (e.table_name === 'plate_appearances') {
    const who = playerName(n.player_id);
    if (e.action === 'insert') return `${who}: ${res(n.result)}${Number(n.rbi) ? `, RBI ${n.rbi}` : ''}`;
    if (e.action === 'delete') return `${who}: smazán zápis ${res(o.result)}`;
    if (e.action === 'restore') return `${who}: obnoven zápis ${res(n.result)}`;
    const parts: string[] = [];
    if (o.result !== n.result) parts.push(`${o.result} → ${n.result}`);
    if (o.rbi !== n.rbi) parts.push(`RBI ${o.rbi} → ${n.rbi}`);
    return `${who}: ${parts.join(', ') || 'úprava zápisu'}`;
  }
  if (e.table_name === 'game_player_extras') {
    const who = playerName(n.player_id);
    const parts: string[] = [];
    const or = Number(o.runs ?? 0), nr = Number(n.runs ?? 0);
    const os = Number(o.stolen_bases ?? 0), ns = Number(n.stolen_bases ?? 0);
    if (or !== nr) parts.push(`R ${nr > or ? '+' : '−'}${Math.abs(nr - or)} (celkem ${nr})`);
    if (os !== ns) parts.push(`SB ${ns > os ? '+' : '−'}${Math.abs(ns - os)} (celkem ${ns})`);
    return `${who}: ${parts.join(', ') || 'beze změny'}`;
  }
  // players
  const team = league.team(Number(n.team_id));
  const teamName = team?.short_name ?? team?.name ?? '';
  if (e.action === 'insert') return `Nový hráč ${n.name}${n.jersey_number != null ? ` #${n.jersey_number}` : ''} (${teamName})`;
  if (o.active === true && n.active === false) return `${n.name} vyřazen ze soupisky (${teamName})`;
  if (o.active === false && n.active === true) return `${n.name} vrácen na soupisku (${teamName})`;
  const parts: string[] = [];
  if (o.name !== n.name) parts.push(`${o.name} → ${n.name}`);
  if (o.jersey_number !== n.jersey_number) parts.push(`číslo ${o.jersey_number ?? '–'} → ${n.jersey_number ?? '–'}`);
  return `Úprava hráče: ${parts.join(', ') || n.name}`;
}

export function describe(group: ChangeGroup, entries: ChangeEntry[]): Described {
  if (group.source === 'import') {
    return { title: 'Import ze softball.cz (soupisky)', context: null, gameId: null };
  }
  const main = entries.filter((e) => !e.is_derived);
  const shown = main.length ? main : entries;
  const gameId = shown.find((e) => e.game_id)?.game_id ?? null;
  const prefix = group.action === 'revert' ? 'Vrácení změny: ' : '';
  const title = shown.length ? prefix + shown.map(describeEntry).join('; ') : group.action === 'revert' ? 'Vrácení změny' : 'Změna';
  return { title, context: gameLabel(gameId), gameId };
}
