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

export const EDITOR_COMMANDS = Object.freeze([
  { id: 'paragraph', label: 'Text', hint: 'Plain text', icon: 'iconoir-text' },
  { id: 'heading1', label: 'Heading 1', hint: 'Large section title', icon: 'iconoir-text-size' },
  { id: 'heading2', label: 'Heading 2', hint: 'Medium section title', icon: 'iconoir-text-size' },
  { id: 'heading3', label: 'Heading 3', hint: 'Small section title', icon: 'iconoir-text-size' },
  { id: 'bullet', label: 'Bulleted list', hint: 'Simple unordered list', icon: 'iconoir-list' },
  { id: 'numbered', label: 'Numbered list', hint: 'Ordered steps', icon: 'iconoir-numbered-list-left' },
  { id: 'todo', label: 'To-do', hint: 'Task with a checkbox', icon: 'iconoir-check-square' },
  { id: 'quote', label: 'Quote', hint: 'Highlight a quote', icon: 'iconoir-quote' },
  { id: 'code', label: 'Code', hint: 'Fenced code block', icon: 'iconoir-code' },
  { id: 'divider', label: 'Divider', hint: 'Separate sections', icon: 'iconoir-minus' },
]);

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

function parseMarkdownLine(line) {
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

export function inlineMarkdownToHtml(value) {
  const placeholders = [];
  const hold = (html) => {
    const token = `\u0000${placeholders.length}\u0000`;
    placeholders.push(html);
    return token;
  };

  let output = escapeHtml(value);
  output = output.replace(/`([^`\n]+)`/g, (_match, text) => hold(`<code>${text}</code>`));
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

function markdownFromNode(node) {
  if (!node) return '';
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node.nodeType !== 1) return '';

  const tag = node.tagName.toLowerCase();
  const content = [...node.childNodes].map(markdownFromNode).join('');
  if (tag === 'br') return '\n';
  if (tag === 'strong' || tag === 'b') return content ? `**${content}**` : '';
  if (tag === 'em' || tag === 'i') return content ? `*${content}*` : '';
  if (tag === 's' || tag === 'strike' || tag === 'del') return content ? `~~${content}~~` : '';
  if (tag === 'code') return content ? `\`${content.replace(/`/g, '\\`')}\`` : '';
  if (tag === 'a') {
    const href = node.getAttribute('href') || '';
    return content && href ? `[${content}](${href})` : content;
  }
  if (tag === 'div' || tag === 'p') return `${content}\n`;
  return content;
}

export function editableHtmlToMarkdown(element) {
  return [...(element?.childNodes || [])]
    .map(markdownFromNode)
    .join('')
    .replace(/\u00a0/g, ' ')
    .replace(/\u200b/g, '')
    .replace(/\n+$/g, '');
}

export function getEditorDocumentStats(blocks) {
  const plainText = (Array.isArray(blocks) ? blocks : [])
    .filter((block) => block.type !== 'divider')
    .map((block) => block.text)
    .join('\n');
  const words = plainText.trim() ? plainText.trim().split(/\s+/u).length : 0;
  return {
    blocks: Array.isArray(blocks) ? blocks.length : 0,
    words,
    characters: [...plainText].length,
  };
}

export function createEditorDocumentModel({
  source: initialSource = '',
  markdown: initialMarkdown = true,
  historyLimit = 150,
} = {}) {
  let markdown = initialMarkdown !== false;
  let blocks = parseEditorDocument(initialSource, { markdown });
  let cursor = null;
  let revision = 0;
  let disposed = false;
  const limit = Math.max(2, Math.floor(Number(historyLimit) || 150));
  let history = [serializeEditorDocument(blocks, { markdown })];
  let historyIndex = 0;
  const subscribers = new Set();

  const serializeCurrent = () => serializeEditorDocument(blocks, { markdown });
  const publicBlock = (block) => Object.freeze({ ...block });
  let projection = null;
  let currentSnapshot = null;
  const refreshSnapshot = ({ structure = false } = {}) => {
    if (structure || !projection) {
      projection = Object.freeze({
        source: serializeCurrent(),
        blocks: Object.freeze(blocks.map(publicBlock)),
        stats: Object.freeze(getEditorDocumentStats(blocks)),
      });
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
  const recordHistory = () => {
    const current = serializeCurrent();
    if (history[historyIndex] === current) return false;
    history = history.slice(0, historyIndex + 1);
    history.push(current);
    if (history.length > limit) history.shift();
    historyIndex = history.length - 1;
    return true;
  };
  const commit = (mutate) => {
    if (disposed) return null;
    const result = mutate();
    if (result === false || result === null) return result;
    if (blocks.length === 0) blocks = [createEditorBlock()];
    recordHistory();
    revision += 1;
    publish({ structure: true });
    return result;
  };
  const findIndex = (id) => blocks.findIndex((block) => block.id === id);
  const block = (id) => {
    const found = blocks[findIndex(id)];
    return found ? publicBlock(found) : null;
  };
  const normalizedBlock = (current, patch) => createEditorBlock(
    patch.type ?? current.type,
    patch.text ?? current.text,
    {
      id: current.id,
      checked: patch.checked ?? current.checked,
      indent: patch.indent ?? current.indent,
      number: patch.number ?? current.number,
      language: patch.language ?? current.language,
      fence: patch.fence ?? current.fence,
    },
  );

  const updateBlock = (id, patch = {}) => commit(() => {
    const index = findIndex(id);
    if (index < 0) return null;
    blocks[index] = normalizedBlock(blocks[index], patch);
    return publicBlock(blocks[index]);
  });

  const changeType = (id, type) => commit(() => {
    const index = findIndex(id);
    if (index < 0) return null;
    const current = blocks[index];
    const text = current.text.replace(/^\/[^\s]*\s?/, '');
    blocks[index] = normalizedBlock(current, {
      type,
      text: type === 'divider' ? '' : text,
      checked: type === 'todo' ? current.checked : false,
    });
    return publicBlock(blocks[index]);
  });

  const addAfter = (afterId, { type = 'paragraph', text = '', ...options } = {}) => commit(() => {
    const index = Math.max(0, findIndex(afterId));
    const next = createEditorBlock(type, text, options);
    blocks.splice(index + 1, 0, next);
    return publicBlock(next);
  });

  const remove = (id) => commit(() => {
    const index = findIndex(id);
    if (index < 0) return null;
    if (blocks.length === 1) {
      const replacement = createEditorBlock();
      blocks = [replacement];
      return { changed: true, focusId: replacement.id, enteringId: replacement.id, index: 0 };
    }
    blocks.splice(index, 1);
    return {
      changed: true,
      focusId: blocks[Math.max(0, index - 1)].id,
      enteringId: null,
      index,
    };
  });

  const moveTo = (id, destination) => commit(() => {
    const sourceIndex = findIndex(id);
    const target = Math.min(Math.max(Math.floor(Number(destination)), 0), blocks.length - 1);
    if (sourceIndex < 0 || sourceIndex === target) return false;
    const [moving] = blocks.splice(sourceIndex, 1);
    blocks.splice(target, 0, moving);
    return { changed: true, id, sourceIndex, destination: target };
  });
  const moveRelative = (id, targetId, position = 'before') => commit(() => {
    const isSpacer = (blockValue) => blockValue?.type === 'paragraph' && blockValue.text === '';
    const visibleSlots = blocks
      .map((blockValue, index) => (isSpacer(blockValue) ? -1 : index))
      .filter((index) => index >= 0);
    const visibleBlocks = visibleSlots.map((index) => blocks[index]);
    const sourceIndex = visibleBlocks.findIndex((blockValue) => blockValue.id === id);
    const targetIndex = visibleBlocks.findIndex((blockValue) => blockValue.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return false;

    let destination = targetIndex + (position === 'after' ? 1 : 0);
    if (sourceIndex < destination) destination -= 1;
    if (destination === sourceIndex) return false;

    const [moving] = visibleBlocks.splice(sourceIndex, 1);
    visibleBlocks.splice(destination, 0, moving);
    visibleSlots.forEach((slot, index) => {
      blocks[slot] = visibleBlocks[index];
    });
    return {
      changed: true,
      id,
      sourceIndex,
      destination,
    };
  });
  const move = (id, delta) => {
    const index = findIndex(id);
    const destination = index + Math.trunc(Number(delta) || 0);
    if (index < 0 || destination < 0 || destination >= blocks.length) return false;
    return moveTo(id, destination);
  };

  const duplicate = (id) => commit(() => {
    const index = findIndex(id);
    if (index < 0) return null;
    const current = blocks[index];
    const copy = createEditorBlock(current.type, current.text, {
      checked: current.checked,
      indent: current.indent,
      number: current.number,
      language: current.language,
      fence: current.fence,
    });
    blocks.splice(index + 1, 0, copy);
    return publicBlock(copy);
  });

  const split = (id, { before = '', after = '' } = {}) => commit(() => {
    const index = findIndex(id);
    if (index < 0 || blocks[index].type === 'code') return false;
    const current = blocks[index];
    blocks[index] = normalizedBlock(current, { text: before });
    const nextType = current.type.startsWith('heading') || current.type === 'quote'
      ? 'paragraph'
      : current.type;
    const next = createEditorBlock(nextType, after, {
      indent: current.indent,
      number: current.type === 'numbered' ? current.number + 1 : 1,
    });
    blocks.splice(index + 1, 0, next);
    return publicBlock(next);
  });

  const mergeWithPrevious = (id) => commit(() => {
    const index = findIndex(id);
    if (index <= 0) return false;
    const current = blocks[index];
    const previous = blocks[index - 1];
    if (current.type === 'divider' || previous.type === 'divider' || previous.type === 'code') return false;
    const offset = previous.text.length;
    blocks[index - 1] = normalizedBlock(previous, { text: `${previous.text}${current.text}` });
    blocks.splice(index, 1);
    return { changed: true, focusId: previous.id, offset };
  });

  const indent = (id, delta) => {
    const current = blocks[findIndex(id)];
    if (!current || !['bullet', 'numbered', 'todo'].includes(current.type)) return false;
    return updateBlock(id, {
      indent: Math.min(Math.max(current.indent + Math.trunc(Number(delta) || 0), 0), 6),
    });
  };

  const restoreHistory = (nextIndex, action, activeId = null) => {
    if (disposed) return { changed: false, action };
    const index = Math.min(Math.max(nextIndex, 0), history.length - 1);
    if (index === historyIndex) return { changed: false, action };
    const activeIndex = Math.max(0, findIndex(activeId));
    historyIndex = index;
    blocks = parseEditorDocument(history[index], { markdown });
    revision += 1;
    publish({ structure: true });
    return {
      changed: true,
      action,
      focusId: blocks[Math.min(activeIndex, blocks.length - 1)].id,
    };
  };
  const undo = (activeId = null) => restoreHistory(historyIndex - 1, 'undo', activeId);
  const redo = (activeId = null) => restoreHistory(historyIndex + 1, 'redo', activeId);

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
    blocks = parseEditorDocument(nextSource, { markdown });
    cursor = null;
    history = [serializeCurrent()];
    historyIndex = 0;
    revision += 1;
    return publish({ structure: true });
  };

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
    block,
    subscribe,
    load,
    updateBlock,
    changeType,
    addAfter,
    remove,
    move,
    moveTo,
    moveRelative,
    duplicate,
    split,
    mergeWithPrevious,
    indent,
    undo,
    redo,
    setCursor,
    dispose,
  });
}

export function editorBlockLabel(type) {
  return EDITOR_COMMANDS.find((command) => command.id === type)?.label
    || (type.startsWith('heading') ? `Heading ${type.slice(-1)}` : 'Text');
}
