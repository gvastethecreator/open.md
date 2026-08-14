const FIT_SELECTORS = [
  '.markdown-body h1',
  '.markdown-body h2',
  '.editor-block--heading1 .editor-block-content',
  '.editor-block--heading2 .editor-block-content',
].join(',');

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

export function findFittedFontSize({
  baseSize,
  minSize,
  maxLines,
  measure,
  precision = 0.5,
}) {
  const safeBase = Math.max(1, Number(baseSize) || 1);
  const safeMinimum = clamp(Number(minSize) || safeBase, 1, safeBase);
  const safeMaxLines = Math.max(1, Math.floor(Number(maxLines) || 1));
  const baseLines = Math.max(0, Number(measure(safeBase)) || 0);

  if (baseLines <= safeMaxLines) {
    return { fontSize: safeBase, lineCount: baseLines, fitted: false };
  }

  const minimumLines = Math.max(0, Number(measure(safeMinimum)) || 0);
  if (minimumLines > safeMaxLines) {
    return { fontSize: safeMinimum, lineCount: minimumLines, fitted: true };
  }

  let low = safeMinimum;
  let high = safeBase;
  let bestSize = safeMinimum;
  let bestLines = minimumLines;
  for (let index = 0; index < 9 && high - low > precision; index += 1) {
    const candidate = (low + high) / 2;
    const lineCount = Math.max(0, Number(measure(candidate)) || 0);
    if (lineCount <= safeMaxLines) {
      bestSize = candidate;
      bestLines = lineCount;
      low = candidate;
    } else {
      high = candidate;
    }
  }

  const rounded = Math.floor(bestSize / precision) * precision;
  return { fontSize: rounded, lineCount: bestLines, fitted: true };
}

function canvasFont(style, size) {
  const parts = [
    style.fontStyle,
    style.fontVariant,
    style.fontWeight,
    `${size}px`,
    style.fontFamily,
  ];
  return parts.filter(Boolean).join(' ');
}

function resetElement(element) {
  element.style.removeProperty('--pretext-font-size');
  delete element.dataset.pretextFitted;
  delete element.dataset.pretextLines;
}

function measureElement(window, element, { layout, prepare }) {
  const text = element.textContent?.trim();
  const width = element.clientWidth;
  if (!text || width <= 0 || element.closest('.minimap-document')) return null;

  const style = window.getComputedStyle(element);
  const baseSize = Number.parseFloat(style.fontSize);
  const lineHeight = Number.parseFloat(style.lineHeight);
  if (!Number.isFinite(baseSize) || !Number.isFinite(lineHeight)) return null;

  const headingOne = element.matches('h1, .editor-block--heading1 .editor-block-content');
  const narrow = window.matchMedia?.('(max-width: 460px)').matches;
  const maxLines = headingOne && narrow ? 3 : 2;
  const minSize = Math.max(headingOne ? 20 : 16, baseSize * (headingOne ? 0.76 : 0.84));
  const lineHeightRatio = lineHeight / baseSize;
  const letterSpacing = Number.parseFloat(style.letterSpacing);
  const options = {
    whiteSpace: style.whiteSpace === 'pre-wrap' ? 'pre-wrap' : 'normal',
    wordBreak: style.wordBreak === 'keep-all' ? 'keep-all' : 'normal',
    ...(Number.isFinite(letterSpacing) ? { letterSpacing } : {}),
  };
  return findFittedFontSize({
    baseSize,
    minSize,
    maxLines,
    measure: (candidate) => {
      const prepared = prepare(text, canvasFont(style, candidate), options);
      return layout(prepared, width, candidate * lineHeightRatio).lineCount;
    },
  });
}

export function createResponsiveTypography({ window, root = window.document, onDiagnostic } = {}) {
  if (!window?.document || !root) throw new Error('Responsive typography requires a window and root');
  let disposed = false;
  let frameId = null;
  let available = typeof Intl?.Segmenter === 'function';
  let pretext = null;
  let pretextPromise = null;

  const loadPretext = () => {
    if (pretext || pretextPromise || !available) return pretextPromise;
    pretextPromise = import('@chenglou/pretext')
      .then((module) => {
        pretext = module;
        pretextPromise = null;
        if (!disposed) schedule();
        return module;
      })
      .catch((error) => {
        pretextPromise = null;
        available = false;
        onDiagnostic?.('Pretext layout unavailable; CSS fallback retained', error);
        return null;
      });
    return pretextPromise;
  };

  const refresh = () => {
    if (disposed || !available) return false;
    if (!pretext) {
      void loadPretext();
      return false;
    }
    try {
      const elements = [...root.querySelectorAll(FIT_SELECTORS)]
        .filter((element) => !element.closest('.minimap-document'));
      elements.forEach(resetElement);
      const measurements = elements.map((element) => measureElement(window, element, pretext));
      elements.forEach((element, index) => {
        const result = measurements[index];
        if (!result) return;
        element.style.setProperty('--pretext-font-size', `${result.fontSize}px`);
        element.dataset.pretextFitted = String(result.fitted);
        element.dataset.pretextLines = String(result.lineCount);
      });
      return true;
    } catch (error) {
      available = false;
      root.querySelectorAll(FIT_SELECTORS).forEach((element) => {
        element.style.removeProperty('--pretext-font-size');
        element.dataset.pretextFitted = 'fallback';
      });
      onDiagnostic?.('Pretext layout unavailable; CSS fallback retained', error);
      return false;
    }
  };

  const schedule = () => {
    if (disposed || frameId !== null) return;
    frameId = window.requestAnimationFrame(() => {
      frameId = null;
      refresh();
    });
  };

  const mutationObserver = typeof window.MutationObserver === 'function'
    ? new window.MutationObserver(schedule)
    : null;
  mutationObserver?.observe(root, { childList: true, characterData: true, subtree: true });

  const resizeObserver = typeof window.ResizeObserver === 'function'
    ? new window.ResizeObserver(schedule)
    : null;
  root.querySelectorAll('.markdown-body, .editor-canvas').forEach((element) => resizeObserver?.observe(element));

  window.document.fonts?.ready?.then(schedule).catch(() => undefined);
  schedule();

  return Object.freeze({
    refresh,
    schedule,
    isAvailable: () => available,
    dispose() {
      if (disposed) return;
      disposed = true;
      mutationObserver?.disconnect();
      resizeObserver?.disconnect();
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = null;
    },
  });
}
