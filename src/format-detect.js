/** Extension policy for path filtering; native open owns content detection. */

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown']);
const PLAIN_TEXT_EXTENSIONS = new Set([
  'txt', 'nfo', 'json', 'ini', 'yml', 'yaml', 'toml', 'cfg', 'conf', 'log', 'csv', 'env',
]);
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'avif']);

const IMAGE_MIME_BY_FORMAT = Object.freeze({
  png: 'image/png',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  avif: 'image/avif',
});

const FORMAT_BY_EXTENSION = Object.freeze({
  md: 'markdown',
  markdown: 'markdown',
  txt: 'text',
  nfo: 'nfo',
  log: 'log',
  env: 'env',
  json: 'json',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  csv: 'csv',
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  gif: 'gif',
  webp: 'webp',
  bmp: 'bmp',
  avif: 'avif',
});

function extensionOf(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') return '';
  const normalized = filePath.replace(/\\/g, '/');
  const name = normalized.split('/').pop() || '';
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot <= 0 || dot === lower.length - 1) return '';
  return lower.slice(dot + 1);
}

export function imageMimeForFormat(format) {
  return IMAGE_MIME_BY_FORMAT[format] || null;
}

export function resolveDocumentFormat(filePath) {
  const extension = extensionOf(filePath);
  const format = FORMAT_BY_EXTENSION[extension] || null;
  const family = MARKDOWN_EXTENSIONS.has(extension)
    ? 'markdown'
    : PLAIN_TEXT_EXTENSIONS.has(extension)
      ? 'text'
      : IMAGE_EXTENSIONS.has(extension) ? 'image' : null;
  return {
    supported: Boolean(family),
    format,
    family,
    kind: family,
    mime: family === 'image' ? imageMimeForFormat(format) : null,
    reclassified: false,
  };
}

export function isSupportedFilePath(filePath) {
  return resolveDocumentFormat(filePath).supported;
}

export function getFormatFromPath(filePath) {
  const resolved = resolveDocumentFormat(filePath);
  return resolved.format;
}

export {
  MARKDOWN_EXTENSIONS,
  PLAIN_TEXT_EXTENSIONS,
  IMAGE_EXTENSIONS,
  FORMAT_BY_EXTENSION,
};
