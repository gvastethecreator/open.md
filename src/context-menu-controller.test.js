import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { createContextMenuController } from './context-menu-controller.js';

function fixture() {
  const dom = new JSDOM('<!doctype html><html><body><button id="origin">Origin</button><main id="content"><a href="#notes">Notes</a><p>Body</p></main><aside id="outside">Outside</aside></body></html>');
  const { document } = dom.window;
  dom.window.matchMedia = () => ({ matches: false });
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 500 });
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 400 });
  const onSelect = vi.fn();
  const onDiagnostic = vi.fn();
  const controller = createContextMenuController({
    window: dom.window,
    document,
    resolveContext: ({ target }) => {
      if (!target.closest?.('#content')) return null;
      const isLink = target.closest('a');
      return {
        label: isLink ? 'Link actions' : 'Document actions',
        context: { target },
        items: isLink
          ? [
              { id: 'open', label: 'Open link', icon: 'iconoir-link', onSelect },
              { id: 'copy', label: 'Copy link', icon: 'iconoir-copy', shortcut: 'Ctrl+C', onSelect },
            ]
          : [
              { id: 'copy', label: 'Copy document', onSelect },
              { type: 'separator' },
              { id: 'delete', label: 'Delete', danger: true, onSelect },
            ],
      };
    },
    hooks: { onDiagnostic },
  });
  controller.start();
  controller.element().getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 200,
    bottom: 180,
    width: 200,
    height: 180,
  });
  return { dom, document, controller, onSelect, onDiagnostic };
}

function contextmenu(view, target, x = 80, y = 90) {
  const event = new view.dom.window.MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  target.dispatchEvent(event);
  return event;
}

describe('Context Menu Controller', () => {
  it('renders adaptive actions in one stable menu and invokes the selected item', async () => {
    const view = fixture();
    const menu = view.controller.element();
    const event = contextmenu(view, view.document.querySelector('a'));
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(true);
    expect(menu.hidden).toBe(false);
    expect(menu.getAttribute('aria-label')).toBe('Link actions');
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent)).toEqual([
      'Open link',
      'Copy linkCtrl+C',
    ]);
    expect(view.document.activeElement.dataset.contextAction).toBe('open');

    menu.querySelector('[data-context-action="copy"]').click();
    expect(view.onSelect).toHaveBeenCalledWith(expect.objectContaining({ target: expect.anything() }));
    expect(menu.hidden).toBe(true);
  });

  it('supports wrapped keyboard traversal, Escape, focus return and separators', async () => {
    const view = fixture();
    const origin = view.document.querySelector('#origin');
    origin.focus();
    contextmenu(view, view.document.querySelector('p'));
    await Promise.resolve();
    const menu = view.controller.element();
    expect(menu.querySelectorAll('[role="separator"]')).toHaveLength(1);

    menu.dispatchEvent(new view.dom.window.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }));
    expect(view.document.activeElement.dataset.contextAction).toBe('delete');
    menu.dispatchEvent(new view.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(menu.hidden).toBe(true);
    expect(view.document.activeElement).toBe(origin);
  });

  it('clamps against viewport chrome and leaves unrelated native menus untouched', () => {
    const view = fixture();
    const event = contextmenu(view, view.document.querySelector('p'), 490, 390);
    expect(event.defaultPrevented).toBe(true);
    expect(view.controller.element().style.left).toBe('292px');
    expect(view.controller.element().style.top).toBe('184px');

    const outsideEvent = contextmenu(view, view.document.querySelector('#outside'));
    expect(outsideEvent.defaultPrevented).toBe(false);
    expect(view.controller.element().hidden).toBe(true);
  });

  it('removes its surface and listeners on dispose', () => {
    const view = fixture();
    const menu = view.controller.element();
    view.controller.dispose();
    expect(menu.isConnected).toBe(false);
    const event = contextmenu(view, view.document.querySelector('a'));
    expect(event.defaultPrevented).toBe(false);
    expect(view.onDiagnostic).not.toHaveBeenCalled();
  });
});
