// @vitest-environment jsdom

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { createEditorSession } from './editor-session.js';

const indexHtml = readFileSync('index.html', 'utf8');

function renderFixture() {
  document.open();
  document.write(indexHtml);
  document.close();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function mount(save = vi.fn(async () => ({ source: '' })), hooks = {}) {
  renderFixture();
  const session = createEditorSession({
    window,
    elements: {
      root: document.getElementById('editor-view'),
      canvas: document.getElementById('editor-canvas'),
      commandMenu: document.getElementById('editor-command-menu'),
      blockMenu: document.getElementById('editor-block-menu'),
      inlineToolbar: document.getElementById('editor-inline-toolbar'),
      caretEcho: document.getElementById('editor-caret-echo'),
      linkPopover: document.getElementById('editor-link-popover'),
      linkInput: document.getElementById('editor-link-input'),
      linkApply: document.getElementById('editor-link-apply'),
    },
    adapters: { save },
    hooks,
  });
  return { session, save };
}

describe('editor session', () => {
  it('enters with the canonical source, becomes dirty and saves through its adapter', async () => {
    const { session, save } = mount();
    session.setDocument({ path: 'C:\\notes\\sample.md', source: '# Note\n\nParagraph', markdown: true });

    expect(session.enter()).toBe(true);
    expect(document.getElementById('editor-view').hidden).toBe(false);
    expect(document.querySelectorAll('.editor-block')).toHaveLength(3);

    const paragraph = document.querySelectorAll('[data-editor-content]')[2];
    paragraph.textContent = 'Paragraph updated';
    paragraph.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    expect(session.current()).toMatchObject({ mode: 'edit', dirty: true });

    await expect(session.save()).resolves.toMatchObject({ status: 'saved' });
    expect(save).toHaveBeenCalledWith('C:\\notes\\sample.md', '# Note\n\nParagraph updated');
    expect(session.current()).toMatchObject({ dirty: false, saveState: 'saved' });
  });

  it('uses the slash menu to change a block and serializes the chosen type', () => {
    const { session } = mount();
    session.setDocument({ path: 'sample.md', source: '', markdown: true });
    session.enter();
    const content = document.querySelector('[data-editor-content]');
    content.textContent = '/todo';
    content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    content.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    expect(document.querySelector('.editor-block')?.dataset.blockType).toBe('todo');
    expect(session.source()).toBe('- [ ] ');
  });

  it('reports undo and redo history restores without rendering toolbar buttons', async () => {
    const onHistoryRestore = vi.fn();
    const { session } = mount(undefined, { onHistoryRestore });
    session.setDocument({ path: 'sample.md', source: 'Before', markdown: true });
    session.enter();
    const content = document.querySelector('[data-editor-content]');
    content.textContent = 'After';
    content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));

    content.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await Promise.resolve();
    expect(session.source()).toBe('Before');
    expect(onHistoryRestore).toHaveBeenLastCalledWith('undo');

    document.querySelector('[data-editor-content]').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true })
    );
    await Promise.resolve();
    expect(session.source()).toBe('After');
    expect(onHistoryRestore).toHaveBeenLastCalledWith('redo');
    expect(document.querySelector('[data-history-action]')).toBeNull();
  });

  it('keeps native checkbox semantics while its completion label follows state', () => {
    const { session } = mount();
    session.setDocument({ path: 'sample.md', source: '- [ ] Ship the release', markdown: true });
    session.enter();
    const checkbox = document.querySelector('[data-todo-check]');

    expect(checkbox).toMatchObject({ type: 'checkbox', checked: false });
    expect(checkbox.getAttribute('aria-label')).toBe('Mark task complete');

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(checkbox.getAttribute('aria-label')).toBe('Mark task incomplete');
    expect(session.source()).toBe('- [x] Ship the release');

    checkbox.checked = false;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    expect(checkbox.getAttribute('aria-label')).toBe('Mark task complete');
  });

  it('reports source line and visible column for the active editor caret', async () => {
    const onCursorChange = vi.fn();
    const { session } = mount(undefined, { onCursorChange });
    session.setDocument({
      path: 'sample.md',
      source: '# Title\n\n- [ ] Task\n\n```js\none\ntwo\n```\nAfter',
      markdown: true,
    });
    session.enter();
    await Promise.resolve();

    const contents = [...document.querySelectorAll('[data-editor-content]')];
    const code = contents.at(-2);
    const range = document.createRange();
    range.setStart(code.firstChild, 6);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));

    expect(session.current().cursor).toEqual({ line: 7, column: 3 });
    expect(onCursorChange).toHaveBeenLastCalledWith({ line: 7, column: 3 });

    code.textContent = 'one\ntwo\nthree';
    code.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    const after = contents.at(-1);
    const shiftedRange = document.createRange();
    shiftedRange.setStart(after.firstChild, 2);
    shiftedRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(shiftedRange);
    document.dispatchEvent(new Event('selectionchange'));

    expect(session.current().cursor).toEqual({ line: 10, column: 3 });
  });

  it('preserves a dirty draft when saving fails and supports retry', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('Disk full'))
      .mockResolvedValueOnce({ source: 'Changed' });
    const { session } = mount(save);
    session.setDocument({ path: 'sample.txt', source: 'Before', markdown: false });
    session.enter();
    const content = document.querySelector('[data-editor-content]');
    content.textContent = 'Changed';
    content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));

    await expect(session.save()).resolves.toMatchObject({ status: 'failed' });
    expect(session.current()).toMatchObject({ dirty: true, saveState: 'error', error: 'Disk full' });
    await expect(session.save()).resolves.toMatchObject({ status: 'saved' });
    expect(session.current()).toMatchObject({ dirty: false, saveState: 'saved' });
  });

  it('does not replace edits typed while a save and reader reload are settling', async () => {
    const pending = deferred();
    const { session } = mount(() => pending.promise);
    session.setDocument({ path: 'sample.md', source: 'Before', markdown: true });
    session.enter();
    const content = document.querySelector('[data-editor-content]');
    content.textContent = 'Saved version';
    content.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const saving = session.save();

    content.textContent = 'Saved version plus newer typing';
    content.dispatchEvent(new InputEvent('input', { bubbles: true }));
    pending.resolve({ source: 'Saved version' });
    await saving;
    session.setDocument({ path: 'sample.md', source: 'Saved version', markdown: true });

    expect(session.source()).toBe('Saved version plus newer typing');
    expect(session.current()).toMatchObject({ mode: 'edit', dirty: true, saveState: 'idle' });
  });

  it('duplicates, reorders and deletes blocks from the contextual block menu', () => {
    const { session } = mount();
    session.setDocument({ path: 'sample.md', source: 'One\nTwo', markdown: true });
    session.enter();

    document.querySelector('[data-block-menu]').click();
    document.querySelector('[data-block-action="duplicate"]').click();
    expect(session.source()).toBe('One\nOne\nTwo');

    document.querySelectorAll('[data-block-menu]')[1].click();
    document.querySelector('[data-block-action="move-down"]').click();
    expect(session.source()).toBe('One\nTwo\nOne');

    document.querySelectorAll('[data-block-menu]')[2].click();
    document.querySelector('[data-block-action="delete"]').click();
    expect(session.source()).toBe('One\nTwo');
  });

  it('indents list blocks and reorders blocks from the keyboard', () => {
    const { session } = mount();
    session.setDocument({ path: 'sample.md', source: '- One\n- Two', markdown: true });
    session.enter();
    const first = document.querySelector('[data-editor-content]');

    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    expect(session.source()).toBe('  - One\n- Two');
    first.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true }));
    expect(session.source()).toBe('- One\n- Two');
    first.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown', altKey: true, shiftKey: true, bubbles: true,
    }));
    expect(session.source()).toBe('- Two\n- One');
  });

  it('opens and closes block actions from the keyboard with focus recovery', async () => {
    const { session } = mount();
    session.setDocument({ path: 'sample.md', source: 'One\nTwo', markdown: true });
    session.enter();
    const first = document.querySelector('[data-editor-content]');
    first.focus();
    first.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'm', altKey: true, shiftKey: true, bubbles: true,
    }));
    await Promise.resolve();

    expect(document.getElementById('editor-block-menu').hidden).toBe(false);
    expect(document.activeElement?.dataset.blockAction).toBe('move-down');
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.getElementById('editor-block-menu').hidden).toBe(true);
    expect(document.activeElement).toBe(first);
  });

  it('asks before discarding dirty work and keeps editing when declined', () => {
    const { session } = mount();
    session.setDocument({ path: 'sample.md', source: 'Before', markdown: true });
    session.enter();
    const content = document.querySelector('[data-editor-content]');
    content.textContent = 'Changed';
    content.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    expect(session.exit()).toBe(false);
    expect(session.current().mode).toBe('edit');
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('echoes collapsed caret movement at the rendered selection geometry', async () => {
    const { session } = mount();
    session.setDocument({ path: 'sample.md', source: 'Before', markdown: true });
    session.enter();
    await Promise.resolve();
    const content = document.querySelector('[data-editor-content]');
    const range = {
      startContainer: content.firstChild,
      commonAncestorContainer: content.firstChild,
      getClientRects: () => [{ left: 120, top: 40, width: 0, height: 22 }],
    };
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      isCollapsed: true,
      getRangeAt: () => range,
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback();
      return 1;
    });

    document.dispatchEvent(new Event('selectionchange'));
    const echo = document.getElementById('editor-caret-echo');
    expect(echo.hidden).toBe(false);
    expect(echo.style.left).toBe('120px');
    expect(echo.style.top).toBe('40px');
    expect(echo.style.height).toBe('22px');
    expect(echo.classList.contains('is-moving')).toBe(true);

    echo.dispatchEvent(new Event('animationend'));
    expect(echo.hidden).toBe(false);
    expect(echo.classList.contains('is-moving')).toBe(false);
  });

  it('keeps the 2px caret echo visible when reduced motion is preferred', async () => {
    const { session } = mount();
    session.setDocument({ path: 'sample.md', source: 'Before', markdown: true });
    session.enter();
    await Promise.resolve();
    const content = document.querySelector('[data-editor-content]');
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      isCollapsed: true,
      getRangeAt: () => ({
        startContainer: content.firstChild,
        getClientRects: () => [{ left: 120, top: 40, width: 0, height: 22 }],
      }),
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
    });

    try {
      document.dispatchEvent(new Event('selectionchange'));
      expect(document.getElementById('editor-caret-echo').hidden).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('marks formatting active only when the selected markup owns that style', async () => {
    const { session } = mount();
    session.setDocument({ path: 'sample.md', source: '# Heading\n\nA **bold** word', markdown: true });
    session.enter();
    await Promise.resolve();

    const heading = document.querySelector('[data-editor-content]');
    const strong = document.querySelector('[data-editor-content] strong');
    let currentRange = {
      commonAncestorContainer: heading.firstChild,
      cloneRange() { return this; },
      getBoundingClientRect: () => ({ left: 80, right: 120, top: 80, bottom: 100, height: 20 }),
    };
    vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => currentRange,
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
    });

    document.dispatchEvent(new Event('selectionchange'));
    expect(document.querySelector('[data-inline-command="bold"]').getAttribute('aria-pressed')).toBe('false');

    currentRange = {
      commonAncestorContainer: strong.firstChild,
      cloneRange() { return this; },
      getBoundingClientRect: () => ({ left: 90, right: 130, top: 120, bottom: 140, height: 20 }),
    };
    document.dispatchEvent(new Event('selectionchange'));
    expect(document.querySelector('[data-inline-command="bold"]').getAttribute('aria-pressed')).toBe('true');
  });

  it('keeps very large documents in read/source mode instead of rendering unsafe block counts', () => {
    const { session } = mount();
    session.setDocument({
      path: 'large.md',
      source: 'x'.repeat(2 * 1024 * 1024 + 1),
      markdown: true,
    });

    expect(session.enter()).toBe(false);
    expect(session.current()).toMatchObject({ mode: 'read', path: 'large.md' });
    expect(document.getElementById('editor-view').hidden).toBe(true);
  });
});
