import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_READING_TOOLS } from './reader-preferences.js';
import { createReaderControls } from './reader-controls.js';

function fixture() {
  const dom = new JSDOM(`<!doctype html><body>
    <button id="tools"></button><div id="tools-shell"><div id="tools-panel"></div></div>
    <button id="type"></button><div id="type-shell"><div id="type-panel"></div></div>
    <button id="top"></button><button id="auto"></button>
    <button data-font-kind="sans"></button><span id="sans-font-name"></span>
    <button data-font-kind="mono"></button><span id="mono-font-name"></span>
    <button data-reading-tool="lineGuide"></button>
    <button data-reading-tool="minimap"></button>
    <button data-reading-tool="source"></button>
    <button data-reading-tool="stats"></button>
    <button data-reading-tool="wordWrap"></button>
    <article id="content"></article><pre id="source"></pre><div id="reader"></div>
  </body>`);
  const document = dom.window.document;
  const elements = {
    readingToolsButton: document.querySelector('#tools'),
    readingToolsShell: document.querySelector('#tools-shell'),
    readingToolsPanel: document.querySelector('#tools-panel'),
    typographyButton: document.querySelector('#type'),
    typographyShell: document.querySelector('#type-shell'),
    typographyPanel: document.querySelector('#type-panel'),
    alwaysOnTopButton: document.querySelector('#top'),
    autoSaveToggle: document.querySelector('#auto'),
    fontButtons: [...document.querySelectorAll('[data-font-kind]')],
    readingToolToggles: [...document.querySelectorAll('[data-reading-tool]')],
    content: document.querySelector('#content'),
    sourceView: document.querySelector('#source'),
  };
  let available = true;
  let editMode = false;
  let helpVisible = false;
  let preferenceState = {
    themeName: null,
    readingTools: { ...DEFAULT_READING_TOOLS },
    fonts: { sans: 0, mono: 0 },
    alwaysOnTop: false,
    autoSave: true,
  };
  let applySnapshot;
  const updates = [];
  const hooks = {
    onReadingToolsApplied: vi.fn(),
    onFontsApplied: vi.fn(),
    onAutoSaveApplied: vi.fn(),
    onToast: vi.fn(),
    onPreferenceResult: vi.fn(),
    captureViewScroll: vi.fn(),
    restoreViewScroll: vi.fn(),
  };
  const preferences = {
    current: () => preferenceState,
    update: vi.fn(async (patch) => {
      updates.push(patch);
      preferenceState = {
        ...preferenceState,
        ...patch,
        readingTools: { ...preferenceState.readingTools, ...(patch.readingTools || {}) },
        fonts: { ...preferenceState.fonts, ...(patch.fonts || {}) },
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
      isDocumentAvailable: () => available,
      isEditMode: () => editMode,
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

  it('owns panel exclusivity, focus return and help gating', async () => {
    const view = fixture();
    view.controller.start();
    view.controller.setReadingToolsOpen(true);
    expect(view.controller.isReadingToolsOpen()).toBe(true);
    expect(view.controller.isTypographyOpen()).toBe(false);

    view.controller.setTypographyOpen(true);
    expect(view.controller.isTypographyOpen()).toBe(true);
    expect(view.controller.isReadingToolsOpen()).toBe(false);

    view.controller.setTypographyOpen(false, { returnFocus: true });
    await Promise.resolve();
    expect(view.document.activeElement).toBe(view.elements.typographyButton);

    view.setHelp(true);
    view.controller.setReadingToolsOpen(true);
    expect(view.controller.isReadingToolsOpen()).toBe(false);
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
    expect(view.hooks.captureViewScroll).toHaveBeenCalledWith('read');
    expect(view.hooks.onToast).toHaveBeenCalledWith('Source view on');
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
});
