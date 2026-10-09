// Human-readable descriptions of history entries.

import type { ChangeEntry, ChangeGroup } from './types.ts';
import { league } from './league.svelte.ts';
import { resultDef } from './stats.ts';
import { plural } from './format.ts';

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
  return d ? `${d.code} (${d.label})` : String(code);
};

const teamLabel = (id: unknown) => {
  const t = league.team(Number(id));
  return t?.short_name ?? t?.name ?? '';
};

const outsLabel = (n: number) => `${n} ${plural(n, ['aut', 'auty', 'autů'])}`;

function describeSession(o: Record<string, unknown>, n: Record<string, unknown>): string {
  if (Number(n.inning) > Number(o.inning)) return `konec ${o.inning}. směny`;
  if (Number(n.inning) < Number(o.inning)) return `zpět do ${n.inning}. směny`;
  if (n.finished !== o.finished) return n.finished ? 'zápis ukončen' : 'zápis znovu otevřen';
  const d = Number(n.outs) - Number(o.outs);
  if (d > 0) return `${d === 1 ? 'aut' : outsLabel(d)} (${n.inning}. směna, ${outsLabel(Number(n.outs))})`;
  return `${n.inning}. směna, ${outsLabel(Number(n.outs))}`;
}

/** A live play described as one sentence: batter result, who scored or stole, outs. */
function describePlay(entries: ChangeEntry[]): string {
  const parts: string[] = [];
  const pa = entries.find((e) => e.table_name === 'plate_appearances' && e.action === 'insert');
  if (pa) {
    const n = pa.new_data;
    parts.push(`${playerName(n.player_id)}: ${res(n.result)}${Number(n.rbi) ? `, RBI ${n.rbi}` : ''}`);
  }
  const scored: string[] = [];
  const stole: string[] = [];
  for (const e of entries) {
    if (e.table_name !== 'game_player_extras' || e.is_derived) continue;
    const o = e.old_data ?? {};
    if (Number(e.new_data.runs ?? 0) > Number(o.runs ?? 0)) scored.push(playerName(e.new_data.player_id));
    if (Number(e.new_data.stolen_bases ?? 0) > Number(o.stolen_bases ?? 0)) stole.push(playerName(e.new_data.player_id));
  }
  if (stole.length) parts.push(`ukradená meta: ${stole.join(', ')}`);
  if (scored.length) parts.push(`doběh: ${scored.join(', ')}`);
  const s = entries.find((e) => e.table_name === 'live_sessions');
  if (s?.old_data) {
    const o = s.old_data;
    const n = s.new_data;
    if (Number(n.inning) !== Number(o.inning) || Number(n.outs) > Number(o.outs)) parts.push(describeSession(o, n));
  }
  if (!pa && !scored.length && !stole.length) parts.unshift('Posun běžců');
  return parts.join(' · ');
}

function describeEntry(e: ChangeEntry): string {
  const n = e.new_data;
  const o = e.old_data ?? {};
  if (e.table_name === 'live_sessions') {
    if (e.action === 'insert') return `Začátek živého zápisu (${teamLabel(n.team_id)})`;
    return `Živý zápis ${teamLabel(n.team_id)}: ${describeSession(o, n)}`;
  }
  if (e.table_name === 'live_lineups') {
    const count = (n.players as unknown[] | undefined)?.length ?? 0;
    return `Pořadí pálkařů ${teamLabel(n.team_id)}: ${count} ${plural(count, ['hráč', 'hráči', 'hráčů'])}`;
  }
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
  const team = teamLabel(shown.find((e) => e.team_id)?.team_id);

  switch (group.action) {
    case 'live_play':
      return { title: describePlay(entries), context: gameLabel(gameId), gameId };
    case 'live_start':
      return { title: `Začátek živého zápisu (${team})`, context: gameLabel(gameId), gameId };
    case 'live_lineup':
      return { title: `Změna pořadí pálkařů (${team})`, context: gameLabel(gameId), gameId };
    case 'live_state':
      return { title: `Oprava stavu živého zápisu (${team})`, context: gameLabel(gameId), gameId };
    case 'live_finish':
      return { title: `Konec živého zápisu (${team})`, context: gameLabel(gameId), gameId };
    case 'live_reopen':
      return { title: `Pokračování živého zápisu (${team})`, context: gameLabel(gameId), gameId };
  }

  const prefix = group.action === 'revert' ? 'Vrácení změny: ' : '';
  const title = shown.length ? prefix + shown.map(describeEntry).join('; ') : group.action === 'revert' ? 'Vrácení změny' : 'Změna';
  return { title, context: gameLabel(gameId), gameId };
}
