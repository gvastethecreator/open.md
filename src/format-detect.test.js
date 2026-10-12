import { describe, expect, it } from 'vitest';
import {
  FORMAT_BY_EXTENSION,
  IMAGE_EXTENSIONS,
  MARKDOWN_EXTENSIONS,
  PLAIN_TEXT_EXTENSIONS,
  resolveDocumentFormat,
} from './format-detect.js';
import formatParity from './format-parity.json';

describe('format detect', () => {
  it('shares JS/native format tables with the parity fixture', () => {
    expect([...MARKDOWN_EXTENSIONS].sort()).toEqual([...formatParity.markdownExtensions].sort());
    expect([...PLAIN_TEXT_EXTENSIONS].sort()).toEqual([...formatParity.plainTextExtensions].sort());
    expect([...IMAGE_EXTENSIONS].sort()).toEqual([...formatParity.imageExtensions].sort());
    expect(FORMAT_BY_EXTENSION.md).toBe('markdown');
    expect(FORMAT_BY_EXTENSION.png).toBe('png');
  });

  it('rejects unknown extensions without expanding support', () => {
    const resolved = resolveDocumentFormat('payload.bin');
    expect(resolved.supported).toBe(false);
    expect(resolved.format).toBeNull();
  });

  it('keeps markdown and json extension mapping from extensions', () => {
    expect(resolveDocumentFormat('README.md').format).toBe('markdown');
    expect(resolveDocumentFormat('config.json').format).toBe('json');
    expect(resolveDocumentFormat('data.csv').format).toBe('csv');
    expect(resolveDocumentFormat('setup.ini').format).toBe('ini');
    expect(resolveDocumentFormat('info.nfo').format).toBe('nfo');
    expect(resolveDocumentFormat('app.log').format).toBe('log');
  });

});
