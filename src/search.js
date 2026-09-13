const clean = value => String(value || '').normalize('NFKC').toLocaleLowerCase().trim();
const words = value => clean(value).match(/[\p{L}\p{N}]+/gu) || [];

export function matchesModelSearch(file, query) {
  const wanted = clean(query); if (!wanted) return true;
  const tags = (file.tags || []).map(clean), tagOnly = wanted.match(/^tag:\s*(.+)$/);
  if (tagOnly) return tags.includes(clean(tagOnly[1]));
  const text = clean(`${file.path || ''} ${tags.join(' ')} ${file.notes || ''} ${file.collection || ''} ${JSON.stringify(file.modelInfo || {})} ${JSON.stringify(file.projectInfo || {})}`);
  if (wanted.length > 1 && wanted.startsWith('"') && wanted.endsWith('"')) return text.includes(wanted.slice(1, -1));
  const available = new Set(words(text)); return words(wanted).every(word => available.has(word));
}
