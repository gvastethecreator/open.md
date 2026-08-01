/**
 * Pure rich-Read HTML builders for companion formats.
 * Invalid/large inputs degrade safely (plain + warning banner).
 */

export const DEFAULT_CSV_ROW_CAP = 500;

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function banner(message, tone = 'warning') {
  return `<p class="format-read-banner format-read-banner--${tone}" role="status">${escapeHtml(message)}</p>`;
}

function plainPre(source, { language = null, warning = null } = {}) {
  const langClass = language ? ` language-${escapeHtml(language)}` : '';
  const head = warning ? banner(warning) : '';
  return `${head}<pre class="format-read-plain" data-plain-text="true" data-full-document-highlight="true"><code class="${langClass.trim()}">${escapeHtml(source)}</code></pre>`;
}

function wrapRich(inner, { format, warning = null } = {}) {
  const head = warning ? banner(warning) : '';
  return `${head}<div class="format-read format-read--${escapeHtml(format || 'text')}" data-format-read="${escapeHtml(format || 'text')}">${inner}</div>`;
}

function renderJsonNode(value, depth = 0) {
  if (value === null) return '<span class="json-null">null</span>';
  if (typeof value === 'boolean') return `<span class="json-bool">${value}</span>`;
  if (typeof value === 'number') return `<span class="json-number">${escapeHtml(String(value))}</span>`;
  if (typeof value === 'string') return `<span class="json-string">"${escapeHtml(value)}"</span>`;

  if (Array.isArray(value)) {
    if (value.length === 0) return '<span class="json-array">[]</span>';
    const items = value.map((item, index) => (
      `<li class="json-item"><span class="json-index">${index}</span>${renderJsonNode(item, depth + 1)}</li>`
    )).join('');
    return `<details class="json-collapsible" ${depth < 2 ? 'open' : ''}><summary>Array (${value.length})</summary><ul class="json-array">${items}</ul></details>`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) return '<span class="json-object">{}</span>';
    const items = keys.map((key) => (
      `<li class="json-item"><span class="json-key">${escapeHtml(key)}</span>${renderJsonNode(value[key], depth + 1)}</li>`
    )).join('');
    return `<details class="json-collapsible" ${depth < 2 ? 'open' : ''}><summary>Object (${keys.length})</summary><ul class="json-object">${items}</ul></details>`;
  }

  return `<span class="json-unknown">${escapeHtml(String(value))}</span>`;
}

/**
 * @returns {{ html: string, warning: string | null, mode: 'rich' | 'plain' }}
 */
export function renderJsonRead(source) {
  const text = typeof source === 'string' ? source : '';
  try {
    const value = JSON.parse(text);
    const tree = renderJsonNode(value);
    return {
      html: wrapRich(tree, { format: 'json' }),
      warning: null,
      mode: 'rich',
    };
  } catch {
    const warning = 'Invalid JSON — showing plain text. Edit mode can still fix the source.';
    return {
      html: plainPre(text, { language: 'json', warning }),
      warning,
      mode: 'plain',
    };
  }
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells;
}

/**
 * @returns {{ html: string, warning: string | null, mode: 'rich' | 'plain', rowCount: number, truncated: boolean }}
 */
export function renderCsvRead(source, { rowCap = DEFAULT_CSV_ROW_CAP } = {}) {
  const text = typeof source === 'string' ? source : '';
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0) {
    return {
      html: wrapRich('<p class="format-read-empty">Empty CSV</p>', { format: 'csv' }),
      warning: null,
      mode: 'rich',
      rowCount: 0,
      truncated: false,
    };
  }

  const cap = Math.max(1, Math.floor(Number(rowCap) || DEFAULT_CSV_ROW_CAP));
  const truncated = lines.length > cap;
  const visible = lines.slice(0, cap);
  const rows = visible.map(parseCsvLine);
  const colCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const header = rows[0] || [];
  const body = rows.slice(1);

  const headCells = Array.from({ length: colCount }, (_, i) => (
    `<th scope="col">${escapeHtml(header[i] ?? '')}</th>`
  )).join('');
  const bodyHtml = body.map((row) => {
    const cells = Array.from({ length: colCount }, (_, i) => (
      `<td>${escapeHtml(row[i] ?? '')}</td>`
    )).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  const warning = truncated
    ? `Showing first ${cap} of ${lines.length} rows for performance.`
    : null;

  const table = `<div class="format-read-table-wrap"><table class="format-read-table"><thead><tr>${headCells}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`;
  return {
    html: wrapRich(table, { format: 'csv', warning }),
    warning,
    mode: 'rich',
    rowCount: lines.length,
    truncated,
  };
}

/**
 * Structured-ish view for INI/YAML/TOML/env: section headings + key lines.
 * Never throws; falls back to plain for pathological input.
 */
export function renderStructuredTextRead(source, { format = 'ini' } = {}) {
  const text = typeof source === 'string' ? source : '';
  if (!text.trim()) {
    return {
      html: wrapRich('<p class="format-read-empty">Empty file</p>', { format }),
      warning: null,
      mode: 'rich',
    };
  }

  try {
    const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const parts = [];
    let buffer = [];

    const flushBuffer = () => {
      if (buffer.length === 0) return;
      const body = buffer.map((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
          return `<div class="struct-comment">${escapeHtml(line)}</div>`;
        }
        const eq = trimmed.indexOf('=');
        const colon = trimmed.indexOf(':');
        let split = -1;
        if (eq > 0 && (colon < 0 || eq < colon)) split = eq;
        else if (colon > 0) split = colon;
        if (split > 0) {
          const key = trimmed.slice(0, split).trim();
          const value = trimmed.slice(split + 1).trim();
          return `<div class="struct-kv"><span class="struct-key">${escapeHtml(key)}</span><span class="struct-sep">:</span><span class="struct-value">${escapeHtml(value)}</span></div>`;
        }
        return `<div class="struct-line">${escapeHtml(line)}</div>`;
      }).join('');
      parts.push(`<div class="struct-block">${body}</div>`);
      buffer = [];
    };

    for (const line of lines) {
      const section = line.match(/^\s*\[([^\]]+)\]\s*$/);
      if (section) {
        flushBuffer();
        parts.push(`<h3 class="struct-section">${escapeHtml(section[1])}</h3>`);
        continue;
      }
      buffer.push(line);
    }
    flushBuffer();

    return {
      html: wrapRich(parts.join(''), { format }),
      warning: null,
      mode: 'rich',
    };
  } catch {
    const warning = 'Could not structure this file — showing plain text.';
    return {
      html: plainPre(text, { warning }),
      warning,
      mode: 'plain',
    };
  }
}

/**
 * Build Read HTML for a companion format from source (frontend enhancement).
 * Markdown and image are handled elsewhere.
 */
export function buildCompanionReadHtml(source, format, options = {}) {
  switch (format) {
    case 'json':
      return renderJsonRead(source);
    case 'csv':
      return renderCsvRead(source, options);
    case 'yaml':
    case 'toml':
    case 'ini':
    case 'env':
      return renderStructuredTextRead(source, { format });
    default:
      return {
        html: plainPre(source, {
          language: options.highlightLanguage || null,
        }),
        warning: null,
        mode: 'plain',
      };
  }
}
