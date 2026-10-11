// Play-by-play sentences and half-inning totals. Run: npm run test:narrate

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { narrate, halfSummary, type PlayDetail } from '../src/lib/narrate.ts';
import type { PaResult } from '../src/lib/types.ts';

const names: Record<string, string> = { b: 'Lehký Lukáš', r1: 'Krátký Karel', r2: 'Pevný Pavel', r3: 'Skokan Sváťa' };
const name = (id: string | null) => (id ? names[id] : '?');
const d = (o: Partial<PlayDetail>): PlayDetail => ({
  inning: 1, outsBefore: 0, batterId: 'b', result: null, kind: null, location: null, batterTo: null, runners: [], ...o
});
const say = (o: Partial<PlayDetail>, result: PaResult | null = o.result ?? null) => narrate(d(o), result, name);

test('hits, walks and strikeouts', () => {
  assert.equal(say({ result: '1B', batterTo: 1, location: 'LF' }), 'Lehký Lukáš singles to left field.');
  assert.equal(say({ result: '2B', batterTo: 2, runners: [{ from: 1, to: 4, player: 'r1' }] }), 'Lehký Lukáš doubles. Krátký Karel scores.');
  assert.equal(say({ result: '1B', batterTo: 1, runners: [{ from: 1, to: 3, player: 'r1' }] }), 'Lehký Lukáš singles. Krátký Karel to 3rd.');
  assert.equal(say({ result: 'HR', batterTo: 4, location: 'CF', runners: [{ from: 2, to: 4, player: 'r2' }] }),
    'Lehký Lukáš homers to center field (2-run home run). Pevný Pavel scores.');
  assert.equal(say({ result: 'HR', batterTo: 4, runners: [1, 2, 3].map((f) => ({ from: f, to: 4, player: `r${f}` })) }).split('.')[0],
    'Lehký Lukáš hits a grand slam');
  assert.equal(say({ result: 'BB', batterTo: 1 }), 'Lehký Lukáš walks.');
  assert.equal(say({ result: 'K', batterTo: 0 }), 'Lehký Lukáš strikes out.');
  assert.equal(say({ result: 'ROE', batterTo: 1, location: 'SS' }), 'Lehký Lukáš reaches on an error by the shortstop.');
  assert.equal(say({ result: '1B', batterTo: 2 }), 'Lehký Lukáš singles. Lehký Lukáš to 2nd.', 'extra base on the throw');
  assert.equal(say({ result: '2B', batterTo: 0 }), 'Lehký Lukáš doubles. Lehký Lukáš out at 3rd.', 'thrown out stretching');
});

test('outs in the field: double play, fielder\'s choice, sacrifices', () => {
  assert.equal(
    say({ result: 'OUT', kind: 'dp', location: 'SS', batterTo: 0, runners: [{ from: 1, to: 0, player: 'r1' }] }),
    'Lehký Lukáš grounds into a double play to shortstop. Krátký Karel forced out at 2nd. Lehký Lukáš out at 1st.'
  );
  assert.equal(
    say({ result: 'FC', kind: 'fc', batterTo: 1, runners: [{ from: 1, to: 0, player: 'r1' }] }),
    "Lehký Lukáš reaches on a fielder's choice. Krátký Karel forced out at 2nd."
  );
  assert.equal(
    say({ result: 'FC', kind: 'fc', batterTo: 1, runners: [{ from: 3, to: 0, player: 'r3' }] }),
    "Lehký Lukáš reaches on a fielder's choice. Skokan Sváťa out at home.",
    'not forced: runner on 3rd alone'
  );
  assert.equal(say({ result: 'SF', kind: 'fly', location: 'RF', batterTo: 0, runners: [{ from: 3, to: 4, player: 'r3' }] }),
    'Lehký Lukáš hits a sacrifice fly to right field. Skokan Sváťa scores.');
  assert.equal(say({ result: 'SH', kind: 'bunt', batterTo: 0, runners: [{ from: 1, to: 2, player: 'r1' }] }),
    'Lehký Lukáš lays down a sacrifice bunt. Krátký Karel to 2nd.');
  assert.equal(say({ result: 'OUT', kind: 'line', location: 'SS', batterTo: 0, runners: [{ from: 2, to: 0, player: 'r2' }] }),
    'Lehký Lukáš lines out to shortstop. Pevný Pavel doubled off 2nd.');
  assert.equal(say({ result: 'OUT', kind: 'pop', location: 'C', batterTo: 0 }), 'Lehký Lukáš pops out to catcher.');
  assert.equal(say({ result: 'OUT', kind: 'ground', location: '2B', batterTo: 0 }), 'Lehký Lukáš grounds out to second base.');
  assert.equal(say({ result: 'OUT', batterTo: 0 }), 'Lehký Lukáš is out.', 'quick out without details');
  // an edited result drops the recorded kind
  assert.equal(say({ result: 'OUT', kind: 'fly', batterTo: 0 }, 'K'), 'Lehký Lukáš strikes out.');
  // a hit corrected to an error: the fielder who erred is not known
  assert.equal(say({ result: '1B', location: 'LF', batterTo: 1 }, 'ROE'), 'Lehký Lukáš reaches on an error.');
  assert.equal(say({ result: 'ROE', location: 'SS', batterTo: 1 }), 'Lehký Lukáš reaches on an error by the shortstop.');
});

test('runner-only plays', () => {
  assert.equal(say({ batterId: null, runners: [{ from: 1, to: 2, sb: true, player: 'r1' }] }), 'Krátký Karel steals 2nd.');
  assert.equal(say({ batterId: null, runners: [{ from: 3, to: 4, sb: true, player: 'r3' }] }), 'Skokan Sváťa steals home.');
  assert.equal(say({ batterId: null, runners: [{ from: 2, to: 3, player: 'r2' }] }), 'Pevný Pavel advances to 3rd.');
  assert.equal(say({ batterId: null, runners: [{ from: 1, to: 0, player: 'r1' }] }), 'Krátký Karel caught stealing 2nd.');
});

test('half-inning totals: runs, hits, errors, left on base', () => {
  const play = (result: PaResult, runs: number, inningEnded = false, detail: PlayDetail | null = null) =>
    ({ kind: 'play' as const, result, runs, inningEnded, detail });
  const s = halfSummary([
    play('1B', 0), play('ROE', 0), play('2B', 1),
    play('K', 0, true, d({ result: 'K', batterTo: 0, runners: [{ from: 2, to: 2, player: 'r2' }, { from: 3, to: 3, player: 'r3' }] }))
  ]);
  assert.deepEqual(s, { runs: 1, hits: 2, errors: 1, lob: 2 });
  assert.equal(halfSummary([play('1B', 0)]).lob, null, 'still going');
});
