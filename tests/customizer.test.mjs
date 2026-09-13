import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseParameters, parameterChange } from '../src/customizer.js';

test('parse OpenSCAD controls, descriptions, sections, and hidden values', () => {
  const source = `/* [Dimensions] */
// Overall width
width = 30; // [10:0.5:100]
height = 12;
enabled = true;
label = "Part";
mode = "M"; // [S:Small, M:Medium, L:Large]
quality = 2; // [1:Low, 2:High]
offset = [1, -2, 3]; // [-10:0.1:10]
stepper = 1.5; // .25
/* [Hidden] */
secret = 42;
/* [Other] */
$fn = 64;
calculated = width * 2;
module part(size = 99) { local = 3; }
after = 100;`;
  const params = parseParameters(source); assert.equal(params.length, 9);
  const width = params.find(p => p.name === 'width'); assert.equal(width.group, 'Dimensions'); assert.equal(width.description, 'Overall width'); assert.equal(width.step, .5); assert.equal(width.max, 100);
  assert.equal(params.find(p => p.name === 'mode').options[1].label, 'Medium'); assert.equal(params.find(p => p.name === 'quality').options[1].value, 2);
  assert.deepEqual(params.find(p => p.name === 'offset').value, [1, -2, 3]); assert.equal(params.find(p => p.name === 'stepper').step, .25);
  assert.ok(!params.some(p => ['secret', 'size', 'local', 'after', 'calculated'].includes(p.name)));
});

test('update only a literal while preserving comments and all other source', () => {
  const source = '// size\r\nwidth = 30; // [10:1:100]\r\nheight=12;\r\ncube([width,width,height]);';
  const change = parameterChange(source, 'width', 45);
  const updated = source.slice(0, change.from) + change.insert + source.slice(change.to);
  assert.equal(updated, source.replace('width = 30;', 'width = 45;'));
  assert.throws(() => parameterChange(source, 'width', 200), /10 to 100/);
  assert.throws(() => parameterChange(source, 'width', NaN), /valid number/);
  assert.throws(() => parameterChange(source, 'width', 'cube(99)'), /valid number/);
});

test('ignore braces in strings/comments, function arguments, calculated values, and ambiguous names', () => {
  const source = '// brace { here\ninclude <lib.scad>\ntext="{value}"; a=-1.5; vector=[1,2,3,4];\nfunction f(x=10)=x;\nb=20; expr=1+2; duplicate=1; duplicate=2; // comment\ncube(2);';
  const params = parseParameters(source); assert.deepEqual(params.map(p => p.name), ['text', 'a', 'vector', 'b']);
  assert.equal(params[1].value, -1.5);
  const change = parameterChange(source, 'text', 'a"; cube(99); //');
  assert.equal(JSON.parse(change.insert), 'a"; cube(99); //');
});
