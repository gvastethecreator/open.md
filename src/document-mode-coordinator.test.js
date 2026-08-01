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
    <button id="mode"><i></i></button><span id="label"></span>
    <main id="read"></main><pre id="source"></pre><section id="edit"></section>
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
      control: dom.window.document.querySelector('#mode'),
      label: dom.window.document.querySelector('#label'),
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
  const calls = [];
  const toasts = [];
  const coordinator = createDocumentModeCoordinator({
    window: view.dom.window,
    document: view.dom.window.document,
    elements: view.elements,
    adapters: {
      getMode: () => mode,
      isAvailable: () => available,
      enterEdit: async () => {
        calls.push('enter');
        if (enterGate) await enterGate;
        mode = 'edit';
        return true;
      },
      exitEdit: () => {
        calls.push('exit');
        if (!allowExit) return false;
        mode = 'read';
        return true;
      },
      setSource: async (active) => {
        calls.push(`source:${active}`);
        mode = active ? 'source' : 'read';
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
  };
}

describe('Document Mode Coordinator', () => {
  it('owns Read -> Edit -> Source -> Read order and refreshes the control', async () => {
    const harness = createHarness({ reduced: true });
    harness.coordinator.refresh();
    expect(harness.elements.control.dataset.mode).toBe('read');

    await harness.coordinator.cycle();
    expect(harness.mode()).toBe('edit');
    expect(harness.elements.label.textContent).toBe('Edit mode');
    await harness.coordinator.cycle();
    expect(harness.mode()).toBe('source');
    await harness.coordinator.cycle();
    expect(harness.mode()).toBe('read');
    expect(harness.calls).toEqual([
      'close-ui', 'cancel-theme', 'enter',
      'close-ui', 'cancel-theme', 'exit', 'source:true',
      'close-ui', 'cancel-theme', 'source:false',
    ]);
    expect(harness.toasts).toEqual(['Edit mode', 'Source mode', 'Read mode']);
  });

  it('does not toast when a mode change is blocked', async () => {
    const harness = createHarness({ reduced: true });
    harness.setAvailable(false);
    await expect(harness.coordinator.cycle()).resolves.toBe(false);
    expect(harness.toasts).toEqual([]);

    harness.setAvailable(true);
    harness.setMode('edit');
    harness.setAllowExit(false);
    await expect(harness.coordinator.cycle()).resolves.toBe(false);
    expect(harness.mode()).toBe('edit');
    expect(harness.toasts).toEqual([]);
  });

  it('freezes mode tooltip copy through intermediate cycle states', async () => {
    const enterGate = deferred();
    const harness = createHarness({ reduced: true, enterGate: enterGate.promise });
    harness.coordinator.refresh();
    expect(harness.elements.control.dataset.tooltip).toBe('Read');

    const change = harness.coordinator.cycle();
    // Let performChange mark cycling=true before intermediate refreshes land.
    await Promise.resolve();
    await Promise.resolve();
    // Simulate editor/state refreshes that observe intermediate modes mid-cycle.
    harness.setMode('edit');
    harness.coordinator.refresh();
    expect(harness.elements.control.dataset.tooltip).toBe('Read');

    enterGate.resolve();
    await change;
    expect(harness.mode()).toBe('edit');
    expect(harness.elements.control.dataset.tooltip).toBe('Edit');
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
          mode = 'read';
          scrollPosition = 0;
          return true;
        },
        setSource: (active) => {
          mode = active ? 'source' : 'read';
          scrollPosition = 0;
        },
      },
      hooks: {
        captureScrollPosition: () => scrollPosition,
        restoreScrollPosition: (value) => { scrollPosition = value; },
      },
    });

    await coordinator.cycle();
    expect(mode).toBe('edit');
    expect(scrollPosition).toBe(320);

    scrollPosition = 480;
    await coordinator.cycle();
    expect(mode).toBe('source');
    expect(scrollPosition).toBe(480);

    await coordinator.cycle();
    expect(mode).toBe('read');
    expect(scrollPosition).toBe(480);
  });

  it('keeps the mode stable when dirty edit exit is canceled', async () => {
    const harness = createHarness({ reduced: true });
    harness.setMode('edit');
    harness.setAllowExit(false);

    await expect(harness.coordinator.cycle()).resolves.toBe(false);
    expect(harness.mode()).toBe('edit');
    expect(harness.calls).not.toContain('source:true');
    expect(harness.elements.control.dataset.mode).toBe('edit');
  });

  it('toggles Source to Edit and Edit to Read without visiting Source on exit', async () => {
    const harness = createHarness({ reduced: true });
    harness.setMode('source');
    await harness.coordinator.toggleEdit();
    expect(harness.mode()).toBe('edit');
    expect(harness.calls.slice(-2)).toEqual(['source:false', 'enter']);

    await harness.coordinator.toggleEdit();
    expect(harness.mode()).toBe('read');
    expect(harness.calls.at(-1)).toBe('exit');
  });

  it('does not enter Edit on a replacement document while leaving Source', async () => {
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

    const change = coordinator.toggleEdit();
    await Promise.resolve();
    await Promise.resolve();
    documentIdentity = 'B.md';
    sourceGate.resolve();

    await expect(change).resolves.toBe(false);
    expect(enterEdit).not.toHaveBeenCalled();
    expect(mode).toBe('read');
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

    const first = coordinator.cycle();
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
    await harness.coordinator.cycle();
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
    const first = harness.coordinator.cycle();
    await Promise.resolve();
    const interrupted = harness.transitions.at(-1);
    const second = harness.coordinator.cycle();
    expect(interrupted.skipTransition).toHaveBeenCalledOnce();
    active.resolve();
    await Promise.all([first, second]);
    expect(harness.mode()).toBe('read');
  });

  it('animates fallback chrome, honors reduced motion and disposes every marker', async () => {
    const animated = createHarness();
    await animated.coordinator.cycle();
    await new Promise((resolve) => animated.dom.window.setTimeout(resolve, 2));
    expect(animated.elements.editSurface.classList.contains('is-mode-morph-entering')).toBe(true);
    expect(animated.elements.lineGutter.classList.contains('is-mode-chrome-morphing')).toBe(false);
    expect(animated.elements.minimap.classList.contains('is-mode-chrome-morphing')).toBe(true);
    animated.coordinator.dispose();
    expect(animated.dom.window.document.querySelector('.is-mode-morph-entering')).toBeNull();
    expect(animated.dom.window.document.querySelector('.is-mode-chrome-morphing')).toBeNull();
    expect(animated.dom.window.document.body.classList.contains('is-mode-morphing')).toBe(false);

    const reduced = createHarness({ reduced: true });
    await reduced.coordinator.cycle();
    expect(reduced.dom.window.document.querySelector('.is-mode-morph-entering')).toBeNull();
    expect(reduced.calls).toContain('cancel-theme');
    reduced.setAvailable(false);
    reduced.coordinator.refresh();
    expect(reduced.elements.control.disabled).toBe(true);
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
    await coordinator.cycle();
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
    await fallbackCoordinator.cycle();
    expect(animateFallback).toHaveBeenCalledOnce();
  });

  it.each([false, true])('does not restore stale morph markers after async cancellation (view transition: %s)', async (viewTransitions) => {
    const gate = deferred();
    const harness = createHarness({ viewTransitions, enterGate: gate.promise });
    const change = harness.coordinator.cycle();
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
