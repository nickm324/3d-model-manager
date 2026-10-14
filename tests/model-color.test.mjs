import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_MODEL_COLOR, stepModelColor } from '../src/model-color.js';

test('keeps normalized STEP colors at their intended brightness', () => {
  assert.deepEqual(stepModelColor([0.6, 0.4, 0.2]), [0.6, 0.4, 0.2]);
});

test('supports STEP colors expressed as byte components', () => {
  assert.deepEqual(stepModelColor([255, 128, 0]), [1, 128 / 255, 0]);
});

test('uses the standard model orange for absent or nearly black colors', () => {
  assert.deepEqual(stepModelColor(undefined), DEFAULT_MODEL_COLOR);
  assert.deepEqual(stepModelColor([0.01, 0.01, 0.01]), DEFAULT_MODEL_COLOR);
});
