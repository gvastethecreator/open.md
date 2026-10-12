/**
 * Minimal JSON property model: top-level rows, depth-limited nested text cells.
 */

export const JSON_PROPS_ROW_CAP = 2000;

function detectIndent(source) {
  const match = String(source).match(/\n([ \t]+)"/);
  if (!match) return 2;
  const unit = match[1];
  if (unit.includes('\t')) return '\t';
  return unit.length || 2;
}

function preserveTrailingNewline(source) {
  return /\r?\n$/.test(String(source ?? ''));
}

function valueType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function isComposite(value) {
  return value !== null && typeof value === 'object';
}

function serializeValue(value, indent) {
  return JSON.stringify(value, null, indent);
}

function canRebuildJson(text) {
  const containers = [];
  // JSON.parse validates syntax first; keep strings whole when inspecting tokens.
  const tokens = /("(?:[^"\\]|\\.)*")\s*:|"(?:[^"\\]|\\.)*"|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|[{}\[\]]/g;
  for (const [token, keyText, numberText] of text.matchAll(tokens)) {
    if (token === '{') containers.push(new Set());
    else if (token === '[') containers.push(null);
    else if (token === '}' || token === ']') containers.pop();
    else if (keyText !== undefined) {
      const key = JSON.parse(keyText);
      const keys = containers.at(-1);
      if (key === '__proto__' || keys.has(key)) return false;
      keys.add(key);
    } else if (numberText !== undefined) {
      const number = Number(numberText);
      if ((Number.isInteger(number) && !Number.isSafeInteger(number))
          || JSON.stringify(number) !== numberText) return false;
    }
  }
  return true;
}

/**
 * @returns {{
 *   ok: true,
 *   rootType: 'object' | 'array',
 *   indent: number | string,
 *   trailingNewline: boolean,
 *   rows: Array<object>,
 *   keyCount: number,
 *   itemCount: number,
 * } | { ok: false, reason: string }}
 */
export function parseJsonPropertyModel(source, { rowCap = JSON_PROPS_ROW_CAP } = {}) {
  const text = String(source ?? '');
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'invalid' };
  }

  if (value === null || typeof value !== 'object') {
    return { ok: false, reason: 'primitive' };
  }
  if (!canRebuildJson(text)) return { ok: false, reason: 'unsafe' };

  const indent = detectIndent(text);
  const trailingNewline = preserveTrailingNewline(text);
  const rootType = Array.isArray(value) ? 'array' : 'object';
  const entries = rootType === 'array'
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);

  if (entries.length > rowCap) {
    return { ok: false, reason: 'too-large', keyCount: entries.length };
  }

  const rows = entries.map(([key, entryValue], index) => {
    const type = valueType(entryValue);
    const composite = isComposite(entryValue);
    return Object.freeze({
      id: `row-${index}-${key}`,
      key,
      path: rootType === 'array' ? `[${key}]` : key,
      type,
      composite,
      // Scalars edit as text; composites as JSON text at depth 1.
      text: composite
        ? serializeValue(entryValue, indent)
        : type === 'string'
          ? entryValue
          : serializeValue(entryValue),
      value: entryValue,
    });
  });

  return {
    ok: true,
    rootType,
    indent,
    trailingNewline,
    rows: Object.freeze(rows),
    keyCount: rootType === 'object' ? rows.length : 0,
    itemCount: rootType === 'array' ? rows.length : 0,
    value,
  };
}

function parseCellText(type, text) {
  const raw = String(text ?? '');
  // Composite cells own nested JSON text. String cells must stay literal text
  // even when the value looks like JSON (e.g. "{\"a\":1}" as a string).
  if (type === 'composite') {
    try {
      const value = JSON.parse(raw);
      if (!canRebuildJson(raw)) return { ok: false, error: 'Use plain-text editing to preserve this JSON' };
      return { ok: true, value };
    } catch {
      return { ok: false, error: 'Invalid JSON' };
    }
  }
  if (type === 'string') return { ok: true, value: raw };
  if (type === 'number') {
    if (raw.trim() === '' || Number.isNaN(Number(raw))) {
      return { ok: false, error: 'Enter a number' };
    }
    if (JSON.stringify(Number(raw)) !== raw.trim() || !canRebuildJson(raw)) {
      return { ok: false, error: 'Use plain-text editing to preserve this number' };
    }
    return { ok: true, value: Number(raw) };
  }
  if (type === 'boolean') {
    if (raw === 'true') return { ok: true, value: true };
    if (raw === 'false') return { ok: true, value: false };
    return { ok: false, error: 'Use true or false' };
  }
  if (type === 'null') {
    if (raw.trim() === '' || raw === 'null') return { ok: true, value: null };
    return { ok: false, error: 'Use null' };
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: 'Invalid JSON' };
  }
}

/**
 * Apply a top-level row edit and return serialized source.
 */
export function updateJsonPropertyModel(model, path, nextText, { key, type } = {}) {
  if (!model?.ok) return { ok: false, error: 'Model unavailable' };
  const rows = model.rows.map((row) => ({ ...row }));
  const index = rows.findIndex((row) => row.path === path);
  if (index < 0) return { ok: false, error: 'Property not found' };

  const row = rows[index];
  if (key !== undefined && key !== row.key) {
    if (model.rootType !== 'object' || !key.trim() || key === '__proto__') {
      return { ok: false, error: 'Use a non-empty property name other than __proto__', path };
    }
    if (rows.some((item) => item.key === key)) return { ok: false, error: 'This property name already exists', path };
  }
  if (type !== undefined && !['string', 'number', 'boolean', 'null', row.type].includes(type)) {
    return { ok: false, error: 'Unsupported value type', path };
  }
  const cellType = type && type !== row.type ? type : row.composite ? 'composite' : row.type;
  let parsed;
  try {
    parsed = parseCellText(cellType, nextText);
  } catch {
    return { ok: false, error: 'Invalid value', path };
  }
  if (!parsed.ok) return { ok: false, error: parsed.error, path };

  rows[index] = {
    ...row,
    key: key ?? row.key,
    value: parsed.value,
    type: valueType(parsed.value),
    composite: isComposite(parsed.value),
    text: isComposite(parsed.value)
      ? serializeValue(parsed.value, model.indent)
      : typeof parsed.value === 'string'
        ? parsed.value
        : serializeValue(parsed.value),
  };

  const root = model.rootType === 'array' ? [] : {};
  for (const item of rows) {
    if (model.rootType === 'array') root[Number(item.key)] = item.value;
    else root[item.key] = item.value;
  }

  let source = JSON.stringify(root, null, model.indent);
  if (model.trailingNewline) source += '\n';

  const next = parseJsonPropertyModel(source, { rowCap: rows.length + 100 });
  if (!next.ok) return { ok: false, error: 'Could not rebuild JSON' };
  return { ok: true, model: next, source };
}

export function removeJsonProperty(model, path) {
  if (!model?.ok) return { ok: false, error: 'Model unavailable' };
  const rows = model.rows.filter((row) => row.path !== path);
  const root = model.rootType === 'array' ? [] : {};
  rows.forEach((row, index) => {
    if (model.rootType === 'array') root.push(row.value);
    else root[row.key] = row.value;
  });
  let source = JSON.stringify(root, null, model.indent);
  if (model.trailingNewline) source += '\n';
  const next = parseJsonPropertyModel(source);
  if (!next.ok) return { ok: false, error: 'Could not rebuild JSON' };
  return { ok: true, model: next, source };
}

export function duplicateJsonProperty(model, path) {
  if (!model?.ok) return { ok: false, error: 'Model unavailable' };
  const row = model.rows.find((item) => item.path === path);
  if (!row) return { ok: false, error: 'Property not found' };

  const root = model.rootType === 'array' ? [...model.value] : { ...model.value };
  const cloneValue = (value) => (
    typeof structuredClone === 'function'
      ? structuredClone(value)
      : JSON.parse(JSON.stringify(value))
  );
  if (model.rootType === 'array') {
    root.splice(Number(row.key) + 1, 0, cloneValue(row.value));
  } else {
    let nextKey = `${row.key}_copy`;
    let n = 2;
    while (Object.prototype.hasOwnProperty.call(root, nextKey)) {
      nextKey = `${row.key}_copy${n}`;
      n += 1;
    }
    root[nextKey] = cloneValue(row.value);
  }

  let source = JSON.stringify(root, null, model.indent);
  if (model.trailingNewline) source += '\n';
  const next = parseJsonPropertyModel(source);
  if (!next.ok) return { ok: false, error: 'Could not rebuild JSON' };
  return { ok: true, model: next, source };
}

export function addJsonProperty(model, { key = 'newKey', value = '' } = {}) {
  if (!model?.ok) return { ok: false, error: 'Model unavailable' };
  const root = model.rootType === 'array' ? [...model.value] : { ...model.value };
  if (model.rootType === 'array') {
    root.push(value);
  } else {
    let nextKey = key;
    let n = 2;
    while (Object.prototype.hasOwnProperty.call(root, nextKey)) {
      nextKey = `${key}${n}`;
      n += 1;
    }
    root[nextKey] = value;
  }
  let source = JSON.stringify(root, null, model.indent);
  if (model.trailingNewline) source += '\n';
  const next = parseJsonPropertyModel(source);
  if (!next.ok) return { ok: false, error: 'Could not rebuild JSON' };
  return { ok: true, model: next, source };
}
