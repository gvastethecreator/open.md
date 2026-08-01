import {
  DEFAULT_ADVANCED_PREFERENCES,
  DEFAULT_READING_TOOLS,
  FONT_PRESETS,
  normalizeAdvancedPreferences,
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
    advanced: normalizeAdvancedPreferences(snapshot.advanced || DEFAULT_ADVANCED_PREFERENCES),
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
  let advancedOpen = false;
  let disposed = false;
  let started = false;
  let sourceChangeGeneration = 0;
  let pendingSourceFrame = null;
  /** Disk preference for multi-process launches; default on after hydrate. */
  let allowMultipleInstances = true;
  let processAllowsMultipleInstances = true;
  let instanceRestartRequired = false;
  /** False until the first successful native system refresh (avoids pre-hydrate races). */
  let systemAvailable = false;
  let systemHydrated = false;
  let associationTooltip = 'Uses your system’s default-app settings for Markdown and text';
  let systemRefreshGeneration = 0;
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
      const kindLabel = kind === 'sans' ? 'Text font' : 'Monospaced font';

      if (name) name.textContent = current.name;
      if (button) {
        const label = `${kindLabel}: ${current.name}. Activate for ${next.name}`;
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
      // Keep the static description tooltip; surface on/off only in aria-label.
      elements.autoSaveToggle.setAttribute(
        'aria-label',
        `Auto-save: ${state.autoSave ? 'on' : 'off'}`,
      );
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

  function applyEdgeFade() {
    const imageDocument = body.classList.contains('is-image-document');
    const fadeOff = imageDocument || state.advanced.edgeFade === false;
    body.classList.toggle('is-edge-fade-off', fadeOff);
  }

  function setAdvancedOpen(nextOpen, { returnFocus = false } = {}) {
    if (disposed) return;
    advancedOpen = Boolean(nextOpen && readingToolsOpen);
    body.classList.toggle('is-advanced-options', advancedOpen);
    elements.readingToolsPanel?.classList.toggle('is-advanced-view', advancedOpen);
    elements.optionsDeck?.classList.toggle('is-advanced-view', advancedOpen);
    elements.advancedOptionsButton?.setAttribute('aria-expanded', String(advancedOpen));
    // Keep both panes in the layout for the horizontal slide; gate interaction with inert.
    if (elements.advancedOptionsPanel) {
      elements.advancedOptionsPanel.hidden = false;
      elements.advancedOptionsPanel.setAttribute('aria-hidden', String(!advancedOpen));
      elements.advancedOptionsPanel.toggleAttribute('inert', !advancedOpen);
    }
    if (elements.basicOptionsPanel) {
      elements.basicOptionsPanel.hidden = false;
      elements.basicOptionsPanel.setAttribute('aria-hidden', String(advancedOpen));
      elements.basicOptionsPanel.toggleAttribute('inert', advancedOpen);
    }
    if (elements.readingToolsHeaderLabel) {
      elements.readingToolsHeaderLabel.textContent = advancedOpen ? 'Advanced options' : 'View options';
    }
    if (!advancedOpen && returnFocus) deferFocus(window, elements.advancedOptionsButton);
  }

  function setReadingToolsOpen(nextOpen, { returnFocus = false } = {}) {
    if (disposed) return;
    const canOpen = !hooks.isHelpVisible?.();
    readingToolsOpen = Boolean(nextOpen && canOpen);
    if (!readingToolsOpen) setAdvancedOpen(false);
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
    setAdvancedOpen(false);
    setReadingToolsOpen(false, { returnFocus });
  }

  function updateAdvancedControls() {
    elements.advancedToggles?.forEach((toggle) => {
      const key = toggle.dataset.advancedPref;
      if (!key) return;
      const value = state.advanced[key];
      if (typeof value === 'boolean') {
        toggle.setAttribute('aria-checked', String(value));
      }
    });
    if (elements.imageDefaultZoomSelect) {
      elements.imageDefaultZoomSelect.value = state.advanced.imageDefaultZoom === '100%' ? '100%' : 'fit';
    }
    if (elements.csvRowCapInput) {
      elements.csvRowCapInput.value = String(state.advanced.csvRowCap);
    }
    updateSystemControls();
    body.classList.toggle('is-app-reduce-motion', Boolean(state.advanced.reduceMotion));
    applyEdgeFade();
  }

  function multiInstanceTooltip() {
    if (!systemAvailable) {
      return systemHydrated
        ? 'Available in the desktop app.'
        : 'Loading system settings…';
    }
    const restartHint = instanceRestartRequired ? ' Restart open.md to apply.' : '';
    return `When off, opening a file reuses the running app. Applies on next launch.${restartHint}`;
  }

  function updateSystemControls() {
    const multiToggle = elements.allowMultipleInstancesToggle;
    if (multiToggle) {
      multiToggle.setAttribute('aria-checked', String(allowMultipleInstances));
      multiToggle.disabled = !systemAvailable;
      multiToggle.dataset.tooltip = multiInstanceTooltip();
      multiToggle.setAttribute('aria-label', `Allow multiple instances: ${allowMultipleInstances ? 'on' : 'off'}`);
    }
    if (elements.fileAssociationButton) {
      elements.fileAssociationButton.disabled = !systemAvailable;
      elements.fileAssociationButton.dataset.tooltip = systemAvailable
        ? associationTooltip
        : (systemHydrated ? 'Available in the desktop app.' : 'Loading system settings…');
    }
  }

  async function refreshAssociationStatus() {
    if (disposed || typeof adapters.system?.getFileAssociationStatus !== 'function') return;
    try {
      const status = await adapters.system.getFileAssociationStatus();
      if (disposed) return;
      if (status?.available === false) {
        associationTooltip = 'Available in the desktop app.';
        return;
      }
      const detail = typeof status?.detail === 'string' && status.detail.trim()
        ? status.detail.trim()
        : null;
      associationTooltip = detail
        || 'Uses your system’s default-app settings for Markdown and text';
    } catch {
      if (!disposed) {
        associationTooltip = 'Uses your system’s default-app settings for Markdown and text';
      }
    }
  }

  async function refreshSystemSettings() {
    const generation = ++systemRefreshGeneration;
    if (typeof adapters.system?.getProcessInstanceMode !== 'function') {
      systemAvailable = false;
      systemHydrated = true;
      associationTooltip = 'Available in the desktop app.';
      if (!disposed) updateSystemControls();
      return;
    }
    try {
      const mode = await adapters.system.getProcessInstanceMode();
      if (disposed || generation !== systemRefreshGeneration) return;
      systemAvailable = mode?.available !== false;
      systemHydrated = true;
      allowMultipleInstances = mode?.allowMultipleInstances !== false;
      processAllowsMultipleInstances = mode?.processAllowsMultipleInstances !== false;
      instanceRestartRequired = Boolean(mode?.restartRequired)
        || allowMultipleInstances !== processAllowsMultipleInstances;
      if (systemAvailable) await refreshAssociationStatus();
      else associationTooltip = 'Available in the desktop app.';
    } catch {
      if (disposed || generation !== systemRefreshGeneration) return;
      systemAvailable = false;
      systemHydrated = true;
      associationTooltip = 'Available in the desktop app.';
    }
    if (!disposed && generation === systemRefreshGeneration) updateSystemControls();
  }

  async function toggleAllowMultipleInstances() {
    if (disposed) return;
    if (!systemAvailable || typeof adapters.system?.setAllowMultipleInstances !== 'function') {
      hooks.onToast?.(
        systemHydrated
          ? 'Multiple instances is available in the desktop app'
          : 'System settings are still loading'
      );
      return;
    }
    const next = !allowMultipleInstances;
    const toggle = elements.allowMultipleInstancesToggle;
    if (toggle) toggle.disabled = true;
    try {
      await adapters.system.setAllowMultipleInstances(next);
      if (disposed) return;
      allowMultipleInstances = next;
      instanceRestartRequired = allowMultipleInstances !== processAllowsMultipleInstances;
      updateSystemControls();
      if (instanceRestartRequired) {
        hooks.onToast?.(
          next
            ? 'Multiple instances on — restart open.md to apply'
            : 'Single instance on — restart open.md to apply'
        );
      } else {
        hooks.onToast?.(next ? 'Multiple instances on' : 'Single instance on');
      }
    } catch (error) {
      if (disposed) return;
      hooks.onDiagnostic?.('Could not change multiple-instances setting', error);
      hooks.onToast?.('Could not change multiple instances');
      // Re-sync from disk after a failed write so the switch matches truth.
      await refreshSystemSettings();
    } finally {
      if (!disposed) updateSystemControls();
    }
  }

  async function requestFileAssociation() {
    if (disposed) return;
    if (!systemAvailable || typeof adapters.system?.requestFileAssociation !== 'function') {
      hooks.onToast?.(
        systemHydrated
          ? 'File associations are available in the desktop app'
          : 'System settings are still loading'
      );
      return;
    }
    const button = elements.fileAssociationButton;
    if (button) button.disabled = true;
    try {
      const result = await adapters.system.requestFileAssociation();
      if (disposed) return;
      const detail = typeof result?.detail === 'string' && result.detail.trim()
        ? result.detail.trim()
        : null;
      if (result?.outcome === 'opened_settings') {
        hooks.onToast?.(detail || 'Opened system default-app settings');
      } else if (result?.outcome === 'set_default') {
        hooks.onToast?.(detail || 'Set open.md as the default for Markdown and text');
      } else {
        hooks.onToast?.(detail || 'File association updated');
      }
      await refreshAssociationStatus();
    } catch (error) {
      if (disposed) return;
      hooks.onDiagnostic?.('Could not set file associations', error);
      const message = typeof error?.message === 'string' && error.message.trim()
        ? error.message.trim()
        : 'Could not set file associations';
      hooks.onToast?.(message);
    } finally {
      if (!disposed) updateSystemControls();
    }
  }

  async function setAdvancedPref(key, value) {
    if (disposed || typeof adapters.preferences?.update !== 'function') return;
    const result = await adapters.preferences.update({ advanced: { [key]: value } });
    hooks.onPreferenceResult?.(result);
    updateAdvancedControls();
  }

  function updateReadingToolControls() {
    const available = isDocumentAvailable();
    const hasActiveTool = available && [
      'lineGuide',
      'minimap',
      'stats',
      'wordWrap',
      'coloredHeadings',
      'blockEditor',
    ]
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
    body.classList.toggle('is-colored-headings', available && state.readingTools.coloredHeadings);
    body.classList.toggle('is-block-editor', available && Boolean(state.readingTools.blockEditor));
    updateReadingToolControls();
    applyEdgeFade();
    hooks.onReadingToolsApplied?.({ ...state.readingTools, sourceActive });
  }

  function refresh() {
    if (disposed) return;
    applyReadingTools();
    updateAutoSaveControl();
    updateAlwaysOnTopControl();
    applyFontPreferences();
    updateAdvancedControls();
  }

  function applySnapshot(nextSnapshot) {
    if (disposed) return;
    const next = snapshotValue(nextSnapshot);
    Object.assign(state, next, {
      readingTools: { ...next.readingTools },
      fonts: { ...next.fonts },
      advanced: { ...next.advanced },
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
    hooks.onToast?.(`${kind === 'sans' ? 'Text font' : 'Monospaced font'}: ${presets[currentIndex].name}`);
  }

  async function setReadingTool(tool, nextValue) {
    if (disposed || !Object.hasOwn(DEFAULT_READING_TOOLS, tool) || !isDocumentAvailable()) return;
    const next = Boolean(nextValue);
    if (state.readingTools[tool] === next || typeof adapters.preferences?.update !== 'function') return;

    const sourceGeneration = tool === 'source' ? ++sourceChangeGeneration : null;
    const documentIdentity = tool === 'source' ? adapters.getDocumentIdentity?.() : null;
    const isCurrentSourceChange = () => (
      !disposed
      && sourceGeneration === sourceChangeGeneration
      && (
        typeof adapters.getDocumentIdentity !== 'function'
        || Object.is(adapters.getDocumentIdentity(), documentIdentity)
      )
    );
    const hasScrollSnapshot = tool === 'source'
      && typeof hooks.captureScrollPosition === 'function';
    const scrollPosition = hasScrollSnapshot
      ? hooks.captureScrollPosition()
      : undefined;

    const result = await adapters.preferences.update({ readingTools: { [tool]: next } });
    if (disposed || (tool === 'source' && !isCurrentSourceChange())) return false;
    // Apply the returned snapshot immediately so presentation adapters
    // (isBlockEditor) never read a stale readingTools map.
    if (result?.snapshot) {
      Object.assign(state, snapshotValue(result.snapshot), {
        readingTools: { ...snapshotValue(result.snapshot).readingTools },
        fonts: { ...snapshotValue(result.snapshot).fonts },
        advanced: { ...snapshotValue(result.snapshot).advanced },
      });
      applyReadingTools();
    }
    hooks.onPreferenceResult?.(result);
    if (tool === 'source') {
      if (pendingSourceFrame?.id != null) {
        window.cancelAnimationFrame?.(pendingSourceFrame.id);
      }
      const frame = { id: null };
      pendingSourceFrame = frame;
      frame.id = window.requestAnimationFrame?.(() => {
        if (pendingSourceFrame === frame) pendingSourceFrame = null;
        if (!isCurrentSourceChange()) return;
        if (hasScrollSnapshot) hooks.restoreScrollPosition?.(scrollPosition);
        (next ? elements.sourceView : elements.content)?.focus?.({ preventScroll: true });
      }) ?? null;
    }

    const labels = {
      lineGuide: 'Line guide',
      minimap: 'Minimap',
      source: 'Source view',
      stats: 'Reading stats',
      wordWrap: 'Word wrap',
      coloredHeadings: 'Heading colors',
      blockEditor: 'Block editor',
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

  function themeSelect() {
    return elements.themeField?.querySelector?.('select')
      || elements.themeSelect
      || document.getElementById('theme-select');
  }

  function openThemeSelect(select) {
    if (!select) return;
    if (typeof select.showPicker === 'function') {
      try {
        select.showPicker();
        return;
      } catch {
        // showPicker can reject without a trusted gesture; fall through.
      }
    }
    select.focus({ preventScroll: true });
    select.click();
  }

  function handleThemeFieldClick(event) {
    if (event.ctrlKey || event.metaKey) {
      // Ctrl+click on the theme row cycles like T without opening the native select.
      if (event.target?.closest?.('select')) {
        event.preventDefault();
      }
      event.preventDefault();
      event.stopPropagation();
      hooks.cycleTheme?.(event.shiftKey ? -1 : 1);
      return;
    }

    const select = themeSelect();
    if (!select) return;
    // Native select already handles clicks on itself.
    if (event.target === select || select.contains?.(event.target)) return;
    event.preventDefault();
    openThemeSelect(select);
  }

  function start() {
    if (disposed || started) return;
    started = true;
    // Ensure advanced pane participates in the slide deck (no hard hidden swap).
    if (elements.advancedOptionsPanel) {
      elements.advancedOptionsPanel.hidden = false;
      elements.advancedOptionsPanel.toggleAttribute('inert', true);
      elements.advancedOptionsPanel.setAttribute('aria-hidden', 'true');
    }
    if (elements.basicOptionsPanel) {
      elements.basicOptionsPanel.hidden = false;
      elements.basicOptionsPanel.toggleAttribute('inert', false);
      elements.basicOptionsPanel.setAttribute('aria-hidden', 'false');
    }
    listen(elements.readingToolsButton, 'click', () => setReadingToolsOpen(!readingToolsOpen));
    listen(elements.themeField, 'click', handleThemeFieldClick);
    listen(elements.alwaysOnTopButton, 'click', () => { void toggleAlwaysOnTop(); });
    listen(elements.autoSaveToggle, 'click', () => { void toggleAutoSave(); });
    listen(elements.advancedOptionsButton, 'click', () => setAdvancedOpen(!advancedOpen));
    listen(elements.advancedBackButton, 'click', () => setAdvancedOpen(false, { returnFocus: true }));
    elements.readingToolToggles?.forEach((toggle) => {
      listen(toggle, 'click', () => {
        void setReadingTool(toggle.dataset.readingTool, toggle.getAttribute('aria-checked') !== 'true');
      });
    });
    elements.advancedToggles?.forEach((toggle) => {
      listen(toggle, 'click', () => {
        const key = toggle.dataset.advancedPref;
        if (!key) return;
        void setAdvancedPref(key, toggle.getAttribute('aria-checked') !== 'true');
      });
    });
    listen(elements.imageDefaultZoomSelect, 'change', (event) => {
      void setAdvancedPref('imageDefaultZoom', event.target.value === '100%' ? '100%' : 'fit');
    });
    listen(elements.csvRowCapInput, 'change', (event) => {
      void setAdvancedPref('csvRowCap', Number(event.target.value));
    });
    listen(elements.allowMultipleInstancesToggle, 'click', () => {
      void toggleAllowMultipleInstances();
    });
    listen(elements.fileAssociationButton, 'click', () => {
      void requestFileAssociation();
    });
    elements.fontButtons?.forEach((button) => {
      listen(button, 'click', () => { void cycleFont(button.dataset.fontKind); });
    });
    listen(document, 'pointerdown', (event) => {
      if (readingToolsOpen && !elements.readingToolsShell?.contains(event.target)) setReadingToolsOpen(false);
    });
    refresh();
    void refreshSystemSettings();
  }

  return Object.freeze({
    start,
    applySnapshot,
    refresh,
    refreshSystemSettings,
    closeTransient,
    setReadingToolsOpen,
    setAdvancedOpen,
    setReadingTool,
    setAdvancedPref,
    cycleFont,
    toggleAutoSave,
    toggleAlwaysOnTop,
    toggleAllowMultipleInstances,
    requestFileAssociation,
    applyEdgeFade,
    isReadingToolsOpen: () => readingToolsOpen,
    isAdvancedOpen: () => advancedOpen,
    current: () => ({
      ...state,
      readingTools: { ...state.readingTools },
      fonts: { ...state.fonts },
      advanced: { ...state.advanced },
      allowMultipleInstances,
      processAllowsMultipleInstances,
      instanceRestartRequired,
      readingToolsOpen,
      advancedOpen,
    }),
    dispose() {
      if (disposed) return;
      closeTransient();
      disposed = true;
      sourceChangeGeneration += 1;
      systemRefreshGeneration += 1;
      if (pendingSourceFrame?.id != null) {
        window.cancelAnimationFrame?.(pendingSourceFrame.id);
      }
      pendingSourceFrame = null;
      unlisteners.splice(0).forEach((unlisten) => unlisten());
    },
  });
}
