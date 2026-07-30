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

export function editorBlockLabel(type) {
  return EDITOR_COMMANDS.find((command) => command.id === type)?.label
    || (type.startsWith('heading') ? `Heading ${type.slice(-1)}` : 'Text');
}
