import { isMarkdownFormat, resolveFormatId } from './format-registry.js';
import {
  getCurrentLineFromAnchors,
  getLineGutterLeft,
  getMinimapViewportGeometry,
  getMinimapScrollTopFromPointer,
  getReadingProgress,
  getScrollEdgeState,
  getVisibleSourceLineRange,
} from './reading-geometry.js';
import { MOTION_BASE_MS, MOTION_EASE_OUT, MOTION_SLOW_MS, shouldReduceMotion } from './reader-motion.js';

export function createReadingNavigationController({
  window,
  document,
  elements = {},
  adapters = {},
  hooks = {},
}) {
  if (!window || !document || typeof adapters.getMode !== 'function') {
    throw new TypeError('Reading Navigation Controller requires window, document and getMode');
  }

  let currentLine = 1;
  let readingProgress = 0;
  let updateFrameId = null;
  let scrollFrameId = null;
  let resizeObserver = null;
  let minimapDragging = false;
  let minimapDirty = true;
  let minimapCloneRevision = 0;
  let minimapContentHeight = 0;
  let started = false;
  let disposed = false;
  let morphLocked = false;
  let morphOrigins = null;
  let lineAnchorCache = null;
  const morphAnimations = new Set();

  const requestFrame = (callback) => (
    window.requestAnimationFrame?.(callback) ?? window.setTimeout(callback, 0)
  );
  const cancelFrame = (id) => {
    if (id === null) return;
    window.cancelAnimationFrame?.(id);
    window.clearTimeout(id);
  };
  const mode = () => {
    const value = adapters.getMode();
    return value === 'edit' || value === 'source' ? value : 'read';
  };
  const snapshot = () => ({ currentLine, readingProgress });
  const reportMetrics = () => hooks.onMetricsChange?.(snapshot());

  const activeView = () => {
    if (mode() === 'edit') return elements.editorCanvas;
    if (mode() === 'source') return elements.sourceView;
    return elements.readView;
  };

  const activeScroller = () => (
    adapters.isHelpVisible?.() ? elements.helpStage : elements.readerPage
  );

  const getRenderedLineAnchors = () => {
    if (!elements.documentStage) return [];
    const scrollTop = activeScroller()?.scrollTop || 0;
    if (lineAnchorCache) {
      return lineAnchorCache.map((anchor) => ({
        ...anchor,
        top: anchor.documentTop - scrollTop,
      }));
    }
    const stageTop = elements.documentStage.getBoundingClientRect().top;
    const seenLines = new Set();
    let anchors = [];
    if (mode() === 'edit') {
      const classicRows = [...(elements.editorCanvas?.querySelectorAll('[data-classic-line]') || [])];
      if (classicRows.length > 0) {
        // Classic continuous surface: one source line per hard-line row.
        anchors = classicRows.map((row) => {
          const index = Number.parseInt(row.dataset.classicLine, 10);
          const content = row.querySelector('[data-classic-content]') || row;
          const styles = window.getComputedStyle(content);
          const lineHeight = Number.parseFloat(styles.lineHeight)
            || Math.min(Math.max(content.getBoundingClientRect().height, 16), 32);
          return {
            line: index + 1,
            top: content.getBoundingClientRect().top - stageTop,
            lineHeight,
          };
        });
      } else {
        const activeDocument = adapters.getDocument?.();
        const activePath = adapters.getFilePath?.();
        const activeFormat = resolveFormatId(activePath, activeDocument);
        const usesMarkdownCodeOffsets = isMarkdownFormat(activeFormat, {
          kind: activeDocument?.kind,
          path: activePath,
        });
        anchors = [...(elements.editorCanvas?.querySelectorAll('[data-source-line-start]') || [])].flatMap((wrapper) => {
          const content = wrapper.querySelector('[data-editor-content]');
          if (!content) return [];
          const sourceStart = Number.parseInt(wrapper.dataset.sourceLineStart, 10);
          const sourceCount = Math.max(1, Number.parseInt(wrapper.dataset.sourceLineCount, 10) || 1);
          const styles = window.getComputedStyle(content);
          const lineHeight = Number.parseFloat(styles.lineHeight)
            || Math.min(Math.max(content.getBoundingClientRect().height, 16), 32);
          const top = content.getBoundingClientRect().top - stageTop;
          const isCode = wrapper.dataset.blockType === 'code'
            && usesMarkdownCodeOffsets;
          const visibleCount = isCode
            ? Math.max(1, content.textContent.split('\n').length)
            : sourceCount;
          const visibleStart = sourceStart + (isCode ? 1 : 0);
          return Array.from({ length: visibleCount }, (_value, index) => ({
            line: visibleStart + index,
            top: top + (index * lineHeight),
            lineHeight,
          }));
        });
      }
    } else {
      anchors = [...(elements.readView?.querySelectorAll('.source-line-anchor[data-source-line]') || [])]
        .map((anchor) => {
          let visualTarget = anchor.nextElementSibling;
          while (visualTarget?.classList.contains('source-line-anchor')) {
            visualTarget = visualTarget.nextElementSibling;
          }
          visualTarget ||= anchor;
          const targetRect = visualTarget.getBoundingClientRect();
          const targetStyles = window.getComputedStyle(visualTarget);
          const targetLineHeight = Number.parseFloat(targetStyles.lineHeight);
          return {
            line: Number.parseInt(anchor.dataset.sourceLine, 10),
            top: targetRect.top - stageTop,
            lineHeight: Number.isFinite(targetLineHeight)
              ? targetLineHeight
              : Math.min(Math.max(targetRect.height, 16), 28),
          };
        });
    }

    const next = anchors
      .filter((anchor) => {
        if (!Number.isFinite(anchor.line) || anchor.line < 1 || seenLines.has(anchor.line)) return false;
        seenLines.add(anchor.line);
        return true;
      })
      .sort((left, right) => left.top - right.top)
      .map((anchor) => ({
        ...anchor,
        documentTop: anchor.top + scrollTop,
      }));
    lineAnchorCache = next;
    return next.map((anchor) => ({
      ...anchor,
      top: anchor.documentTop - scrollTop,
    }));
  };

  const lineTransitionName = (line) => `openmd-ln-${line}`;
  const modeMorphActive = () => document.body.classList.contains('is-mode-morphing');
  const reducedMotion = () => shouldReduceMotion(window);
  const LINE_MORPH_MS = MOTION_SLOW_MS;
  const LINE_MORPH_EASE = MOTION_EASE_OUT;

  const cancelMorphAnimations = () => {
    for (const animation of morphAnimations) {
      try { animation.cancel(); } catch { /* already finished */ }
    }
    morphAnimations.clear();
  };

  const trackMorphAnimation = (animation) => {
    if (!animation) return;
    morphAnimations.add(animation);
    Promise.resolve(animation.finished)
      .catch(() => undefined)
      .finally(() => morphAnimations.delete(animation));
  };

  const applyLineNumber = (label, {
    line,
    top,
    isCurrent = false,
    lineHeight = 20,
    enableTransitionName = false,
  }) => {
    label.className = `line-number${isCurrent ? ' is-current' : ''}`;
    label.dataset.line = String(line);
    label.textContent = String(line);
    label.style.top = `${Math.max(0, top)}px`;
    label.style.height = `${Math.max(1, lineHeight)}px`;
    label.style.lineHeight = `${Math.max(1, lineHeight)}px`;
    // Shared digits keep a stable name so VT can transfer them between modes.
    label.style.viewTransitionName = enableTransitionName ? lineTransitionName(line) : '';
  };

  const createLineNumber = (line, top, isCurrent = false, lineHeight = 20, enableTransitionName = false) => {
    const label = document.createElement('span');
    applyLineNumber(label, {
      line,
      top,
      isCurrent,
      lineHeight,
      enableTransitionName,
    });
    return label;
  };

  const existingLineNumbers = () => {
    const map = new Map();
    if (!elements.lineGutter) return map;
    for (const node of elements.lineGutter.querySelectorAll(':scope > .line-number')) {
      const line = Number.parseInt(node.dataset.line, 10);
      if (!Number.isFinite(line) || line < 1) continue;
      map.set(line, node);
    }
    return map;
  };

  const prepareModeMorph = () => {
    morphLocked = true;
    cancelFrame(updateFrameId);
    updateFrameId = null;
    cancelMorphAnimations();
    morphOrigins = new Map();
    if (!elements.lineGutter || elements.lineGutter.hidden || !adapters.isLineGuideEnabled?.()) return;
    for (const [line, label] of existingLineNumbers()) {
      morphOrigins.set(line, label.getBoundingClientRect());
      // Stamp names before old-state capture so shared digits can shape-transfer.
      label.style.viewTransitionName = lineTransitionName(line);
    }
  };

  const animateModeMorph = () => {
    // Live FLIP only for the non-View-Transition fallback. During VT the live DOM is hidden.
    if (
      !morphOrigins
      || reducedMotion()
      || !document.body.classList.contains('is-mode-morphing-fallback')
    ) return;

    cancelMorphAnimations();
    for (const [, label] of existingLineNumbers()) {
      if (typeof label.animate !== 'function') continue;
      const line = Number.parseInt(label.dataset.line, 10);
      const previous = morphOrigins.get(line);
      const targetOpacity = label.classList.contains('is-current') ? 1 : 0.44;
      if (!previous) {
        trackMorphAnimation(label.animate(
          [
            { opacity: 0, transform: 'translateY(3px)' },
            { opacity: targetOpacity, transform: 'translate(0px, 0px)' },
          ],
          { duration: MOTION_BASE_MS, easing: LINE_MORPH_EASE, fill: 'none' },
        ));
        continue;
      }
      const current = label.getBoundingClientRect();
      const dx = previous.left - current.left;
      const dy = previous.top - current.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      trackMorphAnimation(label.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: 'translate(0px, 0px)' },
        ],
        { duration: LINE_MORPH_MS, easing: LINE_MORPH_EASE, fill: 'both' },
      ));
    }
    morphOrigins = null;
  };

  const finishModeMorph = () => {
    cancelMorphAnimations();
    if (elements.lineGutter) {
      for (const label of elements.lineGutter.querySelectorAll(':scope > .line-number')) {
        label.style.viewTransitionName = '';
        label.style.transform = '';
      }
    }
    morphOrigins = null;
    morphLocked = false;
    // Line guide + minimap were force-refreshed inside the VT update. Do not
    // rewrite minimap viewport geometry here — that was the selection pop-in.
  };

  const positionLineGutter = () => {
    if (!elements.lineGutter || !elements.documentStage) return;
    const view = activeView();
    if (!view) return;
    const viewRect = view.getBoundingClientRect();
    const stageRect = elements.documentStage.getBoundingClientRect();
    const viewStyles = window.getComputedStyle(view);
    const compact = Boolean(window.matchMedia?.('(max-width: 460px)').matches);
    const digitWidth = String(adapters.getDocument?.()?.lineCount || 1).length * (compact ? 7.5 : 9);
    const editorControlLane = Number.parseFloat(viewStyles.getPropertyValue('--editor-control-lane')) || 52;
    const editorLineGap = Number.parseFloat(viewStyles.getPropertyValue('--editor-line-gap')) || 12;
    elements.lineGutter.style.width = `${Math.max(compact ? 34 : 40, digitWidth + 10)}px`;
    const gutterRect = elements.lineGutter.getBoundingClientRect();
    const editMode = mode() === 'edit';
    const gap = editMode ? editorControlLane + editorLineGap : (compact ? 8 : 12);
    const left = getLineGutterLeft({
      viewLeft: viewRect.left,
      stageLeft: stageRect.left,
      paddingLeft: editMode
        ? editorControlLane + (Number.parseFloat(viewStyles.paddingLeft) || 0)
        : Number.parseFloat(viewStyles.paddingLeft) || 0,
      gutterWidth: gutterRect.width || (compact ? 34 : 40),
      gap,
    });
    elements.lineGutter.style.left = `${left}px`;
  };

  const renderLineGuide = () => {
    const currentDocument = adapters.getDocument?.();
    if (
      !elements.lineGutter
      || elements.lineGutter.hidden
      || !adapters.isLineGuideEnabled?.()
      || !elements.readerPage
      || !currentDocument
    ) return;

    const morphing = modeMorphActive();
    // Edit hides Read/Source with display:none; flush layout before measuring anchors.
    if (morphing && elements.documentStage) void elements.documentStage.offsetHeight;

    positionLineGutter();
    const { scrollTop, clientHeight } = elements.readerPage;
    const desired = [];
    let nextCurrentLine = 1;

    if (mode() === 'source') {
      const styles = window.getComputedStyle(elements.sourceView);
      const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
      const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
      const range = getVisibleSourceLineRange({
        scrollTop,
        clientHeight,
        lineHeight,
        paddingTop,
        lineCount: currentDocument.lineCount,
      });
      nextCurrentLine = range.current;
      for (let line = range.first; line <= range.last; line += 1) {
        const top = paddingTop + ((line - 1) * lineHeight);
        desired.push({
          line,
          top,
          isCurrent: line === nextCurrentLine,
          lineHeight,
        });
      }
    } else {
      const anchors = getRenderedLineAnchors();
      const readingOffset = scrollTop + Math.min(48, clientHeight * 0.08);
      nextCurrentLine = mode() === 'edit'
        ? adapters.getEditorCursorLine?.() || currentLine
        : getCurrentLineFromAnchors(anchors, readingOffset);
      const visibleStart = scrollTop - 18;
      const visibleEnd = scrollTop + clientHeight + 18;
      let lastVisibleTop = Number.NEGATIVE_INFINITY;
      let currentIsVisible = false;
      for (const anchor of anchors) {
        if (anchor.top < visibleStart || anchor.top > visibleEnd) continue;
        const isCurrent = anchor.line === nextCurrentLine;
        if (!isCurrent && anchor.top - lastVisibleTop < 13) continue;
        desired.push({
          line: anchor.line,
          top: anchor.top,
          isCurrent,
          lineHeight: anchor.lineHeight,
        });
        lastVisibleTop = anchor.top;
        currentIsVisible ||= isCurrent;
      }
      if (!currentIsVisible) {
        desired.push({
          line: nextCurrentLine,
          top: readingOffset,
          isCurrent: true,
          lineHeight: 20,
        });
      }
    }

    const existing = existingLineNumbers();
    const nextNodes = [];
    const kept = new Set();
    // Shared digits keep VT names (transfer). New digits enter with the surface;
    // removed ones exit via the old snapshot name stamped in prepareModeMorph.
    for (const item of desired) {
      kept.add(item.line);
      const shared = existing.has(item.line);
      const enableTransitionName = morphing && shared;
      let label = existing.get(item.line);
      if (label) {
        applyLineNumber(label, { ...item, enableTransitionName });
      } else {
        label = createLineNumber(
          item.line,
          item.top,
          item.isCurrent,
          item.lineHeight,
          false,
        );
      }
      nextNodes.push(label);
    }
    for (const [line, label] of existing) {
      if (kept.has(line)) continue;
      label.style.viewTransitionName = '';
      label.remove();
    }
    const currentNodes = [...elements.lineGutter.children];
    const orderMatches = currentNodes.length === nextNodes.length
      && nextNodes.every((node, index) => currentNodes[index] === node);
    if (!orderMatches) elements.lineGutter.replaceChildren(...nextNodes);

    if (nextCurrentLine !== currentLine) {
      currentLine = nextCurrentLine;
      reportMetrics();
    }
  };

  const copyAttributes = (source, target) => {
    [...(source.attributes || [])].forEach((attribute) => {
      target.setAttribute(attribute.name, attribute.value);
    });
  };

  const buildMinimapSnapshot = (source) => {
    if (source.nodeType === 3) return source.ownerDocument.createTextNode(source.textContent);
    if (source.nodeType !== 1) return null;
    if (source.matches?.('.copy-code-btn')) return null;
    if (
      source.matches?.('.mermaid, .openmd-mermaid-svg, svg.openmd-mermaid-svg')
      || (source.matches?.('svg') && source.closest?.('.mermaid'))
    ) {
      const placeholder = source.ownerDocument.createElement('span');
      placeholder.className = 'minimap-diagram-placeholder';
      placeholder.setAttribute('aria-hidden', 'true');
      const box = source.getBoundingClientRect?.() || {};
      const width = Math.max(24, Math.round(source.clientWidth || box.width || 48));
      const height = Math.max(12, Math.round(source.clientHeight || box.height || 24));
      placeholder.style.cssText = `display:block;width:${width}px;height:${height}px`;
      return placeholder;
    }
    const copy = source.ownerDocument.createElement(source.tagName);
    copyAttributes(source, copy);
    [...source.childNodes].forEach((child) => {
      const snapped = buildMinimapSnapshot(child);
      if (snapped) copy.appendChild(snapped);
    });
    return copy;
  };

  const sanitizeMinimapClone = (clone) => {
    clone.setAttribute('aria-hidden', 'true');
    clone.setAttribute('inert', '');
    clone.classList.remove('hidden');
    const descendants = [clone, ...clone.querySelectorAll('*')];
    const idMap = new Map();
    const prefix = `openmd-minimap-${++minimapCloneRevision}-`;
    descendants.forEach((element) => {
      if (element.id) {
        const nextId = `${prefix}${element.id}`;
        idMap.set(element.id, nextId);
        element.id = nextId;
      }
      element.removeAttribute('tabindex');
      element.removeAttribute('autofocus');
      element.removeAttribute('aria-live');
      element.removeAttribute('aria-controls');
      element.removeAttribute('contenteditable');
      if (element.matches('a')) element.removeAttribute('href');
      if (element.matches('audio, video')) element.removeAttribute('controls');
    });
    if (idMap.size > 0) {
      descendants.forEach((element) => {
        [...element.attributes].forEach((attribute) => {
          let nextValue = attribute.value;
          idMap.forEach((nextId, previousId) => {
            nextValue = nextValue.replaceAll(`#${previousId}`, `#${nextId}`);
          });
          if (nextValue !== attribute.value) element.setAttribute(attribute.name, nextValue);
        });
      });
    }
  };

  const renderMinimapDocument = () => {
    if (
      !minimapDirty
      || !elements.minimap
      || elements.minimap.hidden
      || !adapters.isMinimapEnabled?.()
      || !elements.minimapDocument
      || !elements.readerPage
    ) return;
    const view = activeView();
    if (!view) return;
    const trackRect = elements.minimap.getBoundingClientRect();
    const viewRect = view.getBoundingClientRect();
    const viewStyles = window.getComputedStyle(view);
    const trackWidth = elements.minimap.clientWidth || trackRect.width;
    const trackHeight = elements.minimap.clientHeight || trackRect.height;
    if (trackWidth <= 0 || trackHeight <= 0 || viewRect.width <= 0) return;

    const documentWidth = Math.max(1, viewRect.width);
    const clone = buildMinimapSnapshot(view);
    if (!clone) return;
    sanitizeMinimapClone(clone);
    clone.style.width = `${documentWidth}px`;
    clone.style.maxWidth = 'none';
    clone.style.minHeight = '0';
    clone.style.margin = '0';
    elements.minimapDocument.style.width = `${documentWidth}px`;
    elements.minimapDocument.style.fontSize = viewStyles.fontSize;
    elements.minimapDocument.style.lineHeight = viewStyles.lineHeight;
    elements.minimapDocument.style.transform = 'none';
    elements.minimapDocument.replaceChildren(clone);
    const documentHeight = Math.max(1, view.scrollHeight, viewRect.height, clone.scrollHeight, clone.offsetHeight);
    elements.minimapDocument.style.height = `${documentHeight}px`;
    const scale = Math.min(trackWidth / documentWidth, trackHeight / documentHeight);
    minimapContentHeight = documentHeight * scale;
    elements.minimapDocument.style.left = `${(trackWidth - (documentWidth * scale)) / 2}px`;
    elements.minimapDocument.style.transform = `scale(${scale})`;
    minimapDirty = false;
  };

  const updateMinimapViewport = () => {
    if (
      !elements.minimap
      || elements.minimap.hidden
      || !adapters.isMinimapEnabled?.()
      || !elements.minimapViewport
      || !elements.readerPage
    ) return;
    const geometry = getMinimapViewportGeometry({
      scrollTop: elements.readerPage.scrollTop,
      scrollHeight: elements.readerPage.scrollHeight,
      clientHeight: elements.readerPage.clientHeight,
      trackHeight: elements.minimap.getBoundingClientRect().height,
      contentHeight: minimapContentHeight,
    });
    elements.minimapViewport.style.top = `${geometry.top}px`;
    elements.minimapViewport.style.height = `${geometry.height}px`;
    elements.minimap.setAttribute('aria-valuenow', String(readingProgress));
    elements.minimap.setAttribute('aria-valuetext', `${readingProgress}% through document`);
  };

  const refresh = ({ force = false } = {}) => {
    if (disposed || !adapters.getDocument?.() || !elements.readerPage || adapters.isHelpVisible?.()) return;
    if (morphLocked && !force) return;
    if (force) lineAnchorCache = null;
    const nextProgress = getReadingProgress(
      elements.readerPage.scrollTop,
      elements.readerPage.scrollHeight,
      elements.readerPage.clientHeight,
    );
    const progressChanged = nextProgress !== readingProgress;
    readingProgress = nextProgress;
    renderLineGuide();
    // During mode morph, force refresh must rebuild the minimap so the VT
    // new-state snapshot shows the destination mode (not a post-morph pop).
    if (!morphLocked || force) {
      if (force) minimapDirty = true;
      renderMinimapDocument();
      updateMinimapViewport();
    }
    if (progressChanged) reportMetrics();
  };

  const queueUpdate = () => {
    if (disposed || morphLocked || updateFrameId !== null) return;
    updateFrameId = requestFrame(() => {
      updateFrameId = null;
      refresh();
    });
  };

  const markDirty = ({ queue = true } = {}) => {
    minimapDirty = true;
    lineAnchorCache = null;
    if (queue) queueUpdate();
  };

  const refreshTools = () => {
    const available = Boolean(adapters.getDocument?.() && adapters.getFilePath?.());
    const lineGuideActive = available && Boolean(adapters.isLineGuideEnabled?.());
    const minimapActive = available && Boolean(adapters.isMinimapEnabled?.());
    if (elements.lineGutter) {
      elements.lineGutter.hidden = !available;
      elements.lineGutter.setAttribute('aria-hidden', String(!lineGuideActive));
      if (!available) elements.lineGutter.replaceChildren();
    }
    if (elements.minimap) {
      elements.minimap.hidden = !available;
      elements.minimap.setAttribute('aria-hidden', String(!minimapActive));
      elements.minimap.toggleAttribute('inert', !minimapActive);
      minimapDirty = minimapActive;
      if (!available) {
        minimapContentHeight = 0;
        elements.minimapDocument?.replaceChildren();
      }
    }
    queueUpdate();
  };

  const scrollFromMinimapPointer = (event) => {
    if (!elements.minimap || !elements.readerPage) return;
    const rect = elements.minimap.getBoundingClientRect();
    const maxScroll = Math.max(0, elements.readerPage.scrollHeight - elements.readerPage.clientHeight);
    // Prefer scaled document height so short docs end where the mini-doc ends,
    // not at the bottom of the empty rail. If height is still unknown, rebuild once.
    if (minimapContentHeight <= 0 && adapters.isMinimapEnabled?.()) {
      minimapDirty = true;
      renderMinimapDocument();
    }
    const contentHeight = minimapContentHeight > 0
      ? minimapContentHeight
      : Math.max(1, rect.height);
    const top = getMinimapScrollTopFromPointer({
      clientY: event.clientY,
      trackTop: rect.top,
      contentHeight,
      maxScroll,
    });
    elements.readerPage.scrollTo({ top, behavior: 'auto' });
  };
  const onMinimapPointerDown = (event) => {
    if (event.button !== 0) return;
    minimapDragging = true;
    elements.minimap?.setPointerCapture?.(event.pointerId);
    scrollFromMinimapPointer(event);
  };
  const onMinimapPointerMove = (event) => {
    if (minimapDragging) scrollFromMinimapPointer(event);
  };
  const onMinimapPointerUp = (event) => {
    minimapDragging = false;
    if (elements.minimap?.hasPointerCapture?.(event.pointerId)) {
      elements.minimap.releasePointerCapture(event.pointerId);
    }
  };
  const onMinimapKeyboard = (event) => {
    if (!elements.readerPage) return;
    const maxScroll = Math.max(0, elements.readerPage.scrollHeight - elements.readerPage.clientHeight);
    let nextScroll = null;
    if (event.key === 'Home') nextScroll = 0;
    if (event.key === 'End') nextScroll = maxScroll;
    if (event.key === 'ArrowUp') nextScroll = elements.readerPage.scrollTop - 48;
    if (event.key === 'ArrowDown') nextScroll = elements.readerPage.scrollTop + 48;
    if (event.key === 'PageUp') nextScroll = elements.readerPage.scrollTop - (elements.readerPage.clientHeight * 0.8);
    if (event.key === 'PageDown') nextScroll = elements.readerPage.scrollTop + (elements.readerPage.clientHeight * 0.8);
    if (nextScroll === null) return;
    event.preventDefault();
    elements.readerPage.scrollTo({
      top: Math.min(Math.max(nextScroll, 0), maxScroll),
      behavior: 'auto',
    });
  };

  const handleScroll = () => {
    if (disposed || scrollFrameId !== null) return;
    scrollFrameId = requestFrame(() => {
      scrollFrameId = null;
      const scroller = activeScroller();
      if (!scroller) return;
      const { scrollTop, scrollHeight, clientHeight } = scroller;
      const maxScroll = scrollHeight - clientHeight;
      const edges = getScrollEdgeState(scrollTop, scrollHeight, clientHeight);
      document.body.classList.toggle('has-scroll-before', edges.before);
      document.body.classList.toggle('has-scroll-after', edges.after);
      elements.scrollToTop?.classList.toggle('show', maxScroll > 0 && scrollTop > maxScroll * 0.5);
      if (!adapters.isHelpVisible?.()) refresh();
    });
  };

  const scrollToTop = () => {
    const reduced = reducedMotion();
    activeScroller()?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  };

  const captureScrollPosition = () => elements.readerPage?.scrollTop ?? 0;
  const restoreScrollPosition = (position, { sync = false } = {}) => {
    if (!elements.readerPage) return;
    const top = Number.isFinite(position) ? Math.max(0, position) : 0;
    elements.readerPage.scrollTo({ top, behavior: 'auto' });
    if (sync) refresh({ force: true });
    else queueUpdate();
  };

  const reset = () => {
    currentLine = 1;
    readingProgress = 0;
    minimapDirty = true;
    minimapContentHeight = 0;
    reportMetrics();
  };

  const start = () => {
    if (started || disposed) return;
    started = true;
    window.addEventListener('resize', queueUpdate, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });
    elements.readerPage?.addEventListener('scroll', handleScroll, { passive: true });
    elements.helpStage?.addEventListener('scroll', handleScroll, { passive: true });
    elements.scrollToTop?.addEventListener('click', scrollToTop);
    elements.minimap?.addEventListener('pointerdown', onMinimapPointerDown);
    elements.minimap?.addEventListener('pointermove', onMinimapPointerMove);
    elements.minimap?.addEventListener('pointerup', onMinimapPointerUp);
    elements.minimap?.addEventListener('pointercancel', onMinimapPointerUp);
    elements.minimap?.addEventListener('keydown', onMinimapKeyboard);
    if (typeof window.ResizeObserver === 'function') {
      resizeObserver = new window.ResizeObserver(() => markDirty());
      [elements.documentStage, elements.readView, elements.sourceView, elements.editView, elements.editorCanvas]
        .filter(Boolean)
        .forEach((element) => resizeObserver.observe(element));
    }
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener('resize', queueUpdate);
    window.removeEventListener('resize', handleScroll);
    elements.readerPage?.removeEventListener('scroll', handleScroll);
    elements.helpStage?.removeEventListener('scroll', handleScroll);
    elements.scrollToTop?.removeEventListener('click', scrollToTop);
    elements.minimap?.removeEventListener('pointerdown', onMinimapPointerDown);
    elements.minimap?.removeEventListener('pointermove', onMinimapPointerMove);
    elements.minimap?.removeEventListener('pointerup', onMinimapPointerUp);
    elements.minimap?.removeEventListener('pointercancel', onMinimapPointerUp);
    elements.minimap?.removeEventListener('keydown', onMinimapKeyboard);
    resizeObserver?.disconnect();
    resizeObserver = null;
    cancelFrame(updateFrameId);
    cancelFrame(scrollFrameId);
    updateFrameId = null;
    scrollFrameId = null;
    minimapDragging = false;
  };

  return Object.freeze({
    activeView,
    snapshot,
    refresh,
    queueUpdate,
    markDirty,
    refreshTools,
    handleScroll,
    scrollToTop,
    captureScrollPosition,
    restoreScrollPosition,
    prepareModeMorph,
    animateModeMorph,
    finishModeMorph,
    reset,
    start,
    dispose,
  });
}
