// Duplicate player names. Run: node --test tests/names.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { similarName, normalizeName } from '../src/lib/names.ts';

test('the same player typed differently', () => {
  assert.equal(normalizeName('  Novák   Jan '), 'novak jan');
  assert.ok(similarName('Novák Jan', 'Novak Jan'), 'without accents');
  assert.ok(similarName('Novák Jan', 'Jan Novák'), 'word order');
  assert.ok(similarName('Novák Jan', 'Nowák Jan'), 'one typo');
  assert.ok(!similarName('Novák Jan', 'Novák Petr'));
  assert.ok(!similarName('Ek', 'Ok'), 'short names need an exact match');
});
