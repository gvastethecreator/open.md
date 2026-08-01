import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { createReaderViewportController } from './reader-viewport-controller.js';

function fixture() {
  const dom = new JSDOM(`<!doctype html><body>
    <main id="viewport">
      <section id="reader"><article id="content" tabindex="-1"></article><pre id="source" tabindex="-1"></pre></section>
      <section id="help" tabindex="-1"><h1 id="help-title" tabindex="-1">Help</h1></section>
      <section id="document"></section>
      <section id="empty"></section>
    </main>
    <button id="help-toggle"></button>
  </body>`);
  const { document } = dom.window;
  const elements = {
    viewport: document.querySelector('#viewport'),
    readerPage: document.querySelector('#reader'),
    content: document.querySelector('#content'),
    sourceView: document.querySelector('#source'),
    helpStage: document.querySelector('#help'),
    helpTitle: document.querySelector('#help-title'),
    documentStage: document.querySelector('#document'),
    emptyStage: document.querySelector('#empty'),
    helpToggleButton: document.querySelector('#help-toggle'),
  };
  const hooks = {
    onStateChange: vi.fn(),
    onHelpChanged: vi.fn(),
    closeTransientUi: vi.fn(),
  };
  elements.helpStage.scrollTo = vi.fn();
  const controller = createReaderViewportController({
    window: dom.window,
    document,
    elements,
    hooks,
  });
  return { dom, document, elements, hooks, controller };
}

describe('Reader Viewport Controller', () => {
  it('projects empty, reader and source states with stable accessibility flags', () => {
    const view = fixture();

    view.controller.sync({ hasFilePath: false });
    expect(view.elements.emptyStage.classList.contains('hidden')).toBe(false);
    expect(view.elements.documentStage.classList.contains('hidden')).toBe(true);
    expect(view.elements.viewport.dataset.page).toBe('1');

    view.controller.sync({ hasFilePath: true, sourceActive: false });
    expect(view.elements.emptyStage.classList.contains('hidden')).toBe(true);
    expect(view.elements.documentStage.classList.contains('hidden')).toBe(false);
    expect(view.elements.content.classList.contains('hidden')).toBe(false);
    expect(view.elements.sourceView.classList.contains('hidden')).toBe(true);
    expect(view.elements.readerPage.getAttribute('aria-hidden')).toBe('false');

    view.controller.sync({ sourceActive: true });
    expect(view.elements.content.classList.contains('hidden')).toBe(true);
    expect(view.elements.sourceView.classList.contains('hidden')).toBe(false);
  });

  it('owns help projection, scroll reset, transient closing and focus return', async () => {
    const view = fixture();
    view.controller.sync({ hasFilePath: true });
    view.elements.helpToggleButton.focus();

    view.controller.setHelpVisible(true);
    await Promise.resolve();
    expect(view.controller.isHelpVisible()).toBe(true);
    expect(view.elements.viewport.dataset.page).toBe('2');
    expect(view.elements.readerPage.getAttribute('aria-hidden')).toBe('true');
    expect(view.elements.readerPage.hasAttribute('inert')).toBe(true);
    expect(view.elements.helpStage.getAttribute('aria-hidden')).toBe('false');
    expect(view.elements.helpStage.hasAttribute('inert')).toBe(false);
    expect(view.document.body.classList.contains('is-help-open')).toBe(true);
    expect(view.elements.helpToggleButton.getAttribute('aria-label')).toBe('Close About and Help');
    expect(view.elements.helpTitle).toBe(view.document.activeElement);
    expect(view.elements.helpStage.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' });
    expect(view.hooks.closeTransientUi).toHaveBeenCalledOnce();

    view.controller.setHelpVisible(false);
    await Promise.resolve();
    expect(view.document.body.classList.contains('is-help-open')).toBe(false);
    expect(view.document.activeElement).toBe(view.elements.helpToggleButton);
    expect(view.hooks.onHelpChanged).toHaveBeenCalledTimes(2);
  });

  it('resets help state without reintroducing stale focus after document replacement', async () => {
    const view = fixture();
    view.controller.sync({ hasFilePath: true });
    view.elements.helpToggleButton.focus();
    view.controller.setHelpVisible(true);
    view.controller.reset();
    view.controller.sync({ hasFilePath: true, sourceActive: false });
    await Promise.resolve();

    expect(view.controller.isHelpVisible()).toBe(false);
    expect(view.elements.viewport.dataset.page).toBe('1');
    expect(view.document.body.classList.contains('is-help-open')).toBe(false);
  });

  it('stops projecting after disposal', () => {
    const view = fixture();
    view.controller.dispose();
    view.controller.sync({ hasFilePath: true });

    expect(view.elements.emptyStage.classList.contains('hidden')).toBe(false);
    expect(view.hooks.onStateChange).not.toHaveBeenCalled();
  });
});
