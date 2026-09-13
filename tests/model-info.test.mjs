import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'three/examples/jsm/libs/fflate.module.js';
import { inspect3mf, inspectThingiverseReadme, add3mfMetadata } from '../model-info.mjs';

test('extract standard and Bambu project details from 3MF', () => {
  const model = `<?xml version="1.0"?><model unit="millimeter"><metadata name="Title">Useful Part</metadata><metadata name="Designer">Sam</metadata><metadata name="Description">&amp;lt;p&amp;gt;First paragraph&amp;lt;/p&amp;gt;&amp;lt;ul&amp;gt;&amp;lt;li&amp;gt;Print slowly&amp;lt;/li&amp;gt;&amp;lt;/ul&amp;gt;</metadata><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/><vertex x="10" y="20" z="5"/></vertices></mesh></object></resources><build><item objectid="1"/></build></model>`;
  const archive = zipSync({ '3D/3dmodel.model': strToU8(model), 'Metadata/project_settings.config': strToU8('{"printer_model":"X1 Carbon","filament_type":"PLA"}'), 'Metadata/plate_1.png': new Uint8Array([137,80,78,71]) });
  const info = inspect3mf(Buffer.from(archive));
  assert.equal(info.standard.title, 'Useful Part'); assert.equal(info.standard.designer, 'Sam'); assert.equal(info.standard.description, 'First paragraph\n• Print slowly'); assert.deepEqual(info.standard.dimensions, [10,20,5]); assert.equal(info.standard.objects, 1); assert.equal(info.standard.buildItems, 1);
  assert.equal(info.bambu.printer, 'X1 Carbon'); assert.equal(info.bambu.filament, 'PLA'); assert.ok(info.thumbnail.data.length);
});

test('extract Thingiverse project information from README', () => {
  const info = inspectThingiverseReadme('# Gear Holder\nDescription: Wall-mounted holder\nPrinting Notes: Print with supports\nLicense: CC BY\nhttps://www.thingiverse.com/thing:1234');
  assert.equal(info.title, 'Gear Holder'); assert.equal(info.description, 'Wall-mounted holder'); assert.equal(info.printingNotes, 'Print with supports'); assert.equal(info.license, 'CC BY'); assert.match(info.sourceUrl, /thing:1234/);
});

test('embed model and README details into a 3MF archive', () => {
  const model = '<?xml version="1.0"?><model unit="millimeter"><resources><object id="1"><mesh><vertices><vertex x="0" y="0" z="0"/></vertices></mesh></object></resources><build><item objectid="1"/></build></model>';
  const archive = Buffer.from(zipSync({ '3D/3dmodel.model': strToU8(model) }));
  const converted = add3mfMetadata(archive, { Title: 'Bracket', Designer: 'Alex & Sam', Description: 'Print with supports.', LicenseTerms: 'CC BY' });
  const info = inspect3mf(converted);
  assert.equal(info.standard.title, 'Bracket');
  assert.equal(info.standard.designer, 'Alex & Sam');
  assert.equal(info.standard.description, 'Print with supports.');
  assert.equal(info.standard.license, 'CC BY');
});

test('ignore Thingiverse ASCII banner and use its license attribution line', () => {
  const info = inspectThingiverseReadme('.,,:::,,, ::`.:,\n4m bolt by Tristan88 is licensed under the Creative Commons - Attribution - Share Alike license.\n# Summary\nA custom bolt');
  assert.equal(info.title, '4m bolt'); assert.equal(info.attribution, 'Tristan88'); assert.equal(info.license, 'Creative Commons - Attribution - Share Alike');
});
