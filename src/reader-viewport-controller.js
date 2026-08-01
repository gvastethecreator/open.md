export function getViewportMode(hasFilePath, helpVisible) {
  if (helpVisible) return 'help';
  return hasFilePath ? 'content' : 'empty';
}

function deferFocus(window, target) {
  const schedule = window.queueMicrotask || ((callback) => Promise.resolve().then(callback));
  schedule(() => target?.focus?.({ preventScroll: true }));
}

export function createReaderViewportController({
  window,
  document,
  elements = {},
  hooks = {},
} = {}) {
  if (!window || !document) {
    throw new TypeError('Reader Viewport Controller requires window and document');
  }

  let state = { hasFilePath: false, sourceActive: false };
  let helpVisible = false;
  let focusBeforeHelp = null;
  let disposed = false;

  const current = () => ({
    ...state,
    mode: getViewportMode(state.hasFilePath, helpVisible),
    helpVisible,
  });

  const project = () => {
    if (disposed) return;

    const mode = getViewportMode(state.hasFilePath, helpVisible);
    const documentVisible = mode === 'content';
    const sourceVisible = documentVisible && state.sourceActive;

    elements.emptyStage?.classList.toggle('hidden', mode !== 'empty');

    if (elements.helpStage) {
      elements.helpStage.setAttribute('aria-hidden', String(mode !== 'help'));
      elements.helpStage.toggleAttribute('inert', mode !== 'help');
    }

    elements.documentStage?.classList.toggle('hidden', !documentVisible);
    elements.content?.classList.toggle('hidden', !documentVisible || sourceVisible);
    elements.sourceView?.classList.toggle('hidden', !sourceVisible);

    if (elements.readerPage) {
      elements.readerPage.setAttribute('aria-hidden', String(mode === 'help'));
      elements.readerPage.toggleAttribute('inert', mode === 'help');
    }

    elements.viewport?.setAttribute('data-page', mode === 'help' ? '2' : '1');
    document.body.classList.toggle('is-help-open', mode === 'help');
    elements.helpToggleButton?.setAttribute('aria-expanded', String(mode === 'help'));

    if (elements.helpToggleButton) {
      const label = mode === 'help' ? 'Close About and Help' : 'Open About and Help';
      elements.helpToggleButton.setAttribute('aria-label', label);
      elements.helpToggleButton.dataset.tooltip = `${label} (F1)`;
    }
  };

  const sync = (nextState = {}) => {
    if (disposed) return current();
    state = {
      ...state,
      ...(Object.hasOwn(nextState, 'hasFilePath')
        ? { hasFilePath: Boolean(nextState.hasFilePath) }
        : {}),
      ...(Object.hasOwn(nextState, 'sourceActive')
        ? { sourceActive: Boolean(nextState.sourceActive) }
        : {}),
    };
    project();
    hooks.onStateChange?.(current());
    return current();
  };

  const setHelpVisible = (nextVisible, { manageFocus = true } = {}) => {
    if (disposed) return current();
    const next = Boolean(nextVisible);
    if (next === helpVisible) return current();

    if (next && manageFocus) {
      const active = document.activeElement;
      focusBeforeHelp = active?.isConnected && typeof active.focus === 'function' ? active : null;
    }

    helpVisible = next;
    if (next) hooks.closeTransientUi?.();
    project();
    hooks.onHelpChanged?.(current());

    if (next) {
      elements.helpStage?.scrollTo?.({ top: 0, behavior: 'auto' });
    }

    if (!manageFocus) {
      if (!next) focusBeforeHelp = null;
      return current();
    }

    if (next) {
      deferFocus(window, elements.helpTitle);
      return current();
    }

    const returnTarget = focusBeforeHelp?.isConnected
      ? focusBeforeHelp
      : elements.helpToggleButton;
    focusBeforeHelp = null;
    deferFocus(window, returnTarget);
    return current();
  };

  const toggleHelp = () => setHelpVisible(!helpVisible);

  return Object.freeze({
    current,
    sync,
    setHelpVisible,
    toggleHelp,
    isHelpVisible: () => helpVisible,
    reset() {
      if (disposed) return;
      helpVisible = false;
      focusBeforeHelp = null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      focusBeforeHelp = null;
    },
  });
}
