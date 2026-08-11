import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { createDocumentModeCoordinator } from './document-mode-coordinator.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture({ reduced = false, viewTransitions = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body class="is-line-guide is-minimap">
    <button id="source-mode"><i></i></button><span id="source-label"></span>
    <button id="edit-mode"><i></i></button><span id="edit-label"></span>
    <main id="read" tabindex="-1"></main><pre id="source" tabindex="-1"></pre><section id="edit"></section>
    <aside id="lines"></aside><aside id="minimap"></aside>
  </body></html>`);
  dom.window.matchMedia = () => ({ matches: reduced });
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(() => callback(16), 0);
  dom.window.cancelAnimationFrame = (id) => dom.window.clearTimeout(id);
  const transitions = [];
  if (viewTransitions) {
    dom.window.document.startViewTransition = vi.fn((update) => {
      const updateCallbackDone = Promise.resolve().then(update);
      const transition = {
        ready: Promise.resolve(),
        updateCallbackDone,
        finished: updateCallbackDone,
        skipTransition: vi.fn(),
      };
      transitions.push(transition);
      return transition;
    });
  }
  return {
    dom,
    transitions,
    elements: {
      sourceControl: dom.window.document.querySelector('#source-mode'),
      sourceLabel: dom.window.document.querySelector('#source-label'),
      editControl: dom.window.document.querySelector('#edit-mode'),
      editLabel: dom.window.document.querySelector('#edit-label'),
      readSurface: dom.window.document.querySelector('#read'),
      sourceSurface: dom.window.document.querySelector('#source'),
      editSurface: dom.window.document.querySelector('#edit'),
      lineGutter: dom.window.document.querySelector('#lines'),
      minimap: dom.window.document.querySelector('#minimap'),
    },
  };
}

function createHarness(options = {}) {
  const { enterGate = null, ...fixtureOptions } = options;
  const view = fixture(fixtureOptions);
  let mode = 'read';
  let available = true;
  let allowExit = true;
  let allowSource = true;
  const calls = [];
  const toasts = [];
  const coordinator = createDocumentModeCoordinator({
    window: view.dom.window,
    document: view.dom.window.document,
    elements: view.elements,
    adapters: {
      getMode: () => mode,
      hasDocument: () => available,
      isAvailable: () => available,
      enterEdit: async () => {
        calls.push('enter');
        if (enterGate) await enterGate;
        mode = mode === 'source' ? 'source-edit' : 'edit';
        return true;
      },
      exitEdit: () => {
        calls.push('exit');
        if (!allowExit) return false;
        mode = mode === 'source-edit' ? 'source' : 'read';
        return true;
      },
      setSource: async (active) => {
        calls.push(`source:${active}`);
        if (!allowSource) return false;
        if (active) mode = mode === 'edit' ? 'source-edit' : 'source';
        else mode = mode === 'source-edit' ? 'edit' : 'read';
        return true;
      },
    },
    hooks: {
      closeTransientUi: () => calls.push('close-ui'),
      cancelCompetingTransition: () => calls.push('cancel-theme'),
      onToast: (message) => toasts.push(message),
    },
  });
  return {
    ...view,
    coordinator,
    calls,
    toasts,
    mode: () => mode,
    setMode: (value) => { mode = value; },
    setAvailable: (value) => { available = value; },
    setAllowExit: (value) => { allowExit = value; },
    setAllowSource: (value) => { allowSource = value; },
  };
}

describe('Document Mode Coordinator', () => {
  it('owns separate Rendered/Source and Read only/Edit controls', async () => {
    const harness = createHarness({ reduced: true });
    harness.coordinator.refresh();
    expect(harness.elements.sourceControl.dataset.mode).toBe('rendered');
    expect(harness.elements.sourceControl.getAttribute('aria-pressed')).toBe('false');
    expect(harness.elements.editControl.dataset.mode).toBe('read-only');
    expect(harness.elements.editControl.getAttribute('aria-pressed')).toBe('false');

    await harness.coordinator.toggleEdit();
    expect(harness.mode()).toBe('edit');
    expect(harness.elements.editLabel.textContent).toBe('Edit mode');
    expect(harness.elements.editControl.getAttribute('aria-pressed')).toBe('true');
    await harness.coordinator.toggleSource();
    expect(harness.mode()).toBe('source-edit');
    expect(harness.elements.sourceControl.getAttribute('aria-pressed')).toBe('true');
    expect(harness.elements.editControl.getAttribute('aria-pressed')).toBe('true');
    await harness.coordinator.toggleSource();
    expect(harness.mode()).toBe('edit');
    await harness.coordinator.toggleEdit();
    expect(harness.mode()).toBe('read');
    expect(harness.dom.window.document.activeElement).toBe(harness.elements.readSurface);
    expect(harness.calls).toEqual([
      'close-ui', 'cancel-theme', 'enter',
      'close-ui', 'cancel-theme', 'source:true',
      'close-ui', 'cancel-theme', 'source:false',
      'close-ui', 'cancel-theme', 'exit',
    ]);
    expect(harness.toasts).toEqual(['Edit mode', 'Source view', 'Rendered view', 'Read only mode']);
  });

  it('moves focus to Source Read after leaving Source Edit', async () => {
    const harness = createHarness({ reduced: true });
    harness.setMode('source-edit');
    harness.coordinator.refresh();

    await harness.coordinator.toggleEdit();

    expect(harness.mode()).toBe('source');
    expect(harness.dom.window.document.activeElement).toBe(harness.elements.sourceSurface);
  });

  it('does not toast when a mode change is blocked', async () => {
    const harness = createHarness({ reduced: true });
    harness.setAvailable(false);
    await expect(harness.coordinator.toggleEdit()).resolves.toBe(false);
    expect(harness.toasts).toEqual([]);

    harness.setAvailable(true);
    harness.setMode('edit');
    harness.setAllowExit(false);
    await expect(harness.coordinator.toggleEdit()).resolves.toBe(false);
    expect(harness.mode()).toBe('edit');
    expect(harness.toasts).toEqual([]);

    harness.setAllowExit(true);
    harness.setAllowSource(false);
    await expect(harness.coordinator.toggleSource()).resolves.toBe(false);
    expect(harness.mode()).toBe('edit');
    expect(harness.toasts).toEqual([]);
  });

  it('projects Source and Edit availability independently', () => {
    const view = fixture({ reduced: true });
    const coordinator = createDocumentModeCoordinator({
      window: view.dom.window,
      document: view.dom.window.document,
      elements: view.elements,
      adapters: {
        getMode: () => 'read',
        hasDocument: () => true,
        isAvailable: (mode) => mode === 'read' || mode === 'source',
      },
    });

    coordinator.refresh();

    expect(view.elements.sourceControl.disabled).toBe(false);
    expect(view.elements.sourceControl.dataset.tooltip).toBe('Rendered');
    expect(view.elements.editControl.disabled).toBe(true);
    expect(view.elements.editControl.dataset.tooltip).toBe('Unavailable for this document');
  });

  it('freezes both tooltips through intermediate mode states', async () => {
    const enterGate = deferred();
    const harness = createHarness({ reduced: true, enterGate: enterGate.promise });
    harness.setMode('source');
    harness.coordinator.refresh();
    expect(harness.elements.sourceControl.dataset.tooltip).toBe('Source');
    expect(harness.elements.editControl.dataset.tooltip).toBe('Read only');

    const change = harness.coordinator.toggleEdit();
    // Let performChange mark the change active before intermediate refreshes land.
    await Promise.resolve();
    await Promise.resolve();
    // Simulate editor/state refreshes while the Source editor is still entering.
    harness.coordinator.refresh();
    expect(harness.mode()).toBe('source');
    expect(harness.elements.sourceControl.dataset.tooltip).toBe('Source');
    expect(harness.elements.editControl.dataset.tooltip).toBe('Read only');

    enterGate.resolve();
    await change;
    expect(harness.mode()).toBe('source-edit');
    expect(harness.elements.sourceControl.dataset.tooltip).toBe('Source');
    expect(harness.elements.editControl.dataset.tooltip).toBe('Edit');
  });

  it('preserves the reader scroll position across Read, Edit and Source', async () => {
    const view = fixture({ reduced: true });
    let mode = 'read';
    let scrollPosition = 320;
    const coordinator = createDocumentModeCoordinator({
      window: view.dom.window,
      document: view.dom.window.document,
      elements: view.elements,
      adapters: {
        getMode: () => mode,
        isAvailable: () => true,
        enterEdit: () => {
          mode = 'edit';
          scrollPosition = 0;
          return true;
        },
        exitEdit: () => {
          mode = mode === 'source-edit' ? 'source' : 'read';
          scrollPosition = 0;
          return true;
        },
        setSource: (active) => {
          if (active) mode = mode === 'edit' ? 'source-edit' : 'source';
          else mode = mode === 'source-edit' ? 'edit' : 'read';
          scrollPosition = 0;
        },
      },
      hooks: {
        captureScrollPosition: () => scrollPosition,
        restoreScrollPosition: (value) => { scrollPosition = value; },
      },
    });

    await coordinator.toggleEdit();
    expect(mode).toBe('edit');
    expect(scrollPosition).toBe(320);

    scrollPosition = 480;
    await coordinator.toggleSource();
    expect(mode).toBe('source-edit');
    expect(scrollPosition).toBe(480);

    await coordinator.toggleEdit();
    expect(mode).toBe('source');
    expect(scrollPosition).toBe(480);
  });

  it('keeps the mode stable when dirty edit exit is canceled', async () => {
    const harness = createHarness({ reduced: true });
    harness.setMode('edit');
    harness.setAllowExit(false);

    await expect(harness.coordinator.toggleEdit()).resolves.toBe(false);
    expect(harness.mode()).toBe('edit');
    expect(harness.calls).not.toContain('source:true');
    expect(harness.elements.editControl.dataset.mode).toBe('edit');
  });

  it('gives Source its own Edit state and returns to Source on exit', async () => {
    const harness = createHarness({ reduced: true });
    harness.setMode('source');
    await harness.coordinator.toggleEdit();
    expect(harness.mode()).toBe('source-edit');
    expect(harness.calls.at(-1)).toBe('enter');
    expect(harness.elements.sourceControl.getAttribute('aria-pressed')).toBe('true');
    expect(harness.elements.editControl.getAttribute('aria-pressed')).toBe('true');

    await harness.coordinator.toggleEdit();
    expect(harness.mode()).toBe('source');
    expect(harness.calls.at(-1)).toBe('exit');
  });

  it('rejects a stale Source Edit completion after the document changes', async () => {
    const view = fixture({ reduced: true });
    const enterGate = deferred();
    let mode = 'source';
    let documentIdentity = 'A.md';
    const enterEdit = vi.fn(async () => {
      await enterGate.promise;
      mode = 'source-edit';
      return true;
    });
    const coordinator = createDocumentModeCoordinator({
      window: view.dom.window,
      document: view.dom.window.document,
      elements: view.elements,
      adapters: {
        getMode: () => mode,
        isAvailable: () => true,
        getDocumentIdentity: () => documentIdentity,
        enterEdit,
      },
    });

    const change = coordinator.toggleEdit();
    await Promise.resolve();
    await Promise.resolve();
    documentIdentity = 'B.md';
    enterGate.resolve();

    await expect(change).resolves.toBe(false);
    expect(enterEdit).toHaveBeenCalledOnce();
    expect(mode).toBe('source-edit');
  });

  it('rejects queued mode actions that were requested for a replaced document', async () => {
    const view = fixture({ reduced: true });
    const sourceGate = deferred();
    let mode = 'source';
    let documentIdentity = 'A.md';
    const enterEdit = vi.fn(() => {
      mode = 'edit';
      return true;
    });
    const coordinator = createDocumentModeCoordinator({
      window: view.dom.window,
      document: view.dom.window.document,
      elements: view.elements,
      adapters: {
        getMode: () => mode,
        isAvailable: () => true,
        getDocumentIdentity: () => documentIdentity,
        setSource: async () => {
          await sourceGate.promise;
          mode = 'read';
        },
        enterEdit,
      },
    });

    const first = coordinator.toggleSource();
    const queued = coordinator.toggleEdit();
    await Promise.resolve();
    await Promise.resolve();
    documentIdentity = 'B.md';
    sourceGate.resolve();

    await expect(first).resolves.toBe(false);
    await expect(queued).resolves.toBe(false);
    expect(enterEdit).not.toHaveBeenCalled();
  });

  it('uses View Transition, skips unchanged transitions and cancels interruption', async () => {
    const harness = createHarness({ viewTransitions: true });
    await harness.coordinator.toggleEdit();
    expect(harness.dom.window.document.startViewTransition).toHaveBeenCalledOnce();
    expect(harness.mode()).toBe('edit');
    expect(harness.dom.window.document.body.classList.contains('is-mode-morphing')).toBe(false);

    const active = deferred();
    harness.dom.window.document.startViewTransition = vi.fn((update) => {
      const updateCallbackDone = Promise.resolve().then(update);
      const transition = {
        ready: active.promise,
        updateCallbackDone,
        finished: active.promise,
        skipTransition: vi.fn(),
      };
      harness.transitions.push(transition);
      return transition;
    });
    const first = harness.coordinator.toggleSource();
    await Promise.resolve();
    const interrupted = harness.transitions.at(-1);
    const second = harness.coordinator.toggleSource();
    expect(interrupted.skipTransition).toHaveBeenCalledOnce();
    active.resolve();
    await Promise.all([first, second]);
    expect(harness.mode()).toBe('edit');
  });

  it('animates fallback chrome, honors reduced motion and disposes every marker', async () => {
    const animated = createHarness();
    await animated.coordinator.toggleEdit();
    await new Promise((resolve) => animated.dom.window.setTimeout(resolve, 2));
    expect(animated.elements.editSurface.classList.contains('is-mode-morph-entering')).toBe(true);
    expect(animated.elements.lineGutter.classList.contains('is-mode-chrome-morphing')).toBe(false);
    expect(animated.elements.minimap.classList.contains('is-mode-chrome-morphing')).toBe(true);
    animated.coordinator.dispose();
    expect(animated.dom.window.document.querySelector('.is-mode-morph-entering')).toBeNull();
    expect(animated.dom.window.document.querySelector('.is-mode-chrome-morphing')).toBeNull();
    expect(animated.dom.window.document.body.classList.contains('is-mode-morphing')).toBe(false);

    const reduced = createHarness({ reduced: true });
    await reduced.coordinator.toggleEdit();
    expect(reduced.dom.window.document.querySelector('.is-mode-morph-entering')).toBeNull();
    expect(reduced.calls).toContain('cancel-theme');
    reduced.setAvailable(false);
    reduced.coordinator.refresh();
    expect(reduced.elements.sourceControl.disabled).toBe(true);
    expect(reduced.elements.editControl.disabled).toBe(true);
  });

  it('prepares and finishes navigation morph hooks around a mode change', async () => {
    const harness = createHarness({ viewTransitions: true });
    const prepareNavigationMorph = vi.fn();
    const animateNavigationMorph = vi.fn();
    const finishNavigationMorph = vi.fn();
    const syncNavigationChrome = vi.fn();
    const restoreScrollPosition = vi.fn();
    const captureScrollPosition = vi.fn(() => 42);
    const coordinator = createDocumentModeCoordinator({
      window: harness.dom.window,
      document: harness.dom.window.document,
      elements: harness.elements,
      adapters: {
        getMode: harness.mode,
        isAvailable: () => true,
        enterEdit: async () => {
          harness.setMode('edit');
          return true;
        },
        exitEdit: () => {
          harness.setMode('read');
          return true;
        },
        setSource: async (active) => {
          harness.setMode(active ? 'source' : 'read');
        },
      },
      hooks: {
        captureScrollPosition,
        restoreScrollPosition,
        prepareNavigationMorph,
        animateNavigationMorph,
        finishNavigationMorph,
        syncNavigationChrome,
      },
    });
    await coordinator.toggleEdit();
    expect(prepareNavigationMorph).toHaveBeenCalledOnce();
    expect(restoreScrollPosition).toHaveBeenCalledWith(42, { sync: true });
    expect(finishNavigationMorph).toHaveBeenCalled();
    expect(animateNavigationMorph).not.toHaveBeenCalled();
    expect(syncNavigationChrome).not.toHaveBeenCalled();

    const fallback = createHarness();
    const animateFallback = vi.fn();
    const fallbackCoordinator = createDocumentModeCoordinator({
      window: fallback.dom.window,
      document: fallback.dom.window.document,
      elements: fallback.elements,
      adapters: {
        getMode: fallback.mode,
        isAvailable: () => true,
        enterEdit: async () => {
          fallback.setMode('edit');
          return true;
        },
        exitEdit: () => {
          fallback.setMode('read');
          return true;
        },
        setSource: async (active) => {
          fallback.setMode(active ? 'source' : 'read');
        },
      },
      hooks: { animateNavigationMorph: animateFallback },
    });
    await fallbackCoordinator.toggleEdit();
    expect(animateFallback).toHaveBeenCalledOnce();
  });

  it.each([false, true])('does not restore stale morph markers after async cancellation (view transition: %s)', async (viewTransitions) => {
    const gate = deferred();
    const harness = createHarness({ viewTransitions, enterGate: gate.promise });
    const change = harness.coordinator.toggleEdit();
    await Promise.resolve();
    await Promise.resolve();

    harness.coordinator.cancelTransition();
    gate.resolve();
    await change;
    await new Promise((resolve) => harness.dom.window.setTimeout(resolve, 2));

    expect(harness.dom.window.document.body.classList.contains('is-mode-morphing')).toBe(false);
    expect(harness.dom.window.document.body.dataset.modeMorphFrom).toBeUndefined();
    expect(harness.dom.window.document.body.dataset.modeMorphTo).toBeUndefined();
    expect(harness.elements.editSurface.classList.contains('is-mode-morph-entering')).toBe(false);
    expect(harness.elements.minimap.classList.contains('is-mode-chrome-morphing')).toBe(false);
  });
});
