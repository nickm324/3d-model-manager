import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { zipSync, strToU8 } from 'three/addons/libs/fflate.module.js';

const root = path.resolve(process.env.DEMO_LIBRARY || './demo-library');
const compiler = process.env.OPENSCAD_BIN || 'openscad';
await fs.mkdir(path.join(root, 'Workshop'), { recursive: true });
await fs.mkdir(path.join(root, 'Printer upgrades'), { recursive: true });
const designs = {
  'Workshop/Hex tray.scad': '$fn=6;\ndifference(){\n cylinder(h=14,r=32);\n translate([0,0,3]) cylinder(h=14,r=28);\n}\n',
  'Workshop/Cable comb.scad': '$fn=40;\nslots=5;\nspacing=9;\ndifference(){\n cube([slots*spacing+5,18,8]);\n for(i=[0:slots-1]) translate([7+i*spacing,9,-1]) cylinder(h=10,d=6);\n}\n',
  'Printer upgrades/Spool spacer.scad': '$fn=96;\nouter_diameter=50;\ninner_diameter=24;\nheight=12;\ndifference(){\n cylinder(h=height,d=outer_diameter);\n translate([0,0,-1]) cylinder(h=height+2,d=inner_diameter);\n}\n'
};
for (const [name, source] of Object.entries(designs)) {
  const input = path.join(root, name); await fs.writeFile(input, source, { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e; });
  const output = input.replace(/\.scad$/, '.stl');
  try { await fs.access(output); } catch {
    await new Promise((resolve, reject) => { const child = spawn(compiler, ['-o', output, input], { windowsHide: true, env: { ...process.env, QT_QPA_PLATFORM: 'offscreen' } }); let log = ''; child.stderr.on('data', chunk => log += chunk); child.on('error', reject); child.on('close', code => code ? reject(new Error(log)) : resolve()); });
  }
}
const vertices = [[0,0,0],[20,0,0],[20,20,0],[0,20,0],[0,0,20],[20,0,20],[20,20,20],[0,20,20]];
const triangles = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices>${vertices.map(([x,y,z]) => `<vertex x="${x}" y="${y}" z="${z}"/>`).join('')}</vertices><triangles>${triangles.map(([v1,v2,v3]) => `<triangle v1="${v1}" v2="${v2}" v3="${v3}"/>`).join('')}</triangles></mesh></object></resources><build><item objectid="1"/></build></model>`;
const zip = zipSync({ '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'), '_rels/.rels': strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'), '3D/3dmodel.model': strToU8(model) });
await fs.writeFile(path.join(root, 'Printer upgrades/Calibration cube.3mf'), zip, { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e; });
console.log(`Demo library created at ${root}`);
