/**
 * Format capabilities: modes, editor kind, read renderer, highlight language.
 */

const DESCRIPTORS = Object.freeze({
  markdown: Object.freeze({
    id: 'markdown',
    family: 'markdown',
    modes: Object.freeze(['read', 'edit', 'source']),
    editorKind: 'blocks',
    readRenderer: 'markdown',
    highlightLanguage: 'markdown',
    productSurface: 'associated',
  }),
  text: Object.freeze({
    id: 'text',
    family: 'text',
    modes: Object.freeze(['read', 'edit', 'source']),
    editorKind: 'plain',
    readRenderer: 'plain',
    highlightLanguage: null,
    productSurface: 'associated',
  }),
  json: Object.freeze({
    id: 'json',
    family: 'text',
    modes: Object.freeze(['read', 'edit', 'source']),
    editorKind: 'plain',
    readRenderer: 'json-tree',
    highlightLanguage: 'json',
    productSurface: 'companion',
  }),
  yaml: Object.freeze({
    id: 'yaml',
    family: 'text',
    modes: Object.freeze(['read', 'edit', 'source']),
    editorKind: 'plain',
    readRenderer: 'structured-text',
    highlightLanguage: 'yaml',
    productSurface: 'companion',
  }),
  toml: Object.freeze({
    id: 'toml',
    family: 'text',
    modes: Object.freeze(['read', 'edit', 'source']),
    editorKind: 'plain',
    readRenderer: 'structured-text',
    highlightLanguage: 'ini',
    productSurface: 'companion',
  }),
  ini: Object.freeze({
    id: 'ini',
    family: 'text',
    modes: Object.freeze(['read', 'edit', 'source']),
    editorKind: 'plain',
    readRenderer: 'structured-text',
    highlightLanguage: 'ini',
    productSurface: 'companion',
  }),
  env: Object.freeze({
    id: 'env',
    family: 'text',
    modes: Object.freeze(['read', 'edit', 'source']),
    editorKind: 'plain',
    readRenderer: 'structured-text',
    highlightLanguage: 'properties',
    productSurface: 'companion',
  }),
  csv: Object.freeze({
    id: 'csv',
    family: 'text',
    modes: Object.freeze(['read', 'edit', 'source']),
    editorKind: 'plain',
    readRenderer: 'csv-table',
    highlightLanguage: null,
    productSurface: 'companion',
  }),
  png: imageDescriptor('png'),
  jpeg: imageDescriptor('jpeg'),
  gif: imageDescriptor('gif'),
  webp: imageDescriptor('webp'),
  bmp: imageDescriptor('bmp'),
  avif: imageDescriptor('avif'),
  image: imageDescriptor('image'),
});

function imageDescriptor(id) {
  return Object.freeze({
    id,
    family: 'image',
    modes: Object.freeze(['read']),
    editorKind: 'none',
    readRenderer: 'image',
    highlightLanguage: null,
    productSurface: 'companion',
  });
}

const DEFAULT_TEXT = DESCRIPTORS.text;

/**
 * @param {string | null | undefined} format
 * @param {{ kind?: string | null, path?: string | null }} [hint]
 */
export function getFormatDescriptor(format, hint = {}) {
  if (format && DESCRIPTORS[format]) return DESCRIPTORS[format];
  if (hint.kind === 'image' || format === 'image') return DESCRIPTORS.image;
  if (hint.kind === 'markdown' || format === 'markdown') return DESCRIPTORS.markdown;
  if (hint.kind === 'text') return DEFAULT_TEXT;
  return DEFAULT_TEXT;
}

export function isImageFormat(format, hint = {}) {
  return getFormatDescriptor(format, hint).family === 'image';
}

export function isMarkdownFormat(format, hint = {}) {
  return getFormatDescriptor(format, hint).family === 'markdown';
}

export function allowsDocumentMode(format, mode, hint = {}) {
  const descriptor = getFormatDescriptor(format, hint);
  return descriptor.modes.includes(mode);
}

export function getAllowedModes(format, hint = {}) {
  return getFormatDescriptor(format, hint).modes;
}

export function getEditorKind(format, hint = {}) {
  return getFormatDescriptor(format, hint).editorKind;
}

export function getReadRenderer(format, hint = {}) {
  return getFormatDescriptor(format, hint).readRenderer;
}

export function getHighlightLanguage(format, hint = {}) {
  return getFormatDescriptor(format, hint).highlightLanguage;
}

export function listFormatDescriptors() {
  return DESCRIPTORS;
}
