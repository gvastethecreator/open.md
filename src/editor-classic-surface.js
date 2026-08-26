/**
 * Classic continuous live-preview surface (Obsidian-style).
 *
 * Architecture (hard requirement):
 * - Works on **source lines** (`\n`), never on Markdown block islands.
 * - Only the active line (and multi-select expansion) shows raw Markdown.
 * - Every other line is rendered preview.
 * - One contenteditable host on the canvas so selection can span lines.
 */

import {
  classicLineKind,
  classicLinePreviewHtml,
  classicLineSourceHtml,
} from './editor-document.js';
import { MOTION_EASE_OUT } from './reader-motion.js';

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

function boundaryOffsetIn(element, container, offset) {
  if (!element || !container || !element.contains(container)) return 0;
  const range = element.ownerDocument.createRange();
  range.selectNodeContents(element);
  range.setEnd(container, offset);
  return range.toString().length;
}

function placeCaret(element, offset, selection) {
  if (!element || !selection) return;
  const doc = element.ownerDocument;
  const range = doc.createRange();
  // Empty source lines need a text node so the caret can sit inside the host.
  if (!element.firstChild) {
    element.appendChild(doc.createTextNode(''));
  }
  let remaining = Math.max(0, Math.floor(Number(offset) || 0));
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let placed = false;
  while (node) {
    const len = node.nodeValue?.length || 0;
    if (remaining <= len) {
      range.setStart(node, remaining);
      range.collapse(true);
      placed = true;
      break;
    }
    remaining -= len;
    node = walker.nextNode();
  }
  if (!placed) {
    const last = element.lastChild;
    if (last?.nodeType === 3) {
      range.setStart(last, last.nodeValue?.length || 0);
      range.collapse(true);
    } else {
      range.selectNodeContents(element);
      range.collapse(false);
    }
  }
  selection.removeAllRanges();
  selection.addRange(range);
}

function isComposingEvent(event) {
  return Boolean(event?.isComposing || event?.key === 'Process');
}

function caretOffsetFromPointer(element, event) {
  if (!element || !event) return null;
  const doc = element.ownerDocument;
  try {
    if (typeof doc.caretPositionFromPoint === 'function' && Number.isFinite(event.clientX)) {
      const pos = doc.caretPositionFromPoint(event.clientX, event.clientY);
      if (pos?.offsetNode && element.contains(pos.offsetNode)) {
        return boundaryOffsetIn(element, pos.offsetNode, pos.offset);
      }
    }
    if (typeof doc.caretRangeFromPoint === 'function' && Number.isFinite(event.clientX)) {
      const range = doc.caretRangeFromPoint(event.clientX, event.clientY);
      if (range?.startContainer && element.contains(range.startContainer)) {
        return boundaryOffsetIn(element, range.startContainer, range.startOffset);
      }
    }
  } catch {
    /* jsdom / missing layout */
  }
  return null;
}

function rangeAtOffset(element, offset) {
  const doc = element.ownerDocument;
  const range = doc.createRange();
  if (!element.firstChild) element.appendChild(doc.createTextNode(''));
  let remaining = Math.max(0, Math.floor(Number(offset) || 0));
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const len = node.nodeValue?.length || 0;
    if (remaining <= len) {
      range.setStart(node, remaining);
      range.collapse(true);
      return range;
    }
    remaining -= len;
    node = walker.nextNode();
  }
  range.selectNodeContents(element);
  range.collapse(false);
  return range;
}

function collapsedRectAt(element, offset) {
  const range = rangeAtOffset(element, offset);
  const rects = typeof range.getClientRects === 'function' ? range.getClientRects() : null;
  if (rects && rects.length > 0) return rects[0];
  return typeof range.getBoundingClientRect === 'function' ? range.getBoundingClientRect() : null;
}

function visualLineStarts(element) {
  const length = element?.textContent?.length || 0;
  const starts = [0];
  let lastTop = null;
  for (let offset = 0; offset <= length; offset += 1) {
    const rect = collapsedRectAt(element, offset);
    if (!rect || !Number.isFinite(rect.top)) continue;
    if (rect.height <= 0 && rect.width <= 0) continue;
    if (lastTop == null) {
      lastTop = rect.top;
      continue;
    }
    if (Math.abs(rect.top - lastTop) > 2) {
      starts.push(offset);
      lastTop = rect.top;
    }
  }
  return starts;
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
  let preferredColumn = 0;
  /** True after a vertical nav until a horizontal/edit action resets sticky capture. */
  let stickyVerticalNav = false;
  let selectionLines = new Set();
  let disposed = false;
  let mounted = false;
  let suppressSelection = 0;
  let suppressNextInsertParagraph = false;
  let bandRaf = null;
  let bandAnimation = null;
  let listenersBound = false;
  let composing = false;
  let lastCaret = 0;

  const isMarkdown = () => adapters.isMarkdown?.() !== false;
  const highlightSource = () => Boolean(adapters.highlightSource?.());
  const readSource = () => normalizeSource(adapters.getSource?.() || '');
  const reduceMotion = () => Boolean(adapters.shouldReduceMotion?.());

  const cancelBandAnimation = () => {
    if (bandAnimation) {
      try {
        bandAnimation.cancel();
      } catch {
        /* ignore */
      }
      bandAnimation = null;
    }
  };

  const withSelectionSuppressed = (fn) => {
    suppressSelection += 1;
    try {
      return fn();
    } finally {
      suppressSelection -= 1;
    }
  };

  const commitLines = (lines, { coalesce = false, originCaret = lastCaret } = {}) => {
    const next = joinLines(lines);
    if (typeof adapters.applySource === 'function') {
      adapters.applySource(next, {
        coalesce,
        cursor: { line: activeLine + 1, column: Math.max(1, lastCaret + 1) },
        originCursor: { line: activeLine + 1, column: Math.max(1, originCaret + 1) },
      });
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
        return String(content.textContent ?? '')
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
      if (highlightSource()) content.innerHTML = classicLineSourceHtml(line, { highlight: true });
      else content.textContent = line;
    } else if (highlightSource()) {
      content.contentEditable = 'false';
      content.innerHTML = classicLineSourceHtml(line, { highlight: true });
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
      canvas.setAttribute('aria-label', adapters.getAriaLabel?.() || 'Document editor');
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
    preferredColumn = caret == null ? preferredColumn : caret;
    if (caret != null) lastCaret = caret;
    scheduleActiveLineBand();
  };

  const replaceLineRow = (index, line, { source, active, caret = null } = {}) => {
    const next = renderLineRow(line, index, { source, active });
    const current = canvas.querySelector(`[data-classic-line="${index}"]`);
    if (current) current.replaceWith(next);
    else canvas.append(next);
    if (active && caret != null) {
      const content = next.querySelector('[data-classic-content]');
      try {
        canvas.focus({ preventScroll: true });
      } catch {
        canvas.focus?.();
      }
      if (content) placeCaret(content, caret, window.getSelection());
    }
    return next;
  };

  const flipActiveLine = (nextIndex, caret) => {
    const lines = splitLines(readSource());
    const previous = activeLine;
    activeLine = Math.max(0, Math.min(nextIndex, lines.length - 1));
    if (previous !== activeLine) {
      replaceLineRow(previous, lines[previous] ?? '', {
        source: selectionLines.has(previous),
        active: false,
      });
    }
    replaceLineRow(activeLine, lines[activeLine] ?? '', {
      source: true,
      active: true,
      caret,
    });
    lastCaret = caret ?? lastCaret;
    preferredColumn = caret ?? preferredColumn;
    adapters.setCursor?.({
      line: activeLine + 1,
      column: Math.max(1, (caret ?? lastCaret) + 1),
    });
    scheduleActiveLineBand();
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
    const liveLines = splitLines(readSource());
    const nextCaret = caret == null
      ? 0
      : Math.max(0, Math.min(caret, (liveLines[next] || '').length));
    preferredColumn = nextCaret;
    lastCaret = nextCaret;
    stickyVerticalNav = false;
    if (lineElements().length === liveLines.length) {
      flipActiveLine(next, nextCaret);
      return;
    }
    activeLine = next;
    render({
      source: readSource(),
      focusLine: activeLine,
      caret: nextCaret,
    });
  };

  const handleClick = (event) => {
    if (disposed || !mounted || isComposingEvent(event)) return false;
    const target = event.target?.nodeType === 1 ? event.target : event.target?.parentElement;
    if (!target) return false;
    if (target.closest?.('[data-todo-check]')) return false;
    const row = target.closest?.('[data-classic-line]');
    if (!row || !canvas.contains(row)) return false;
    const index = Number(row.dataset.classicLine);
    if (!Number.isFinite(index)) return false;
    // Any pointer placement ends a sticky vertical sequence.
    stickyVerticalNav = false;
    const content = row.querySelector('[data-classic-content]');
    if (index === activeLine && content?.dataset.editorMode === 'source') {
      return true; // let browser place caret inside active source
    }
    event.preventDefault();
    const selection = window.getSelection();
    let caret = caretOffsetFromPointer(content, event);
    if (caret == null && content) caret = caretOffsetIn(content, selection);
    if (caret == null) caret = 0;
    activateLine(index, { caret, clearSelection: true });
    return true;
  };

  const handleInput = (event) => {
    if (disposed || !mounted) return false;
    if (isComposingEvent(event) || composing) return true;
    stickyVerticalNav = false;
    const activeContent = canvas.querySelector(
      `[data-classic-line="${activeLine}"] [data-classic-content]`,
    );
    const hostBefore = activeContent;
    const selection = window.getSelection();
    const originCaret = lastCaret;
    const caret = caretOffsetIn(activeContent, selection);
    lastCaret = caret;
    preferredColumn = caret;
    const lines = readLinesFromDom();
    commitLines(lines, { coalesce: true, originCaret });
    const rows = lineElements();
    if (rows.length !== lines.length) {
      render({ source: joinLines(lines), focusLine: activeLine, caret });
    } else {
      rows.forEach((row, index) => {
        row.dataset.sourceText = lines[index] ?? '';
      });
      const content = canvas.querySelector(`[data-classic-line="${activeLine}"] [data-classic-content]`);
      if (content !== hostBefore) return true;
      adapters.setCursor?.({ line: activeLine + 1, column: Math.max(1, caret + 1) });
    }
    return true;
  };

  const restyleActiveSource = () => {
    if (!highlightSource()) return;
    const content = canvas.querySelector(
      `[data-classic-line="${activeLine}"] [data-classic-content]`,
    );
    if (!content || content.dataset.editorMode !== 'source') return;
    const selection = window.getSelection();
    const caret = caretOffsetIn(content, selection);
    const line = readLinesFromDom()[activeLine] ?? '';
    withSelectionSuppressed(() => {
      content.innerHTML = classicLineSourceHtml(line, { highlight: true });
      placeCaret(content, caret, selection);
    });
  };

  const handleCompositionStart = () => {
    composing = true;
  };

  const handleCompositionEnd = (event) => {
    composing = false;
    const result = handleInput(event);
    restyleActiveSource();
    return result;
  };

  /**
   * Keep the active hard line inside the document scrollport (.reader-page).
   * Call only after keyboard navigation — never from mount/render (mode morph
   * must preserve scroll). Matches Block focusBlock scrollIntoView nearest.
   */
  const ensureActiveLineVisible = () => {
    if (disposed || !mounted) return;
    const row = canvas.querySelector(`[data-classic-line="${activeLine}"]`);
    if (!row) return;
    const target = row.querySelector('[data-classic-content]') || row;
    try {
      target.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    } catch {
      /* jsdom / inert hosts */
    }
    scheduleActiveLineBand();
  };

  /** PageUp/Down step from the real scroll viewport, not canvas document height. */
  const pageLineStep = () => {
    const scroller = canvas.closest?.('.reader-page') || canvas;
    const row = canvas.querySelector(`[data-classic-line="${activeLine}"]`);
    let lineH = 28;
    if (row && typeof row.getBoundingClientRect === 'function') {
      const height = row.getBoundingClientRect().height;
      if (Number.isFinite(height) && height > 0) lineH = Math.max(18, height);
    }
    return Math.max(1, Math.floor((scroller.clientHeight || 240) / lineH));
  };

  /**
   * Move the active hard line. When `retainPreferred` is true, the caret is
   * clamped to the target line length but preferredColumn is kept unclamped so
   * later longer lines restore the original column (editor-standard sticky col).
   */
  const goToLine = (index, caret, { retainPreferred = false } = {}) => {
    const lines = readLinesFromDom();
    commitLines(lines);
    const nextLines = splitLines(readSource());
    const next = Math.max(0, Math.min(index, nextLines.length - 1));
    const length = (nextLines[next] || '').length;
    const desired = Number.isFinite(caret) ? caret : preferredColumn;
    const savedPreferred = retainPreferred ? desired : null;
    const offset = Math.max(0, Math.min(desired, length));
    if (!retainPreferred) preferredColumn = offset;
    lastCaret = offset;
    selectionLines = new Set();
    if (lineElements().length === nextLines.length) {
      flipActiveLine(next, offset);
    } else {
      activeLine = next;
      render({ source: joinLines(nextLines), focusLine: next, caret: offset });
      try {
        canvas.focus({ preventScroll: true });
      } catch {
        canvas.focus?.();
      }
    }
    // render() overwrites preferredColumn from the clamped caret; focus may
    // fire selectionchange. Restore sticky column after both.
    if (retainPreferred && savedPreferred != null) {
      preferredColumn = savedPreferred;
    }
    ensureActiveLineVisible();
  };

  const ensureActiveSourceContent = () => {
    let content = canvas.querySelector(
      `[data-classic-line="${activeLine}"] [data-classic-content]`,
    );
    if (content?.dataset.editorMode === 'source') return content;
    // Recover when active line drifted out of source mode (stale projection).
    const lines = splitLines(readSource());
    if (lines.length === 0) return null;
    activeLine = Math.max(0, Math.min(activeLine, lines.length - 1));
    render({
      source: joinLines(lines),
      focusLine: activeLine,
      caret: preferredColumn,
    });
    content = canvas.querySelector(
      `[data-classic-line="${activeLine}"] [data-classic-content]`,
    );
    return content?.dataset.editorMode === 'source' ? content : null;
  };

  const insertLineBreak = (event, { fromKeydown = false } = {}) => {
    if (disposed || !mounted) return false;
    if (!fromKeydown && suppressNextInsertParagraph) {
      event.preventDefault();
      suppressNextInsertParagraph = false;
      return true;
    }
    const content = ensureActiveSourceContent();
    if (!content) return false;
    event.preventDefault();
    if (fromKeydown) {
      suppressNextInsertParagraph = true;
      queueMicrotask(() => { suppressNextInsertParagraph = false; });
    }

    const lines = readLinesFromDom();
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const rowFor = (node) => {
      const element = node?.nodeType === 1 ? node : node?.parentElement;
      return element?.closest?.('[data-classic-line]') || null;
    };
    const startRow = rowFor(range?.startContainer) || content.closest('[data-classic-line]');
    const endRow = rowFor(range?.endContainer) || startRow;
    let startLine = Number(startRow?.dataset.classicLine);
    let endLine = Number(endRow?.dataset.classicLine);
    if (!Number.isFinite(startLine)) startLine = activeLine;
    if (!Number.isFinite(endLine)) endLine = startLine;
    if (endLine < startLine) [startLine, endLine] = [endLine, startLine];

    const startContent = startRow?.querySelector('[data-classic-content]') || content;
    const endContent = endRow?.querySelector('[data-classic-content]') || startContent;
    const startOffset = range
      ? boundaryOffsetIn(startContent, range.startContainer, range.startOffset)
      : caretOffsetIn(startContent, selection);
    const endOffset = range
      ? boundaryOffsetIn(endContent, range.endContainer, range.endOffset)
      : startOffset;
    const before = (lines[startLine] ?? '').slice(0, startOffset);
    const after = (lines[endLine] ?? '').slice(endOffset);
    lines.splice(startLine, endLine - startLine + 1, before, after);

    commitLines(lines);
    preferredColumn = 0;
    stickyVerticalNav = false;
    activeLine = startLine + 1;
    selectionLines = new Set();
    render({ source: joinLines(lines), focusLine: activeLine, caret: 0 });
    canvas.focus?.({ preventScroll: true });
    ensureActiveLineVisible();
    return true;
  };

  const replaceMultiLineSelection = (event, replacement = '') => {
    const selection = window.getSelection();
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || selection.isCollapsed) return false;

    const rowFor = (node) => {
      const element = node?.nodeType === 1 ? node : node?.parentElement;
      return element?.closest?.('[data-classic-line]') || null;
    };
    const startRow = rowFor(range.startContainer);
    const endRow = rowFor(range.endContainer);
    let startLine = Number(startRow?.dataset.classicLine);
    let endLine = Number(endRow?.dataset.classicLine);
    if (!Number.isFinite(startLine) || !Number.isFinite(endLine) || startLine === endLine) {
      return false;
    }
    if (endLine < startLine) [startLine, endLine] = [endLine, startLine];

    const startContent = startRow.querySelector('[data-classic-content]');
    const endContent = endRow.querySelector('[data-classic-content]');
    if (!startContent || !endContent) return false;

    event.preventDefault();
    const lines = readLinesFromDom();
    const startOffset = boundaryOffsetIn(startContent, range.startContainer, range.startOffset);
    const endOffset = boundaryOffsetIn(endContent, range.endContainer, range.endOffset);
    const before = (lines[startLine] ?? '').slice(0, startOffset);
    const after = (lines[endLine] ?? '').slice(endOffset);
    const inserted = String(replacement ?? '').replace(/\r\n?/g, '\n').split('\n');
    const nextLines = inserted.length === 1
      ? [`${before}${inserted[0]}${after}`]
      : [
          `${before}${inserted[0]}`,
          ...inserted.slice(1, -1),
          `${inserted.at(-1)}${after}`,
        ];
    lines.splice(startLine, endLine - startLine + 1, ...nextLines);
    commitLines(lines);
    activeLine = startLine + nextLines.length - 1;
    const caret = inserted.length === 1
      ? before.length + inserted[0].length
      : inserted.at(-1).length;
    preferredColumn = caret;
    stickyVerticalNav = false;
    selectionLines = new Set();
    render({ source: joinLines(lines), focusLine: activeLine, caret });
    canvas.focus?.({ preventScroll: true });
    ensureActiveLineVisible();
    return true;
  };

  const handleBeforeInput = (event) => {
    if (isComposingEvent(event) || composing) return false;
    if (['insertParagraph', 'insertLineBreak'].includes(event?.inputType)) {
      return insertLineBreak(event);
    }
    if (['insertText', 'insertReplacementText', 'insertFromPaste'].includes(event?.inputType)) {
      const replacement = event.data ?? event.dataTransfer?.getData?.('text/plain');
      if (replacement != null && replaceMultiLineSelection(event, replacement)) return true;
    }
    if (String(event?.inputType || '').startsWith('delete')) {
      return replaceMultiLineSelection(event, '');
    }
    return false;
  };

  const moveVisualOrHard = (event, direction) => {
    const content = canvas.querySelector(
      `[data-classic-line="${activeLine}"] [data-classic-content]`,
    );
    const selection = window.getSelection();
    const offset = caretOffsetIn(content, selection);
    const starts = visualLineStarts(content);
    if (starts.length > 1) {
      let visual = 0;
      for (let index = 0; index < starts.length; index += 1) {
        if (starts[index] <= offset) visual = index;
      }
      const nextVisual = visual + direction;
      if (nextVisual >= 0 && nextVisual < starts.length) {
        event.preventDefault();
        const lineStart = starts[nextVisual];
        const lineEnd = nextVisual + 1 < starts.length
          ? starts[nextVisual + 1]
          : (content.textContent?.length || 0);
        const column = preferredColumn;
        const nextOffset = Math.max(lineStart, Math.min(lineStart + column, lineEnd));
        lastCaret = nextOffset;
        placeCaret(content, nextOffset, selection);
        adapters.setCursor?.({ line: activeLine + 1, column: Math.max(1, nextOffset + 1) });
        return true;
      }
    }
    return false;
  };

  const handleKeydown = (event) => {
    if (disposed || !mounted) return false;
    if (isComposingEvent(event) || composing) return false;
    const selection = window.getSelection();
    if (!selection?.isCollapsed && !['Enter', 'Backspace', 'Delete'].includes(event.key)) {
      // Let multi-select browser behavior stand unless we own the key.
      // Still handle nav keys only when collapsed (checked per-branch below).
    }
    const content = ensureActiveSourceContent();
    if (!content) return false;
    const offset = caretOffsetIn(content, selection);
    const length = content.textContent?.length || 0;
    const linesNow = splitLines(readSource());
    const meta = event.ctrlKey || event.metaKey;
    const isVerticalNav = event.key === 'ArrowUp'
      || event.key === 'ArrowDown'
      || event.key === 'PageUp'
      || event.key === 'PageDown';
    const wrapStarts = visualLineStarts(content);
    let visualColumn = offset;
    if (wrapStarts.length > 1) {
      let visual = 0;
      for (let index = 0; index < wrapStarts.length; index += 1) {
        if (wrapStarts[index] <= offset) visual = index;
      }
      visualColumn = offset - wrapStarts[visual];
    }

    // Sticky column: capture the visual column at the start of a vertical
    // sequence so wrap rows do not use the absolute hard-line offset.
    if (isVerticalNav) {
      if (!stickyVerticalNav) preferredColumn = visualColumn;
      stickyVerticalNav = true;
    } else {
      stickyVerticalNav = false;
      preferredColumn = offset;
    }

    if (event.key === 'Enter') return insertLineBreak(event, { fromKeydown: true });

    if (
      !selection?.isCollapsed
      && (event.key === 'Backspace' || event.key === 'Delete')
      && replaceMultiLineSelection(event, '')
    ) {
      return true;
    }

    if (event.key === 'Backspace' && selection?.isCollapsed && offset === 0 && activeLine > 0) {
      event.preventDefault();
      const lines = readLinesFromDom();
      const prev = lines[activeLine - 1] ?? '';
      const current = lines[activeLine] ?? '';
      const caret = prev.length;
      lines[activeLine - 1] = `${prev}${current}`;
      lines.splice(activeLine, 1);
      commitLines(lines);
      preferredColumn = caret;
      stickyVerticalNav = false;
      activeLine -= 1;
      selectionLines = new Set();
      render({ source: joinLines(lines), focusLine: activeLine, caret });
      canvas.focus?.({ preventScroll: true });
      ensureActiveLineVisible();
      return true;
    }

    if (
      event.key === 'Delete'
      && selection?.isCollapsed
      && offset >= length
      && activeLine < linesNow.length - 1
    ) {
      event.preventDefault();
      const lines = readLinesFromDom();
      const current = lines[activeLine] ?? '';
      const next = lines[activeLine + 1] ?? '';
      const caret = current.length;
      lines[activeLine] = `${current}${next}`;
      lines.splice(activeLine + 1, 1);
      commitLines(lines);
      preferredColumn = caret;
      stickyVerticalNav = false;
      selectionLines = new Set();
      render({ source: joinLines(lines), focusLine: activeLine, caret });
      canvas.focus?.({ preventScroll: true });
      ensureActiveLineVisible();
      return true;
    }

    if (event.key === 'ArrowUp' && selection?.isCollapsed && !meta) {
      if (moveVisualOrHard(event, -1)) return true;
      if (activeLine <= 0) return false;
      event.preventDefault();
      goToLine(activeLine - 1, preferredColumn, { retainPreferred: true });
      return true;
    }

    if (event.key === 'ArrowDown' && selection?.isCollapsed && !meta) {
      if (moveVisualOrHard(event, 1)) return true;
      if (activeLine >= linesNow.length - 1) return false;
      event.preventDefault();
      goToLine(activeLine + 1, preferredColumn, { retainPreferred: true });
      return true;
    }

    if (event.key === 'ArrowLeft' && selection?.isCollapsed && !meta && offset === 0 && activeLine > 0) {
      event.preventDefault();
      const prevLen = (linesNow[activeLine - 1] || '').length;
      stickyVerticalNav = false;
      goToLine(activeLine - 1, prevLen, { retainPreferred: false });
      return true;
    }

    if (event.key === 'ArrowRight' && selection?.isCollapsed && !meta && offset >= length) {
      if (activeLine >= linesNow.length - 1) return false;
      event.preventDefault();
      stickyVerticalNav = false;
      goToLine(activeLine + 1, 0, { retainPreferred: false });
      return true;
    }

    if (event.key === 'Home' && selection?.isCollapsed) {
      event.preventDefault();
      stickyVerticalNav = false;
      if (meta) goToLine(0, 0, { retainPreferred: false });
      else {
        preferredColumn = 0;
        placeCaret(content, 0, selection);
        adapters.setCursor?.({ line: activeLine + 1, column: 1 });
      }
      return true;
    }

    if (event.key === 'End' && selection?.isCollapsed) {
      event.preventDefault();
      stickyVerticalNav = false;
      if (meta) {
        const last = linesNow.length - 1;
        goToLine(last, (linesNow[last] || '').length, { retainPreferred: false });
      } else {
        preferredColumn = length;
        placeCaret(content, length, selection);
        adapters.setCursor?.({ line: activeLine + 1, column: length + 1 });
      }
      return true;
    }

    if (event.key === 'PageUp' && selection?.isCollapsed) {
      event.preventDefault();
      goToLine(activeLine - pageLineStep(), preferredColumn, { retainPreferred: true });
      return true;
    }

    if (event.key === 'PageDown' && selection?.isCollapsed) {
      event.preventDefault();
      goToLine(activeLine + pageLineStep(), preferredColumn, { retainPreferred: true });
      return true;
    }

    return false;
  };

  const scheduleActiveLineBand = () => {
    if (bandRaf != null) return;
    const run = () => {
      bandRaf = null;
      updateActiveLineBand();
    };
    if (typeof window.requestAnimationFrame === 'function') {
      bandRaf = window.requestAnimationFrame(run);
      // jsdom may not invoke rAF; also allow sync flush via null id engines.
      if (bandRaf == null) run();
    } else {
      run();
    }
  };

  const updateActiveLineBand = () => {
    const band = adapters.getActiveLineBand?.();
    if (!band || !mounted) {
      if (band) {
        cancelBandAnimation();
        band.hidden = true;
      }
      return;
    }
    const host = adapters.getBandHost?.() || canvas.closest?.('.editor-view') || canvas;
    const row = canvas.querySelector(`.classic-line.is-active-line`);
    if (!row || !host) {
      cancelBandAnimation();
      band.hidden = true;
      return;
    }
    const hostRect = host.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const nextTop = rowRect.top - hostRect.top + (host.scrollTop || 0);
    const nextHeight = Math.max(rowRect.height, 18);
    const prevTop = Number.parseFloat(band.dataset.top || '') || nextTop;
    const prevHeight = Number.parseFloat(band.dataset.height || '') || nextHeight;
    const motionOff = reduceMotion();

    // Prefer live visual geometry when retargeting mid-flight.
    // Always cancel when reduce motion is on so mid-flight travel cannot continue.
    let fromTop = prevTop;
    let fromHeight = prevHeight;
    if (bandAnimation || motionOff) {
      if (bandAnimation) {
        try {
          const live = band.getBoundingClientRect();
          fromTop = live.top - hostRect.top + (host.scrollTop || 0);
          fromHeight = Math.max(live.height || prevHeight, 1);
        } catch {
          /* keep dataset values */
        }
      }
      cancelBandAnimation();
    }

    band.hidden = false;
    band.style.left = '0';
    band.style.right = '0';
    band.style.width = '100%';
    band.style.transform = '';
    band.style.top = `${nextTop}px`;
    band.style.height = `${nextHeight}px`;
    band.dataset.top = String(nextTop);
    band.dataset.height = String(nextHeight);

    const deltaY = fromTop - nextTop;
    const heightDelta = fromHeight - nextHeight;
    const canAnimate = !motionOff
      && (Math.abs(deltaY) > 0.5 || Math.abs(heightDelta) > 0.5)
      && typeof band.animate === 'function'
      && band.dataset.ready === '1';

    if (canAnimate) {
      bandAnimation = band.animate(
        [
          {
            transform: `translateY(${deltaY}px)`,
            height: `${fromHeight}px`,
          },
          {
            transform: 'translateY(0)',
            height: `${nextHeight}px`,
          },
        ],
        {
          duration: 180,
          easing: MOTION_EASE_OUT,
          fill: 'none',
        },
      );
      const clear = () => {
        if (bandAnimation) bandAnimation = null;
      };
      try {
        bandAnimation.addEventListener?.('finish', clear);
        bandAnimation.addEventListener?.('cancel', clear);
      } catch {
        /* ignore */
      }
    }
    band.dataset.ready = '1';
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
      const colOffset = caretOffsetIn(content, selection);
      // While a vertical sticky sequence is active, ignore selection noise from
      // goToLine/placeCaret. Pointer/input/non-vertical keys clear sticky first.
      if (!stickyVerticalNav) {
        preferredColumn = colOffset;
        lastCaret = colOffset;
      }
      adapters.setCursor?.({ line: activeLine + 1, column: Math.max(1, colOffset + 1) });
      return true;
    }
    const content = row.querySelector('[data-classic-content]');
    const caret = content?.dataset.editorMode === 'source'
      ? caretOffsetIn(content, selection)
      : null;
    activateLine(index, { caret, clearSelection: true });
    return true;
  };

  const onInput = (event) => handleInput(event);
  const onBeforeInput = (event) => handleBeforeInput(event);
  const onCompositionStart = (event) => handleCompositionStart(event);
  const onCompositionEnd = (event) => handleCompositionEnd(event);
  const onKeydown = (event) => {
    const meta = event.ctrlKey || event.metaKey;
    if (meta && !event.altKey && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      adapters.restoreHistory?.(event.shiftKey ? 'redo' : 'undo');
      return;
    }
    if (meta && !event.altKey && event.key.toLowerCase() === 'y') {
      event.preventDefault();
      adapters.restoreHistory?.('redo');
      return;
    }
    handleKeydown(event);
  };
  const onClick = (event) => handleClick(event);
  const onSelectionChange = () => handleSelectionChange();

  const bindListeners = () => {
    if (listenersBound || disposed) return;
    canvas.addEventListener('input', onInput);
    canvas.addEventListener('beforeinput', onBeforeInput);
    canvas.addEventListener('compositionstart', onCompositionStart);
    canvas.addEventListener('compositionend', onCompositionEnd);
    canvas.addEventListener('keydown', onKeydown);
    canvas.addEventListener('click', onClick);
    window.document.addEventListener('selectionchange', onSelectionChange);
    listenersBound = true;
  };

  const unbindListeners = () => {
    if (!listenersBound) return;
    canvas.removeEventListener('input', onInput);
    canvas.removeEventListener('beforeinput', onBeforeInput);
    canvas.removeEventListener('compositionstart', onCompositionStart);
    canvas.removeEventListener('compositionend', onCompositionEnd);
    canvas.removeEventListener('keydown', onKeydown);
    canvas.removeEventListener('click', onClick);
    window.document.removeEventListener('selectionchange', onSelectionChange);
    listenersBound = false;
  };

  const mount = () => {
    if (disposed) return;
    mounted = true;
    selectionLines = new Set();
    activeLine = 0;
    preferredColumn = 0;
    const band = adapters.getActiveLineBand?.();
    if (band) {
      band.hidden = false;
      band.dataset.ready = '0';
    }
    bindListeners();
    render({ source: readSource(), focusLine: 0, caret: 0 });
  };

  const unmount = () => {
    mounted = false;
    selectionLines = new Set();
    unbindListeners();
    canvas.classList.remove('is-classic-surface');
    const band = adapters.getActiveLineBand?.();
    if (band) {
      cancelBandAnimation();
      band.hidden = true;
      band.dataset.ready = '0';
      band.style.transform = '';
    }
    if (bandRaf != null) window.cancelAnimationFrame?.(bandRaf);
    bandRaf = null;
  };

  const dispose = () => {
    disposed = true;
    mounted = false;
    selectionLines = new Set();
    unbindListeners();
    cancelBandAnimation();
    if (bandRaf != null) window.cancelAnimationFrame?.(bandRaf);
    bandRaf = null;
  };

  return Object.freeze({
    mount,
    unmount,
    dispose,
    render,
    activateLine,
    handleClick,
    handleInput,
    handleBeforeInput,
    handleKeydown,
    handleSelectionChange,
    syncActiveLineBand: scheduleActiveLineBand,
    /** @internal test/debug: preferred sticky column for vertical nav */
    preferredColumn: () => preferredColumn,
    isMounted: () => mounted,
    activeLine: () => activeLine,
    commitFromDom: () => {
      const lines = readLinesFromDom();
      commitLines(lines);
      return joinLines(lines);
    },
  });
}
