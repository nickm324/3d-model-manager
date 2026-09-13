import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesModelSearch } from '../src/search.js';

const tagged = { path: 'Parts/pickup.stl', tags: ['Truck'], notes: '' };
const prose = { path: 'Clock.3mf', tags: [], notes: 'The inspiration struck instantly.' };

test('whole-word search does not match text inside another word', () => {
  assert.equal(matchesModelSearch(tagged, 'truck'), true);
  assert.equal(matchesModelSearch(prose, 'truck'), false);
});

test('tag search requires an exact tag', () => {
  assert.equal(matchesModelSearch(tagged, 'tag:truck'), true);
  assert.equal(matchesModelSearch({ ...tagged, tags: ['Fire Truck'] }, 'tag:truck'), false);
  assert.equal(matchesModelSearch({ ...tagged, tags: ['Fire Truck'] }, 'tag:fire truck'), true);
});

test('quoted search supports exact phrases', () => {
  assert.equal(matchesModelSearch({ ...tagged, notes: 'Heavy duty truck mount' }, '"truck mount"'), true);
  assert.equal(matchesModelSearch({ ...tagged, notes: 'Truck axle mount' }, '"truck mount"'), false);
});
