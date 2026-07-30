import {
  getCurrentLineFromAnchors,
  getFileKind,
  getLineGutterLeft,
  getMinimapViewportGeometry,
  getReadingProgress,
  getScrollEdgeState,
  getVisibleSourceLineRange,
} from './core/reader.js';

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
  let viewScrollPositions = { read: 0, source: 0 };
  let started = false;
  let disposed = false;

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
    const stageTop = elements.documentStage.getBoundingClientRect().top;
    const seenLines = new Set();
    const anchors = mode() === 'edit'
      ? [...(elements.editorCanvas?.querySelectorAll('[data-source-line-start]') || [])].flatMap((wrapper) => {
          const content = wrapper.querySelector('[data-editor-content]');
          if (!content) return [];
          const sourceStart = Number.parseInt(wrapper.dataset.sourceLineStart, 10);
          const sourceCount = Math.max(1, Number.parseInt(wrapper.dataset.sourceLineCount, 10) || 1);
          const styles = window.getComputedStyle(content);
          const lineHeight = Number.parseFloat(styles.lineHeight)
            || Math.min(Math.max(content.getBoundingClientRect().height, 16), 32);
          const top = content.getBoundingClientRect().top - stageTop;
          const isCode = wrapper.dataset.blockType === 'code'
            && getFileKind(adapters.getFilePath?.()) === 'Markdown';
          const visibleCount = isCode
            ? Math.max(1, content.textContent.split('\n').length)
            : sourceCount;
          const visibleStart = sourceStart + (isCode ? 1 : 0);
          return Array.from({ length: visibleCount }, (_value, index) => ({
            line: visibleStart + index,
            top: top + (index * lineHeight),
            lineHeight,
          }));
        })
      : [...(elements.readView?.querySelectorAll('.source-line-anchor[data-source-line]') || [])]
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

    return anchors
      .filter((anchor) => {
        if (!Number.isFinite(anchor.line) || anchor.line < 1 || seenLines.has(anchor.line)) return false;
        seenLines.add(anchor.line);
        return true;
      })
      .sort((left, right) => left.top - right.top);
  };

  const createLineNumber = (line, top, isCurrent = false, lineHeight = 20) => {
    const label = document.createElement('span');
    label.className = `line-number${isCurrent ? ' is-current' : ''}`;
    label.textContent = String(line);
    label.style.top = `${Math.max(0, top)}px`;
    label.style.height = `${Math.max(1, lineHeight)}px`;
    label.style.lineHeight = `${Math.max(1, lineHeight)}px`;
    return label;
  };

  const positionLineGutter = () => {
    if (!elements.lineGutter || !elements.documentStage) return;
    const view = activeView();
    if (!view) return;
    const viewRect = view.getBoundingClientRect();
    const stageRect = elements.documentStage.getBoundingClientRect();
    const viewStyles = window.getComputedStyle(view);
    const compact = Boolean(window.matchMedia?.('(max-width: 460px)').matches);
    const digitWidth = String(adapters.getDocument?.()?.lineCount || 1).length * (compact ? 6 : 7);
    const editorControlLane = Number.parseFloat(viewStyles.getPropertyValue('--editor-control-lane')) || 52;
    const editorLineGap = Number.parseFloat(viewStyles.getPropertyValue('--editor-line-gap')) || 12;
    elements.lineGutter.style.width = `${Math.max(compact ? 29 : 34, digitWidth + 8)}px`;
    const gutterRect = elements.lineGutter.getBoundingClientRect();
    const editMode = mode() === 'edit';
    const gap = editMode ? editorControlLane + editorLineGap : (compact ? 8 : 12);
    const left = getLineGutterLeft({
      viewLeft: viewRect.left,
      stageLeft: stageRect.left,
      paddingLeft: editMode
        ? editorControlLane + (Number.parseFloat(viewStyles.paddingLeft) || 0)
        : Number.parseFloat(viewStyles.paddingLeft) || 0,
      gutterWidth: gutterRect.width || 34,
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

    positionLineGutter();
    const { scrollTop, clientHeight } = elements.readerPage;
    const fragment = document.createDocumentFragment();
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
        fragment.appendChild(createLineNumber(line, top, line === nextCurrentLine, lineHeight));
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
        fragment.appendChild(createLineNumber(anchor.line, anchor.top, isCurrent, anchor.lineHeight));
        lastVisibleTop = anchor.top;
        currentIsVisible ||= isCurrent;
      }
      if (!currentIsVisible) {
        fragment.appendChild(createLineNumber(nextCurrentLine, readingOffset, true));
      }
    }

    elements.lineGutter.replaceChildren(fragment);
    if (nextCurrentLine !== currentLine) {
      currentLine = nextCurrentLine;
      reportMetrics();
    }
  };

  const sanitizeMinimapClone = (clone) => {
    clone.setAttribute('aria-hidden', 'true');
    clone.setAttribute('inert', '');
    clone.classList.remove('hidden');
    clone.querySelectorAll('.copy-code-btn').forEach((button) => button.remove());
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
    const clone = view.cloneNode(true);
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

  const refresh = () => {
    if (disposed || !adapters.getDocument?.() || !elements.readerPage || adapters.isHelpVisible?.()) return;
    const nextProgress = getReadingProgress(
      elements.readerPage.scrollTop,
      elements.readerPage.scrollHeight,
      elements.readerPage.clientHeight,
    );
    const progressChanged = nextProgress !== readingProgress;
    readingProgress = nextProgress;
    renderLineGuide();
    renderMinimapDocument();
    updateMinimapViewport();
    if (progressChanged) reportMetrics();
  };

  const queueUpdate = () => {
    if (disposed || updateFrameId !== null) return;
    updateFrameId = requestFrame(() => {
      updateFrameId = null;
      refresh();
    });
  };

  const markDirty = ({ queue = true } = {}) => {
    minimapDirty = true;
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
    const ratio = Math.min(Math.max((event.clientY - rect.top) / Math.max(1, rect.height), 0), 1);
    const maxScroll = Math.max(0, elements.readerPage.scrollHeight - elements.readerPage.clientHeight);
    elements.readerPage.scrollTo({ top: ratio * maxScroll, behavior: 'auto' });
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
    const reduced = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    activeScroller()?.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  };

  const captureViewScroll = (viewMode) => {
    if (!elements.readerPage || !Object.hasOwn(viewScrollPositions, viewMode)) return;
    viewScrollPositions[viewMode] = elements.readerPage.scrollTop;
  };
  const restoreViewScroll = (viewMode) => {
    if (!elements.readerPage || !Object.hasOwn(viewScrollPositions, viewMode)) return;
    elements.readerPage.scrollTo({ top: viewScrollPositions[viewMode] || 0, behavior: 'auto' });
    queueUpdate();
  };

  const reset = () => {
    currentLine = 1;
    readingProgress = 0;
    minimapDirty = true;
    minimapContentHeight = 0;
    viewScrollPositions = { read: 0, source: 0 };
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
    captureViewScroll,
    restoreViewScroll,
    reset,
    start,
    dispose,
  });
}
