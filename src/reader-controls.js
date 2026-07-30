import {
  DEFAULT_READING_TOOLS,
  FONT_PRESETS,
  normalizeFontIndex,
} from './reader-preferences.js';

function deferFocus(window, target) {
  const schedule = window.queueMicrotask || ((callback) => Promise.resolve().then(callback));
  schedule(() => target?.focus?.());
}

function snapshotValue(snapshot = {}) {
  return {
    themeName: snapshot.themeName ?? null,
    readingTools: { ...DEFAULT_READING_TOOLS, ...(snapshot.readingTools || {}) },
    fonts: {
      sans: normalizeFontIndex(snapshot.fonts?.sans, FONT_PRESETS.sans.length),
      mono: normalizeFontIndex(snapshot.fonts?.mono, FONT_PRESETS.mono.length),
    },
    alwaysOnTop: Boolean(snapshot.alwaysOnTop),
    autoSave: snapshot.autoSave !== false,
  };
}

export function createReaderControls({
  window,
  document,
  elements = {},
  adapters = {},
  hooks = {},
}) {
  const body = document.body;
  const state = snapshotValue(adapters.preferences?.current?.());
  let readingToolsOpen = false;
  let typographyOpen = false;
  let disposed = false;
  let started = false;
  const unlisteners = [];

  const isDocumentAvailable = () => Boolean(adapters.isDocumentAvailable?.());
  const isEditMode = () => Boolean(adapters.isEditMode?.());

  function listen(target, type, listener, options) {
    target?.addEventListener?.(type, listener, options);
    if (target?.removeEventListener) unlisteners.push(() => target.removeEventListener(type, listener, options));
  }

  function updateFontControls() {
    for (const kind of Object.keys(FONT_PRESETS)) {
      const presets = FONT_PRESETS[kind];
      const index = normalizeFontIndex(state.fonts[kind], presets.length);
      const current = presets[index];
      const next = presets[(index + 1) % presets.length];
      const button = elements.fontButtons?.find((candidate) => candidate.dataset.fontKind === kind);
      const name = document.getElementById(`${kind}-font-name`);
      const kindLabel = kind === 'sans' ? 'Sans' : 'Mono';

      if (name) name.textContent = current.name;
      if (button) {
        const label = `${kindLabel} font: ${current.name}. Activate for ${next.name}`;
        button.setAttribute('aria-label', label);
        button.dataset.tooltip = label;
      }
    }
  }

  function applyFontPreferences() {
    for (const kind of Object.keys(FONT_PRESETS)) {
      const presets = FONT_PRESETS[kind];
      const index = normalizeFontIndex(state.fonts[kind], presets.length);
      state.fonts[kind] = index;
      document.documentElement.style.setProperty(`--font-${kind}`, presets[index].value);
    }
    updateFontControls();
    hooks.onFontsApplied?.({ ...state.fonts });
  }

  function updateAutoSaveControl() {
    elements.autoSaveToggle?.setAttribute('aria-checked', String(state.autoSave));
    if (elements.autoSaveToggle) {
      const label = `Auto-save: ${state.autoSave ? 'on' : 'off'}`;
      elements.autoSaveToggle.setAttribute('aria-label', label);
      elements.autoSaveToggle.dataset.tooltip = label;
    }
  }

  function updateAlwaysOnTopControl() {
    const label = `Always on top: ${state.alwaysOnTop ? 'on' : 'off'}`;
    body.classList.toggle('is-always-on-top', state.alwaysOnTop);
    elements.alwaysOnTopButton?.setAttribute('aria-checked', String(state.alwaysOnTop));
    if (elements.alwaysOnTopButton) {
      elements.alwaysOnTopButton.setAttribute('aria-label', label);
      elements.alwaysOnTopButton.dataset.tooltip = label;
    }
  }

  function setTypographyOpen(nextOpen, { returnFocus = false } = {}) {
    if (disposed) return;
    typographyOpen = Boolean(nextOpen && !hooks.isHelpVisible?.());
    if (typographyOpen) setReadingToolsOpen(false);
    body.classList.toggle('is-typography-open', typographyOpen);
    elements.typographyButton?.setAttribute('aria-expanded', String(typographyOpen));

    if (elements.typographyButton) {
      const label = typographyOpen ? 'Close appearance options' : 'Open appearance options';
      elements.typographyButton.setAttribute('aria-label', label);
      elements.typographyButton.dataset.tooltip = label;
    }

    if (elements.typographyPanel) {
      elements.typographyPanel.setAttribute('aria-hidden', String(!typographyOpen));
      elements.typographyPanel.toggleAttribute('inert', !typographyOpen);
    }

    if (!typographyOpen && returnFocus) deferFocus(window, elements.typographyButton);
  }

  function setReadingToolsOpen(nextOpen, { returnFocus = false } = {}) {
    if (disposed) return;
    const canOpen = !hooks.isHelpVisible?.();
    readingToolsOpen = Boolean(nextOpen && canOpen);
    if (readingToolsOpen) setTypographyOpen(false);
    body.classList.toggle('is-reading-tools-open', readingToolsOpen);
    elements.readingToolsButton?.setAttribute('aria-expanded', String(readingToolsOpen));

    if (elements.readingToolsButton) {
      const label = readingToolsOpen ? 'Close view options' : 'Open view options';
      elements.readingToolsButton.setAttribute('aria-label', label);
      elements.readingToolsButton.dataset.tooltip = label;
    }

    if (elements.readingToolsPanel) {
      elements.readingToolsPanel.setAttribute('aria-hidden', String(!readingToolsOpen));
      elements.readingToolsPanel.toggleAttribute('inert', !readingToolsOpen);
    }

    if (!readingToolsOpen && returnFocus) deferFocus(window, elements.readingToolsButton);
  }

  function closeTransient({ returnFocus = false } = {}) {
    setReadingToolsOpen(false, { returnFocus });
    setTypographyOpen(false, { returnFocus });
  }

  function updateReadingToolControls() {
    const available = isDocumentAvailable();
    const hasActiveTool = available && ['lineGuide', 'minimap', 'stats', 'wordWrap']
      .some((tool) => state.readingTools[tool] !== DEFAULT_READING_TOOLS[tool]);

    elements.readingToolsButton?.classList.toggle('is-active', hasActiveTool);
    elements.readingToolToggles?.forEach((toggle) => {
      const tool = toggle.dataset.readingTool;
      toggle.disabled = !available;
      toggle.setAttribute('aria-checked', String(Boolean(state.readingTools[tool])));
    });
  }

  function applyReadingTools() {
    const available = isDocumentAvailable();
    const sourceActive = available && state.readingTools.source && !isEditMode();
    body.classList.toggle('is-source-view', sourceActive);
    body.classList.toggle('is-line-guide', available && state.readingTools.lineGuide);
    body.classList.toggle('is-minimap', available && state.readingTools.minimap);
    body.classList.toggle('is-word-wrap', state.readingTools.wordWrap);
    elements.content?.classList.toggle('hidden', sourceActive || isEditMode());
    elements.sourceView?.classList.toggle('hidden', !sourceActive);
    updateReadingToolControls();
    hooks.onReadingToolsApplied?.({ ...state.readingTools, sourceActive });
  }

  function refresh() {
    if (disposed) return;
    applyReadingTools();
    updateAutoSaveControl();
    updateAlwaysOnTopControl();
    applyFontPreferences();
  }

  function applySnapshot(nextSnapshot) {
    if (disposed) return;
    const next = snapshotValue(nextSnapshot);
    Object.assign(state, next, {
      readingTools: { ...next.readingTools },
      fonts: { ...next.fonts },
    });
    refresh();
    hooks.onThemeName?.(state.themeName);
    hooks.onAutoSaveApplied?.(state.autoSave);
  }

  async function cycleFont(kind) {
    const presets = FONT_PRESETS[kind];
    if (!presets || typeof adapters.preferences?.update !== 'function') return;
    const nextIndex = normalizeFontIndex(state.fonts[kind] + 1, presets.length);
    const result = await adapters.preferences.update({ fonts: { [kind]: nextIndex } });
    hooks.onPreferenceResult?.(result);
    const currentIndex = normalizeFontIndex(state.fonts[kind], presets.length);
    hooks.onToast?.(`${kind === 'sans' ? 'Sans' : 'Mono'} font: ${presets[currentIndex].name}`);
  }

  async function setReadingTool(tool, nextValue) {
    if (!Object.hasOwn(DEFAULT_READING_TOOLS, tool) || !isDocumentAvailable()) return;
    const next = Boolean(nextValue);
    if (state.readingTools[tool] === next || typeof adapters.preferences?.update !== 'function') return;

    if (tool === 'source') {
      hooks.captureViewScroll?.(state.readingTools.source ? 'source' : 'read');
    }

    const result = await adapters.preferences.update({ readingTools: { [tool]: next } });
    hooks.onPreferenceResult?.(result);
    if (tool === 'source') {
      window.requestAnimationFrame?.(() => {
        hooks.restoreViewScroll?.(next ? 'source' : 'read');
        (next ? elements.sourceView : elements.content)?.focus?.({ preventScroll: true });
      });
    }

    const labels = {
      lineGuide: 'Line guide',
      minimap: 'Minimap',
      source: 'Source view',
      stats: 'Reading stats',
      wordWrap: 'Word wrap',
    };
    hooks.onToast?.(`${labels[tool]} ${next ? 'on' : 'off'}`);
  }

  async function toggleAutoSave() {
    if (typeof adapters.preferences?.update !== 'function') return;
    const result = await adapters.preferences.update({ autoSave: !state.autoSave });
    hooks.onPreferenceResult?.(result);
    hooks.onToast?.(`Auto-save ${state.autoSave ? 'on' : 'off'}`);
  }

  async function toggleAlwaysOnTop() {
    if (typeof adapters.preferences?.update !== 'function') return;
    const nextValue = !state.alwaysOnTop;
    if (elements.alwaysOnTopButton) elements.alwaysOnTopButton.disabled = true;
    try {
      const result = await adapters.preferences.update({ alwaysOnTop: nextValue });
      if (result.status === 'applied' || result.status === 'volatile') {
        hooks.onPreferenceResult?.(result);
        hooks.onToast?.(`Always on top ${nextValue ? 'on' : 'off'}`);
      } else if (result.status === 'unavailable') {
        hooks.onToast?.('Always on top is available in the desktop app');
      } else {
        hooks.onToast?.('Could not change always on top');
      }
    } catch (error) {
      hooks.onDiagnostic?.('Could not change the always-on-top setting', error);
      hooks.onToast?.('Could not change always on top');
    } finally {
      if (elements.alwaysOnTopButton) elements.alwaysOnTopButton.disabled = false;
    }
  }

  function start() {
    if (disposed || started) return;
    started = true;
    listen(elements.readingToolsButton, 'click', () => setReadingToolsOpen(!readingToolsOpen));
    listen(elements.typographyButton, 'click', () => setTypographyOpen(!typographyOpen));
    listen(elements.alwaysOnTopButton, 'click', () => { void toggleAlwaysOnTop(); });
    listen(elements.autoSaveToggle, 'click', () => { void toggleAutoSave(); });
    elements.readingToolToggles?.forEach((toggle) => {
      listen(toggle, 'click', () => {
        void setReadingTool(toggle.dataset.readingTool, toggle.getAttribute('aria-checked') !== 'true');
      });
    });
    elements.fontButtons?.forEach((button) => {
      listen(button, 'click', () => { void cycleFont(button.dataset.fontKind); });
    });
    listen(document, 'pointerdown', (event) => {
      if (readingToolsOpen && !elements.readingToolsShell?.contains(event.target)) setReadingToolsOpen(false);
      if (typographyOpen && !elements.typographyShell?.contains(event.target)) setTypographyOpen(false);
    });
    refresh();
  }

  return Object.freeze({
    start,
    applySnapshot,
    refresh,
    closeTransient,
    setReadingToolsOpen,
    setTypographyOpen,
    setReadingTool,
    cycleFont,
    toggleAutoSave,
    toggleAlwaysOnTop,
    isReadingToolsOpen: () => readingToolsOpen,
    isTypographyOpen: () => typographyOpen,
    current: () => ({
      ...state,
      readingTools: { ...state.readingTools },
      fonts: { ...state.fonts },
      readingToolsOpen,
      typographyOpen,
    }),
    dispose() {
      if (disposed) return;
      closeTransient();
      disposed = true;
      unlisteners.splice(0).forEach((unlisten) => unlisten());
    },
  });
}
