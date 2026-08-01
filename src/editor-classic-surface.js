/**
 * Classic continuous live-preview surface (Obsidian-style).
 *
 * Architecture (hard requirement):
 * - Works on **source lines** (`\n`), never on Markdown block islands.
 * - Only the active line (and multi-select expansion) shows raw Markdown.
 * - Every other line is rendered preview.
 * - One contenteditable host on the canvas so selection can span lines.
 */

import { classicLineKind, classicLinePreviewHtml } from './editor-document.js';

function normalizeSource(value) {
  const text = String(value ?? '').replace(/\r\n?/g, '\n');
  return text.length > 0 ? text : '';
}

function splitLines(source) {
  const normalized = normalizeSource(source);
  return normalized.length === 0 ? [''] : normalized.split('\n');
}

function joinLines(lines) {
  return (Array.isArray(lines) && lines.length > 0 ? lines : ['']).join('\n');
}

function caretOffsetIn(element, selection) {
  if (!element || !selection || selection.rangeCount === 0) return 0;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return 0;
  const before = range.cloneRange();
  before.selectNodeContents(element);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length;
}

function placeCaret(element, offset, selection) {
  if (!element || !selection) return;
  const text = element.firstChild?.nodeType === 3
    ? element.firstChild
    : null;
  const range = element.ownerDocument.createRange();
  if (text) {
    const max = text.textContent?.length || 0;
    range.setStart(text, Math.max(0, Math.min(offset, max)));
    range.collapse(true);
  } else {
    range.selectNodeContents(element);
    range.collapse(offset <= 0);
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

export function createEditorClassicSurface({
  window,
  canvas,
  adapters = {},
  hooks = {},
}) {
  if (!window || !canvas) {
    throw new TypeError('Classic surface requires window and canvas');
  }

  const document = canvas.ownerDocument;
  let activeLine = 0;
  let selectionLines = new Set();
  let disposed = false;
  let mounted = false;
  let suppressSelection = 0;

  const isMarkdown = () => adapters.isMarkdown?.() !== false;
  const readSource = () => normalizeSource(adapters.getSource?.() || '');

  const withSelectionSuppressed = (fn) => {
    suppressSelection += 1;
    try {
      return fn();
    } finally {
      suppressSelection -= 1;
    }
  };

  const commitLines = (lines, { history = true } = {}) => {
    const next = joinLines(lines);
    if (history && typeof adapters.applySource === 'function') {
      adapters.applySource(next);
    } else if (typeof adapters.applySource === 'function') {
      // applySource always records history today; still the public path.
      adapters.applySource(next);
    }
    hooks.onChange?.();
    return next;
  };

  const lineElements = () => [...canvas.querySelectorAll('[data-classic-line]')];

  const readLinesFromDom = () => {
    const rows = lineElements();
    if (rows.length === 0) return splitLines(readSource());
    return rows.map((row) => {
      const content = row.querySelector('[data-classic-content]');
      if (content?.dataset.editorMode === 'source') {
        return String(content.innerText ?? content.textContent ?? '')
          .replace(/\r\n?/g, '\n')
          .replace(/\u00a0/g, ' ')
          .replace(/\u200b/g, '')
          .replace(/\n+$/g, '');
      }
      return row.dataset.sourceText ?? '';
    });
  };

  const renderLineRow = (line, index, { source, active }) => {
    const markdown = isMarkdown();
    const kind = classicLineKind(line, { markdown });
    const row = document.createElement('div');
    row.className = `classic-line classic-line--${kind}`;
    row.dataset.classicLine = String(index);
    row.dataset.sourceText = line;
    row.dataset.lineKind = kind;
    if (active) row.classList.add('is-active-line');
    if (source && !active) row.classList.add('is-selection-source');

    const content = document.createElement('div');
    content.className = [
      'classic-line-content',
      `classic-line-content--${kind}`,
      active ? 'is-active-line' : '',
      source && !active ? 'is-selection-source' : '',
      source ? 'classic-line-source' : 'classic-line-preview',
    ].filter(Boolean).join(' ');
    content.dataset.classicContent = '';
    content.dataset.editorMode = source ? 'source' : 'preview';
    content.dataset.lineKind = kind;

    if (source) {
      // Raw Markdown stays editable; typography follows the line kind (h1, list…).
      content.removeAttribute('contenteditable');
      content.textContent = line;
    } else {
      content.contentEditable = 'false';
      content.innerHTML = classicLinePreviewHtml(line, { markdown });
    }

    row.append(content);
    return row;
  };

  const render = ({
    source = readSource(),
    focusLine = activeLine,
    caret = null,
  } = {}) => {
    if (disposed || !mounted) return;
    const lines = splitLines(source);
    activeLine = Math.max(0, Math.min(focusLine, lines.length - 1));
    const fragment = document.createDocumentFragment();
    lines.forEach((line, index) => {
      const sourceMode = index === activeLine || selectionLines.has(index);
      fragment.append(renderLineRow(line, index, {
        source: sourceMode,
        active: index === activeLine,
      }));
    });
    withSelectionSuppressed(() => {
      canvas.replaceChildren(fragment);
      canvas.contentEditable = 'true';
      canvas.setAttribute('role', 'textbox');
      canvas.setAttribute('aria-multiline', 'true');
      canvas.setAttribute('aria-label', 'Document editor');
      canvas.classList.add('is-classic-surface');
      if (caret != null) {
        const row = canvas.querySelector(`[data-classic-line="${activeLine}"] [data-classic-content]`);
        if (row) {
          canvas.focus({ preventScroll: true });
          placeCaret(row, caret, window.getSelection());
        }
      }
    });
    const col = Math.max(1, (caret ?? 0) + 1);
    adapters.setCursor?.({ line: activeLine + 1, column: col });
  };

  const activateLine = (index, { caret = null, clearSelection = true } = {}) => {
    if (disposed || !mounted) return;
    const lines = splitLines(readSource());
    const next = Math.max(0, Math.min(index, lines.length - 1));
    if (clearSelection) selectionLines = new Set();
    // Commit any in-progress source edits before flipping projection.
    const domLines = readLinesFromDom();
    if (joinLines(domLines) !== joinLines(lines)) {
      commitLines(domLines);
    }
    activeLine = next;
    render({
      source: readSource(),
      focusLine: activeLine,
      caret: caret == null ? (lines[activeLine]?.length || 0) : caret,
    });
  };

  const handleClick = (event) => {
    if (disposed || !mounted) return false;
    const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
    if (!target) return false;
    if (target.closest?.('[data-todo-check]')) return false;
    const row = target.closest?.('[data-classic-line]');
    if (!row || !canvas.contains(row)) return false;
    const index = Number(row.dataset.classicLine);
    if (!Number.isFinite(index)) return false;
    if (index === activeLine && row.querySelector('[data-editor-mode="source"]')) {
      return true; // let browser place caret inside active source
    }
    event.preventDefault();
    activateLine(index, { caret: null, clearSelection: true });
    return true;
  };

  const handleInput = () => {
    if (disposed || !mounted) return false;
    const lines = readLinesFromDom();
    commitLines(lines);
    // Keep projection: active line stays source; do not full-render unless line count changed.
    const rows = lineElements();
    if (rows.length !== lines.length) {
      render({ source: joinLines(lines), focusLine: activeLine, caret: null });
      const content = canvas.querySelector(`[data-classic-line="${activeLine}"] [data-classic-content]`);
      if (content) {
        const selection = window.getSelection();
        placeCaret(content, content.textContent?.length || 0, selection);
      }
    } else {
      rows.forEach((row, index) => {
        row.dataset.sourceText = lines[index] ?? '';
      });
      const content = canvas.querySelector(`[data-classic-line="${activeLine}"] [data-classic-content]`);
      const selection = window.getSelection();
      const col = caretOffsetIn(content, selection) + 1;
      adapters.setCursor?.({ line: activeLine + 1, column: Math.max(1, col) });
      hooks.onChange?.();
    }
    return true;
  };

  const handleKeydown = (event) => {
    if (disposed || !mounted) return false;
    const selection = window.getSelection();
    const content = canvas.querySelector(`[data-classic-line="${activeLine}"] [data-classic-content]`);
    if (!content || content.dataset.editorMode !== 'source') return false;

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const lines = readLinesFromDom();
      const offset = caretOffsetIn(content, selection);
      const current = lines[activeLine] ?? '';
      const before = current.slice(0, offset);
      const after = current.slice(offset);
      lines[activeLine] = before;
      lines.splice(activeLine + 1, 0, after);
      commitLines(lines);
      activeLine += 1;
      selectionLines = new Set();
      render({ source: joinLines(lines), focusLine: activeLine, caret: 0 });
      return true;
    }

    if (event.key === 'Backspace') {
      const offset = caretOffsetIn(content, selection);
      if (offset === 0 && activeLine > 0 && selection?.isCollapsed) {
        event.preventDefault();
        const lines = readLinesFromDom();
        const prev = lines[activeLine - 1] ?? '';
        const current = lines[activeLine] ?? '';
        const caret = prev.length;
        lines[activeLine - 1] = `${prev}${current}`;
        lines.splice(activeLine, 1);
        commitLines(lines);
        activeLine -= 1;
        selectionLines = new Set();
        render({ source: joinLines(lines), focusLine: activeLine, caret });
        return true;
      }
    }

    if (event.key === 'ArrowUp' && selection?.isCollapsed) {
      const offset = caretOffsetIn(content, selection);
      if (offset === 0 && activeLine > 0) {
        event.preventDefault();
        const lines = readLinesFromDom();
        commitLines(lines);
        activateLine(activeLine - 1, {
          caret: (splitLines(readSource())[activeLine - 1] || '').length,
          clearSelection: true,
        });
        return true;
      }
    }

    if (event.key === 'ArrowDown' && selection?.isCollapsed) {
      const offset = caretOffsetIn(content, selection);
      const length = content.textContent?.length || 0;
      if (offset >= length) {
        const lines = splitLines(readSource());
        if (activeLine < lines.length - 1) {
          event.preventDefault();
          commitLines(readLinesFromDom());
          activateLine(activeLine + 1, { caret: 0, clearSelection: true });
          return true;
        }
      }
    }

    return false;
  };

  const handleSelectionChange = () => {
    if (disposed || !mounted || suppressSelection) return false;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return false;
    if (!canvas.contains(selection.anchorNode) && !canvas.contains(selection.focusNode)) {
      return false;
    }

    if (!selection.isCollapsed) {
      // Critical: do NOT re-render or flip preview→source while the user is
      // dragging a multi-line selection. Full replaceChildren + mode flips
      // change line heights mid-gesture and cause jumpy selection.
      // Parent contenteditable can already select across preview rows.
      const focusRow = selection.focusNode?.nodeType === 1
        ? selection.focusNode.closest?.('[data-classic-line]')
        : selection.focusNode?.parentElement?.closest?.('[data-classic-line]');
      if (focusRow) {
        const b = Number(focusRow.dataset.classicLine);
        if (Number.isFinite(b)) activeLine = b;
      }
      // Soft highlight only (no content re-projection).
      const anchorRow = selection.anchorNode?.nodeType === 1
        ? selection.anchorNode.closest?.('[data-classic-line]')
        : selection.anchorNode?.parentElement?.closest?.('[data-classic-line]');
      if (anchorRow && focusRow) {
        const a = Number(anchorRow.dataset.classicLine);
        const b = Number(focusRow.dataset.classicLine);
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        lineElements().forEach((row) => {
          const i = Number(row.dataset.classicLine);
          row.classList.toggle('is-in-selection', Number.isFinite(i) && i >= lo && i <= hi);
        });
      }
      return true;
    }

    // Collapsed caret: clear drag highlights; follow active line.
    lineElements().forEach((row) => row.classList.remove('is-in-selection'));
    if (selectionLines.size > 0) {
      selectionLines = new Set();
    }
    const node = selection.getRangeAt(0).startContainer;
    const row = node?.nodeType === 1
      ? node.closest?.('[data-classic-line]')
      : node?.parentElement?.closest?.('[data-classic-line]');
    if (!row) return false;
    const index = Number(row.dataset.classicLine);
    if (!Number.isFinite(index)) return false;
    if (index === activeLine && row.querySelector('[data-editor-mode="source"]')) {
      const content = row.querySelector('[data-classic-content]');
      const col = caretOffsetIn(content, selection) + 1;
      adapters.setCursor?.({ line: activeLine + 1, column: Math.max(1, col) });
      return true;
    }
    const content = row.querySelector('[data-classic-content]');
    const caret = content?.dataset.editorMode === 'source'
      ? caretOffsetIn(content, selection)
      : null;
    activateLine(index, { caret, clearSelection: true });
    return true;
  };

  const mount = () => {
    if (disposed) return;
    mounted = true;
    selectionLines = new Set();
    activeLine = 0;
    render({ source: readSource(), focusLine: 0, caret: 0 });
  };

  const unmount = () => {
    mounted = false;
    selectionLines = new Set();
    canvas.classList.remove('is-classic-surface');
    // Leave canvas cleanup to the session renderer.
  };

  const dispose = () => {
    disposed = true;
    mounted = false;
    selectionLines = new Set();
  };

  return Object.freeze({
    mount,
    unmount,
    dispose,
    render,
    activateLine,
    handleClick,
    handleInput,
    handleKeydown,
    handleSelectionChange,
    isMounted: () => mounted,
    activeLine: () => activeLine,
    commitFromDom: () => {
      const lines = readLinesFromDom();
      commitLines(lines);
      return joinLines(lines);
    },
  });
}
