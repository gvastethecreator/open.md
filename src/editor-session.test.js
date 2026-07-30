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

function mount(save = vi.fn(async () => ({ source: '' }))) {
  renderFixture();
  const session = createEditorSession({
    window,
    elements: {
      root: document.getElementById('editor-view'),
      canvas: document.getElementById('editor-canvas'),
      commandMenu: document.getElementById('editor-command-menu'),
      blockMenu: document.getElementById('editor-block-menu'),
      inlineToolbar: document.getElementById('editor-inline-toolbar'),
      linkPopover: document.getElementById('editor-link-popover'),
      linkInput: document.getElementById('editor-link-input'),
      linkApply: document.getElementById('editor-link-apply'),
    },
    adapters: { save },
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
