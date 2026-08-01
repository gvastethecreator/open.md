// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
  createEditorDocumentModel,
  editableHtmlToMarkdown,
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
    model.updateBlock(model.snapshot().blocks[0].id, { text: 'key: changed' });
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

  it('converts supported inline Markdown to editable semantics and back', () => {
    const host = document.createElement('div');
    host.innerHTML = inlineMarkdownToHtml('Use **bold**, *italics*, ~~old~~, `code` and [docs](https://example.com).');

    expect(host.querySelector('strong')?.textContent).toBe('bold');
    expect(host.querySelector('em')?.textContent).toBe('italics');
    expect(host.querySelector('s')?.textContent).toBe('old');
    expect(host.querySelector('code')?.textContent).toBe('code');
    expect(host.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    expect(editableHtmlToMarkdown(host)).toBe('Use **bold**, *italics*, ~~old~~, `code` and [docs](https://example.com).');
  });

  it('reports block, word and character stats from user content', () => {
    const stats = getEditorDocumentStats(parseEditorDocument('# One\n\nTwo words\n---'));
    expect(stats).toEqual({ blocks: 4, words: 3, characters: 14 });
  });

  it('owns canonical block CRUD, split, merge and serialization', () => {
    const model = createEditorDocumentModel({ source: '# Title\nBody' });
    const [title, body] = model.snapshot().blocks;
    model.changeType(body.id, 'quote');
    const added = model.addAfter(body.id, { type: 'todo', text: 'Ship', checked: true });
    const copy = model.duplicate(added.id);
    model.move(copy.id, -1);
    expect(model.source()).toBe('# Title\n> Body\n- [x] Ship\n- [x] Ship');

    const split = model.split(title.id, { before: 'Field', after: 'notes' });
    expect(model.snapshot().blocks[0]).toMatchObject({ type: 'heading1', text: 'Field' });
    expect(split).toMatchObject({ type: 'paragraph', text: 'notes' });
    const merged = model.mergeWithPrevious(split.id);
    expect(merged).toMatchObject({ focusId: title.id, offset: 5 });
    expect(model.snapshot().blocks[0].text).toBe('Fieldnotes');
    expect(model.remove(copy.id).changed).toBe(true);
  });

  it('moves visible Markdown blocks while preserving separator rows', () => {
    const source = '# Alpha\n\nBravo\n\nCharlie';
    const model = createEditorDocumentModel({ source });
    const visible = model.snapshot().blocks.filter((block) => block.text);
    const [alpha, bravo, charlie] = visible;

    expect(model.moveRelative(alpha.id, bravo.id, 'before')).toBe(false);
    expect(model.moveRelative(alpha.id, bravo.id, 'after')).toMatchObject({
      changed: true,
    });
    expect(model.source()).toBe('Bravo\n\n# Alpha\n\nCharlie');

    expect(model.moveRelative(alpha.id, bravo.id, 'before')).toMatchObject({ changed: true });
    expect(model.source()).toBe(source);

    expect(model.moveRelative(charlie.id, alpha.id, 'before')).toMatchObject({ changed: true });
    expect(model.source()).toBe('Charlie\n\n# Alpha\n\nBravo');
  });

  it('does not treat leading, repeated or trailing blank lines as draggable blocks', () => {
    const model = createEditorDocumentModel({ source: '\nAlpha\n\n\nBravo\n' });
    const blocks = model.snapshot().blocks;
    const visible = blocks.filter((block) => block.text);

    expect(model.moveRelative(visible[1].id, visible[0].id, 'before')).toMatchObject({ changed: true });
    expect(model.source()).toBe('\nBravo\n\n\nAlpha\n');
    expect(model.moveRelative(blocks[0].id, visible[0].id, 'after')).toBe(false);
  });

  it('keeps bounded undo and redo history independent per model', () => {
    const first = createEditorDocumentModel({ source: 'one', historyLimit: 3 });
    const second = createEditorDocumentModel({ source: 'other' });
    const blockId = first.snapshot().blocks[0].id;
    first.updateBlock(blockId, { text: 'two' });
    first.updateBlock(blockId, { text: 'three' });
    first.updateBlock(blockId, { text: 'four' });
    expect(first.undo(blockId)).toMatchObject({ changed: true, action: 'undo' });
    expect(first.source()).toBe('three');
    expect(first.redo(first.snapshot().blocks[0].id)).toMatchObject({ changed: true, action: 'redo' });
    expect(first.source()).toBe('four');
    expect(second.source()).toBe('other');
  });

  it('preserves plain-text semantics and publishes cursor snapshots', () => {
    const model = createEditorDocumentModel({ source: '# literal\n- literal', markdown: false });
    const snapshots = [];
    const unsubscribe = model.subscribe((snapshot) => snapshots.push(snapshot));
    const second = model.snapshot().blocks[1];
    model.updateBlock(second.id, { type: 'heading1', text: 'still literal' });
    model.setCursor({ line: 2, column: 4 });
    expect(model.source()).toBe('# literal\nstill literal');
    expect(model.snapshot().cursor).toEqual({ line: 2, column: 4 });
    expect(snapshots.at(-1).cursor).toEqual({ line: 2, column: 4 });
    unsubscribe();
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
    expect(after.blocks).toBe(before.blocks);
    expect(after.stats).toBe(before.stats);
  });
});
