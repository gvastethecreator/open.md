import { describe, expect, it } from 'vitest';
import {
  allowsDocumentMode,
  getEditorKind,
  getFormatDescriptor,
  getFormatLabel,
  getReadRenderer,
  getStatusProfile,
  imageMimeForFormat,
  isCompanionTextFormat,
  isImageFormat,
  resolveFormatId,
} from './format-registry.js';

describe('format registry', () => {
  it('locks images to read-only modes (F8)', () => {
    expect(allowsDocumentMode('png', 'read')).toBe(true);
    expect(allowsDocumentMode('png', 'edit')).toBe(false);
    expect(allowsDocumentMode('png', 'source')).toBe(false);
    expect(getEditorKind('png')).toBe('none');
    expect(isImageFormat('jpeg')).toBe(true);
  });

  it('exposes read/edit/source for companions with plain or json-props editors', () => {
    for (const format of ['csv', 'yaml', 'toml', 'ini', 'text']) {
      expect(allowsDocumentMode(format, 'read')).toBe(true);
      expect(allowsDocumentMode(format, 'edit')).toBe(true);
      expect(allowsDocumentMode(format, 'source')).toBe(true);
      expect(getEditorKind(format)).toBe('plain');
    }
    expect(getEditorKind('json')).toBe('json-props');
    expect(getEditorKind('markdown')).toBe('blocks');
  });

  it('owns status profiles per format family', () => {
    expect(getStatusProfile('markdown')).toBe('markdown');
    expect(getStatusProfile('json')).toBe('json');
    expect(getStatusProfile('csv')).toBe('csv');
    expect(getStatusProfile('png')).toBe('image');
    expect(getStatusProfile('yaml')).toBe('text');
  });

  it('maps rich read renderers', () => {
    expect(getReadRenderer('json')).toBe('json-tree');
    expect(getReadRenderer('csv')).toBe('csv-table');
    expect(getReadRenderer('yaml')).toBe('structured-text');
    expect(getFormatDescriptor('markdown').readRenderer).toBe('markdown');
  });

  it('resolves format id from payload before path', () => {
    expect(resolveFormatId('notes.txt', { format: 'json', kind: 'text' })).toBe('json');
    expect(resolveFormatId('photo.PNG', null)).toBe('png');
    expect(resolveFormatId('README.md', { kind: 'markdown' })).toBe('markdown');
  });

  it('owns display labels and image MIME ids', () => {
    expect(getFormatLabel('json')).toBe('JSON');
    expect(getFormatLabel('png')).toBe('Image');
    expect(getFormatLabel('markdown')).toBe('Markdown');
    expect(imageMimeForFormat('webp')).toBe('image/webp');
    expect(imageMimeForFormat('unknown')).toBeNull();
  });

  it('classifies companion text formats without soft tool defaults', () => {
    expect(isCompanionTextFormat('json')).toBe(true);
    expect(isCompanionTextFormat('markdown')).toBe(false);
    expect(isCompanionTextFormat('png')).toBe(false);
    expect(isCompanionTextFormat('text')).toBe(false);
  });
});
