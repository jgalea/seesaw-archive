import test from 'node:test';
import assert from 'node:assert/strict';
import {
  schoolYear, matchesYear, archiveFilename, childFolder, matchIndexes,
} from '../src/names.js';
import { parseSelection } from '../src/prompt.js';

test('schoolYear pulls the year out of a class name', () => {
  assert.equal(schoolYear('Art PK4-A 2023-24'), '2023-24');
  assert.equal(schoolYear('PK4-A 2025-26 The Hedgehogs'), '2025-26');
  assert.equal(schoolYear('Homeroom 2024-2025'), '2024-25');
  assert.equal(schoolYear('1A Lenguas y sociales con Ms Silvia'), null);
  // Seen on a real account: teachers write the short form too.
  assert.equal(schoolYear('PK4-A Library 23-24'), '2023-24');
  // Non-consecutive pairs are room or group numbers, not school years.
  assert.equal(schoolYear('Reading Group 12-19'), null);
  assert.equal(schoolYear('Homeroom 1-A'), null);
});

test('matchesYear accepts the shapes a parent would type', () => {
  for (const needle of ['2023-24', '2023-2024', '2023', '2024']) {
    assert.equal(matchesYear('Art PK4-A 2023-24', needle), true, needle);
  }
  assert.equal(matchesYear('Art PK4-A 2023-24', '2025-26'), false);
  assert.equal(matchesYear('Class with no year', '2023'), false);
});

test('filenames keep the child and stay filesystem-safe', () => {
  assert.equal(
    archiveFilename({ childName: 'Ada Ross', className: 'Gross Motor PK4-A 2023-24' }),
    'Ada_Ross_Gross_Motor_PK4-A_2023-24.zip'
  );
  assert.equal(
    archiveFilename({ childName: 'Ada Ross', className: 'Art / Music' }),
    'Ada_Ross_Art_Music.zip'
  );
  assert.equal(childFolder(''), 'Unknown_Child');
});

test('typing a child name or year at the menu selects the right rows', () => {
  const rows = [
    { childName: 'Ada Ross', className: 'Art PK4-A 2023-24' },
    { childName: 'Ada Ross', className: 'Music K5-A 2024-25' },
    { childName: 'Sam Ross', className: 'Art PK3-A 2024-25' },
  ];
  assert.deepEqual(matchIndexes(rows, 'Ada'), [0, 1]);
  assert.deepEqual(matchIndexes(rows, 'ada'), [0, 1]);
  assert.deepEqual(matchIndexes(rows, '2024-25'), [1, 2]);
  assert.deepEqual(matchIndexes(rows, 'Ross'), [0, 1, 2]);
  assert.deepEqual(matchIndexes(rows, 'nobody'), []);
});

test('parseSelection handles numbers, ranges, all, and words', () => {
  assert.deepEqual(parseSelection('1-3,7', 10), [0, 1, 2, 6]);
  assert.deepEqual(parseSelection('all', 3), [0, 1, 2]);
  assert.deepEqual(parseSelection('', 3), []);
  assert.deepEqual(parseSelection('2,2,1', 3), [0, 1]);
  assert.deepEqual(parseSelection('ada', 3, () => [1, 2]), [1, 2]);
  assert.throws(() => parseSelection('9', 3), /Out of range/);
  assert.throws(() => parseSelection('3-1', 5), /Out of range/);
  assert.throws(() => parseSelection('nope', 3, () => []), /Nothing matches/);
});
