import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import occtFactory from 'occt-import-js';

test('OpenCascade converts STEP geometry for the browser viewer', { timeout: 30000 }, async () => {
  const content = await fs.readFile(new URL('../node_modules/occt-import-js/test/testfiles/simple-basic-cube/cube.stp', import.meta.url));
  const occt = await occtFactory(), result = occt.ReadStepFile(content, { linearUnit: 'millimeter' });
  assert.equal(result.success, true); assert.ok(result.meshes.length); assert.ok(result.meshes[0].attributes.position.array.length); assert.ok(result.meshes[0].index.array.length);
});
