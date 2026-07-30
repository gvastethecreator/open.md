import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTooltipController } from './tooltip-controller.js';

function fixture({ reduced = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><body><button id="one" title="First action">One</button><button id="two" title="Second action" aria-describedby="hint">Two</button><span id="hint">Hint</span></body></html>');
  const { document } = dom.window;
  dom.window.matchMedia = () => ({ matches: reduced });
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
  tooltip.getBoundingClientRect = () => ({ left: 0, top: 0, right: 120, bottom: 30, width: 120, height: 30 });
  document.querySelector('#one').getBoundingClientRect = () => ({ left: 20, top: 12, right: 60, bottom: 36, width: 40, height: 24 });
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
    expect(view.tooltip.textContent).toBe('Second action');
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
    one.dispatchEvent(new view.dom.window.MouseEvent('pointerover', { bubbles: true }));
    expect(view.tooltip.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(419);
    expect(view.tooltip.hidden).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(view.tooltip.hidden).toBe(false);
    expect(view.tooltip.textContent).toBe('First action');

    one.dispatchEvent(new view.dom.window.MouseEvent('pointerout', { bubbles: true, relatedTarget: two }));
    two.dispatchEvent(new view.dom.window.MouseEvent('pointerover', { bubbles: true, relatedTarget: one }));
    await vi.advanceTimersByTimeAsync(40);
    expect(view.controller.element()).toBe(view.tooltip);
    expect(view.tooltip.textContent).toBe('Second action');
  });

  it('migrates dynamic titles and refreshes an active tooltip label', async () => {
    const view = fixture({ reduced: true });
    const dynamic = view.document.createElement('button');
    dynamic.title = 'Dynamic action';
    view.document.body.append(dynamic);
    await Promise.resolve();
    await Promise.resolve();
    expect(dynamic.hasAttribute('title')).toBe(false);
    expect(dynamic.dataset.tooltip).toBe('Dynamic action');

    dynamic.getBoundingClientRect = () => ({ left: 100, top: 100, right: 140, bottom: 124, width: 40, height: 24 });
    dynamic.dispatchEvent(new view.dom.window.FocusEvent('focusin', { bubbles: true }));
    dynamic.dataset.tooltip = 'Updated action';
    await Promise.resolve();
    await Promise.resolve();
    expect(view.tooltip.textContent).toBe('Updated action');
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
