import { describe, expect, it } from 'vitest';
import {
  allowsDocumentMode,
  getEditorKind,
  getFormatDescriptor,
  getReadRenderer,
  isImageFormat,
} from './format-registry.js';

describe('format registry', () => {
  it('locks images to read-only modes (F8)', () => {
    expect(allowsDocumentMode('png', 'read')).toBe(true);
    expect(allowsDocumentMode('png', 'edit')).toBe(false);
    expect(allowsDocumentMode('png', 'source')).toBe(false);
    expect(getEditorKind('png')).toBe('none');
    expect(isImageFormat('jpeg')).toBe(true);
  });

  it('exposes read/edit/source for companions with plain editor', () => {
    for (const format of ['json', 'csv', 'yaml', 'toml', 'ini', 'text']) {
      expect(allowsDocumentMode(format, 'read')).toBe(true);
      expect(allowsDocumentMode(format, 'edit')).toBe(true);
      expect(allowsDocumentMode(format, 'source')).toBe(true);
      expect(getEditorKind(format)).toBe('plain');
    }
    expect(getEditorKind('markdown')).toBe('blocks');
  });

  it('maps rich read renderers', () => {
    expect(getReadRenderer('json')).toBe('json-tree');
    expect(getReadRenderer('csv')).toBe('csv-table');
    expect(getReadRenderer('yaml')).toBe('structured-text');
    expect(getFormatDescriptor('markdown').readRenderer).toBe('markdown');
  });
});
