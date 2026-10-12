import { getMarkdownSourceTokenRanges } from './markdown-source.js';

const BLOCK_TYPES = new Set([
  'paragraph',
  'heading1',
  'heading2',
  'heading3',
  'heading4',
  'heading5',
  'heading6',
  'bullet',
  'numbered',
  'todo',
  'quote',
  'code',
  'divider',
]);

let nextBlockId = 1;

export function createEditorBlock(type = 'paragraph', text = '', options = {}) {
  const normalizedType = BLOCK_TYPES.has(type) ? type : 'paragraph';
  return {
    id: options.id || `block-${nextBlockId++}`,
    type: normalizedType,
    text: String(text ?? '').replace(/\r\n?/g, '\n'),
    checked: Boolean(options.checked),
    indent: Math.max(0, Math.min(6, Math.floor(Number(options.indent) || 0))),
    number: Math.max(1, Math.floor(Number(options.number) || 1)),
    language: String(options.language || '').trim(),
    fence: options.fence === '~~~' ? '~~~' : '```',
  };
}

export function parseMarkdownLine(line) {
  let match = line.match(/^(#{1,6})\s+(.*)$/);
  if (match) return createEditorBlock(`heading${match[1].length}`, match[2]);

  match = line.match(/^(\s*)[-+*]\s+\[([ xX])\]\s?(.*)$/);
  if (match) {
    return createEditorBlock('todo', match[3], {
      checked: match[2].toLowerCase() === 'x',
      indent: Math.floor(match[1].length / 2),
    });
  }

  match = line.match(/^(\s*)[-+*]\s+(.*)$/);
  if (match) {
    return createEditorBlock('bullet', match[2], {
      indent: Math.floor(match[1].length / 2),
    });
  }

  match = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
  if (match) {
    return createEditorBlock('numbered', match[3], {
      indent: Math.floor(match[1].length / 2),
      number: Number(match[2]),
    });
  }

  match = line.match(/^>\s?(.*)$/);
  if (match) return createEditorBlock('quote', match[1]);

  if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
    return createEditorBlock('divider');
  }

  return createEditorBlock('paragraph', line);
}

export function parseEditorDocument(source, { markdown = true } = {}) {
  const normalized = String(source ?? '').replace(/\r\n?/g, '\n');
  if (!markdown) {
    const blocks = normalized.split('\n').map((line) => createEditorBlock('paragraph', line));
    return blocks.length > 0 ? blocks : [createEditorBlock()];
  }

  const lines = normalized.split('\n');
  const blocks = [];
  for (let index = 0; index < lines.length; index += 1) {
    const fenceMatch = lines[index].match(/^\s{0,3}(```|~~~)\s*([^\s`]*)\s*$/);
    if (!fenceMatch) {
      blocks.push(parseMarkdownLine(lines[index]));
      continue;
    }

    const fence = fenceMatch[1];
    const codeLines = [];
    let closed = false;
    for (index += 1; index < lines.length; index += 1) {
      if (new RegExp(`^\\s{0,3}${fence}\\s*$`).test(lines[index])) {
        closed = true;
        break;
      }
      codeLines.push(lines[index]);
    }
    blocks.push(createEditorBlock('code', codeLines.join('\n'), {
      language: fenceMatch[2],
      fence,
    }));
    if (!closed) break;
  }

  return blocks.length > 0 ? blocks : [createEditorBlock()];
}

function serializeBlock(block, markdown) {
  const text = String(block.text ?? '').replace(/\r\n?/g, '\n');
  if (!markdown) return text;

  const indent = '  '.repeat(Math.max(0, Math.min(6, Number(block.indent) || 0)));
  switch (block.type) {
    case 'heading1': return `# ${text}`;
    case 'heading2': return `## ${text}`;
    case 'heading3': return `### ${text}`;
    case 'heading4': return `#### ${text}`;
    case 'heading5': return `##### ${text}`;
    case 'heading6': return `###### ${text}`;
    case 'bullet': return `${indent}- ${text}`;
    case 'numbered': return `${indent}${Math.max(1, Number(block.number) || 1)}. ${text}`;
    case 'todo': return `${indent}- [${block.checked ? 'x' : ' '}] ${text}`;
    case 'quote': return text.split('\n').map((line) => `> ${line}`).join('\n');
    case 'code': {
      const fence = block.fence === '~~~' ? '~~~' : '```';
      return `${fence}${block.language || ''}\n${text}\n${fence}`;
    }
    case 'divider': return '---';
    default: return text;
  }
}

export function serializeEditorDocument(blocks, { markdown = true } = {}) {
  const safeBlocks = Array.isArray(blocks) && blocks.length > 0 ? blocks : [createEditorBlock()];
  return safeBlocks.map((block) => serializeBlock(block, markdown)).join('\n');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function isTableLine(raw) {
  const line = String(raw ?? '');
  if (/^\s*\|.+\|\s*$/.test(line)) return true;
  return /^\s*\|?(?:\s*:?-{3,}:?\s*\|)+\s*:?-{3,}:?\s*\|?\s*$/.test(line);
}

function isImageLine(raw) {
  return /^\s*!\[[^\]]*\]\([^)\s]+\)\s*$/.test(String(raw ?? ''));
}

/**
 * Structural kind of one hard source line for Classic typography
 * (active source keeps raw Markdown but uses the same visual scale).
 */
export function classicLineKind(line, { markdown = true } = {}) {
  const raw = String(line ?? '');
  if (!markdown) return 'paragraph';
  if (/^\s{0,3}(```|~~~)/.test(raw)) return 'fence';
  if (/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) return 'divider';
  if (isTableLine(raw)) return 'table';
  if (isImageLine(raw)) return 'image';
  const block = parseMarkdownLine(raw);
  return block.type || 'paragraph';
}

/** Walk a full document so fenced interiors stay `code`, not paragraphs. */
export function classicLineKinds(lines, { markdown = true } = {}) {
  const rows = Array.isArray(lines) ? lines : [];
  if (!markdown) return rows.map(() => 'paragraph');
  const kinds = [];
  let fence = null;
  for (const line of rows) {
    const raw = String(line ?? '');
    const marker = raw.match(/^\s{0,3}(```|~~~)/);
    if (fence) {
      const closed = Boolean(marker && marker[1] === fence && /^\s{0,3}(?:```|~~~)\s*$/.test(raw));
      kinds.push(closed ? 'fence' : 'code');
      if (closed) fence = null;
      continue;
    }
    if (marker) {
      kinds.push('fence');
      fence = marker[1];
      continue;
    }
    kinds.push(classicLineKind(raw, { markdown: true }));
  }
  return kinds;
}

function imagePreviewHtml(raw) {
  const match = String(raw ?? '').match(/^\s*!\[([^\]]*)\]\(([^)\s]+)\)\s*$/);
  if (!match) return '';
  return `<img class="classic-line-image" alt="${escapeHtml(match[1])}" data-document-source="${escapeHtml(match[2])}">`;
}

function tablePreviewHtml(raw) {
  const cells = String(raw ?? '').split('|').slice(1, -1).map((cell) => cell.trim());
  if (cells.length === 0) return escapeHtml(raw) || '<br>';
  if (cells.every((cell) => /^:?-{3,}:?$/.test(cell))) {
    return '<span class="classic-line-table-rule" aria-hidden="true"></span>';
  }
  const html = cells
    .map((cell) => `<span class="classic-line-cell">${inlineMarkdownToHtml(cell)}</span>`)
    .join('');
  return `<span class="classic-line-table">${html}</span>`;
}

/**
 * Render one hard source line for Classic live preview (inactive lines).
 * Structural markers are shown as chrome; body text uses inline Markdown.
 */
export function classicLinePreviewHtml(line, { markdown = true, kind } = {}) {
  const raw = String(line ?? '');
  if (!markdown) {
    return raw ? escapeHtml(raw) : '<br>';
  }
  const resolved = kind || classicLineKind(raw, { markdown: true });
  if (resolved === 'fence') {
    return `<code class="classic-line-fence">${escapeHtml(raw)}</code>`;
  }
  if (resolved === 'code') {
    return `<code class="classic-line-code">${escapeHtml(raw) || ' '}</code>`;
  }
  if (resolved === 'divider') {
    return '<hr class="classic-line-hr" aria-hidden="true">';
  }
  if (resolved === 'table') {
    return tablePreviewHtml(raw);
  }
  if (resolved === 'image') {
    return imagePreviewHtml(raw) || inlineMarkdownToHtml(raw);
  }
  const block = parseMarkdownLine(raw);
  // Keep preview chrome lightweight (no nested font-size) so source/preview
  // rows of the same kind share the row's metrics and do not jump on flip.
  const body = inlineMarkdownToHtml(block.text || '');
  if (block.type.startsWith('heading')) {
    return body || '<br>';
  }
  if (block.type === 'bullet') {
    return `<span class="classic-line-bullet" aria-hidden="true">•</span> ${body || ''}`;
  }
  if (block.type === 'numbered') {
    return `<span class="classic-line-number" aria-hidden="true">${block.number}.</span> ${body || ''}`;
  }
  if (block.type === 'todo') {
    const mark = block.checked ? '☑' : '☐';
    return `<span class="classic-line-todo${block.checked ? ' is-checked' : ''}"><span class="classic-line-check" aria-hidden="true">${mark}</span> ${body || ''}</span>`;
  }
  if (block.type === 'quote') {
    return body || '<br>';
  }
  return body || '<br>';
}

export function classicLineSourceHtml(line, { highlight = false } = {}) {
  const raw = String(line ?? '');
  if (!highlight) return raw ? escapeHtml(raw) : '<br>';

  let cursor = 0;
  let html = '';
  for (const range of getMarkdownSourceTokenRanges(raw)) {
    if (range.start > cursor) html += escapeHtml(raw.slice(cursor, range.start));
    html += `<strong class="source-markup-token">${escapeHtml(raw.slice(range.start, range.end))}</strong>`;
    cursor = range.end;
  }
  if (cursor < raw.length) html += escapeHtml(raw.slice(cursor));
  return html || '<br>';
}

export function inlineMarkdownToHtml(value) {
  const placeholders = [];
  const hold = (html) => {
    const token = `\u0000${placeholders.length}\u0000`;
    placeholders.push(html);
    return token;
  };

  let output = escapeHtml(value);
  output = output.replace(/`([^`\n]+)`/g, (_match, text) => hold(`<code>${text}</code>`));
  output = output.replace(/!\[([^\]\n]*)\]\(([^)\s]+)\)/g, (_match, alt, href) => {
    return hold(`<img class="classic-line-image" alt="${alt}" data-document-source="${href}">`);
  });
  output = output.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_match, label, href) => {
    const safeHref = /^(?:https?:|mailto:|#|\.\.?\/)/i.test(href) ? href : '#';
    return hold(`<a href="${escapeHtml(safeHref)}">${label}</a>`);
  });
  output = output.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  output = output.replace(/__([^_\n]+)__/g, '<strong>$1</strong>');
  output = output.replace(/~~([^~\n]+)~~/g, '<s>$1</s>');
  output = output.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  output = output.replace(/(^|[^_])_([^_\n]+)_/g, '$1<em>$2</em>');
  output = output.replace(/\n/g, '<br>');
  output = output.replace(/\u0000(\d+)\u0000/g, (_match, index) => placeholders[Number(index)] || '');
  return output;
}

export function getEditorDocumentStats(source) {
  const plainText = String(source ?? '').replace(/\r\n?/g, '\n');
  const lines = plainText.length === 0 ? 1 : plainText.split('\n').length;
  const words = plainText.match(/\S+/gu)?.length || 0;
  return {
    lines,
    words,
    characters: plainText.length - (plainText.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)?.length || 0),
  };
}

function changedDocumentStats(source, stats, { start, end, text }) {
  // Include the words at both edges, plus CRLF/surrogate pairs crossing an edge.
  let from = Math.max(0, start - 1);
  let to = Math.min(source.length, end + 1);
  while (from > 0 && !/\s/u.test(source[from - 1])) from -= 1;
  while (to < source.length && !/\s/u.test(source[to])) to += 1;
  const before = getEditorDocumentStats(source.slice(from, to));
  const after = getEditorDocumentStats(source.slice(from, start) + text + source.slice(end, to));
  return {
    lines: stats.lines + after.lines - before.lines,
    words: stats.words + after.words - before.words,
    characters: stats.characters + after.characters - before.characters,
  };
}

export function createEditorDocumentModel({
  source: initialSource = '',
  markdown: initialMarkdown = true,
  historyLimit = 150,
} = {}) {
  let markdown = initialMarkdown !== false;
  let currentSource = String(initialSource ?? '');
  let cursor = null;
  let revision = 0;
  let disposed = false;
  const limit = Math.max(2, Math.floor(Number(historyLimit) || 150));
  let history = [currentSource];
  let historyCursors = [null];
  let historyIndex = 0;
  let coalesceOpen = false;
  const subscribers = new Set();
  const trimHistory = () => {
    let characters = history.reduce((total, entry) => total + entry.length, 0);
    while (history.length > 1 && (history.length > limit || characters > 16 * 1024 * 1024)) {
      characters -= history.shift().length;
      historyCursors.shift();
    }
    historyIndex = history.length - 1;
  };

  let projection = null;
  let changedStats = null;
  let currentSnapshot = null;
  const refreshSnapshot = ({ structure = false } = {}) => {
    if (structure || !projection) {
      projection = Object.freeze({
        source: currentSource,
        stats: Object.freeze(changedStats || getEditorDocumentStats(currentSource)),
      });
      changedStats = null;
    }
    currentSnapshot = Object.freeze({
      revision,
      markdown,
      ...projection,
      cursor: cursor ? Object.freeze({ ...cursor }) : null,
      canUndo: historyIndex > 0,
      canRedo: historyIndex < history.length - 1,
    });
    return currentSnapshot;
  };
  refreshSnapshot({ structure: true });
  const source = () => projection.source;
  const snapshot = () => currentSnapshot;
  const publish = (options) => {
    const next = refreshSnapshot(options);
    subscribers.forEach((subscriber) => subscriber(next));
    return next;
  };
  const recordHistory = (current, cursor = null) => {
    if (history[historyIndex] === current) return false;
    history = history.slice(0, historyIndex + 1);
    historyCursors = historyCursors.slice(0, historyIndex + 1);
    history.push(current);
    historyCursors.push(cursor || null);
    trimHistory();
    return true;
  };
  const commit = (mutate, options = {}) => {
    if (disposed) return null;
    const result = mutate();
    if (result === false || result === null) return result;
    const cursor = options.cursor || null;
    if (options.coalesce && coalesceOpen && historyIndex === history.length - 1) {
      history[historyIndex] = currentSource;
      historyCursors[historyIndex] = cursor;
      trimHistory();
    } else {
      if (options.coalesce && options.originCursor) {
        historyCursors[historyIndex] = options.originCursor;
      }
      recordHistory(currentSource, cursor);
      coalesceOpen = Boolean(options.coalesce);
    }
    revision += 1;
    publish({ structure: true });
    return result;
  };
  const restoreHistory = (nextIndex, action) => {
    if (disposed) return { changed: false, action };
    const index = Math.min(Math.max(nextIndex, 0), history.length - 1);
    if (index === historyIndex) return { changed: false, action };
    historyIndex = index;
    coalesceOpen = false;
    currentSource = history[index];
    cursor = historyCursors[index] || cursor;
    revision += 1;
    publish({ structure: true });
    return {
      changed: true,
      action,
      cursor: historyCursors[index] || null,
    };
  };
  const undo = () => restoreHistory(historyIndex - 1, 'undo');
  const redo = () => restoreHistory(historyIndex + 1, 'redo');

  const setCursor = (nextCursor) => {
    const next = nextCursor
      ? { line: Math.max(1, Math.floor(Number(nextCursor.line) || 1)), column: Math.max(1, Math.floor(Number(nextCursor.column) || 1)) }
      : null;
    if (cursor?.line === next?.line && cursor?.column === next?.column) return false;
    cursor = next;
    revision += 1;
    publish();
    return true;
  };

  const load = (nextSource = '', { markdown: nextMarkdown = markdown } = {}) => {
    if (disposed) return snapshot();
    markdown = nextMarkdown !== false;
    currentSource = String(nextSource ?? '');
    cursor = null;
    history = [currentSource];
    historyCursors = [null];
    historyIndex = 0;
    coalesceOpen = false;
    revision += 1;
    return publish({ structure: true });
  };

  /** Replace document from full source text and record history (Classic surface). */
  const applySource = (nextSource = '', options = {}) => commit(() => {
    const next = String(nextSource ?? '');
    if (currentSource === next) return false;
    if (options.change) changedStats = changedDocumentStats(currentSource, projection.stats, options.change);
    currentSource = next;
    return true;
  }, {
    coalesce: Boolean(options.coalesce),
    cursor: options.cursor || null,
    originCursor: options.originCursor || null,
  });

  const subscribe = (subscriber) => {
    if (typeof subscriber !== 'function' || disposed) return () => {};
    subscribers.add(subscriber);
    subscriber(snapshot());
    return () => subscribers.delete(subscriber);
  };

  const dispose = () => {
    disposed = true;
    subscribers.clear();
  };

  return Object.freeze({
    snapshot,
    source,
    subscribe,
    load,
    applySource,
    undo,
    redo,
    setCursor,
    dispose,
  });
}
