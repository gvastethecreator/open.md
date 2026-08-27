/**
 * Format capabilities: modes, editor kind, read renderer, highlight language.
 */

import {
  getFormatFromPath,
  imageMimeForFormat as mimeForFormat,
} from './format-detect.js';

const DESCRIPTORS = Object.freeze({
  markdown: Object.freeze({
    id: 'markdown',
    family: 'markdown',
    modes: Object.freeze(['read', 'edit', 'source']),
    editorKind: 'classic',
    readRenderer: 'markdown',
    highlightLanguage: 'markdown',
    productSurface: 'associated',
    statusProfile: 'markdown',
  }),
  text: Object.freeze({
    id: 'text',
    family: 'text',
    modes: Object.freeze(['read', 'edit', 'source']),
    editorKind: 'plain',
    readRenderer: 'plain',
    highlightLanguage: null,
    productSurface: 'associated',
    statusProfile: 'text',
  }),
  json: Object.freeze({
    id: 'json',
    family: 'text',
    modes: Object.freeze(['read', 'edit', 'source']),
    editorKind: 'json-props',
    readRenderer: 'json-tree',
    highlightLanguage: 'json',
    productSurface: 'companion',
    statusProfile: 'json',
  }),
  yaml: Object.freeze({
    id: 'yaml',
    family: 'text',
    modes: Object.freeze(['read', 'edit', 'source']),
    editorKind: 'plain',
    readRenderer: 'structured-text',
    highlightLanguage: 'yaml',
    productSurface: 'companion',
    statusProfile: 'text',
  }),
  toml: Object.freeze({
    id: 'toml',
    family: 'text',
    modes: Object.freeze(['read', 'edit', 'source']),
    editorKind: 'plain',
    readRenderer: 'structured-text',
    highlightLanguage: 'ini',
    productSurface: 'companion',
    statusProfile: 'text',
  }),
  ini: Object.freeze({
    id: 'ini',
    family: 'text',
    modes: Object.freeze(['read', 'edit', 'source']),
    editorKind: 'plain',
    readRenderer: 'structured-text',
    highlightLanguage: 'ini',
    productSurface: 'companion',
    statusProfile: 'text',
  }),
  env: Object.freeze({
    id: 'env',
    family: 'text',
    modes: Object.freeze(['read', 'edit', 'source']),
    editorKind: 'plain',
    readRenderer: 'structured-text',
    highlightLanguage: 'properties',
    productSurface: 'companion',
    statusProfile: 'text',
  }),
  csv: Object.freeze({
    id: 'csv',
    family: 'text',
    modes: Object.freeze(['read', 'edit', 'source']),
    editorKind: 'plain',
    readRenderer: 'csv-table',
    highlightLanguage: null,
    productSurface: 'companion',
    statusProfile: 'csv',
  }),
  nfo: Object.freeze({
    id: 'nfo',
    family: 'text',
    modes: Object.freeze(['read', 'source']),
    editorKind: 'none',
    readRenderer: 'plain',
    highlightLanguage: null,
    productSurface: 'companion',
    statusProfile: 'text',
  }),
  log: Object.freeze({
    id: 'log',
    family: 'text',
    modes: Object.freeze(['read', 'source']),
    editorKind: 'none',
    readRenderer: 'plain',
    highlightLanguage: null,
    productSurface: 'companion',
    statusProfile: 'text',
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
    statusProfile: 'image',
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

/**
 * Status bar metric profile for a format (markdown | text | json | csv | image).
 */
export function getStatusProfile(format, hint = {}) {
  return getFormatDescriptor(format, hint).statusProfile || 'text';
}

/**
 * Resolve the canonical format id from a document payload and optional path.
 * Payload fields win; path is a last-resort ingress hint before open settles.
 */
export function resolveFormatId(path = null, document = null) {
  if (document?.format) return document.format;
  if (document?.kind === 'image') return 'image';
  if (document?.kind === 'markdown') return 'markdown';
  if (document?.kind === 'text') return 'text';
  if (typeof path === 'string' && path.trim()) {
    return getFormatFromPath(path) || 'text';
  }
  return 'text';
}

/**
 * Human status/chrome label for a format. Fine formats stay product-readable.
 */
export function getFormatLabel(format, hint = {}) {
  const descriptor = getFormatDescriptor(format, hint);
  if (descriptor.family === 'markdown') return 'Markdown';
  if (descriptor.family === 'image') return 'Image';
  if (descriptor.id === 'json') return 'JSON';
  if (descriptor.id === 'yaml') return 'YAML';
  if (descriptor.id === 'toml') return 'TOML';
  if (descriptor.id === 'csv') return 'CSV';
  if (descriptor.id === 'ini') return 'INI';
  if (descriptor.id === 'env') return 'Env';
  if (descriptor.id === 'nfo') return 'NFO';
  if (descriptor.id === 'log') return 'Log';
  return 'Text';
}

export function imageMimeForFormat(format) {
  return mimeForFormat(format);
}

export function listFormatDescriptors() {
  return DESCRIPTORS;
}

/**
 * Companion text formats (json, yaml, csv, …) versus associated Markdown/TXT.
 */
export function isCompanionTextFormat(format, hint = {}) {
  const descriptor = getFormatDescriptor(format, hint);
  return descriptor.productSurface === 'companion' && descriptor.family === 'text';
}
