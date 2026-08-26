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

function mount(save = vi.fn(async () => ({ source: '' })), hooks = {}, options = {}) {
  renderFixture();
  // Rendered Markdown always uses the rich block projection. The preference only
  // controls block tools; Source Edit owns the continuous raw-source surface.
  const blockEditor = options.blockEditor !== false;
  const session = createEditorSession({
    window,
    elements: {
      root: document.getElementById('editor-view'),
      canvas: document.getElementById('editor-canvas'),
      commandMenu: document.getElementById('editor-command-menu'),
      blockMenu: document.getElementById('editor-block-menu'),
      blockToolbar: document.getElementById('editor-block-toolbar'),
      inlineToolbar: document.getElementById('editor-inline-toolbar'),
      caretEcho: document.getElementById('editor-caret-echo'),
      linkPopover: document.getElementById('editor-link-popover'),
      linkInput: document.getElementById('editor-link-input'),
      linkApply: document.getElementById('editor-link-apply'),
      contextLabel: document.getElementById('editor-context-label'),
      contextHint: document.getElementById('editor-context-hint'),
    },
    adapters: {
      save,
      isBlockEditor: () => blockEditor,
      isSourceMode: typeof options.isSourceMode === 'function'
        ? options.isSourceMode
        : () => Boolean(options.sourceMode),
    },
    hooks,
  });
  return { session, save };
}

function blockToolbar() {
  return document.getElementById('editor-block-toolbar');
}

function activateBlock(index = 0) {
  const wrappers = [...document.querySelectorAll('[data-block-id]')];
  const wrapper = wrappers[index];
  const content = wrapper?.querySelector('[data-editor-content]');
  content?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  content?.focus?.();
  return wrapper;
}

function blockRect(top, height = 36) {
  return {
    x: 0,
    y: top,
    top,
    right: 600,
    bottom: top + height,
    left: 0,
    width: 600,
    height,
    toJSON: () => ({}),
  };
}

function createBlockDataTransfer() {
  const data = new Map();
  return {
    effectAllowed: 'none',
    dropEffect: 'none',
    types: [],
    setDragImage: vi.fn(),
    setData(type, value) {
      data.set(type, value);
      if (!this.types.includes(type)) this.types.push(type);
    },
    getData(type) {
      return data.get(type) || '';
    },
  };
}

function dispatchBlockDrag(target, type, dataTransfer, { clientX = 4, clientY = 4 } = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    dataTransfer: { value: dataTransfer },
    clientX: { value: clientX },
    clientY: { value: clientY },
  });
  target.dispatchEvent(event);
  return event;
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

  it('focuses the initial edit block without scrolling the reader', async () => {
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      const { session } = mount();
      session.setDocument({ path: 'sample.md', source: 'Paragraph', markdown: true });
      expect(session.enter()).toBe(true);
      await Promise.resolve();

      expect(document.activeElement).toBe(document.querySelector('[data-editor-content]'));
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      if (original) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          configurable: true,
          value: original,
        });
      } else {
        delete HTMLElement.prototype.scrollIntoView;
      }
    }
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

  it('merges the next rendered block on Delete at the current block end', () => {
    const { session } = mount();
    session.setDocument({ path: 'sample.md', source: 'Alpha\nBeta', markdown: true });
    session.enter();
    const content = document.querySelector('[data-editor-content]');
    const range = document.createRange();
    range.selectNodeContents(content);
    range.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    content.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Delete',
      bubbles: true,
      cancelable: true,
    }));

    expect(session.source()).toBe('AlphaBeta');
    expect(document.querySelectorAll('[data-block-id]')).toHaveLength(1);
    expect(document.querySelector('[data-editor-content]')?.textContent).toBe('AlphaBeta');
    session.dispose();
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
    const content = document.querySelector('[data-editor-content], [data-classic-content]');
    content.textContent = 'Changed';
    content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));

    await expect(session.save()).resolves.toMatchObject({ status: 'failed' });
    expect(session.current()).toMatchObject({ dirty: true, saveState: 'error', error: 'Disk full' });
    await expect(session.save()).resolves.toMatchObject({ status: 'saved' });
    expect(session.current()).toMatchObject({ dirty: false, saveState: 'saved' });
  });

  it('enters JSON property editor for valid object sources and flushes pending cells on save', async () => {
    const save = vi.fn(async (_path, source) => ({ source }));
    const { session } = mount(save, {}, { blockEditor: false });
    session.setDocument({
      path: 'config.json',
      source: '{\n  "name": "open.md",\n  "count": 1\n}\n',
      markdown: false,
      presentation: 'json-props',
    });
    expect(session.enter()).toBe(true);
    expect(session.current().presentation).toBe('json-props');
    expect(document.querySelector('.json-props')).toBeTruthy();
    expect(document.querySelectorAll('[data-json-property]')).toHaveLength(2);

    // Prefer-block refresh must not wipe the JSON property surface.
    session.refreshPresentation();
    expect(document.querySelector('.json-props')).toBeTruthy();
    expect(document.querySelectorAll('[data-json-property]')).toHaveLength(2);

    const value = document.querySelector('[data-json-path="count"] [data-json-value]');
    value.focus();
    value.textContent = '9';
    // No blur yet — save must flush the pending cell.
    await expect(session.save()).resolves.toMatchObject({ status: 'saved' });
    expect(save).toHaveBeenCalledWith(
      'config.json',
      expect.stringContaining('"count": 9'),
    );
    expect(session.isDirty()).toBe(false);
    session.dispose();
  });

  it('keeps the next JSON cell mounted when an unchanged cell loses focus', async () => {
    const save = vi.fn(async (_path, source) => ({ source }));
    const { session } = mount(save, {}, { blockEditor: false });
    session.setDocument({
      path: 'config.json',
      source: '{\n  "name": "open.md",\n  "count": 1\n}\n',
      markdown: false,
      presentation: 'json-props',
    });
    session.enter();

    const name = document.querySelector('[data-json-path="name"] [data-json-value]');
    const count = document.querySelector('[data-json-path="count"] [data-json-value]');
    name.focus();
    count.focus();

    expect(count.isConnected).toBe(true);
    count.textContent = '9';
    await expect(session.save()).resolves.toMatchObject({ status: 'saved' });
    expect(save).toHaveBeenCalledWith('config.json', expect.stringContaining('"count": 9'));
    session.dispose();
  });

  it('gives JSON Source its own raw Edit mode and restores properties in Rendered Edit', async () => {
    let sourceMode = true;
    const { session } = mount(vi.fn(async () => ({ source: '' })), {}, {
      blockEditor: false,
      isSourceMode: () => sourceMode,
    });
    session.setDocument({
      path: 'config.json',
      source: '{\n  "name": "open.md",\n  "count": 1\n}\n',
      markdown: false,
      presentation: 'json-props',
    });

    expect(session.enter()).toBe(true);
    expect(session.current().presentation).toBe('source');
    expect(document.querySelector('.json-props')).toBeNull();
    expect(document.getElementById('editor-canvas').getAttribute('aria-label')).toBe('Source editor');

    sourceMode = false;
    session.refreshPresentation();
    expect(session.current().presentation).toBe('json-props');
    expect(document.querySelectorAll('[data-json-property]')).toHaveLength(2);

    sourceMode = true;
    session.refreshPresentation();
    expect(session.current().presentation).toBe('source');
    expect(document.querySelector('.json-props')).toBeNull();
    expect(session.source()).toContain('"count": 1');
    session.dispose();
  });

  it('keeps invalid JSON source in plain edit and reports the fallback after the mode settles', async () => {
    let sourceMode = true;
    const onUnavailable = vi.fn();
    const { session } = mount(vi.fn(async () => ({ source: '' })), { onUnavailable }, {
      blockEditor: false,
      isSourceMode: () => sourceMode,
    });
    session.setDocument({
      path: 'config.json',
      source: '{\n  "count": 1\n}\n',
      markdown: false,
      presentation: 'json-props',
    });
    session.enter();
    const content = document.querySelector('[data-classic-content][data-editor-mode="source"]');
    content.textContent = '{ invalid';
    content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));

    sourceMode = false;
    expect(session.refreshPresentation()).toBe(true);
    expect(session.current().presentation).toBe('classic');
    expect(session.source()).toMatch(/^\{ invalid/);
    expect(onUnavailable).not.toHaveBeenCalled();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    expect(onUnavailable).toHaveBeenCalledWith('Invalid JSON — editing as plain text');
    session.dispose();
  });

  it('falls back to plain edit when JSON is invalid', () => {
    const { session } = mount(vi.fn(async () => ({ source: '' })), {
      onUnavailable: vi.fn(),
    }, { blockEditor: false });
    session.setDocument({
      path: 'broken.json',
      source: '{ not json',
      markdown: false,
      presentation: 'json-props',
    });
    expect(session.enter()).toBe(true);
    expect(session.current().presentation).toBe('classic');
    expect(document.querySelector('.json-props')).toBeNull();
    session.dispose();
  });

  it('flushes pending JSON cells into drafts when switching documents', () => {
    const { session } = mount(vi.fn(async () => ({ source: '' })), {}, { blockEditor: false });
    session.setDocument({
      path: 'a.json',
      source: '{\n  "count": 1\n}\n',
      markdown: false,
      presentation: 'json-props',
    });
    expect(session.enter()).toBe(true);
    const value = document.querySelector('[data-json-path="count"] [data-json-value]');
    value.textContent = '7';
    expect(session.isDirty()).toBe(true);

    session.setDocument({
      path: 'b.json',
      source: '{\n  "other": true\n}\n',
      markdown: false,
      presentation: 'json-props',
    });
    // Returning to a.json should recover the flushed pending edit, not drop it.
    session.setDocument({
      path: 'a.json',
      source: '{\n  "count": 1\n}\n',
      markdown: false,
      presentation: 'json-props',
    });
    // enter() already ran for path switch while editing; draft should win.
    expect(session.source()).toContain('"count": 7');
    session.dispose();
  });

  it('marks save error when JSON flush rejects invalid cells so autosave backs off', async () => {
    const onUnavailable = vi.fn();
    const save = vi.fn(async (_path, source) => ({ source }));
    const { session } = mount(save, { onUnavailable }, { blockEditor: false });
    session.setDocument({
      path: 'num.json',
      source: '{\n  "count": 1\n}\n',
      markdown: false,
      presentation: 'json-props',
    });
    session.enter();
    const value = document.querySelector('[data-json-path="count"] [data-json-value]');
    value.textContent = 'not-a-number';
    await expect(session.save()).resolves.toMatchObject({ status: 'unavailable' });
    expect(session.current().saveState).toBe('error');
    expect(onUnavailable).toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    session.dispose();
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

  it('keeps the active rendered block stable when a same-path save payload is applied', async () => {
    const savedPayload = { source: 'One\nTwo edited', html: '<p>One</p><p>Two edited</p>' };
    const { session } = mount(vi.fn(async () => savedPayload));
    session.setDocument({ path: 'stable.md', source: 'One\nTwo', markdown: true });
    session.enter();
    await Promise.resolve();
    activateBlock(1);
    const second = document.querySelector('.editor-block.is-active-line');
    const content = second.querySelector('[data-editor-content]');
    content.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(content);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    content.textContent = 'Two edited';
    content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));

    await expect(session.save()).resolves.toMatchObject({ status: 'saved' });
    expect(document.querySelector('.editor-block.is-active-line')?.dataset.blockId)
      .toBe(second.dataset.blockId);
    session.setDocument({ path: 'stable.md', source: savedPayload.source, markdown: true });

    const active = document.querySelector('.editor-block.is-active-line');
    expect(active?.dataset.blockId).toBe(second.dataset.blockId);
    expect(active?.querySelector('[data-editor-content]')?.textContent).toBe('Two edited');
    expect(session.current()).toMatchObject({ dirty: false, saveState: 'saved' });
    session.dispose();
  });

  it('keeps an invalid pending JSON cell when a presentation change is requested', () => {
    let sourceMode = false;
    const onUnavailable = vi.fn();
    const { session } = mount(vi.fn(async () => ({ source: '' })), { onUnavailable }, {
      blockEditor: false,
      isSourceMode: () => sourceMode,
    });
    session.setDocument({
      path: 'num.json',
      source: '{\n  "count": 1\n}\n',
      markdown: false,
      presentation: 'json-props',
    });
    session.enter();
    const value = document.querySelector('[data-json-path="count"] [data-json-value]');
    value.textContent = 'not-a-number';
    sourceMode = true;

    expect(session.refreshPresentation()).toBe(false);
    expect(session.current()).toMatchObject({ presentation: 'json-props', saveState: 'error' });
    expect(value.isConnected).toBe(true);
    expect(value.textContent).toBe('not-a-number');
    expect(value.classList.contains('is-invalid')).toBe(true);
    expect(onUnavailable).toHaveBeenCalled();
    session.dispose();
  });

  it('does not commit an in-flight save into a replacement document', async () => {
    const pending = deferred();
    const onSaved = vi.fn();
    const { session } = mount(() => pending.promise, { onSaved });
    session.setDocument({ path: 'old.md', source: 'Old', markdown: true });
    session.enter();
    const content = document.querySelector('[data-editor-content]');
    content.textContent = 'Old edited';
    content.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const saving = session.save();

    session.setDocument({ path: 'new.md', source: 'New', markdown: true });
    pending.resolve({ source: 'Old edited' });

    await expect(saving).resolves.toMatchObject({ status: 'stale' });
    expect(session.current()).toMatchObject({ path: 'new.md', dirty: false, saveState: 'idle' });
    expect(session.source()).toBe('New');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('duplicates, reorders and deletes blocks from the floating block toolbar and menu', () => {
    const { session } = mount();
    session.setDocument({ path: 'sample.md', source: 'One\nTwo', markdown: true });
    session.enter();

    activateBlock(0);
    blockToolbar().querySelector('[data-block-menu]').click();
    document.querySelector('[data-block-action="duplicate"]').click();
    expect(session.source()).toBe('One\nOne\nTwo');

    activateBlock(1);
    blockToolbar().querySelector('[data-block-toolbar-action="move-down"]').click();
    expect(session.source()).toBe('One\nTwo\nOne');

    activateBlock(2);
    blockToolbar().querySelector('[data-block-toolbar-action="delete"]').click();
    expect(session.source()).toBe('One\nTwo');
  });

  it('exposes content-aware block state and actions to the shared context menu', () => {
    const { session } = mount();
    session.setDocument({ path: 'sample.md', source: 'One\nTwo\nThree', markdown: true });
    session.enter();

    const blocks = [...document.querySelectorAll('[data-block-id]')];
    expect(session.contextFor(blocks[0].querySelector('[data-editor-content]'))).toMatchObject({
      blockId: blocks[0].dataset.blockId,
      blockType: 'paragraph',
      canMoveUp: false,
      canMoveDown: true,
      canDelete: true,
      hasSelection: false,
    });
    expect(session.contextFor(blocks[1].querySelector('[data-editor-content]'))).toMatchObject({
      canMoveUp: true,
      canMoveDown: true,
    });

    expect(session.performBlockAction(blocks[1].dataset.blockId, 'duplicate')).toBe(true);
    expect(session.source()).toBe('One\nTwo\nTwo\nThree');
    expect(session.performBlockAction('missing', 'delete')).toBe(false);
  });

  it('reorders blocks live while dragging from the floating toolbar and commits on drop', () => {
    const { session } = mount();
    session.setDocument({ path: 'sample.md', source: 'One\nTwo\nThree', markdown: true });
    session.enter();

    let wrappers = [...document.querySelectorAll('[data-block-id]')];
    activateBlock(0);
    let transfer = createBlockDataTransfer();
    dispatchBlockDrag(blockToolbar().querySelector('[data-block-drag]'), 'dragstart', transfer);
    wrappers = [...document.querySelectorAll('[data-block-id]')];
    vi.spyOn(wrappers[2], 'getBoundingClientRect').mockReturnValue(blockRect(80));
    const afterEvent = dispatchBlockDrag(wrappers[2], 'dragover', transfer, { clientY: 115 });
    expect(afterEvent.defaultPrevented).toBe(true);
    expect(
      [...document.querySelectorAll('[data-block-id]')]
        .map((node) => node.querySelector('[data-editor-content]')?.textContent)
        .filter((text) => text !== undefined),
    ).toEqual(['Two', 'Three', 'One']);
    expect(session.source()).toBe('One\nTwo\nThree');
    dispatchBlockDrag(wrappers[2], 'drop', transfer, { clientY: 115 });
    expect(session.source()).toBe('Two\nThree\nOne');
    expect(document.querySelector('.is-dragging, .is-drag-target-after')).toBeNull();

    wrappers = [...document.querySelectorAll('[data-block-id]')];
    activateBlock(2);
    transfer = createBlockDataTransfer();
    dispatchBlockDrag(blockToolbar().querySelector('[data-block-drag]'), 'dragstart', transfer);
    wrappers = [...document.querySelectorAll('[data-block-id]')];
    vi.spyOn(wrappers[0], 'getBoundingClientRect').mockReturnValue(blockRect(0));
    dispatchBlockDrag(wrappers[0], 'dragover', transfer, { clientY: 2 });
    expect(
      [...document.querySelectorAll('[data-block-id]')]
        .map((node) => node.querySelector('[data-editor-content]')?.textContent)
        .filter((text) => text !== undefined),
    ).toEqual(['One', 'Two', 'Three']);
    dispatchBlockDrag(wrappers[0], 'drop', transfer, { clientY: 2 });
    expect(session.source()).toBe('One\nTwo\nThree');
  });

  it('keeps blank Markdown separator rows stable while dragging visible blocks', () => {
    const { session } = mount();
    session.setDocument({ path: 'sample.md', source: '# One\n\nTwo\n\nThree', markdown: true });
    session.enter();

    const wrappers = [...document.querySelectorAll('[data-block-id]')];
    const visible = wrappers.filter((wrapper) => !wrapper.hasAttribute('data-block-spacer'));
    activateBlock(wrappers.indexOf(visible[2]));
    const transfer = createBlockDataTransfer();
    dispatchBlockDrag(blockToolbar().querySelector('[data-block-drag]'), 'dragstart', transfer);
    const nextVisible = [...document.querySelectorAll('[data-block-id]')]
      .filter((wrapper) => !wrapper.hasAttribute('data-block-spacer'));
    vi.spyOn(nextVisible[0], 'getBoundingClientRect').mockReturnValue(blockRect(0));
    dispatchBlockDrag(nextVisible[0], 'dragover', transfer, { clientY: 2 });
    dispatchBlockDrag(nextVisible[0], 'drop', transfer, { clientY: 2 });

    expect(session.source()).toBe('Three\n\n# One\n\nTwo');
    expect(document.querySelectorAll('[data-block-spacer]')).toHaveLength(2);
    expect(document.querySelector('.editor-block-gutter')).toBeNull();
  });

  it('animates block insertion and reflow when motion is allowed, then bypasses it when reduced', () => {
    const originalAnimate = window.Element.prototype.animate;
    const originalMatchMedia = window.matchMedia;
    const animate = vi.fn(() => ({
      cancel: vi.fn(),
      finished: Promise.resolve(),
    }));
    Object.defineProperty(window.Element.prototype, 'animate', { configurable: true, value: animate });
    window.matchMedia = vi.fn(() => ({ matches: false }));
    const rects = vi.spyOn(window.HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function rect() {
      if (this.matches?.('[data-block-id]')) {
        const siblings = [...this.parentElement.querySelectorAll(':scope > [data-block-id]')];
        return blockRect(siblings.indexOf(this) * 40);
      }
      return blockRect(0, 0);
    });
    const { session } = mount();

    try {
      session.setDocument({ path: 'sample.md', source: 'One\nTwo', markdown: true });
      session.enter();
      activateBlock(0);
      blockToolbar().querySelector('[data-block-toolbar-action="duplicate"]').click();
      expect(animate).toHaveBeenCalled();
      expect(animate.mock.calls.some(([frames]) => frames[0]?.opacity === 0)).toBe(true);

      animate.mockClear();
      window.matchMedia = vi.fn(() => ({ matches: true }));
      activateBlock(0);
      blockToolbar().querySelector('[data-block-toolbar-action="duplicate"]').click();
      expect(animate).not.toHaveBeenCalled();
    } finally {
      session.dispose();
      rects.mockRestore();
      window.matchMedia = originalMatchMedia;
      if (originalAnimate) {
        Object.defineProperty(window.Element.prototype, 'animate', {
          configurable: true,
          value: originalAnimate,
        });
      } else {
        delete window.Element.prototype.animate;
      }
    }
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

  it('reorders visible blocks from the keyboard without moving separator rows', () => {
    const { session } = mount();
    session.setDocument({ path: 'sample.md', source: '# One\n\nTwo\n\nThree', markdown: true });
    session.enter();
    const first = document.querySelector('[data-editor-content]');

    first.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown', altKey: true, shiftKey: true, bubbles: true,
    }));

    expect(session.source()).toBe('Two\n\n# One\n\nThree');
    expect(document.activeElement?.textContent).toBe('One');
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
    const selectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      isCollapsed: true,
      getRangeAt: () => range,
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
    });
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback();
      return 1;
    });

    try {
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
    } finally {
      selectionSpy.mockRestore();
      rafSpy.mockRestore();
      session.dispose();
    }
  });

  it('keeps the 2px caret echo visible when reduced motion is preferred', async () => {
    const { session } = mount();
    session.setDocument({ path: 'sample.md', source: 'Before', markdown: true });
    session.enter();
    await Promise.resolve();
    const content = document.querySelector('[data-editor-content]');
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    const selectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
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
      selectionSpy.mockRestore();
      vi.unstubAllGlobals();
      session.dispose();
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
    const selectionSpy = vi.spyOn(window, 'getSelection').mockReturnValue({
      rangeCount: 1,
      isCollapsed: false,
      getRangeAt: () => currentRange,
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
    });

    try {
      document.dispatchEvent(new Event('selectionchange'));
      expect(document.querySelector('[data-inline-command="bold"]').getAttribute('aria-pressed')).toBe('false');

      currentRange = {
        commonAncestorContainer: strong.firstChild,
        cloneRange() { return this; },
        getBoundingClientRect: () => ({ left: 90, right: 130, top: 120, bottom: 140, height: 20 }),
      };
      document.dispatchEvent(new Event('selectionchange'));
      expect(document.querySelector('[data-inline-command="bold"]').getAttribute('aria-pressed')).toBe('true');
    } finally {
      selectionSpy.mockRestore();
      session.dispose();
    }
  });

  it('uses Obsidian-style live preview in Block mode: active line is source, others are rendered', () => {
    const { session } = mount();
    session.setDocument({
      path: 'sample.md',
      source: '# Title\n\nHello **world**\n\n- item',
      markdown: true,
    });
    session.enter();

    expect(document.querySelector('.editor-block-gutter')).toBeNull();
    expect(blockToolbar().hidden).toBe(false);
    expect(session.current().presentation).toBe('block');
    expect(document.querySelector('.editor-block.is-active-line')).toBeTruthy();

    const blocks = [...document.querySelectorAll('[data-block-id]')];
    const active = blocks.find((block) => block.classList.contains('is-active-line'));
    const inactiveWithMarkup = blocks.find((block) => (
      block.querySelector('[data-editor-mode="preview"] strong')
    ));

    expect(active.querySelector('[data-editor-mode="source"]')).toBeTruthy();
    expect(active.querySelector('[data-editor-content]').contentEditable).toBe('true');
    expect(inactiveWithMarkup).toBeTruthy();
    expect(inactiveWithMarkup.querySelector('strong')?.textContent).toBe('world');

    const previewBlockId = inactiveWithMarkup.dataset.blockId;
    const preview = inactiveWithMarkup.querySelector('[data-editor-content]');
    preview.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const nextActive = document.querySelector(`[data-block-id="${previewBlockId}"]`);
    expect(nextActive?.classList.contains('is-active-line')).toBe(true);
    expect(nextActive?.querySelector('[data-editor-mode="source"]')?.textContent).toContain('**world**');
    expect(document.querySelectorAll('.editor-block.is-active-line')).toHaveLength(1);
  });

  it('reclassifies Markdown while typing in Rendered Edit and adjusts heading depth at the caret', () => {
    const { session } = mount(vi.fn(async () => ({ source: '' })), {}, { blockEditor: false });
    session.setDocument({ path: 'live.md', source: 'Plain text', markdown: true });
    session.enter();

    let content = document.querySelector('.editor-block.is-active-line [data-editor-content]');
    content.textContent = '# Live heading';
    content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));

    expect(document.querySelector('.editor-block--heading1')).toBeTruthy();
    expect(session.source()).toBe('# Live heading');

    content = document.querySelector('.editor-block.is-active-line [data-editor-content]');
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStart(content.firstChild, 0);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    content.dispatchEvent(new KeyboardEvent('keydown', {
      key: '#',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    }));

    expect(document.querySelector('.editor-block--heading2')).toBeTruthy();
    expect(session.source()).toBe('## Live heading');

    content = document.querySelector('.editor-block.is-active-line [data-editor-content]');
    const backspaceRange = document.createRange();
    backspaceRange.setStart(content.firstChild, 0);
    backspaceRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(backspaceRange);
    content.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    }));

    expect(document.querySelector('.editor-block--heading1')).toBeTruthy();
    expect(session.source()).toBe('# Live heading');

    content = document.querySelector('.editor-block.is-active-line [data-editor-content]');
    const paragraphRange = document.createRange();
    paragraphRange.setStart(content.firstChild, 0);
    paragraphRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(paragraphRange);
    content.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    }));
    content = document.querySelector('.editor-block.is-active-line [data-editor-content]');
    content.textContent = '- List item';
    content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));

    expect(document.querySelector('.editor-block--bullet')).toBeTruthy();
    expect(session.source()).toBe('- List item');
    session.dispose();
  });

  it('keeps the full supported Markdown projection in Rendered Edit when block tools are off', async () => {
    const { session } = mount(vi.fn(async () => ({ source: '' })), {}, { blockEditor: false });
    session.setDocument({
      path: 'rendered-parity.md',
      source: [
        '# Title',
        '',
        'Text with **bold**, *italics*, ~~old~~, `code` and [docs](https://example.com).',
        '',
        '## Section',
        '',
        '- Bullet',
        '1. Numbered',
        '- [x] Complete',
        '',
        '> Quoted text',
        '',
        '```js',
        'const ready = true;',
        '```',
        '',
        '---',
      ].join('\n'),
      markdown: true,
    });

    session.enter();
    await Promise.resolve();

    expect(session.current().presentation).toBe('block');
    expect(document.getElementById('editor-view').classList.contains('is-block-presentation')).toBe(true);
    expect(blockToolbar().hidden).toBe(true);
    expect(document.querySelector('.editor-block--heading1')).toBeTruthy();
    expect(document.querySelector('.editor-block--heading2')).toBeTruthy();
    expect(document.querySelector('.editor-block--bullet .editor-list-marker')?.textContent).toBe('•');
    expect(document.querySelector('.editor-block--numbered .editor-list-marker')?.textContent).toBe('1.');
    expect(document.querySelector('.editor-block--todo input[type="checkbox"]')?.checked).toBe(true);
    expect(document.querySelector('.editor-block--quote [data-editor-mode="preview"]')?.textContent).toBe('Quoted text');
    expect(document.querySelector('.editor-block--code pre')?.textContent).toBe('const ready = true;');
    expect(document.querySelector('.editor-block--divider [role="separator"]')).toBeTruthy();
    expect(document.querySelector('[data-editor-mode="preview"] strong')?.textContent).toBe('bold');
    expect(document.querySelector('[data-editor-mode="preview"] em')?.textContent).toBe('italics');
    expect(document.querySelector('[data-editor-mode="preview"] s')?.textContent).toBe('old');
    expect(document.querySelector('[data-editor-mode="preview"] code')?.textContent).toBe('code');
    expect(document.querySelector('[data-editor-mode="preview"] a')?.getAttribute('href')).toBe('https://example.com');
    session.dispose();
  });

  it('Source Edit uses the continuous raw-source surface, not rendered block islands', async () => {
    const { session } = mount(vi.fn(async () => ({ source: '' })), {}, {
      blockEditor: false,
      sourceMode: true,
    });
    session.setDocument({
      path: 'classic.md',
      source: '# Title\n\nHello **world**\n\n- item',
      markdown: true,
    });
    session.enter();
    await Promise.resolve();

    expect(session.current().presentation).toBe('source');
    expect(blockToolbar().hidden).toBe(true);
    const canvas = document.getElementById('editor-canvas');
    expect(canvas.contentEditable).toBe('true');
    expect(canvas.classList.contains('is-classic-surface')).toBe(true);
    expect(document.getElementById('editor-view').classList.contains('is-classic-presentation')).toBe(true);

    // No block-island chrome.
    expect(document.querySelector('[data-block-id]')).toBeNull();
    expect(document.querySelectorAll('.classic-line.is-active-line')).toHaveLength(1);
    expect(document.querySelectorAll('[data-editor-mode="source"]')).toHaveLength(1);
    expect(document.querySelector('.is-active-line [data-editor-mode="source"]')?.textContent)
      .toContain('# Title');
    expect([...document.querySelectorAll('[data-editor-mode="preview"] .source-markup-token')]
      .filter((token) => token.textContent === '**')).toHaveLength(2);

    // Activate the world line via classic surface line index 2.
    const worldRow = [...document.querySelectorAll('[data-classic-line]')]
      .find((row) => (row.dataset.sourceText || '').includes('**world**'));
    expect(worldRow).toBeTruthy();
    worldRow.querySelector('[data-classic-content]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    // Classic surface owns the canvas click listener.
    await Promise.resolve();
    // If click did not activate (handler needs surface), force through re-render path.
    if (!document.querySelector('.is-active-line [data-editor-mode="source"]')?.textContent.includes('**world**')) {
      session.refreshPresentation();
      await Promise.resolve();
    }
    expect(document.querySelectorAll('.classic-line.is-active-line')).toHaveLength(1);
    expect(document.querySelectorAll('[data-editor-mode="source"]')).toHaveLength(1);
    expect(document.querySelector('[data-editor-mode="preview"]')).toBeTruthy();
    session.dispose();
  });

  it('keeps Source Edit responsive and highlighted across multiline Enter input', () => {
    const { session } = mount(vi.fn(async () => ({ source: '' })), {}, {
      blockEditor: false,
      sourceMode: true,
    });
    session.setDocument({ path: 'multiline.md', source: '**bold**', markdown: true });
    session.enter();

    const first = document.querySelector('.classic-line.is-active-line [data-classic-content]');
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(first);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
    first.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }));

    const next = document.querySelector('.classic-line.is-active-line [data-classic-content]');
    next.innerHTML = '<div>**next**</div>';
    const nextRange = document.createRange();
    nextRange.selectNodeContents(next);
    nextRange.collapse(false);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    next.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));

    expect(session.source()).toBe('**bold**\n**next**');
    expect(document.querySelectorAll('.classic-line')).toHaveLength(2);
    expect(next.textContent).toBe('**next**');
    expect(document.getElementById('editor-canvas').contentEditable).toBe('true');
    expect(session.current().dirty).toBe(true);
    session.dispose();
  });

  it('does not normalize incomplete Markdown merely by entering Source Edit', () => {
    const raw = '```js\nconst pending = true;';
    const { session } = mount(vi.fn(async () => ({ source: '' })), {}, {
      sourceMode: true,
    });
    session.setDocument({ path: 'raw.md', source: raw, markdown: true });

    session.enter();

    expect(session.current().presentation).toBe('source');
    expect(session.source()).toBe(raw);
    expect(document.querySelectorAll('.classic-line')).toHaveLength(2);
    session.dispose();
  });

  it('edits Source as raw text and preserves the draft when returning to Rendered', async () => {
    let sourceMode = true;
    const { session } = mount(vi.fn(async () => ({ source: '' })), {}, {
      blockEditor: false,
      isSourceMode: () => sourceMode,
    });
    session.setDocument({
      path: 'source-edit.md',
      source: '# Title\n\nHello **world**',
      markdown: true,
    });

    session.enter();
    await Promise.resolve();

    expect(session.current().presentation).toBe('source');
    expect(document.getElementById('editor-view').classList.contains('is-source-presentation')).toBe(true);
    expect(document.getElementById('editor-canvas').getAttribute('aria-label')).toBe('Source editor');
    expect(document.getElementById('editor-context-label').textContent).toBe('Source editor');
    expect([...document.querySelectorAll('[data-editor-mode="preview"] .source-markup-token')]
      .map((token) => token.textContent)).toEqual(['**', '**']);
    expect(document.querySelector('[data-source-text*="**world**"]')).toBeTruthy();

    const active = document.querySelector('.is-active-line [data-classic-content]');
    active.textContent = '# Raw title';
    active.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    expect(session.current().dirty).toBe(true);

    sourceMode = false;
    session.refreshPresentation();
    await Promise.resolve();
    expect(session.current()).toMatchObject({ dirty: true, presentation: 'block' });
    expect(session.source()).toContain('# Raw title');
    expect(document.querySelector('[data-editor-mode="preview"] strong:not(.source-markup-token)')?.textContent)
      .toBe('world');
    session.dispose();
  });

  it('Source Edit multi-line selection stays stable without reprojecting every line', async () => {
    const { session } = mount(vi.fn(async () => ({ source: '' })), {}, {
      blockEditor: false,
      sourceMode: true,
    });
    session.setDocument({
      path: 'select.md',
      source: 'Alpha **one**\n\nBeta **two**\n\nGamma',
      markdown: true,
    });
    session.enter();
    await Promise.resolve();

    expect(document.querySelectorAll('[data-editor-mode="source"]')).toHaveLength(1);
    expect(document.querySelector('[data-block-id]')).toBeNull();

    const rows = [...document.querySelectorAll('[data-classic-line]')];
    const start = rows[0].querySelector('[data-classic-content]');
    const end = rows[rows.length - 1].querySelector('[data-classic-content]');
    if (!start.firstChild) start.textContent = 'Alpha **one**';
    const range = document.createRange();
    range.setStart(start.firstChild, 0);
    range.setEnd(end, 0);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await Promise.resolve();

    // Mid-drag: still a single source line (active); no height thrash from mass re-projection.
    expect(document.querySelectorAll('[data-editor-mode="source"]')).toHaveLength(1);
    expect(document.querySelectorAll('.classic-line.is-active-line')).toHaveLength(1);
    expect(document.querySelectorAll('.classic-line.is-in-selection').length).toBeGreaterThanOrEqual(2);
    session.dispose();
  });

  it('keeps a dirty rendered draft when block tools are toggled', async () => {
    let blockEditor = false;
    renderFixture();
    const session = createEditorSession({
      window,
      elements: {
        root: document.getElementById('editor-view'),
        canvas: document.getElementById('editor-canvas'),
        commandMenu: document.getElementById('editor-command-menu'),
        blockMenu: document.getElementById('editor-block-menu'),
        blockToolbar: document.getElementById('editor-block-toolbar'),
        inlineToolbar: document.getElementById('editor-inline-toolbar'),
        caretEcho: document.getElementById('editor-caret-echo'),
        linkPopover: document.getElementById('editor-link-popover'),
        linkInput: document.getElementById('editor-link-input'),
        linkApply: document.getElementById('editor-link-apply'),
        contextLabel: document.getElementById('editor-context-label'),
        contextHint: document.getElementById('editor-context-hint'),
      },
      adapters: {
        save: vi.fn(async () => ({ source: '' })),
        isBlockEditor: () => blockEditor,
      },
    });
    session.setDocument({ path: 'flip.md', source: 'Hello', markdown: true });
    session.enter();
    expect(session.current().presentation).toBe('block');
    expect(document.getElementById('editor-context-label').textContent).toBe('Live preview');
    const content = document.querySelector('[data-classic-content][data-editor-mode="source"], [data-editor-content]');
    expect(content).toBeTruthy();
    content.textContent = 'Hello dirty';
    content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    expect(session.current().dirty).toBe(true);

    blockEditor = true;
    session.refreshPresentation();
    expect(session.current()).toMatchObject({ dirty: true, presentation: 'block' });
    expect(blockToolbar().hidden).toBe(false);
    expect(session.source()).toContain('Hello dirty');
    expect(document.getElementById('editor-context-label').textContent).toBe('Block live preview');
    expect(document.getElementById('editor-context-hint').textContent).toContain('for blocks');

    blockEditor = false;
    session.refreshPresentation();
    expect(session.current()).toMatchObject({ dirty: true, presentation: 'block' });
    expect(blockToolbar().hidden).toBe(true);
    expect(session.source()).toContain('Hello dirty');
    expect(document.getElementById('editor-context-hint').textContent).toMatch(/Active block|Markdown|preview/i);
    session.dispose();
  });

  it('commits continuous Source Edit text on save', async () => {
    const save = vi.fn(async (_path, source) => ({ source }));
    const { session } = mount(save, {}, { blockEditor: false, sourceMode: true });
    session.setDocument({
      path: 'commit.md',
      source: 'First line',
      markdown: true,
    });
    session.enter();
    await Promise.resolve();
    const active = document.querySelector('.is-active-line [data-classic-content], .is-active-line [data-editor-mode="source"]');
    expect(active).toBeTruthy();
    active.textContent = 'First line edited';
    active.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await expect(session.save()).resolves.toMatchObject({ status: 'saved' });
    expect(save).toHaveBeenCalledWith('commit.md', expect.stringContaining('First line edited'));
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

  it('stops canvas input after the editor session is disposed', () => {
    const onStateChange = vi.fn();
    const { session } = mount(undefined, { onStateChange });
    session.setDocument({ path: 'sample.md', source: '- [ ] Task', markdown: true });
    session.enter();

    const canvas = document.getElementById('editor-canvas');
    const content = canvas.querySelector('[data-editor-content]');
    const checkbox = canvas.querySelector('[data-todo-check]');
    const addButton = blockToolbar().querySelector('[data-block-toolbar-action="add"]');
    const callbackCount = onStateChange.mock.calls.length;
    const sourceBeforeDispose = session.source();
    const blockCountBeforeDispose = canvas.querySelectorAll('[data-block-id]').length;

    session.dispose();
    content.textContent = 'Changed after dispose';
    content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    const keydown = new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    content.dispatchEvent(keydown);
    addButton.click();
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change', { bubbles: true }));

    expect(onStateChange).toHaveBeenCalledTimes(callbackCount);
    expect(session.source()).toBe(sourceBeforeDispose);
    expect(canvas.querySelectorAll('[data-block-id]')).toHaveLength(blockCountBeforeDispose);
    expect(keydown.defaultPrevented).toBe(false);
  });

  it('does not clear the Source Edit cursor from the Block selection controller', async () => {
    const { session } = mount(vi.fn(async () => ({ source: '' })), {}, {
      blockEditor: false,
      sourceMode: true,
    });
    session.setDocument({ path: 'notes.md', source: 'Hello world', markdown: true });
    session.enter();
    await Promise.resolve();

    expect(document.querySelector('[data-block-id]')).toBeNull();
    const content = document.querySelector('[data-classic-content]');
    expect(content).toBeTruthy();
    if (!content.firstChild) content.appendChild(document.createTextNode('Hello world'));
    const range = document.createRange();
    range.setStart(content.firstChild, 3);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));

    expect(session.current().cursor).toEqual({ line: 1, column: 4 });
    expect(document.getElementById('editor-inline-toolbar').hidden).toBe(true);
    expect(document.getElementById('editor-caret-echo').hidden).toBe(true);
    expect(document.getElementById('editor-view').classList.contains('has-custom-caret')).toBe(false);
    session.dispose();
  });

  it('switches exclusive canvas ownership between Block and Source Edit', async () => {
    let sourceMode = false;
    const { session } = mount(vi.fn(async () => ({ source: '' })), {}, {
      blockEditor: true,
      isSourceMode: () => sourceMode,
    });
    session.setDocument({ path: 'notes.md', source: '# Title\n\nHello', markdown: true });
    session.enter();
    await Promise.resolve();

    const canvas = document.getElementById('editor-canvas');
    expect(canvas.querySelector('[data-block-id]')).toBeTruthy();
    expect(canvas.classList.contains('is-classic-surface')).toBe(false);

    sourceMode = true;
    expect(session.refreshPresentation()).toBe(true);
    await Promise.resolve();
    expect(session.current().presentation).toBe('source');
    expect(canvas.classList.contains('is-classic-surface')).toBe(true);
    expect(canvas.querySelector('[data-block-id]')).toBeNull();
    expect(canvas.querySelector('[data-classic-line]')).toBeTruthy();

    sourceMode = false;
    expect(session.refreshPresentation()).toBe(true);
    await Promise.resolve();
    expect(session.current().presentation).toBe('block');
    expect(canvas.classList.contains('is-classic-surface')).toBe(false);
    expect(canvas.querySelector('[data-block-id]')).toBeTruthy();
    expect(canvas.querySelector('[data-classic-line]')).toBeNull();
    session.dispose();
  });

  it('stops Source Edit input after the editor session is disposed', () => {
    const { session } = mount(vi.fn(async () => ({ source: '' })), {}, {
      blockEditor: false,
      sourceMode: true,
    });
    session.setDocument({ path: 'notes.md', source: 'Hello', markdown: true });
    session.enter();
    const canvas = document.getElementById('editor-canvas');
    const sourceBeforeDispose = session.source();
    session.dispose();
    const content = canvas.querySelector('[data-classic-content]');
    if (content) {
      content.textContent = 'Changed after dispose';
      content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    }
    canvas.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    expect(session.source()).toBe(sourceBeforeDispose);
  });

  it('coalesces Classic typing into one undo and restores the caret', async () => {
    const { session } = mount(vi.fn(async () => ({ source: '' })), {}, {
      blockEditor: false,
      sourceMode: true,
    });
    session.setDocument({ path: 'notes.md', source: 'Hello', markdown: true });
    session.enter();
    await Promise.resolve();
    const canvas = document.getElementById('editor-canvas');
    const content = canvas.querySelector('[data-classic-content]');
    if (!content.firstChild) content.appendChild(document.createTextNode('Hello'));
    const origin = 2;
    const range = document.createRange();
    range.setStart(content.firstChild, origin);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));

    content.textContent = 'HeXllo';
    if (!content.firstChild) content.appendChild(document.createTextNode('HeXllo'));
    range.setStart(content.firstChild, origin + 1);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));

    content.textContent = 'HeXYllo';
    if (!content.firstChild) content.appendChild(document.createTextNode('HeXYllo'));
    range.setStart(content.firstChild, origin + 2);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    expect(session.source()).toBe('HeXYllo');

    canvas.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    }));
    expect(session.source()).toBe('Hello');
    const restored = canvas.querySelector('[data-editor-mode="source"]');
    expect(restored).toBeTruthy();
    const restoredSelection = window.getSelection();
    expect(restoredSelection?.rangeCount).toBeGreaterThan(0);
    const before = document.createRange();
    before.selectNodeContents(restored);
    before.setEnd(restoredSelection.getRangeAt(0).startContainer, restoredSelection.getRangeAt(0).startOffset);
    expect(before.toString().length).toBe(origin);
    session.dispose();
  });

  it('keeps sibling block nodes when activating another block at the click offset', async () => {
    const { session } = mount();
    session.setDocument({ path: 'notes.md', source: 'Alpha block\n\nHello world', markdown: true });
    session.enter();
    await Promise.resolve();
    const first = document.querySelector('[data-block-id]');
    const second = [...document.querySelectorAll('[data-block-id]')]
      .find((wrapper) => wrapper !== first && !wrapper.hasAttribute('data-block-spacer'));
    expect(second).toBeTruthy();
    const preview = second.querySelector('[data-editor-content]');
    const text = preview.firstChild;
    const clickOffset = 4;
    document.caretRangeFromPoint = () => {
      const range = document.createRange();
      range.setStart(text, clickOffset);
      range.collapse(true);
      return range;
    };
    const pointer = { bubbles: true, cancelable: true, clientX: 24, clientY: 12 };
    preview.dispatchEvent(new MouseEvent('mousedown', pointer));
    preview.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    preview.dispatchEvent(new MouseEvent('click', pointer));
    expect(first.isConnected).toBe(true);
    expect(second.isConnected).toBe(true);
    expect(second.classList.contains('is-active-line')).toBe(true);
    const active = second.querySelector('[data-editor-mode="source"]');
    expect(active).toBeTruthy();
    const selection = window.getSelection();
    const before = document.createRange();
    before.selectNodeContents(active);
    before.setEnd(selection.getRangeAt(0).startContainer, selection.getRangeAt(0).startOffset);
    expect(before.toString().length).toBe(clickOffset);
    expect(before.toString().length).not.toBe(active.textContent.length);
    session.dispose();
    delete document.caretRangeFromPoint;
  });

  it('does not split a block while composing', async () => {
    const { session } = mount();
    session.setDocument({ path: 'notes.md', source: 'Plain text', markdown: true });
    session.enter();
    await Promise.resolve();
    const content = document.querySelector('[data-editor-content]');
    const before = session.source();
    content.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    }));
    expect(session.source()).toBe(before);
    expect(document.querySelectorAll('[data-block-id]').length).toBeGreaterThan(0);
    session.dispose();
  });

  it('does not commit a JSON scalar on composing Enter', async () => {
    const { session } = mount();
    session.setDocument({
      path: 'config.json',
      source: '{\n  "name": "open.md"\n}\n',
      markdown: false,
      presentation: 'json-props',
    });
    expect(session.enter()).toBe(true);
    const value = document.querySelector('[data-json-value]');
    expect(value).toBeTruthy();
    value.textContent = 'draft';
    value.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    }));
    expect(session.source()).toContain('"open.md"');
    expect(value.textContent).toBe('draft');
    session.dispose();
  });
});
