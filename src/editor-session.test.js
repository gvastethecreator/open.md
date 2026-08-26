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
  const session = createEditorSession({
    window,
    elements: {
      root: document.getElementById('editor-view'),
      canvas: document.getElementById('editor-canvas'),
      contextLabel: document.getElementById('editor-context-label'),
      contextHint: document.getElementById('editor-context-hint'),
    },
    adapters: {
      save,
      isSourceMode: typeof options.isSourceMode === 'function'
        ? options.isSourceMode
        : () => Boolean(options.sourceMode),
    },
    hooks,
  });
  return { session, save };
}

function activeSource() {
  return document.querySelector('[data-classic-content][data-editor-mode="source"]');
}

describe('editor session', () => {
  it('enters Markdown Rendered Edit on the Classic live-preview surface and saves', async () => {
    const { session, save } = mount();
    session.setDocument({ path: 'C:\\notes\\sample.md', source: '# Note\n\nParagraph', markdown: true });

    expect(session.enter()).toBe(true);
    await Promise.resolve();
    expect(document.getElementById('editor-view').hidden).toBe(false);
    expect(session.current().presentation).toBe('classic');
    expect(document.getElementById('editor-view').classList.contains('is-classic-presentation')).toBe(true);
    expect(document.getElementById('editor-canvas').classList.contains('is-classic-surface')).toBe(true);
    expect(document.querySelector('[data-block-id]')).toBeNull();
    expect(document.querySelectorAll('.classic-line')).toHaveLength(3);

    const paragraphRow = [...document.querySelectorAll('[data-classic-line]')]
      .find((row) => (row.dataset.sourceText || '') === 'Paragraph');
    paragraphRow.querySelector('[data-classic-content]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    const content = activeSource();
    content.textContent = 'Paragraph updated';
    content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    expect(session.current()).toMatchObject({ mode: 'edit', dirty: true });

    await expect(session.save()).resolves.toMatchObject({ status: 'saved' });
    expect(save).toHaveBeenCalledWith('C:\\notes\\sample.md', '# Note\n\nParagraph updated');
    expect(session.current()).toMatchObject({ dirty: false, saveState: 'saved' });
    session.dispose();
  });

  it('focuses the canvas without scrolling the reader', async () => {
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

      const canvas = document.getElementById('editor-canvas');
      expect(canvas.classList.contains('is-classic-surface')).toBe(true);
      expect(canvas.contentEditable).toBe('true');
      expect(scrollIntoView).not.toHaveBeenCalled();
      session.dispose();
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

  it('reports undo and redo history restores from Classic keyboard shortcuts', async () => {
    const onHistoryRestore = vi.fn();
    const { session } = mount(undefined, { onHistoryRestore });
    session.setDocument({ path: 'sample.md', source: 'Before', markdown: true });
    session.enter();
    await Promise.resolve();
    const canvas = document.getElementById('editor-canvas');
    const content = activeSource();
    content.textContent = 'After';
    content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(session.source()).toBe('Before');
    expect(onHistoryRestore).toHaveBeenLastCalledWith('undo');

    canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', ctrlKey: true, bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(session.source()).toBe('After');
    expect(onHistoryRestore).toHaveBeenLastCalledWith('redo');
    session.dispose();
  });

  it('preserves a dirty draft when saving fails and supports retry', async () => {
    const save = vi.fn()
      .mockRejectedValueOnce(new Error('Disk full'))
      .mockResolvedValueOnce({ source: 'Changed' });
    const { session } = mount(save);
    session.setDocument({ path: 'sample.txt', source: 'Before', markdown: false });
    session.enter();
    await Promise.resolve();
    const content = activeSource();
    content.textContent = 'Changed';
    content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));

    await expect(session.save()).resolves.toMatchObject({ status: 'failed' });
    expect(session.current()).toMatchObject({ dirty: true, saveState: 'error', error: 'Disk full' });
    await expect(session.save()).resolves.toMatchObject({ status: 'saved' });
    expect(session.current()).toMatchObject({ dirty: false, saveState: 'saved' });
    session.dispose();
  });

  it('enters JSON property editor for valid object sources and flushes pending cells on save', async () => {
    const save = vi.fn(async (_path, source) => ({ source }));
    const { session } = mount(save);
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

    session.refreshPresentation();
    expect(document.querySelector('.json-props')).toBeTruthy();
    expect(document.querySelectorAll('[data-json-property]')).toHaveLength(2);

    const value = document.querySelector('[data-json-path="count"] [data-json-value]');
    value.focus();
    value.textContent = '9';
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
    const { session } = mount(save);
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
    });
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
    const { session } = mount(vi.fn(async () => ({ source: '' })));
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
    session.setDocument({
      path: 'a.json',
      source: '{\n  "count": 1\n}\n',
      markdown: false,
      presentation: 'json-props',
    });
    expect(session.source()).toContain('"count": 7');
    session.dispose();
  });

  it('marks save error when JSON flush rejects invalid cells so autosave backs off', async () => {
    const onUnavailable = vi.fn();
    const save = vi.fn(async (_path, source) => ({ source }));
    const { session } = mount(save, { onUnavailable });
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
    await Promise.resolve();
    const content = activeSource();
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
    session.dispose();
  });

  it('keeps Classic edits after a same-path save payload is applied', async () => {
    const savedPayload = { source: 'One\nTwo edited', html: '<p>One</p><p>Two edited</p>' };
    const { session } = mount(vi.fn(async () => savedPayload));
    session.setDocument({ path: 'stable.md', source: 'One\nTwo', markdown: true });
    session.enter();
    await Promise.resolve();
    const second = [...document.querySelectorAll('[data-classic-line]')]
      .find((row) => (row.dataset.sourceText || '') === 'Two');
    second.querySelector('[data-classic-content]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    const content = activeSource();
    content.textContent = 'Two edited';
    content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));

    await expect(session.save()).resolves.toMatchObject({ status: 'saved' });
    session.setDocument({ path: 'stable.md', source: savedPayload.source, markdown: true });

    expect(session.source()).toBe('One\nTwo edited');
    expect(session.current()).toMatchObject({ dirty: false, saveState: 'saved' });
    session.dispose();
  });

  it('keeps an invalid pending JSON cell when a presentation change is requested', () => {
    let sourceMode = false;
    const onUnavailable = vi.fn();
    const { session } = mount(vi.fn(async () => ({ source: '' })), { onUnavailable }, {
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
    await Promise.resolve();
    const content = activeSource();
    content.textContent = 'Old edited';
    content.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const saving = session.save();

    session.setDocument({ path: 'new.md', source: 'New', markdown: true });
    pending.resolve({ source: 'Old edited' });

    await expect(saving).resolves.toMatchObject({ status: 'stale' });
    expect(session.current()).toMatchObject({ path: 'new.md', dirty: false, saveState: 'idle' });
    expect(session.source()).toBe('New');
    expect(onSaved).not.toHaveBeenCalled();
    session.dispose();
  });

  it('asks before discarding dirty work and keeps editing when declined', () => {
    const { session } = mount();
    session.setDocument({ path: 'sample.md', source: 'Before', markdown: true });
    session.enter();
    const content = activeSource();
    content.textContent = 'Changed';
    content.dispatchEvent(new InputEvent('input', { bubbles: true }));
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);

    expect(session.exit()).toBe(false);
    expect(session.current().mode).toBe('edit');
    expect(confirm).toHaveBeenCalledOnce();
    session.dispose();
    confirm.mockRestore();
  });

  it('uses Obsidian-style live preview: active line is source, others are rendered', async () => {
    const { session } = mount();
    session.setDocument({
      path: 'sample.md',
      source: '# Title\n\nHello **world**\n\n- item',
      markdown: true,
    });
    session.enter();
    await Promise.resolve();

    expect(session.current().presentation).toBe('classic');
    expect(document.getElementById('editor-context-label').textContent).toBe('Live preview');
    expect(document.getElementById('editor-context-hint').textContent)
      .toBe('Active line is Markdown · other lines are preview');
    expect(document.querySelectorAll('[data-editor-mode="source"]')).toHaveLength(1);
    expect(activeSource()?.textContent).toContain('# Title');
    expect(document.querySelector('[data-editor-mode="preview"] strong')?.textContent).toBe('world');

    const preview = [...document.querySelectorAll('[data-classic-line]')]
      .find((row) => row.querySelector('[data-editor-mode="preview"] strong'));
    preview.querySelector('[data-classic-content]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(activeSource()?.textContent).toContain('**world**');
    expect(document.querySelectorAll('[data-editor-mode="source"]')).toHaveLength(1);
    session.dispose();
  });

  it('keeps the full supported Markdown projection in Rendered Edit', async () => {
    const { session } = mount();
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

    expect(session.current().presentation).toBe('classic');
    expect(document.querySelector('[data-editor-mode="preview"] strong')?.textContent).toBe('bold');
    expect(document.querySelector('[data-editor-mode="preview"] em')?.textContent).toBe('italics');
    expect(document.querySelector('[data-editor-mode="preview"] s')?.textContent).toBe('old');
    expect(document.querySelector('[data-editor-mode="preview"] code')?.textContent).toBe('code');
    expect(document.querySelector('[data-editor-mode="preview"] a')?.getAttribute('href')).toBe('https://example.com');
    session.dispose();
  });

  it('Source Edit uses the continuous raw-source surface, not rendered block islands', async () => {
    const { session } = mount(vi.fn(async () => ({ source: '' })), {}, { sourceMode: true });
    session.setDocument({
      path: 'classic.md',
      source: '# Title\n\nHello **world**\n\n- item',
      markdown: true,
    });
    session.enter();
    await Promise.resolve();

    expect(session.current().presentation).toBe('source');
    const canvas = document.getElementById('editor-canvas');
    expect(canvas.contentEditable).toBe('true');
    expect(canvas.classList.contains('is-classic-surface')).toBe(true);
    expect(document.getElementById('editor-view').classList.contains('is-classic-presentation')).toBe(true);
    expect(document.querySelector('[data-block-id]')).toBeNull();
    expect(document.querySelectorAll('.classic-line.is-active-line')).toHaveLength(1);
    expect(document.querySelectorAll('[data-editor-mode="source"]')).toHaveLength(1);
    expect(document.querySelector('.is-active-line [data-editor-mode="source"]')?.textContent)
      .toContain('# Title');
    expect([...document.querySelectorAll('[data-editor-mode="preview"] .source-markup-token')]
      .filter((token) => token.textContent === '**')).toHaveLength(2);

    const worldRow = [...document.querySelectorAll('[data-classic-line]')]
      .find((row) => (row.dataset.sourceText || '').includes('**world**'));
    worldRow.querySelector('[data-classic-content]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(document.querySelectorAll('.classic-line.is-active-line')).toHaveLength(1);
    expect(document.querySelectorAll('[data-editor-mode="source"]')).toHaveLength(1);
    session.dispose();
  });

  it('keeps Source Edit responsive and highlighted across multiline Enter input', () => {
    const { session } = mount(vi.fn(async () => ({ source: '' })), {}, { sourceMode: true });
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
    const { session } = mount(vi.fn(async () => ({ source: '' })), {}, { sourceMode: true });
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

    const active = document.querySelector('.is-active-line [data-classic-content]');
    active.textContent = '# Raw title';
    active.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    expect(session.current().dirty).toBe(true);

    sourceMode = false;
    session.refreshPresentation();
    await Promise.resolve();
    expect(session.current()).toMatchObject({ dirty: true, presentation: 'classic' });
    expect(session.source()).toContain('# Raw title');
    expect(document.querySelector('[data-editor-mode="preview"] strong:not(.source-markup-token)')?.textContent)
      .toBe('world');
    session.dispose();
  });

  it('Source Edit multi-line selection stays stable without reprojecting every line', async () => {
    const { session } = mount(vi.fn(async () => ({ source: '' })), {}, { sourceMode: true });
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

    expect(document.querySelectorAll('[data-editor-mode="source"]')).toHaveLength(1);
    expect(document.querySelectorAll('.classic-line.is-active-line')).toHaveLength(1);
    expect(document.querySelectorAll('.classic-line.is-in-selection').length).toBeGreaterThanOrEqual(2);
    session.dispose();
  });

  it('commits continuous Source Edit text on save', async () => {
    const save = vi.fn(async (_path, source) => ({ source }));
    const { session } = mount(save, {}, { sourceMode: true });
    session.setDocument({
      path: 'commit.md',
      source: 'First line',
      markdown: true,
    });
    session.enter();
    await Promise.resolve();
    const active = activeSource();
    active.textContent = 'First line edited';
    active.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    await expect(session.save()).resolves.toMatchObject({ status: 'saved' });
    expect(save).toHaveBeenCalledWith('commit.md', expect.stringContaining('First line edited'));
    session.dispose();
  });

  it('keeps very large documents in read/source mode instead of rendering unsafe line counts', () => {
    const { session } = mount();
    session.setDocument({
      path: 'large.md',
      source: 'x'.repeat(2 * 1024 * 1024 + 1),
      markdown: true,
    });

    expect(session.enter()).toBe(false);
    expect(session.current()).toMatchObject({ mode: 'read', path: 'large.md' });
    expect(document.getElementById('editor-view').hidden).toBe(true);
    session.dispose();
  });

  it('stops Classic input after the editor session is disposed', () => {
    const { session } = mount();
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

  it('does not mount a Block selection controller on Classic', async () => {
    const { session } = mount(vi.fn(async () => ({ source: '' })), {}, { sourceMode: true });
    session.setDocument({ path: 'notes.md', source: 'Hello world', markdown: true });
    session.enter();
    await Promise.resolve();

    expect(document.querySelector('[data-block-id]')).toBeNull();
    const content = document.querySelector('[data-classic-content]');
    if (!content.firstChild) content.appendChild(document.createTextNode('Hello world'));
    const range = document.createRange();
    range.setStart(content.firstChild, 3);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));

    expect(session.current().cursor).toEqual({ line: 1, column: 4 });
    expect(document.getElementById('editor-view').classList.contains('has-custom-caret')).toBe(false);
    session.dispose();
  });

  it('keeps Classic canvas ownership when switching Rendered and Source Edit', async () => {
    let sourceMode = false;
    const { session } = mount(vi.fn(async () => ({ source: '' })), {}, {
      isSourceMode: () => sourceMode,
    });
    session.setDocument({ path: 'notes.md', source: '# Title\n\nHello', markdown: true });
    session.enter();
    await Promise.resolve();

    const canvas = document.getElementById('editor-canvas');
    expect(session.current().presentation).toBe('classic');
    expect(canvas.classList.contains('is-classic-surface')).toBe(true);
    expect(canvas.querySelector('[data-classic-line]')).toBeTruthy();
    expect(canvas.querySelector('[data-block-id]')).toBeNull();

    sourceMode = true;
    expect(session.refreshPresentation()).toBe(true);
    await Promise.resolve();
    expect(session.current().presentation).toBe('source');
    expect(canvas.classList.contains('is-classic-surface')).toBe(true);
    expect(canvas.querySelector('[data-classic-line]')).toBeTruthy();
    expect(canvas.querySelector('[data-block-id]')).toBeNull();

    sourceMode = false;
    expect(session.refreshPresentation()).toBe(true);
    await Promise.resolve();
    expect(session.current().presentation).toBe('classic');
    expect(canvas.classList.contains('is-classic-surface')).toBe(true);
    expect(canvas.querySelector('[data-classic-line]')).toBeTruthy();
    session.dispose();
  });

  it('coalesces Classic typing into one undo and restores the caret', async () => {
    const { session } = mount(vi.fn(async () => ({ source: '' })), {}, { sourceMode: true });
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
