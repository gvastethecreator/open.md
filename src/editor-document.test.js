// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  classicLineKinds,
  classicLinePreviewHtml,
  classicLineSourceHtml,
  createEditorDocumentModel,
  getEditorDocumentStats,
  inlineMarkdownToHtml,
  parseEditorDocument,
  serializeEditorDocument,
} from './editor-document.js';

describe('editor document model', () => {
  it('round-trips the supported Markdown block contract without losing blank lines', () => {
    const source = [
      '# Field notes',
      '',
      'A **clear** paragraph with [a link](https://example.com).',
      '- first',
      '  - nested',
      '3. numbered',
      '- [x] shipped',
      '> quoted',
      '---',
      '```js',
      'const saved = true;',
      '```',
    ].join('\n');

    const blocks = parseEditorDocument(source);

    expect(blocks.map((block) => block.type)).toEqual([
      'heading1', 'paragraph', 'paragraph', 'bullet', 'bullet', 'numbered', 'todo', 'quote', 'divider', 'code',
    ]);
    expect(blocks[4]).toMatchObject({ text: 'nested', indent: 1 });
    expect(blocks[5]).toMatchObject({ text: 'numbered', number: 3 });
    expect(blocks[6]).toMatchObject({ checked: true });
    expect(serializeEditorDocument(blocks)).toBe(source);
  });

  it('preserves non-Markdown source text on serialize without block rewrite (F9)', () => {
    const model = createEditorDocumentModel();
    const source = 'key: value\nlist:\n  - one\n  - two\n';
    model.load(source, { markdown: false });
    model.applySource('key: changed\nlist:\n  - one\n  - two\n');
    const serialized = model.snapshot().source;
    expect(serialized.startsWith('key: changed')).toBe(true);
    expect(serialized).not.toContain('# ');
    // Plain mode must not invent Markdown list/heading structure from free text.
    expect(serialized).toContain('list:');
    expect(serialized).toContain('  - one');
    model.dispose();
  });

  it('keeps plain-text lines free from Markdown block conversion', () => {
    const blocks = parseEditorDocument('# literal\n- also literal', { markdown: false });
    expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'paragraph']);
    expect(serializeEditorDocument(blocks, { markdown: false })).toBe('# literal\n- also literal');
  });

  it('renders supported inline Markdown semantics', () => {
    const host = document.createElement('div');
    host.innerHTML = inlineMarkdownToHtml('Use **bold**, *italics*, ~~old~~, `code` and [docs](https://example.com).');

    expect(host.querySelector('strong')?.textContent).toBe('bold');
    expect(host.querySelector('em')?.textContent).toBe('italics');
    expect(host.querySelector('s')?.textContent).toBe('old');
    expect(host.querySelector('code')?.textContent).toBe('code');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
  });

  it('classifies fenced interiors, tables and images for Classic preview', () => {
    const lines = [
      '# Title',
      '',
      'Text with **bold** and `code`.',
      '  - nested',
      '![Desk](assets/quiet-desk.webp)',
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
      '```js',
      'const ready = true;',
      '```',
    ];
    expect(classicLineKinds(lines)).toEqual([
      'heading1',
      'paragraph',
      'paragraph',
      'bullet',
      'image',
      'table',
      'table',
      'table',
      'fence',
      'code',
      'fence',
    ]);
  });

  it('renders Classic preview with document chrome, not raw markers', () => {
    expect(classicLinePreviewHtml('Hello **world** and `code`')).toContain('<strong>world</strong>');
    expect(classicLinePreviewHtml('Hello **world** and `code`')).toContain('<code>code</code>');
    expect(classicLinePreviewHtml('- nested item')).toContain('classic-line-bullet');
    expect(classicLinePreviewHtml('![Desk](assets/quiet-desk.webp)')).toContain(
      'data-document-source="assets/quiet-desk.webp"',
    );
    expect(classicLinePreviewHtml('| A | **B** |')).toContain('classic-line-cell');
    expect(classicLinePreviewHtml('const ready = true;', { kind: 'code' })).toContain(
      'classic-line-code',
    );
    expect(classicLinePreviewHtml('![x](javascript:alert(1))')).not.toContain('src="javascript:');
  });

  it('highlights raw Markdown delimiters without rendering the source', () => {
    const host = document.createElement('div');
    host.innerHTML = classicLineSourceHtml('# <Title> with **bold**', { highlight: true });

    expect([...host.querySelectorAll('.source-markup-token')].map((token) => token.textContent))
      .toEqual(['#', '**', '**']);
    expect(host.textContent).toBe('# <Title> with **bold**');
    expect(host.querySelector('title')).toBeNull();
  });

  it('reports line, word and character stats from source text', () => {
    const stats = getEditorDocumentStats('# One\n\nTwo words\n---');
    expect(stats).toEqual({ lines: 4, words: 5, characters: 20 });

    const model = createEditorDocumentModel({ source: 'one two\r\n😀 tail\rline\r\n' });
    for (const [removed, text] of [[' ', ''], ['two', ' TWO '], ['\r\n', '\n'], ['😀', '🦊🦊'], ['\rline', '\r\nline']]) {
      const previous = model.source();
      const start = previous.indexOf(removed);
      const end = start + removed.length;
      const next = previous.slice(0, start) + text + previous.slice(end);
      model.applySource(next, { change: { start, end, text } });
      expect(model.snapshot().stats).toEqual(getEditorDocumentStats(next));
    }
    model.dispose();
  });

  it('applies source, undoes, and restores cursor without a Block CRUD API', () => {
    const model = createEditorDocumentModel({ source: '# Title\nBody' });
    expect(model.updateBlock).toBeUndefined();
    expect(model.moveRelative).toBeUndefined();
    model.applySource('# Title\n> Body\n- [x] Ship');
    expect(model.source()).toBe('# Title\n> Body\n- [x] Ship');
    expect(model.snapshot().stats.lines).toBe(3);
    expect(model.undo()).toMatchObject({ changed: true, action: 'undo' });
    expect(model.source()).toBe('# Title\nBody');
    expect(model.redo()).toMatchObject({ changed: true, action: 'redo' });
    expect(model.source()).toBe('# Title\n> Body\n- [x] Ship');
    model.dispose();
  });

  it('keeps raw Markdown and line endings through load, edits and history', () => {
    const raw = '# Notes\r\n\r\n* star\r\n\t- nested\r\n1) one\r\n***\r\n```js\r\nunfinished';
    const model = createEditorDocumentModel({ source: raw });
    expect(model.source()).toBe(raw);
    model.load(raw);
    expect(model.applySource(raw)).toBe(false);
    expect(model.snapshot().canUndo).toBe(false);

    const edited = raw.replace('# Notes', '# Edited notes');
    model.applySource(edited);
    expect(model.source()).toBe(edited);
    model.undo();
    expect(model.source()).toBe(raw);
    model.redo();
    expect(model.source()).toBe(edited);
    model.dispose();
  });

  it('keeps bounded undo and redo history independent per model', () => {
    const first = createEditorDocumentModel({ source: 'one', historyLimit: 3 });
    const second = createEditorDocumentModel({ source: 'other' });
    first.applySource('two');
    first.applySource('three');
    first.applySource('four');
    expect(first.undo()).toMatchObject({ changed: true, action: 'undo' });
    expect(first.source()).toBe('three');
    expect(first.redo()).toMatchObject({ changed: true, action: 'redo' });
    expect(first.source()).toBe('four');
    expect(second.source()).toBe('other');
    first.dispose();
    second.dispose();
  });

  it('caps undo history at 16 million characters while retaining the current document', () => {
    const large = 'a'.repeat(9 * 1024 * 1024);
    const model = createEditorDocumentModel({ source: large });
    model.applySource(`b${large.slice(1)}`);
    expect(model.snapshot().canUndo).toBe(false);
    model.applySource('small');
    expect(model.undo().changed).toBe(true);
    expect(model.source()).toBe(`b${large.slice(1)}`);
    model.dispose();
  });

  it('preserves plain-text semantics and publishes cursor snapshots', () => {
    const model = createEditorDocumentModel({ source: '# literal\n- literal', markdown: false });
    const snapshots = [];
    const unsubscribe = model.subscribe((snapshot) => snapshots.push(snapshot));
    model.applySource('# literal\nstill literal');
    model.setCursor({ line: 2, column: 4 });
    expect(model.source()).toBe('# literal\nstill literal');
    expect(model.snapshot().cursor).toEqual({ line: 2, column: 4 });
    expect(snapshots.at(-1).cursor).toEqual({ line: 2, column: 4 });
    unsubscribe();
    model.dispose();
  });

  it('reuses the structural document projection across cursor-only updates', () => {
    const source = Array.from({ length: 2_000 }, (_, index) => `Line ${index + 1}`).join('\n');
    const model = createEditorDocumentModel({ source, markdown: false });
    const before = model.snapshot();

    for (let index = 0; index < 25; index += 1) {
      model.setCursor({ line: index + 1, column: 2 });
    }

    const after = model.snapshot();
    expect(after.cursor).toEqual({ line: 25, column: 2 });
    expect(after.source).toBe(before.source);
    expect(after.stats).toBe(before.stats);
  });
});
