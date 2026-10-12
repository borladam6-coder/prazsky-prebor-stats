// Unit tests of the browser-side live scoring logic (default runner advancement, RBI, validation).
// Run: npm run test:logic

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPlay, defaultRbi, validatePlay, applyPlay, runsOn, outsOn, type Bases, type Play } from '../src/lib/live.ts';

const defaultRbiOf = (p: Play) => defaultRbi(p);
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

// ------------------------------------------------------------------ only possible destinations
import { runnerOptions, cascade, defaultFieldOut, fieldOutResult, fieldOutsFor, type FieldOut } from '../src/lib/live.ts';

test('runner on 1st and a double: only 3rd, home or out', () => {
  const p = defaultPlay('2B', ['x', null, null], 0);
  assert.deepEqual(runnerOptions(1, p), [0, 3, 4]);
  const single = defaultPlay('1B', ['x', 'y', null], 0);
  assert.deepEqual(runnerOptions(1, single), [0, 2, 3, 4], 'forced off 1st');
  assert.deepEqual(runnerOptions(2, single), [0, 3, 4], 'the runner behind him took 2nd');
  assert.deepEqual(runnerOptions(3, defaultPlay('HR', LOADED, 0)), [0, 4]);
  // stealing: nobody behind
  assert.deepEqual(runnerOptions(2, { result: null, batterTo: null, runners: [{ from: 2, to: 2 }] }), [0, 2, 3, 4]);
});

test('moving a runner up pushes the runners ahead of him', () => {
  const p = defaultPlay('1B', LOADED, 0); // 1→2, 2→3, 3→4
  const moved = cascade({ ...p, runners: p.runners.map((r) => (r.from === 1 ? { ...r, to: 3 as const } : r)) });
  assert.deepEqual(dests(moved), { 1: 3, 2: 4, 3: 4 });
  const batter = cascade({ ...defaultPlay('1B', ['x', null, 'z'], 0), batterTo: 3 as const });
  assert.deepEqual(dests(batter), { 1: 4, 3: 4 }, 'batter stretched to 3rd: everyone ahead scores');
  // a runner thrown out does not push anybody
  const outRunner = cascade({ ...p, runners: p.runners.map((r) => (r.from === 1 ? { ...r, to: 0 as const } : r)) });
  assert.deepEqual(dests(outRunner), { 1: 0, 2: 3, 3: 4 });
});

test('every combination of choices offered stays valid after the cascade', () => {
  const all: Bases[] = [];
  for (let m = 1; m < 8; m++) all.push([m & 1 ? 'x' : null, m & 2 ? 'y' : null, m & 4 ? 'z' : null]);
  for (const r of ['1B', '2B', '3B', 'BB', 'ROE'] as PaResult[]) {
    for (const b of all) {
      const p = defaultPlay(r, b, 0);
      for (const run of p.runners) {
        for (const to of runnerOptions(run.from, p)) {
          const q = cascade({ ...p, runners: p.runners.map((x) => (x.from === run.from ? { ...x, to } : x)) });
          const fixed = { ...q, rbi: Math.min(q.rbi, runsOn(q)) };
          assert.equal(validatePlay(fixed, b, 0), null, `${r} ${JSON.stringify(b)} runner ${run.from}→${to}`);
        }
      }
    }
  }
});

test('field outs: the official result follows from what happened', () => {
  // caught fly, runner tags up from 3rd and scores, 1 out → SF with 1 RBI
  const fly = defaultFieldOut('fly', [null, null, 'z'], 1);
  assert.equal(fly.result, 'OUT', 'runner holds by default');
  const tag = { ...fly, runners: [{ from: 3 as const, to: 4 as const }] };
  assert.equal(fieldOutResult('fly', tag, 1), 'SF');
  assert.equal(fieldOutResult('fly', tag, 2), 'OUT', 'with 2 outs there is no sacrifice');
  // bunt moves the runners up → SH
  const bunt = defaultFieldOut('bunt', ['x', null, null], 0);
  assert.equal(bunt.result, 'SH');
  assert.deepEqual(dests(bunt), { 1: 2 });
  // runner forced out at 2nd, batter safe → FC
  const fc = defaultFieldOut('fc', ['x', null, null], 0);
  assert.equal(fc.result, 'FC');
  assert.equal(fc.batterTo, 1);
  // double play: two outs, a run scores from 3rd, no RBI
  const dp = defaultFieldOut('dp', ['x', null, 'z'], 0);
  assert.equal(dp.result, 'OUT');
  assert.equal(outsOn(dp), 2);
  const dpRun = { ...dp, runners: dp.runners.map((r) => (r.from === 3 ? { ...r, to: 4 as const } : r)) };
  assert.equal(defaultRbiOf(dpRun), 0, 'no RBI on a double play');
  // ground out with runners on 1st and 3rd: forced runner to 2nd, the one on 3rd holds
  const g = defaultFieldOut('ground', ['x', null, 'z'], 0);
  assert.deepEqual(dests(g), { 1: 2, 3: 3 });
  // what is offered
  assert.deepEqual(fieldOutsFor([null, null, null], 0), ['fly', 'ground'], 'empty bases: fly ball or ground ball');
  assert.deepEqual(fieldOutsFor(['x', null, null], 2), ['fly', 'ground', 'fc']);
});

test('field out defaults are always valid', () => {
  for (let m = 0; m < 8; m++) {
    const b: Bases = [m & 1 ? 'x' : null, m & 2 ? 'y' : null, m & 4 ? 'z' : null];
    for (const outs of [0, 1, 2]) {
      for (const k of fieldOutsFor(b, outs) as FieldOut[]) {
        const p = defaultFieldOut(k, b, outs);
        assert.equal(validatePlay(p, b, outs), null, `${k} ${JSON.stringify(b)} ${outs}`);
      }
    }
  }
});

test('detailed scoring: every out asks how, line and pop outs behave like a fly', () => {
  assert.deepEqual(fieldOutsFor([null, null, null], 0, true), ['fly', 'line', 'pop', 'ground', 'bunt']);
  assert.deepEqual(fieldOutsFor(['x', null, null], 0, true), ['fly', 'line', 'pop', 'ground', 'fc', 'dp', 'bunt']);
  const line = defaultFieldOut('line', [null, null, 'z'], 0);
  assert.equal(line.kind, 'line');
  assert.equal(fieldOutResult('line', { ...line, runners: [{ from: 3, to: 4 }] }, 0), 'SF');
  assert.equal(fieldOutResult('pop', { ...line, runners: [{ from: 3, to: 4 }] }, 0), 'OUT', 'an infield pop is no sacrifice fly');
  for (const k of ['fly', 'line', 'pop', 'ground', 'bunt'] as FieldOut[]) {
    assert.equal(validatePlay(defaultFieldOut(k, [null, null, null], 1), [null, null, null], 1), null, k);
  }
});

test('softball rules on the client: dropped third strike, runs on the third out, tie-breaker', async () => {
  const { validatePlay: v, applyPlay: a, batterChoices: bc } = await import('../src/lib/live.ts');
  // dropped third strike
  assert.deepEqual(bc('K', ['x', null, null], 0), [0], 'first base taken, < 2 outs: batter cannot run');
  assert.deepEqual(bc('K', ['x', null, null], 2), [0, 1, 2, 3, 4]);
  assert.match(v({ result: 'K', batterTo: 1, runners: [{ from: 1, to: 2 }], rbi: 0 }, ['x', null, null], 1) ?? '', /dropped third strike/);
  // third out
  assert.match(v({ result: 'OUT', batterTo: 0, runners: [{ from: 3, to: 4 }], rbi: 0 }, [null, null, 'z'], 2) ?? '', /nepočítá/);
  assert.match(v({ result: '1B', batterTo: 1, runners: [{ from: 1, to: 0 }, { from: 3, to: 4 }], rbi: 0 }, ['x', null, 'z'], 2) ?? '', /nepočítá/);
  assert.equal(v({ result: '1B', batterTo: 1, runners: [{ from: 2, to: 0 }, { from: 3, to: 4 }], rbi: 1 }, [null, 'y', 'z'], 2), null, 'time play');
  // tie-breaker
  const lineup = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
  const end7 = a({ inning: 7, outs: 2, bases: [null, null, null], nextSlot: 3 }, lineup, { result: 'K', batterTo: 0, runners: [], rbi: 0 });
  assert.deepEqual([end7.inning, end7.bases], [8, [null, 'd', null]]);
  const end6 = a({ inning: 6, outs: 2, bases: [null, null, null], nextSlot: 3 }, lineup, { result: 'K', batterTo: 0, runners: [], rbi: 0 });
  assert.deepEqual(end6.bases, [null, null, null]);
});
