// Unit tests of the browser-side live scoring logic (default runner advancement, RBI, validation).
// Run: npm run test:logic

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPlay, validatePlay, applyPlay, runsOn, type Bases, type Play } from '../src/lib/live.ts';
import type { PaResult } from '../src/lib/types.ts';

const EMPTY: Bases = [null, null, null];
const LOADED: Bases = ['r1', 'r2', 'r3'];
const lineup = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];

const dests = (p: Play) => Object.fromEntries(p.runners.map((r) => [r.from, r.to]));

test('single and walk move only forced runners', () => {
  for (const r of ['1B', 'BB', 'HBP', 'ROE'] as PaResult[]) {
    assert.deepEqual(dests(defaultPlay(r, ['x', null, 'z'], 0)), { 1: 2, 3: 3 }, r);
    assert.deepEqual(dests(defaultPlay(r, [null, 'y', null], 0)), { 2: 2 }, r);
    assert.deepEqual(dests(defaultPlay(r, LOADED, 0)), { 1: 2, 2: 3, 3: 4 }, r);
  }
  assert.equal(defaultPlay('1B', LOADED, 0).rbi, 1);
  assert.equal(defaultPlay('BB', LOADED, 0).rbi, 1);
  assert.equal(defaultPlay('ROE', LOADED, 0).rbi, 0, 'no RBI on an error');
});

test('four singles in a row = one run', () => {
  let state = { inning: 1, outs: 0, bases: EMPTY, nextSlot: 0 };
  let runs = 0;
  for (let i = 0; i < 4; i++) {
    const p = defaultPlay('1B', state.bases, state.outs);
    assert.equal(validatePlay(p, state.bases, state.outs), null);
    const next = applyPlay(state, lineup, p);
    runs += next.runs;
    state = next;
  }
  assert.equal(runs, 1);
  assert.deepEqual(state.bases, ['d', 'c', 'b']);
});

test('extra-base hits', () => {
  assert.deepEqual(dests(defaultPlay('2B', LOADED, 0)), { 1: 3, 2: 4, 3: 4 });
  assert.equal(defaultPlay('2B', LOADED, 0).rbi, 2);
  assert.deepEqual(dests(defaultPlay('3B', LOADED, 0)), { 1: 4, 2: 4, 3: 4 });
  const hr = defaultPlay('HR', LOADED, 0);
  assert.equal(hr.batterTo, 4);
  assert.equal(hr.rbi, 4, 'grand slam');
  assert.equal(defaultPlay('HR', EMPTY, 2).rbi, 1, 'solo HR');
});

test('outs, sacrifices and fielder\'s choice', () => {
  assert.deepEqual(dests(defaultPlay('K', LOADED, 0)), { 1: 1, 2: 2, 3: 3 });
  const sf = defaultPlay('SF', [null, 'y', 'z'], 1);
  assert.deepEqual(dests(sf), { 2: 2, 3: 4 });
  assert.equal(sf.rbi, 1);
  assert.deepEqual(dests(defaultPlay('SH', ['x', null, null], 0)), { 1: 2 });
  const fc = defaultPlay('FC', ['x', 'y', null], 0);
  assert.deepEqual(dests(fc), { 1: 0, 2: 3 });
  assert.equal(fc.batterTo, 1);
  assert.deepEqual(dests(defaultPlay('FC', [null, null, 'z'], 0)), { 3: 0 });
});

test('no run scores when the play makes the third out', () => {
  const fc = defaultPlay('FC', LOADED, 2);
  assert.equal(runsOn(fc), 0);
  assert.equal(fc.rbi, 0);
  const next = applyPlay({ inning: 4, outs: 2, bases: LOADED, nextSlot: 8 }, lineup, fc);
  assert.equal(next.inningOver, true);
  assert.equal(next.inning, 5);
  assert.deepEqual(next.bases, EMPTY);
  assert.equal(next.nextSlot, 0);
});

test('validation catches impossible plays', () => {
  const base: Play = { result: '1B', batterTo: 1, runners: [{ from: 1, to: 2 }, { from: 2, to: 3 }, { from: 3, to: 4 }], rbi: 1 };
  assert.equal(validatePlay(base, LOADED, 0), null);
  assert.match(validatePlay({ ...base, runners: base.runners.slice(0, 2) }, LOADED, 0)!, /Chybí/);
  assert.match(validatePlay({ ...base, runners: [{ from: 1, to: 1 }, { from: 2, to: 3 }, { from: 3, to: 4 }] }, LOADED, 0)!, /dva běžci/);
  assert.match(validatePlay({ ...base, runners: [{ from: 1, to: 4 }, { from: 2, to: 3 }, { from: 3, to: 4 }] }, LOADED, 0)!, /předběhnout/);
  assert.match(validatePlay({ ...base, rbi: 2 }, LOADED, 0)!, /RBI/);
  assert.match(validatePlay({ ...base, batterTo: 0 }, LOADED, 0)!, /nemůže skončit/);
  assert.match(validatePlay({ result: 'SF', batterTo: 0, runners: [{ from: 3, to: 4 }], rbi: 1 }, [null, null, 'z'], 2)!, /méně než 2/);
  assert.match(validatePlay({ result: null, batterTo: null, runners: [{ from: 1, to: 1 }], rbi: 0 }, ['x', null, null], 0)!, /neposunul/);
  assert.equal(validatePlay({ result: null, batterTo: null, runners: [{ from: 1, to: 2, sb: true }], rbi: 0 }, ['x', null, null], 0), null);
  assert.match(validatePlay({ result: 'K', batterTo: 0, runners: [{ from: 1, to: 0 }, { from: 2, to: 0 }, { from: 3, to: 3 }], rbi: 0 }, LOADED, 2)!, /3 outy/);
});

test('defaults are always valid', () => {
  const results: PaResult[] = ['1B', '2B', '3B', 'HR', 'BB', 'HBP', 'K', 'OUT', 'FC', 'ROE', 'SF', 'SH'];
  const all: Bases[] = [];
  for (let m = 0; m < 8; m++) all.push([m & 1 ? 'x' : null, m & 2 ? 'y' : null, m & 4 ? 'z' : null]);
  for (const r of results) {
    for (const b of all) {
      for (const outs of [0, 1, 2]) {
        const p = defaultPlay(r, b, outs);
        const err = validatePlay(p, b, outs);
        const expected =
          (r === 'SF' || r === 'SH') && outs >= 2 ? /méně než 2/ :
          r === 'SF' && !b[2] ? /aspoň jeden/ : null;
        if (expected) assert.match(err ?? '', expected, `${r} ${JSON.stringify(b)} ${outs}`);
        else assert.equal(err, null, `${r} ${JSON.stringify(b)} ${outs}`);
      }
    }
  }
});
