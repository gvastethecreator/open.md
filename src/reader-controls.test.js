import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_READING_TOOLS } from './reader-preferences.js';
import { createReaderControls } from './reader-controls.js';

function deferred() {
  let resolve;
  const promise = new Promise((yes) => { resolve = yes; });
  return { promise, resolve };
}

function fixture({ preferenceGate = null, deferFrames = false, system = null } = {}) {
  const dom = new JSDOM(`<!doctype html><body>
    <button id="tools"></button><div id="tools-shell"><div id="tools-panel"></div></div>
    <label id="theme-field" class="theme-field appearance-theme-field"><select id="theme-select"></select></label>
    <button id="top"></button><button id="auto"></button>
    <button data-font-kind="sans"></button><span id="sans-font-name"></span>
    <button data-font-kind="mono"></button><span id="mono-font-name"></span>
    <button data-reading-tool="lineGuide"></button>
    <button data-reading-tool="minimap"></button>
    <button data-reading-tool="source"></button>
    <button data-reading-tool="stats"></button>
    <button data-reading-tool="wordWrap"></button>
    <button data-advanced-pref="edgeFade" role="switch" aria-checked="true"></button>
    <button id="multi" role="switch" aria-checked="true"></button>
    <button id="assoc" type="button"></button>
    <article id="content"></article><pre id="source"></pre><div id="reader"></div>
  </body>`);
  const frames = new Map();
  let nextFrameId = 1;
  dom.window.requestAnimationFrame = (callback) => {
    const id = nextFrameId++;
    if (deferFrames) frames.set(id, callback);
    else callback();
    return id;
  };
  dom.window.cancelAnimationFrame = (id) => frames.delete(id);
  const document = dom.window.document;
  const elements = {
    readingToolsButton: document.querySelector('#tools'),
    readingToolsShell: document.querySelector('#tools-shell'),
    readingToolsPanel: document.querySelector('#tools-panel'),
    themeField: document.querySelector('#theme-field'),
    alwaysOnTopButton: document.querySelector('#top'),
    autoSaveToggle: document.querySelector('#auto'),
    fontButtons: [...document.querySelectorAll('[data-font-kind]')],
    readingToolToggles: [...document.querySelectorAll('[data-reading-tool]')],
    advancedToggles: [...document.querySelectorAll('[data-advanced-pref]')],
    allowMultipleInstancesToggle: document.querySelector('#multi'),
    fileAssociationButton: document.querySelector('#assoc'),
    content: document.querySelector('#content'),
    sourceView: document.querySelector('#source'),
  };
  let available = true;
  let editMode = false;
  let helpVisible = false;
  let documentIdentity = { path: 'A.md' };
  let preferenceState = {
    themeName: null,
    readingTools: { ...DEFAULT_READING_TOOLS },
    fonts: { sans: 0, mono: 0 },
    alwaysOnTop: false,
    autoSave: true,
    advanced: {
      edgeFade: true,
      imageDefaultZoom: 'fit',
      imageZoomAnimation: true,
      csvRowCap: 500,
      randomThemeAtStart: false,
      pathRemembersTheme: false,
    },
  };
  let applySnapshot;
  const updates = [];
  const hooks = {
    onReadingToolsApplied: vi.fn(),
    onFontsApplied: vi.fn(),
    onAutoSaveApplied: vi.fn(),
    onToast: vi.fn(),
    onPreferenceResult: vi.fn(),
    cycleTheme: vi.fn(),
    captureScrollPosition: vi.fn(() => 140),
    restoreScrollPosition: vi.fn(),
  };
  const preferences = {
    current: () => preferenceState,
    update: vi.fn(async (patch) => {
      updates.push(patch);
      if (preferenceGate) await preferenceGate;
      preferenceState = {
        ...preferenceState,
        ...patch,
        readingTools: { ...preferenceState.readingTools, ...(patch.readingTools || {}) },
        fonts: { ...preferenceState.fonts, ...(patch.fonts || {}) },
        advanced: { ...preferenceState.advanced, ...(patch.advanced || {}) },
      };
      applySnapshot?.(preferenceState);
      return { status: 'applied', snapshot: preferenceState, warnings: [] };
    }),
  };
  const controller = createReaderControls({
    window: dom.window,
    document,
    elements,
    adapters: {
      preferences,
      system,
      isDocumentAvailable: () => available,
      isEditMode: () => editMode,
      getDocumentIdentity: () => documentIdentity,
    },
    hooks: { ...hooks, isHelpVisible: () => helpVisible },
  });
  applySnapshot = controller.applySnapshot;
  return {
    dom,
    document,
    elements,
    controller,
    hooks,
    updates,
    setAvailable: (value) => { available = value; },
    setEditMode: (value) => { editMode = value; },
    setHelp: (value) => { helpVisible = value; },
    replaceDocument: () => { documentIdentity = { path: 'B.md' }; },
    flushFrames: () => {
      const pending = [...frames.values()];
      frames.clear();
      pending.forEach((callback) => callback());
    },
  };
}

describe('Reader Controls', () => {
  it('projects preferences, panels, fonts and document availability', () => {
    const view = fixture();
    view.controller.start();
    view.controller.applySnapshot({
      themeName: 'Github Light',
      readingTools: { lineGuide: true, source: true, wordWrap: false },
      fonts: { sans: 1, mono: 2 },
      alwaysOnTop: true,
      autoSave: false,
    });

    expect(view.document.body.classList.contains('is-source-view')).toBe(true);
    expect(view.document.body.classList.contains('is-line-guide')).toBe(true);
    expect(view.document.body.classList.contains('is-word-wrap')).toBe(false);
    expect(view.document.documentElement.style.getPropertyValue('--font-sans')).toContain('Candara');
    expect(view.elements.alwaysOnTopButton.getAttribute('aria-checked')).toBe('true');
    expect(view.elements.autoSaveToggle.getAttribute('aria-checked')).toBe('false');
    expect(view.elements.readingToolToggles[0].disabled).toBe(false);
    expect(view.hooks.onReadingToolsApplied).toHaveBeenCalled();

    view.setAvailable(false);
    view.controller.refresh();
    expect(view.elements.readingToolToggles[0].disabled).toBe(true);
    expect(view.document.body.classList.contains('is-source-view')).toBe(false);
  });

  it('owns panel open state, help gating and edge fade', async () => {
    const view = fixture();
    view.controller.start();
    view.controller.setReadingToolsOpen(true);
    expect(view.controller.isReadingToolsOpen()).toBe(true);

    view.setHelp(true);
    view.controller.setReadingToolsOpen(true);
    expect(view.controller.isReadingToolsOpen()).toBe(false);

    expect(view.document.body.classList.contains('is-edge-fade-off')).toBe(false);
    await view.controller.setAdvancedPref('edgeFade', false);
    expect(view.document.body.classList.contains('is-edge-fade-off')).toBe(true);

    view.document.body.classList.add('is-image-document');
    view.controller.applyEdgeFade();
    expect(view.document.body.classList.contains('is-edge-fade-off')).toBe(true);
  });

  it('ctrl+clicks theme field like the T shortcut', () => {
    const view = fixture();
    view.controller.start();

    view.elements.themeField.dispatchEvent(new view.dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    }));
    expect(view.hooks.cycleTheme).toHaveBeenNthCalledWith(1, 1);

    view.elements.themeField.dispatchEvent(new view.dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      shiftKey: true,
    }));
    expect(view.hooks.cycleTheme).toHaveBeenNthCalledWith(2, -1);
  });

  it('opens the theme select when the whole theme row is activated', () => {
    const view = fixture();
    const select = view.document.querySelector('#theme-select');
    select.showPicker = vi.fn();
    select.focus = vi.fn();
    select.click = vi.fn();
    view.controller.start();

    view.elements.themeField.dispatchEvent(new view.dom.window.MouseEvent('click', {
      bubbles: true,
      cancelable: true,
    }));
    expect(select.showPicker).toHaveBeenCalledOnce();
    expect(view.hooks.cycleTheme).not.toHaveBeenCalled();
  });

  it('slides between basic and advanced options without hard-hiding panes', () => {
    const view = fixture();
    const basic = view.document.createElement('div');
    basic.id = 'basic-options-panel';
    const advanced = view.document.createElement('div');
    advanced.id = 'advanced-options-panel';
    advanced.hidden = true;
    const deck = view.document.createElement('div');
    deck.id = 'options-deck';
    deck.append(basic, advanced);
    view.elements.readingToolsPanel.append(deck);
    view.elements.basicOptionsPanel = basic;
    view.elements.advancedOptionsPanel = advanced;
    view.elements.optionsDeck = deck;
    view.elements.advancedOptionsButton = view.document.createElement('button');
    view.elements.readingToolsHeaderLabel = view.document.createElement('span');
    view.controller.start();
    view.controller.setReadingToolsOpen(true);

    view.controller.setAdvancedOpen(true);
    expect(view.controller.isAdvancedOpen()).toBe(true);
    expect(view.elements.readingToolsPanel.classList.contains('is-advanced-view')).toBe(true);
    expect(deck.classList.contains('is-advanced-view')).toBe(true);
    expect(basic.hidden).toBe(false);
    expect(advanced.hidden).toBe(false);
    expect(basic.getAttribute('aria-hidden')).toBe('true');
    expect(advanced.getAttribute('aria-hidden')).toBe('false');
    expect(basic.hasAttribute('inert')).toBe(true);
    expect(advanced.hasAttribute('inert')).toBe(false);

    view.controller.setAdvancedOpen(false);
    expect(view.elements.readingToolsPanel.classList.contains('is-advanced-view')).toBe(false);
    expect(deck.classList.contains('is-advanced-view')).toBe(false);
    expect(basic.hasAttribute('inert')).toBe(false);
    expect(advanced.hasAttribute('inert')).toBe(true);
  });

  it('serializes tool and font changes through the preference adapter', async () => {
    const view = fixture();
    view.controller.start();
    await view.controller.setReadingTool('source', true);
    await view.controller.cycleFont('sans');
    await view.controller.toggleAutoSave();

    expect(view.updates).toEqual([
      { readingTools: { source: true } },
      { fonts: { sans: 1 } },
      { autoSave: false },
    ]);
    expect(view.hooks.captureScrollPosition).toHaveBeenCalledOnce();
    expect(view.hooks.restoreScrollPosition).toHaveBeenCalledWith(140);
    expect(view.hooks.onToast).toHaveBeenCalledWith('Source view on');
  });

  it.each(['replacement', 'dispose'])('drops stale Source effects after document %s', async (reason) => {
    const gate = deferred();
    const view = fixture({ preferenceGate: gate.promise, deferFrames: true });
    view.controller.start();
    const change = view.controller.setReadingTool('source', true);

    if (reason === 'replacement') view.replaceDocument();
    else view.controller.dispose();
    gate.resolve();
    await change;
    view.flushFrames();

    expect(view.hooks.restoreScrollPosition).not.toHaveBeenCalled();
    expect(view.hooks.onToast).not.toHaveBeenCalled();
  });

  it('removes its listeners and stops projecting after disposal', () => {
    const view = fixture();
    view.controller.start();
    view.controller.dispose();
    view.elements.readingToolsButton.click();
    expect(view.controller.isReadingToolsOpen()).toBe(false);
    const before = view.elements.readingToolToggles[0].disabled;
    view.setAvailable(false);
    view.controller.refresh();
    expect(view.elements.readingToolToggles[0].disabled).toBe(before);
  });

  it('persists multiple instances through the system adapter and notes restart', async () => {
    let allowMultipleInstances = true;
    const system = {
      getProcessInstanceMode: vi.fn(async () => ({
        allowMultipleInstances,
        processAllowsMultipleInstances: true,
        restartRequired: allowMultipleInstances !== true,
        available: true,
      })),
      setAllowMultipleInstances: vi.fn(async (value) => {
        allowMultipleInstances = value;
        return { allowMultipleInstances: value, applied: 'next_launch' };
      }),
      getFileAssociationStatus: vi.fn(async () => ({
        status: 'registered_not_default',
        platform: 'windows',
        detail: 'Another app is the default for .md.',
        available: true,
      })),
      requestFileAssociation: vi.fn(async () => ({
        outcome: 'opened_settings',
        detail: 'Opened Windows Default apps.',
      })),
    };
    const view = fixture({ system });
    view.controller.start();
    expect(view.elements.allowMultipleInstancesToggle.disabled).toBe(true);
    await view.controller.refreshSystemSettings();
    expect(view.elements.allowMultipleInstancesToggle.disabled).toBe(false);
    expect(view.elements.allowMultipleInstancesToggle.getAttribute('aria-checked')).toBe('true');
    expect(view.elements.fileAssociationButton.dataset.tooltip).toContain('Another app is the default');

    await view.controller.toggleAllowMultipleInstances();
    expect(system.setAllowMultipleInstances).toHaveBeenCalledWith(false);
    expect(view.elements.allowMultipleInstancesToggle.getAttribute('aria-checked')).toBe('false');
    expect(view.hooks.onToast).toHaveBeenCalledWith(
      'Single instance on — restart open.md to apply'
    );

    await view.controller.requestFileAssociation();
    expect(system.requestFileAssociation).toHaveBeenCalledOnce();
    expect(system.getFileAssociationStatus).toHaveBeenCalled();
    expect(view.hooks.onToast).toHaveBeenCalledWith('Opened Windows Default apps.');
  });

  it('keeps system controls disabled while hydrate is in flight', async () => {
    let resolveMode;
    const modePromise = new Promise((resolve) => { resolveMode = resolve; });
    const system = {
      getProcessInstanceMode: vi.fn(() => modePromise),
      getFileAssociationStatus: vi.fn(async () => ({
        status: 'unknown',
        detail: 'Status ready',
        available: true,
      })),
    };
    const view = fixture({ system });
    view.controller.start();
    expect(view.elements.allowMultipleInstancesToggle.disabled).toBe(true);
    expect(view.elements.allowMultipleInstancesToggle.dataset.tooltip).toContain('Loading');
    expect(view.elements.fileAssociationButton.disabled).toBe(true);

    resolveMode({
      allowMultipleInstances: false,
      processAllowsMultipleInstances: false,
      restartRequired: false,
      available: true,
    });
    // Flush the start()-time hydrate plus association status.
    await Promise.resolve();
    await Promise.resolve();
    await view.controller.refreshSystemSettings();
    expect(view.elements.allowMultipleInstancesToggle.disabled).toBe(false);
    expect(view.elements.allowMultipleInstancesToggle.getAttribute('aria-checked')).toBe('false');
    expect(view.elements.fileAssociationButton.dataset.tooltip).toContain('Status ready');
  });

  it('disables system controls when the desktop adapter is unavailable', async () => {
    const view = fixture();
    view.controller.start();
    await view.controller.refreshSystemSettings();
    expect(view.elements.allowMultipleInstancesToggle.disabled).toBe(true);
    expect(view.elements.fileAssociationButton.disabled).toBe(true);
    expect(view.elements.allowMultipleInstancesToggle.dataset.tooltip).toContain('desktop app');

    await view.controller.toggleAllowMultipleInstances();
    expect(view.hooks.onToast).toHaveBeenCalledWith(
      'Multiple instances is available in the desktop app'
    );
  });

  it('ignores system refresh results after dispose', async () => {
    let resolveMode;
    const modePromise = new Promise((resolve) => { resolveMode = resolve; });
    const system = {
      getProcessInstanceMode: vi.fn(() => modePromise),
      getFileAssociationStatus: vi.fn(async () => ({
        status: 'unknown',
        detail: 'late status',
        available: true,
      })),
    };
    const view = fixture({ system });
    view.controller.start();
    const pending = view.controller.refreshSystemSettings();
    view.controller.dispose();
    resolveMode({
      allowMultipleInstances: false,
      processAllowsMultipleInstances: true,
      restartRequired: true,
      available: true,
    });
    await pending;
    expect(view.elements.allowMultipleInstancesToggle.getAttribute('aria-checked')).toBe('true');
    expect(view.elements.allowMultipleInstancesToggle.disabled).toBe(true);
  });
});
