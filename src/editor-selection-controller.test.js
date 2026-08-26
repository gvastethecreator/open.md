import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { createEditorSelectionController } from './editor-selection-controller.js';

function fixture({ reduced = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <section class="reader-page"><main id="root"><div id="canvas"><div data-block-id="one" data-source-line-start="3" data-block-type="paragraph">
      <div data-editor-content contenteditable="true">Hello <strong>bold</strong> world</div>
    </div></div></main></section>
    <div id="toolbar" hidden><button data-inline-command="bold"></button><button data-inline-command="italic"></button>
      <button data-inline-command="code"></button><button data-inline-command="link"></button></div>
    <div id="caret" hidden></div><div id="link" hidden><input id="href"><button id="apply">Apply</button></div>
  </body></html>`);
  const { document } = dom.window;
  dom.window.matchMedia = () => ({ matches: reduced });
  dom.window.requestAnimationFrame = (callback) => { callback(); return 1; };
  dom.window.cancelAnimationFrame = vi.fn();
  document.execCommand = vi.fn(() => true);
  const elements = {
    root: document.querySelector('#root'),
    canvas: document.querySelector('#canvas'),
    inlineToolbar: document.querySelector('#toolbar'),
    caretEcho: document.querySelector('#caret'),
    linkPopover: document.querySelector('#link'),
    linkInput: document.querySelector('#href'),
    linkApply: document.querySelector('#apply'),
  };
  const readerPage = document.querySelector('.reader-page');
  readerPage.getBoundingClientRect = () => ({
    left: 0,
    top: 0,
    right: 500,
    bottom: 400,
    width: 500,
    height: 400,
  });
  elements.inlineToolbar.getBoundingClientRect = () => ({ left: 10, top: 10, right: 150, bottom: 40, width: 140, height: 30 });
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 500 });
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 400 });
  const setCursor = vi.fn();
  const updateBlockFromElement = vi.fn();
  const onDocumentChange = vi.fn();
  const focusBlock = vi.fn();
  const trailHide = vi.fn();
  const trailMoveTo = vi.fn();
  const caretTrail = {
    hide: trailHide,
    moveTo: trailMoveTo,
    isVisible: () => false,
  };
  const controller = createEditorSelectionController({
    window: dom.window,
    document,
    elements,
    adapters: {
      isEditing: () => true,
      isMarkdown: () => true,
      getActiveBlockId: () => 'one',
      setCursor,
      updateBlockFromElement,
      getCaretTrail: () => caretTrail,
    },
    hooks: { onDocumentChange, focusBlock },
  });
  controller.start();
  return {
    dom,
    document,
    elements,
    controller,
    setCursor,
    updateBlockFromElement,
    onDocumentChange,
    focusBlock,
    readerPage,
    content: document.querySelector('[data-editor-content]'),
    trailHide,
    trailMoveTo,
    caretTrail,
  };
}

function selectText(view, node, start, end, rect = { left: 80, top: 100, width: 40, height: 18, right: 120, bottom: 118 }) {
  const range = view.document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  range.getBoundingClientRect = () => rect;
  range.getClientRects = () => [rect];
  const selection = view.dom.window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  view.document.dispatchEvent(new view.dom.window.Event('selectionchange'));
  return range;
}

describe('Editor Selection Controller', () => {
  it('projects cursor position and inline active state from the captured range', () => {
    const view = fixture();
    const boldText = view.content.querySelector('strong').firstChild;
    selectText(view, boldText, 0, 4);
    expect(view.setCursor).toHaveBeenLastCalledWith({ line: 3, column: 7 });
    expect(view.elements.inlineToolbar.hidden).toBe(false);
    expect(view.elements.inlineToolbar.querySelector('[data-inline-command="bold"]').getAttribute('aria-pressed')).toBe('true');
    expect(view.elements.inlineToolbar.style.left).not.toBe('');
  });

  it('applies formatting and links, syncs the block, and restores focus on cancel', () => {
    const view = fixture();
    const text = view.content.firstChild;
    selectText(view, text, 0, 5);
    expect(view.controller.applyFromCurrentSelection('bold')).toBe(true);
    expect(view.document.execCommand).toHaveBeenCalledWith('bold', false);
    expect(view.updateBlockFromElement).toHaveBeenCalled();
    expect(view.onDocumentChange).toHaveBeenCalled();

    selectText(view, text, 0, 5);
    expect(view.controller.openLinkFromCurrentSelection()).toBe(true);
    view.elements.linkInput.value = 'example.com';
    view.elements.linkApply.click();
    expect(view.document.execCommand).toHaveBeenCalledWith('createLink', false, 'https://example.com');
    expect(view.elements.inlineToolbar.hidden).toBe(true);

    selectText(view, text, 0, 5);
    view.controller.openLinkFromCurrentSelection();
    view.elements.linkInput.dispatchEvent(new view.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(view.focusBlock).toHaveBeenCalledWith('one');
    expect(view.elements.linkPopover.hidden).toBe(true);
  });

  it('animates collapsed caret geometry and honors reduced motion', async () => {
    const view = fixture();
    const text = view.content.firstChild;
    selectText(view, text, 2, 2, { left: 101.25, top: 88.75, width: 0, height: 20, right: 101.25, bottom: 108.75 });
    await new Promise((resolve) => view.dom.window.setTimeout(resolve, 20));
    expect(view.elements.caretEcho.hidden).toBe(false);
    expect(view.elements.caretEcho.style.left).toBe('101.5px');
    expect(view.elements.caretEcho.classList.contains('is-moving')).toBe(true);

    const reduced = fixture({ reduced: true });
    selectText(reduced, reduced.content.firstChild, 1, 1, { left: 40, top: 50, width: 0, height: 18, right: 40, bottom: 68 });
    await new Promise((resolve) => reduced.dom.window.setTimeout(resolve, 20));
    expect(reduced.elements.caretEcho.hidden).toBe(false);
    expect(reduced.elements.caretEcho.classList.contains('is-moving')).toBe(false);
  });

  it('keeps collapsed caret geometry attached to its range while the reader scrolls', () => {
    const view = fixture();
    const range = selectText(view, view.content.firstChild, 2, 2, {
      left: 101,
      top: 120,
      width: 0,
      height: 20,
      right: 101,
      bottom: 140,
    });
    let rect = {
      left: 101,
      top: 72,
      width: 0,
      height: 20,
      right: 101,
      bottom: 92,
    };
    range.getClientRects = () => [rect];
    range.getBoundingClientRect = () => rect;

    view.readerPage.dispatchEvent(new view.dom.window.Event('scroll'));

    expect(view.elements.caretEcho.style.top).toBe('72px');
    expect(view.elements.caretEcho.classList.contains('is-moving')).toBe(false);

    rect = { ...rect, top: -48, bottom: -28 };
    view.readerPage.dispatchEvent(new view.dom.window.Event('scroll'));
    expect(view.elements.caretEcho.hidden).toBe(true);
    expect(view.elements.root.classList.contains('has-custom-caret')).toBe(false);

    rect = { ...rect, top: 56, bottom: 76 };
    view.readerPage.dispatchEvent(new view.dom.window.Event('scroll'));
    expect(view.elements.caretEcho.hidden).toBe(false);
    expect(view.elements.caretEcho.style.top).toBe('56px');
    expect(view.elements.root.classList.contains('has-custom-caret')).toBe(true);
  });

  it('does not capture selection after stop', () => {
    const view = fixture();
    selectText(view, view.content.firstChild, 0, 3);
    expect(view.elements.inlineToolbar.hidden).toBe(false);
    view.controller.stop();
    expect(view.elements.inlineToolbar.hidden).toBe(true);
    expect(view.elements.caretEcho.hidden).toBe(true);
    const callCount = view.setCursor.mock.calls.length;
    view.document.dispatchEvent(new view.dom.window.Event('selectionchange'));
    expect(view.setCursor).toHaveBeenCalledTimes(callCount);
    view.controller.start();
    view.document.dispatchEvent(new view.dom.window.Event('selectionchange'));
    expect(view.setCursor.mock.calls.length).toBeGreaterThan(callCount);
  });

  it('clears saved selection, caret and listeners on dispose', () => {
    const view = fixture();
    selectText(view, view.content.firstChild, 0, 3);
    view.controller.dispose();
    expect(view.elements.inlineToolbar.hidden).toBe(true);
    expect(view.elements.caretEcho.hidden).toBe(true);
    expect(view.setCursor).toHaveBeenLastCalledWith(null);
    const callCount = view.setCursor.mock.calls.length;
    view.document.dispatchEvent(new view.dom.window.Event('selectionchange'));
    expect(view.setCursor).toHaveBeenCalledTimes(callCount);
  });

  it('hides the caret trail immediately on clear (leave-edit path)', async () => {
    const view = fixture();
    selectText(view, view.content.firstChild, 2, 2, {
      left: 100, top: 80, width: 0, height: 20, right: 100, bottom: 100,
    });
    await new Promise((resolve) => view.dom.window.setTimeout(resolve, 20));
    expect(view.elements.caretEcho.hidden).toBe(false);
    expect(view.trailMoveTo).toHaveBeenCalled();
    view.trailHide.mockClear();

    // editor-session exit calls selectionController.clear() — trail must not linger until idle.
    view.controller.clear();
    expect(view.elements.caretEcho.hidden).toBe(true);
    expect(view.trailHide).toHaveBeenCalled();
    expect(view.setCursor).toHaveBeenLastCalledWith(null);
  });
});
