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
  let bandRaf = null;
  let bandAnimation = null;

  const isMarkdown = () => adapters.isMarkdown?.() !== false;
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
    preferredColumn = caret == null ? preferredColumn : caret;
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
    activeLine = next;
    const nextCaret = caret == null ? (lines[activeLine]?.length || 0) : caret;
    preferredColumn = nextCaret;
    render({
      source: readSource(),
      focusLine: activeLine,
      caret: nextCaret,
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
    selectionLines = new Set();
    activeLine = next;
    render({ source: joinLines(nextLines), focusLine: next, caret: offset });
    // render() overwrites preferredColumn from the clamped caret; restore sticky col.
    if (retainPreferred && savedPreferred != null) {
      preferredColumn = savedPreferred;
    }
    // Ensure focus remains on the continuous host after replaceChildren.
    try {
      canvas.focus({ preventScroll: true });
    } catch {
      /* jsdom may not implement focus options */
      canvas.focus?.();
    }
    scheduleActiveLineBand();
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

  const handleKeydown = (event) => {
    if (disposed || !mounted) return false;
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

    // Sticky column: capture from the live caret at the start of a vertical
    // sequence; keep it across shorter lines until a horizontal/edit action.
    if (isVerticalNav) {
      if (!stickyVerticalNav) preferredColumn = offset;
      stickyVerticalNav = true;
    } else {
      stickyVerticalNav = false;
      preferredColumn = offset;
    }

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      const lines = readLinesFromDom();
      const current = lines[activeLine] ?? '';
      lines[activeLine] = current.slice(0, offset);
      lines.splice(activeLine + 1, 0, current.slice(offset));
      commitLines(lines);
      preferredColumn = 0;
      stickyVerticalNav = false;
      activeLine += 1;
      selectionLines = new Set();
      render({ source: joinLines(lines), focusLine: activeLine, caret: 0 });
      canvas.focus?.({ preventScroll: true });
      scheduleActiveLineBand();
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
      scheduleActiveLineBand();
      return true;
    }

    if (event.key === 'ArrowUp' && selection?.isCollapsed && !meta) {
      if (activeLine <= 0) return false;
      event.preventDefault();
      goToLine(activeLine - 1, preferredColumn, { retainPreferred: true });
      return true;
    }

    if (event.key === 'ArrowDown' && selection?.isCollapsed && !meta) {
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
      const step = Math.max(1, Math.floor((canvas.clientHeight || 240) / 28));
      goToLine(activeLine - step, preferredColumn, { retainPreferred: true });
      return true;
    }

    if (event.key === 'PageDown' && selection?.isCollapsed) {
      event.preventDefault();
      const step = Math.max(1, Math.floor((canvas.clientHeight || 240) / 28));
      goToLine(activeLine + step, preferredColumn, { retainPreferred: true });
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

    // Prefer live visual geometry when retargeting mid-flight.
    let fromTop = prevTop;
    let fromHeight = prevHeight;
    if (bandAnimation) {
      try {
        const live = band.getBoundingClientRect();
        fromTop = live.top - hostRect.top + (host.scrollTop || 0);
        fromHeight = Math.max(live.height || prevHeight, 1);
      } catch {
        /* keep dataset values */
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
    const canAnimate = !reduceMotion()
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
          easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
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
      if (!stickyVerticalNav) preferredColumn = colOffset;
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
    render({ source: readSource(), focusLine: 0, caret: 0 });
  };

  const unmount = () => {
    mounted = false;
    selectionLines = new Set();
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
