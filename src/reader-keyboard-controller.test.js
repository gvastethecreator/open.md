// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createReaderKeyboardController } from './reader-keyboard-controller.js';

function fixture() {
  document.body.innerHTML = '<input id="input"><div id="editable" contenteditable="true"></div>';
  const state = {
    help: false,
    readingTools: false,
    typography: false,
    edit: false,
  };
  const hooks = {
    toggleHelp: vi.fn(() => { state.help = !state.help; }),
    closeHelp: vi.fn(() => { state.help = false; }),
    closeReadingTools: vi.fn(() => { state.readingTools = false; }),
    closeTypography: vi.fn(() => { state.typography = false; }),
    toggleEdit: vi.fn(() => { state.edit = !state.edit; }),
    saveEditor: vi.fn(),
    openFile: vi.fn(),
    closeFile: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    resetZoom: vi.fn(),
    cycleTheme: vi.fn(),
  };
  const controller = createReaderKeyboardController({
    window,
    adapters: {
      isHelpVisible: () => state.help,
      isReadingToolsOpen: () => state.readingTools,
      isTypographyOpen: () => state.typography,
      isEditMode: () => state.edit,
    },
    hooks,
  });
  controller.start();
  return { controller, state, hooks };
}

function press(key, options = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  window.dispatchEvent(event);
  return event;
}

describe('Reader Keyboard Controller', () => {
  it('preserves help, panel and edit/save precedence', () => {
    const view = fixture();
    expect(press('F1').defaultPrevented).toBe(true);
    expect(view.hooks.toggleHelp).toHaveBeenCalledOnce();

    view.state.help = true;
    view.state.readingTools = true;
    press('Escape');
    expect(view.hooks.closeHelp).toHaveBeenCalledOnce();
    expect(view.hooks.closeReadingTools).not.toHaveBeenCalled();

    view.state.help = false;
    press('Escape');
    expect(view.hooks.closeReadingTools).toHaveBeenCalledOnce();

    view.state.edit = true;
    press('s', { ctrlKey: true });
    expect(view.hooks.saveEditor).toHaveBeenCalledOnce();
    press('e', { ctrlKey: true, shiftKey: true });
    expect(view.hooks.toggleEdit).toHaveBeenCalledOnce();
  });

  it('routes open, close, zoom and theme shortcuts while protecting editable targets', () => {
    const view = fixture();
    press('o', { ctrlKey: true });
    press('F4', { ctrlKey: true });
    // code-only F4 still closes (some hosts report code without a stable key).
    const codeOnly = new KeyboardEvent('keydown', {
      key: 'Unidentified',
      code: 'F4',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(codeOnly);
    press('+', { ctrlKey: true });
    press('-', { ctrlKey: true });
    press('0', { ctrlKey: true });
    press('t');
    press('t', { shiftKey: true });
    press('t', { ctrlKey: true });

    expect(view.hooks.openFile).toHaveBeenCalledOnce();
    expect(view.hooks.closeFile).toHaveBeenCalledTimes(2);
    expect(codeOnly.defaultPrevented).toBe(true);
    expect(view.hooks.zoomIn).toHaveBeenCalledOnce();
    expect(view.hooks.zoomOut).toHaveBeenCalledOnce();
    expect(view.hooks.resetZoom).toHaveBeenCalledOnce();
    expect(view.hooks.cycleTheme).toHaveBeenNthCalledWith(1, 1);
    expect(view.hooks.cycleTheme).toHaveBeenNthCalledWith(2, -1);
    expect(view.hooks.cycleTheme).toHaveBeenNthCalledWith(3, -1);

    const inputEvent = new KeyboardEvent('keydown', { key: 't', bubbles: true, cancelable: true });
    document.querySelector('#input').dispatchEvent(inputEvent);
    const editableEvent = new KeyboardEvent('keydown', { key: 't', bubbles: true, cancelable: true });
    document.querySelector('#editable').dispatchEvent(editableEvent);
    expect(view.hooks.cycleTheme).toHaveBeenCalledTimes(3);
  });

  it('closes typography and stops listening after disposal', () => {
    const view = fixture();
    view.state.typography = true;
    press('Escape');
    expect(view.hooks.closeTypography).toHaveBeenCalledOnce();

    view.controller.dispose();
    press('F1');
    expect(view.hooks.toggleHelp).not.toHaveBeenCalled();
  });
});
