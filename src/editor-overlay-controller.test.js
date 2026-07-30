import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { createEditorOverlayController } from './editor-overlay-controller.js';

const COMMANDS = [
  { id: 'paragraph', label: 'Text', hint: 'Plain text', icon: 'text' },
  { id: 'heading1', label: 'Heading 1', hint: 'Large title', icon: 'heading' },
  { id: 'todo', label: 'To-do', hint: 'Task checkbox', icon: 'todo' },
];

function fixture({ markdown = true } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <main id="canvas"><div data-block-id="one"><button data-block-menu></button></div><div data-block-id="two"></div></main>
    <div id="commands" hidden></div>
    <div id="blocks" hidden>
      <button data-block-action="move-up">Up</button><button data-block-action="move-down">Down</button>
      <button data-block-action="duplicate">Copy</button><button data-block-action="delete">Delete</button>
    </div><button id="outside"></button>
  </body></html>`);
  const document = dom.window.document;
  const canvas = document.querySelector('#canvas');
  const commandMenu = document.querySelector('#commands');
  const blockMenu = document.querySelector('#blocks');
  const wrappers = [...canvas.querySelectorAll('[data-block-id]')];
  wrappers[0].getBoundingClientRect = () => ({ left: 90, top: 40, right: 290, bottom: 70, width: 200, height: 30 });
  wrappers[1].getBoundingClientRect = () => ({ left: 90, top: 100, right: 290, bottom: 130, width: 200, height: 30 });
  commandMenu.getBoundingClientRect = () => ({ width: 180, height: 120 });
  blockMenu.getBoundingClientRect = () => ({ width: 150, height: 100 });
  Object.defineProperty(dom.window, 'innerWidth', { configurable: true, value: 320 });
  Object.defineProperty(dom.window, 'innerHeight', { configurable: true, value: 180 });
  const onCommand = vi.fn();
  const onBlockAction = vi.fn();
  const focusBlock = vi.fn();
  const controller = createEditorOverlayController({
    window: dom.window,
    document,
    elements: { canvas, commandMenu, blockMenu },
    commands: COMMANDS,
    adapters: {
      isMarkdown: () => markdown,
      getBlock: (id) => ({ id, text: id === 'one' ? '' : 'Second' }),
      getBlocks: () => [{ id: 'one', text: '' }, { id: 'two', text: 'Second' }],
      getWrapper: (id) => canvas.querySelector(`[data-block-id="${id}"]`),
      focusBlock,
    },
    hooks: { onCommand, onBlockAction },
  });
  controller.start();
  return { dom, document, canvas, commandMenu, blockMenu, controller, onCommand, onBlockAction, focusBlock };
}

describe('Editor Overlay Controller', () => {
  it('filters commands, keeps active option state and activates from the keyboard', () => {
    const view = fixture();
    view.controller.openCommand('one', 'title');
    expect(view.commandMenu.hidden).toBe(false);
    expect(view.commandMenu.querySelectorAll('[data-command]')).toHaveLength(1);
    expect(view.commandMenu.textContent).toContain('Heading 1');

    const down = new view.dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', cancelable: true });
    expect(view.controller.handleCommandKey(down, { blockId: 'one', query: '' })).toBe(true);
    expect(down.defaultPrevented).toBe(true);
    const enter = new view.dom.window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true });
    view.controller.handleCommandKey(enter, { blockId: 'one', query: '' });
    expect(view.onCommand).toHaveBeenCalledWith('one', 'heading1');
  });

  it('limits plain text to paragraphs and owns block disabled states/actions', () => {
    const view = fixture({ markdown: false });
    view.controller.openCommand('one');
    expect([...view.commandMenu.querySelectorAll('[data-command]')].map((button) => button.dataset.command))
      .toEqual(['paragraph']);

    const handle = view.canvas.querySelector('[data-block-menu]');
    view.controller.openBlock('one', handle, { focus: true });
    expect(view.blockMenu.querySelector('[data-block-action="move-up"]').disabled).toBe(true);
    expect(view.blockMenu.querySelector('[data-block-action="move-down"]').disabled).toBe(false);
    expect(view.blockMenu.querySelector('[data-block-action="delete"]').disabled).toBe(false);
    view.blockMenu.querySelector('[data-block-action="duplicate"]').click();
    expect(view.onBlockAction).toHaveBeenCalledWith('one', 'duplicate');
    expect(view.blockMenu.hidden).toBe(true);
  });

  it('places overlays inside viewport edges and restores focus on Escape', async () => {
    const view = fixture();
    view.controller.openBlock('two', view.canvas.querySelector('[data-block-id="two"]'), { focus: true });
    await Promise.resolve();
    expect(Number.parseInt(view.blockMenu.style.left, 10)).toBeLessThanOrEqual(162);
    expect(Number.parseInt(view.blockMenu.style.top, 10)).toBeGreaterThanOrEqual(40);
    const escape = new view.dom.window.KeyboardEvent('keydown', { bubbles: true, key: 'Escape', cancelable: true });
    view.blockMenu.dispatchEvent(escape);
    expect(view.focusBlock).toHaveBeenCalledWith('two');
    expect(view.blockMenu.hidden).toBe(true);
  });

  it('dismisses outside clicks and removes document listeners on dispose', () => {
    const view = fixture();
    view.controller.openCommand('one');
    view.document.querySelector('#outside').dispatchEvent(new view.dom.window.MouseEvent('pointerdown', { bubbles: true }));
    expect(view.commandMenu.hidden).toBe(true);
    view.controller.openBlock('one', view.canvas.querySelector('[data-block-menu]'));
    view.controller.dispose();
    expect(view.blockMenu.hidden).toBe(true);
    view.blockMenu.hidden = false;
    view.document.querySelector('#outside').dispatchEvent(new view.dom.window.MouseEvent('pointerdown', { bubbles: true }));
    expect(view.blockMenu.hidden).toBe(false);
  });
});
