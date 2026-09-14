// A literal-only reader: never executes source or evaluates expressions.
const numberPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
export function literal(text) {
  const value = text.trim();
  if (numberPattern.test(value) && Number.isFinite(Number(value))) return { type: 'number', value: Number(value) };
  if (value === 'true' || value === 'false') return { type: 'boolean', value: value === 'true' };
  if (/^"(?:\\.|[^"\\])*"$/.test(value)) { try { return { type: 'string', value: JSON.parse(value) }; } catch { return null; } }
  if (value.startsWith('[') && value.endsWith(']')) {
    const values = value.slice(1, -1).split(',').map(x => x.trim());
    if (values.length >= 1 && values.length <= 4 && values.every(x => numberPattern.test(x) && Number.isFinite(Number(x)))) return { type: 'vector', value: values.map(Number) };
  }
  return null;
}
function annotation(raw, param) {
  const text = raw.trim(), bracket = text.match(/^\[([^\]]+)\]/);
  if (!bracket) {
    if (numberPattern.test(text) && Number(text) > 0) { if (param.type === 'string') param.maxLength = Math.floor(Number(text)); else param.step = Number(text); }
    return;
  }
  const spec = bracket[1].trim(), parts = spec.split(':').map(x => x.trim());
  if ((param.type === 'number' || param.type === 'vector') && !spec.includes(',') && parts.length <= 3 && parts.every(x => numberPattern.test(x))) {
    const numbers = parts.map(Number);
    const min = numbers.length === 1 ? 0 : numbers[0], max = numbers.at(-1), step = numbers.length === 3 ? numbers[1] : 1;
    if (Number.isFinite(min) && Number.isFinite(max) && Number.isFinite(step) && max > min && step > 0) Object.assign(param, { min, max, step, range: true });
    return;
  }
  if (param.type !== 'number' && param.type !== 'string') return;
  const options = spec.split(',').map(entry => {
    const split = entry.indexOf(':'), rawValue = (split < 0 ? entry : entry.slice(0, split)).trim();
    const value = param.type === 'number' ? Number(rawValue) : rawValue.replace(/^"(.*)"$/, '$1');
    return { value, label: (split < 0 ? rawValue : entry.slice(split + 1)).trim() };
  });
  if (options.length && options.every(x => param.type !== 'number' || Number.isFinite(x.value))) param.options = options;
}

export function parseParameters(source) {
  const tokens = [];
  const regex = /\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|[A-Za-z_$][\w$]*|(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[^\s]/g;
  for (const match of source.matchAll(regex)) { tokens.push({ text: match[0], start: match.index, end: match.index + match[0].length }); if (match[0] === '{') break; }
  const params = []; let group = 'Parameters', description = '', i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token.text === '{') break;
    if (token.text.startsWith('/*')) { const header = token.text.match(/^\/\*\s*\[([^\]]+)\]\s*\*\/$/); if (header) { group = header[1].trim(); description = ''; } i++; continue; }
    if (token.text.startsWith('//')) { description = token.text.slice(2).trim(); i++; continue; }
    if ((token.text === 'include' || token.text === 'use') && tokens[i + 1]?.text === '<') { while (i < tokens.length && tokens[i].text !== '>') i++; i++; description = ''; continue; }
    if (/^[A-Za-z_$][\w$]*$/.test(token.text) && tokens[i + 1]?.text === '=') {
      const start = i + 2; let end = start;
      while (end < tokens.length && ![';', '{'].includes(tokens[end].text)) end++;
      if (tokens[end]?.text !== ';') break;
      const expression = tokens.slice(start, end).filter(t => !t.text.startsWith('//') && !t.text.startsWith('/*'));
      const originalValue = expression.length ? literal(source.slice(expression[0].start, expression.at(-1).end)) : null;
      if (originalValue && group !== 'Hidden') {
        const parameter = { name: token.text, group, description, ...originalValue, from: expression[0].start, to: expression.at(-1).end };
        const comment = tokens[end + 1];
        if (comment?.text.startsWith('//') && !/[\r\n]/.test(source.slice(tokens[end].end, comment.start))) { annotation(comment.text.slice(2), parameter); end++; }
        params.push(parameter);
      }
      description = ''; i = end + 1; continue;
    }
    // Skip full non-assignment statements, including function/module arguments.
    while (i < tokens.length && ![';', '{'].includes(tokens[i].text)) i++;
    if (tokens[i]?.text === '{') break;
    i++; description = '';
  }
  // Ambiguous reassignments are left to the source editor.
  return params.filter(param => params.filter(other => other.name === param.name).length === 1);
}

export function parameterChange(source, name, value) {
  const parameter = parseParameters(source).find(p => p.name === name);
  if (!parameter) throw new Error('This parameter changed in the source. Reopen the Customizer.');
  const values = parameter.type === 'vector' ? value : [value];
  if (parameter.type === 'vector' && (!Array.isArray(value) || value.length !== parameter.value.length)) throw new Error('Enter a number for each vector component.');
  if (parameter.type === 'number' || parameter.type === 'vector') {
    if (!values.every(x => typeof x === 'number' && Number.isFinite(x))) throw new Error('Enter a valid number.');
    if (parameter.range && !values.every(x => x >= parameter.min && x <= parameter.max)) throw new Error(`Use a value from ${parameter.min} to ${parameter.max}.`);
  } else if (typeof value !== parameter.type) throw new Error('Invalid parameter value.');
  if (parameter.maxLength && value.length > parameter.maxLength) throw new Error(`Use at most ${parameter.maxLength} characters.`);
  if (parameter.options && !parameter.options.some(option => option.value === value)) throw new Error('Choose one of the listed values.');
  return { from: parameter.from, to: parameter.to, insert: JSON.stringify(value) };
}
