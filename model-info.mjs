import { unzipSync, zipSync, strFromU8, strToU8 } from 'three/examples/jsm/libs/fflate.module.js';

const text = bytes => { try { return strFromU8(bytes); } catch { return ''; } };
const decodeOnce = value => String(value || '').replace(/&#(x[0-9a-f]+|\d+);/gi, (_, code) => String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code))).replace(/&nbsp;/gi, ' ').replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'").replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&amp;/gi, '&');
const decode = value => { let result = String(value || ''); for (let i = 0; i < 5; i++) { const next = decodeOnce(result); if (next === result) break; result = next; } return result; };
const richText = value => decode(value).replace(/<\s*br\s*\/?\s*>/gi, '\n').replace(/<\s*\/\s*(p|div|h[1-6]|li)\s*>/gi, '\n').replace(/<\s*li\b[^>]*>/gi, '• ').replace(/<[^>]*>/g, '').split('\n').map(line => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n');
const tags = (xml, name) => [...xml.matchAll(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'gi'))].map(x => decode(x[1].replace(/<[^>]+>/g, '').trim())).filter(Boolean);
const attrs = (xml, name) => [...xml.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'gi'))].map(match => Object.fromEntries([...match[1].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(x => [x[1], decode(x[2])])));
const xmlEscape = value => String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]);

export function add3mfMetadata(buffer, values = {}) {
  const archive = unzipSync(new Uint8Array(buffer)), modelName = Object.keys(archive).find(name => /(^|\/)3d\/.*\.model$/i.test(name));
  if (!modelName) throw new Error('No 3D model document was found in the converted file.');
  let xml = text(archive[modelName]); const open = xml.match(/<model\b[^>]*>/i); if (!open) throw new Error('The converted 3MF model document is invalid.');
  const metadata = Object.entries(values).filter(([, value]) => value != null && String(value).trim()).map(([name, value]) => `<metadata name="${xmlEscape(name)}">${xmlEscape(value)}</metadata>`).join('');
  xml = xml.slice(0, open.index + open[0].length) + metadata + xml.slice(open.index + open[0].length); archive[modelName] = strToU8(xml);
  return Buffer.from(zipSync(archive, { level: 6 }));
}

export function inspect3mf(buffer) {
  const archive = unzipSync(new Uint8Array(buffer));
  const names = Object.keys(archive), modelName = names.find(name => /(^|\/)3d\/.*\.model$/i.test(name));
  if (!modelName) throw new Error('No 3D model document was found.');
  const xml = text(archive[modelName]), metadata = {};
  for (const item of attrs(xml, 'metadata')) {
    const match = xml.match(new RegExp(`<metadata\\b[^>]*name=["']${String(item.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>([\\s\\S]*?)<\\/metadata>`, 'i'));
    if (item.name && match) metadata[item.name] = richText(match[1]);
  }
  const model = attrs(xml, 'model')[0] || {}, vertices = attrs(xml, 'vertex').map(v => [Number(v.x), Number(v.y), Number(v.z)]).filter(v => v.every(Number.isFinite));
  let dimensions;
  if (vertices.length) dimensions = ['x', 'y', 'z'].map((_, i) => Math.max(...vertices.map(v => v[i])) - Math.min(...vertices.map(v => v[i])));
  const thumbnailName = names.find(name => /(^|\/)(thumbnail|cover|plate[^/]*)(\.png|\.jpe?g)$/i.test(name)) || names.find(name => /Metadata\/.*\.png$/i.test(name));
  const configNames = names.filter(name => /(^|\/)(Metadata|Config)\/.*\.(json|config|xml)$/i.test(name));
  const configText = configNames.map(name => text(archive[name])).join('\n');
  const findConfig = key => configText.match(new RegExp(`["'<]${key}["'>:\\s=]+["']?([^"'<,}\\r\\n]+)`, 'i'))?.[1]?.trim();
  const standard = {
    title: metadata.Title || metadata.title || '', description: metadata.Description || metadata.description || '',
    designer: metadata.Designer || metadata.Author || metadata.designer || '', copyright: metadata.Copyright || '',
    license: metadata.LicenseTerms || metadata.License || '', created: metadata.CreationDate || '', modified: metadata.ModificationDate || '',
    application: metadata.Application || '', unit: model.unit || 'millimeter', dimensions,
    objects: attrs(xml, 'object').length, components: attrs(xml, 'component').length, buildItems: attrs(xml, 'item').length,
    materials: attrs(xml, 'base').map(x => x.name).filter(Boolean), colors: attrs(xml, 'base').map(x => x.displaycolor).filter(Boolean)
  };
  const bambu = /bambu|slice_info|model_settings|plate_/i.test(names.join('\n') + configText) ? {
    plates: names.filter(name => /plate_.*\.(png|json|gcode)$/i.test(name)).length,
    printer: findConfig('printer_model') || findConfig('printer_settings_id') || '',
    filament: findConfig('filament_settings_id') || findConfig('filament_type') || '',
    profile: findConfig('print_settings_id') || findConfig('process_settings_id') || '',
    estimatedTime: findConfig('prediction') || findConfig('estimated_time') || ''
  } : null;
  return { standard, bambu, thumbnail: thumbnailName ? { name: thumbnailName, data: Buffer.from(archive[thumbnailName]) } : null };
}

export function inspectThingiverseReadme(source) {
  const raw = String(source || '').slice(0, 250000), lines = raw.split(/\r?\n/), value = (...labels) => {
    for (const label of labels) { const match = raw.match(new RegExp(`(?:^|\\n)\\s*(?:#+\\s*)?${label}\\s*[:\\-]?\\s*(.+)`, 'i')); if (match) return match[1].trim(); }
    return '';
  };
  const url = raw.match(/https?:\/\/(?:www\.)?thingiverse\.com\/thing:\d+/i)?.[0] || '';
  const licenseLine = raw.match(/^(.+?)\s+by\s+(.+?)\s+is licensed under\s+the\s+(.+?)\s+license\.?$/im);
  const firstReadable = lines.map(line => line.replace(/^#+\s*/, '').trim()).find(line => /[a-z]{3}/i.test(line) && !/^[,.:`\s]+$/.test(line)) || '';
  return { title: value('title', 'thing name') || licenseLine?.[1]?.trim() || firstReadable, description: value('description', 'summary'), printingNotes: value('print settings', 'printing notes', 'instructions'), attribution: value('attribution', 'created by', 'author') || licenseLine?.[2]?.trim() || '', license: value('license') || licenseLine?.[3]?.trim() || '', sourceUrl: url, raw };
}
