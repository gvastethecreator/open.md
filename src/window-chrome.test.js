import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { createWindowChrome } from './window-chrome.js';

function createFixture() {
  const dom = new JSDOM(`<!doctype html><body>
    <button id="minimize"></button>
    <button id="maximize"><i></i></button>
    <button id="close"></button>
  </body>`);
  return {
    window: dom.window,
    document: dom.window.document,
    elements: {
      minimize: dom.window.document.querySelector('#minimize'),
      maximize: dom.window.document.querySelector('#maximize'),
      close: dom.window.document.querySelector('#close'),
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Window Chrome', () => {
  it('owns native actions, maximize presentation and listener disposal', async () => {
    const fixture = createFixture();
    let maximized = false;
    let resized;
    const unlisten = vi.fn();
    const nativeWindow = {
      isMaximized: vi.fn(async () => maximized),
      minimize: vi.fn(async () => {}),
      toggleMaximize: vi.fn(async () => { maximized = !maximized; }),
      close: vi.fn(async () => {}),
      onResized: vi.fn(async (listener) => { resized = listener; return unlisten; }),
    };
    const chrome = createWindowChrome({
      document: fixture.document,
      elements: fixture.elements,
      nativeWindow,
    });

    await chrome.start();
    expect(fixture.elements.maximize.getAttribute('aria-label')).toBe('Maximize');
    expect(fixture.elements.maximize.querySelector('i').className).toBe('iconoir-square');

    fixture.elements.minimize.click();
    fixture.elements.maximize.click();
    await settle();
    expect(nativeWindow.minimize).toHaveBeenCalledOnce();
    expect(fixture.elements.maximize.getAttribute('aria-label')).toBe('Restore');
    expect(fixture.document.body.classList.contains('is-window-maximized')).toBe(true);

    maximized = false;
    await resized();
    expect(fixture.elements.maximize.getAttribute('aria-label')).toBe('Maximize');

    chrome.dispose();
    fixture.elements.close.click();
    await settle();
    expect(nativeWindow.close).not.toHaveBeenCalled();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('reports native action failures through one error hook', async () => {
    const fixture = createFixture();
    const failure = new Error('blocked');
    const onError = vi.fn();
    const chrome = createWindowChrome({
      document: fixture.document,
      elements: fixture.elements,
      nativeWindow: {
        isMaximized: vi.fn(async () => false),
        minimize: vi.fn(async () => { throw failure; }),
        toggleMaximize: vi.fn(async () => {}),
        close: vi.fn(async () => {}),
        onResized: vi.fn(async () => vi.fn()),
      },
      onError,
    });

    await chrome.start();
    fixture.elements.minimize.click();
    await settle();
    expect(onError).toHaveBeenCalledWith('Could not minimize the window', failure);
  });
});
