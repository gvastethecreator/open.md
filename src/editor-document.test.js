// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
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
});
