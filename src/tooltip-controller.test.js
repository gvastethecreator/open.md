import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTooltipController } from './tooltip-controller.js';

function fixture({ reduced = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><button id="one" title="First action">One</button><button id="two" title="Second action" aria-describedby="hint">Two</button><span id="hint">Hint</span></body></html>');
  const { document } = dom.window;
  dom.window.matchMedia = () => ({ matches: reduced });
  dom.window.requestAnimationFrame = (callback) => dom.window.setTimeout(() => callback(16), 0);
  dom.window.cancelAnimationFrame = (id) => dom.window.clearTimeout(id);
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 500 });
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 400 });
  const onDiagnostic = vi.fn();
  const controller = createTooltipController({
    window: dom.window,
    document,
    hooks: { onDiagnostic },
  });
  controller.start();
  const tooltip = controller.element();
  tooltip.getBoundingClientRect = () => ({ left: 10, top: 0, right: 130, bottom: 30, width: 120, height: 30 });
  document.querySelector('#one').getBoundingClientRect = () => ({ left: 20, top: 40, right: 60, bottom: 64, width: 40, height: 24 });
  document.querySelector('#two').getBoundingClientRect = () => ({ left: 440, top: 340, right: 480, bottom: 364, width: 40, height: 24 });
  return { dom, document, controller, tooltip, onDiagnostic };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Tooltip Controller', () => {
  it('migrates native titles and exposes a custom keyboard tooltip with preserved descriptions', () => {
    const view = fixture({ reduced: true });
    const two = view.document.querySelector('#two');
    expect(view.document.querySelectorAll('[title]')).toHaveLength(0);
    expect(two.dataset.tooltip).toBe('Second action');

    two.dispatchEvent(new view.dom.window.FocusEvent('focusin', { bubbles: true }));
    expect(view.tooltip.hidden).toBe(false);
    expect(view.tooltip.querySelector('.app-tooltip-message:not(.app-tooltip-message--previous) .app-tooltip-text')?.textContent)
      .toBe('Second action');
    expect(two.getAttribute('aria-describedby')).toBe('hint app-tooltip');
    expect(view.tooltip.dataset.side).toBe('top');

    view.document.dispatchEvent(new view.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(view.tooltip.hidden).toBe(true);
    expect(two.getAttribute('aria-describedby')).toBe('hint');
  });

  it('uses a delayed first hover and fast stable-shell retargeting between controls', async () => {
    vi.useFakeTimers();
    const view = fixture({ reduced: true });
    const one = view.document.querySelector('#one');
    const two = view.document.querySelector('#two');
    one.dispatchEvent(new view.dom.window.MouseEvent('pointerover', { bubbles: true, clientX: 30, clientY: 50 }));
    expect(view.tooltip.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(419);
    expect(view.tooltip.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(view.tooltip.hidden).toBe(false);
    expect(view.tooltip.querySelector('.app-tooltip-text')?.textContent).toBe('First action');

    one.dispatchEvent(new view.dom.window.MouseEvent('pointerout', {
      bubbles: true,
      relatedTarget: two,
      clientX: 450,
      clientY: 350,
    }));
    two.dispatchEvent(new view.dom.window.MouseEvent('pointerover', {
      bubbles: true,
      relatedTarget: one,
      clientX: 450,
      clientY: 350,
    }));
    await vi.advanceTimersByTimeAsync(40);
    expect(view.tooltip.querySelector('.app-tooltip-text')?.textContent).toBe('Second action');
  });

  it('keeps the open shell when the pointer leaves into the trigger safe-zone', async () => {
    vi.useFakeTimers();
    const view = fixture({ reduced: true });
    const one = view.document.querySelector('#one');
    one.dispatchEvent(new view.dom.window.MouseEvent('pointerover', { bubbles: true, clientX: 30, clientY: 50 }));
    await vi.advanceTimersByTimeAsync(420);
    expect(view.tooltip.hidden).toBe(false);

    one.dispatchEvent(new view.dom.window.MouseEvent('pointerout', {
      bubbles: true,
      relatedTarget: view.document.body,
      clientX: 30,
      clientY: 34,
    }));
    await vi.advanceTimersByTimeAsync(140);
    expect(view.tooltip.hidden).toBe(false);
  });

  it('swaps label copy without hiding the shell', async () => {
    const view = fixture({ reduced: true });
    const dynamic = view.document.createElement('button');
    dynamic.title = 'Dynamic action';
    dynamic.getBoundingClientRect = () => ({ left: 100, top: 100, right: 140, bottom: 124, width: 40, height: 24 });
    view.document.body.append(dynamic);
    await Promise.resolve();
    await Promise.resolve();

    dynamic.dispatchEvent(new view.dom.window.FocusEvent('focusin', { bubbles: true }));
    const shell = view.tooltip;
    expect(shell.hidden).toBe(false);

    dynamic.dataset.tooltip = 'Updated action';
    // MutationObserver (microtask) then rAF coalesce (setTimeout 0 stub).
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => view.dom.window.setTimeout(resolve, 0));

    expect(view.tooltip).toBe(shell);
    expect(view.tooltip.hidden).toBe(false);
    expect(view.tooltip.querySelector('.app-tooltip-message:not(.app-tooltip-message--previous) .app-tooltip-text')?.textContent)
      .toBe('Updated action');
    expect(view.tooltip.dataset.state).toBe('open');
    expect(view.controller.current()).toBe(dynamic);
  });

  it('morphs content with shell opacity locked and text-layer fades only', async () => {
    const view = fixture({ reduced: false });
    const calls = [];
    const animate = (target, keyframes, options) => {
      const animation = {
        target,
        keyframes,
        options,
        finished: Promise.resolve(),
        cancel: vi.fn(),
      };
      calls.push(animation);
      return animation;
    };
    view.tooltip.animate = (keyframes, options) => animate(view.tooltip, keyframes, options);
    view.tooltip.querySelectorAll('.app-tooltip-message').forEach((node) => {
      node.animate = (keyframes, options) => animate(node, keyframes, options);
    });

    const mode = view.document.createElement('button');
    mode.dataset.tooltip = 'Read';
    mode.dataset.tooltipShortcut = 'Ctrl+Shift+E';
    mode.getBoundingClientRect = () => ({ left: 100, top: 100, right: 140, bottom: 124, width: 40, height: 24 });
    view.document.body.append(mode);

    mode.dispatchEvent(new view.dom.window.FocusEvent('focusin', { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
    const afterOpen = calls.length;

    mode.dataset.tooltip = 'Edit';
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => view.dom.window.setTimeout(resolve, 0));

    expect(view.tooltip.hidden).toBe(false);
    expect(view.tooltip.dataset.state).toBe('open');
    expect(view.tooltip.querySelector('.app-tooltip-message:not(.app-tooltip-message--previous) .app-tooltip-text')?.textContent)
      .toBe('Edit');

    const morphCalls = calls.slice(afterOpen);
    const shellMorph = morphCalls.find((entry) => entry.target === view.tooltip
      && entry.keyframes?.some?.((frame) => Object.hasOwn(frame, 'width')));
    expect(shellMorph).toBeTruthy();
    expect(shellMorph.keyframes.every((frame) => frame.opacity === 1)).toBe(true);

    const textFades = morphCalls.filter((entry) => entry.target !== view.tooltip);
    expect(textFades.length).toBeGreaterThanOrEqual(1);
    expect(morphCalls.some((entry) => (
      entry.target === view.tooltip
      && entry.keyframes?.[0]?.opacity === 0
      && String(entry.keyframes?.[0]?.transform || '').includes('scale')
    ))).toBe(false);
  });

  it('renders shortcut chips from data-tooltip-shortcut and trailing title shortcuts', async () => {
    const view = fixture({ reduced: true });
    const mode = view.document.createElement('button');
    mode.dataset.tooltip = 'Edit';
    mode.dataset.tooltipShortcut = 'Ctrl+Shift+E';
    mode.getBoundingClientRect = () => ({ left: 80, top: 80, right: 120, bottom: 104, width: 40, height: 24 });
    view.document.body.append(mode);

    mode.dispatchEvent(new view.dom.window.FocusEvent('focusin', { bubbles: true }));
    expect(view.tooltip.querySelector('.app-tooltip-text')?.textContent).toBe('Edit');
    expect([...view.tooltip.querySelectorAll('.app-tooltip-message:not(.app-tooltip-message--previous) kbd')]
      .map((node) => node.textContent)).toEqual(['Ctrl', 'Shift', 'E']);

    const open = view.document.createElement('button');
    open.title = 'Open file (Ctrl+O)';
    open.getBoundingClientRect = () => ({ left: 160, top: 80, right: 200, bottom: 104, width: 40, height: 24 });
    view.document.body.append(open);
    await Promise.resolve();
    await Promise.resolve();
    open.dispatchEvent(new view.dom.window.FocusEvent('focusin', { bubbles: true }));
    expect(view.tooltip.querySelector('.app-tooltip-text')?.textContent).toBe('Open file');
    expect([...view.tooltip.querySelectorAll('.app-tooltip-message:not(.app-tooltip-message--previous) kbd')]
      .map((node) => node.textContent)).toEqual(['Ctrl', 'O']);
  });

  it('does not dismiss on pointerdown of the active tooltip control', async () => {
    vi.useFakeTimers();
    const view = fixture({ reduced: true });
    const one = view.document.querySelector('#one');
    one.dispatchEvent(new view.dom.window.MouseEvent('pointerover', { bubbles: true, clientX: 30, clientY: 50 }));
    await vi.advanceTimersByTimeAsync(420);
    expect(view.tooltip.hidden).toBe(false);

    one.dispatchEvent(new view.dom.window.MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: 30,
      clientY: 50,
    }));
    expect(view.tooltip.hidden).toBe(false);

    view.document.body.dispatchEvent(new view.dom.window.MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      clientX: 200,
      clientY: 200,
    }));
    expect(view.tooltip.hidden).toBe(true);
  });

  it('ignores scroll dismiss while the pointer remains over the active control', async () => {
    vi.useFakeTimers();
    const view = fixture({ reduced: true });
    const one = view.document.querySelector('#one');
    one.dispatchEvent(new view.dom.window.MouseEvent('pointerover', { bubbles: true, clientX: 30, clientY: 50 }));
    await vi.advanceTimersByTimeAsync(420);
    view.document.dispatchEvent(new view.dom.window.Event('scroll', { bubbles: true }));
    expect(view.tooltip.hidden).toBe(false);
  });

  it('removes its stable surface, observer and descriptions on dispose', () => {
    const view = fixture({ reduced: true });
    const one = view.document.querySelector('#one');
    one.dispatchEvent(new view.dom.window.FocusEvent('focusin', { bubbles: true }));
    view.controller.dispose();
    expect(view.tooltip.isConnected).toBe(false);
    expect(one.hasAttribute('aria-describedby')).toBe(false);
    expect(view.onDiagnostic).not.toHaveBeenCalled();
  });
});
