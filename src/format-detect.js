/**
 * Pure format resolution: extension + optional header magic/heuristics.
 * Mirrors native open policy for unit tests; native open remains authoritative.
 */

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

function asBytes(header) {
  if (!header) return new Uint8Array(0);
  if (header instanceof Uint8Array) return header;
  if (header instanceof ArrayBuffer) return new Uint8Array(header);
  if (ArrayBuffer.isView(header)) {
    return new Uint8Array(header.buffer, header.byteOffset, header.byteLength);
  }
  if (typeof header === 'string') {
    const out = new Uint8Array(header.length);
    for (let i = 0; i < header.length; i += 1) out[i] = header.charCodeAt(i) & 0xff;
    return out;
  }
  return new Uint8Array(0);
}

function startsWithBytes(bytes, signature) {
  if (bytes.length < signature.length) return false;
  for (let i = 0; i < signature.length; i += 1) {
    if (bytes[i] !== signature[i]) return false;
  }
  return true;
}

/**
 * Detect image format from magic bytes. Returns format id or null.
 */
export function detectImageFormatFromMagic(header) {
  const bytes = asBytes(header);
  if (startsWithBytes(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61])
    || startsWithBytes(bytes, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
  ) {
    return 'gif';
  }
  if (
    bytes.length >= 12
    && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
    && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'webp';
  }
  if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) return 'bmp';
  // ISO BMFF: size(4) + 'ftyp' + brand 'avif' at offset 8
  if (
    bytes.length >= 12
    && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70
    && bytes[8] === 0x61 && bytes[9] === 0x76 && bytes[10] === 0x69 && bytes[11] === 0x66
  ) {
    return 'avif';
  }
  return null;
}

export function imageMimeForFormat(format) {
  return IMAGE_MIME_BY_FORMAT[format] || null;
}

function skipBomAndWs(bytes) {
  let i = 0;
  if (
    bytes.length >= 3
    && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf
  ) {
    i = 3;
  }
  while (i < bytes.length) {
    const b = bytes[i];
    if (b === 0x20 || b === 0x09 || b === 0x0a || b === 0x0d) i += 1;
    else break;
  }
  return i;
}

const NFO_XML_PREFIXES = [
  '<?xml',
  '<movie',
  '<tvshow',
  '<episodedetails',
  '<musicvideo',
  '<album',
  '<artist',
  '<nfo',
];

function asciiSlice(bytes, start, maxLength) {
  const end = Math.min(bytes.length, start + maxLength);
  let out = '';
  for (let i = start; i < end; i += 1) {
    if (bytes[i] > 0x7e) return out;
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function nfoXmlBoundary(char) {
  return char === undefined
    || char === ' '
    || char === '\t'
    || char === '\n'
    || char === '\r'
    || char === '>'
    || char === '/';
}

/**
 * Kodi/Plex/Windows System Information XML among `.nfo` companions.
 */
export function looksLikeNfoXml(header) {
  const bytes = asBytes(header);
  const start = skipBomAndWs(bytes);
  if (start >= bytes.length) return false;
  const ascii = asciiSlice(bytes, start, 24).toLowerCase();
  return NFO_XML_PREFIXES.some((prefix) => (
    ascii.startsWith(prefix) && nfoXmlBoundary(ascii[prefix.length])
  ));
}

/**
 * Lightweight JSON leading-char check among text companions only.
 */
export function looksLikeJson(header) {
  const bytes = asBytes(header);
  const i = skipBomAndWs(bytes);
  if (i >= bytes.length) return false;
  const c = bytes[i];
  return c === 0x7b || c === 0x5b; // { or [
}

/**
 * Resolve product format for an accepted path + optional header.
 * Does not expand unknown extensions into supported opens.
 *
 * @returns {{
 *   supported: boolean,
 *   format: string | null,
 *   family: 'markdown' | 'text' | 'image' | null,
 *   kind: 'markdown' | 'text' | 'image' | null,
 *   mime: string | null,
 *   reclassified: boolean,
 *   failClosed?: string,
 * }}
 */
export function resolveDocumentFormat(filePath, header = null) {
  const extension = extensionOf(filePath);
  const fromExt = FORMAT_BY_EXTENSION[extension] || null;
  const familyFromExt = MARKDOWN_EXTENSIONS.has(extension)
    ? 'markdown'
    : PLAIN_TEXT_EXTENSIONS.has(extension)
      ? 'text'
      : IMAGE_EXTENSIONS.has(extension)
        ? 'image'
        : null;

  if (!familyFromExt) {
    return {
      supported: false,
      format: null,
      family: null,
      kind: null,
      mime: null,
      reclassified: false,
    };
  }

  const magicImage = header != null ? detectImageFormatFromMagic(header) : null;

  // Image extension: confirm magic when header present; fail closed on mismatch.
  if (familyFromExt === 'image') {
    if (header != null && !magicImage) {
      return {
        supported: true,
        format: fromExt,
        family: 'image',
        kind: 'image',
        mime: imageMimeForFormat(fromExt),
        reclassified: false,
        failClosed: 'This image file is damaged or is not a supported image format.',
      };
    }
    const format = magicImage || fromExt;
    return {
      supported: true,
      format,
      family: 'image',
      kind: 'image',
      mime: imageMimeForFormat(format),
      reclassified: Boolean(magicImage && magicImage !== fromExt),
    };
  }

  // Text / markdown companions: reclassify to image when magic matches.
  if (magicImage) {
    return {
      supported: true,
      format: magicImage,
      family: 'image',
      kind: 'image',
      mime: imageMimeForFormat(magicImage),
      reclassified: true,
    };
  }

  if (familyFromExt === 'markdown') {
    return {
      supported: true,
      format: 'markdown',
      family: 'markdown',
      kind: 'markdown',
      mime: null,
      reclassified: false,
    };
  }

  // Text subclass: extension primary; light JSON confirm when extension is json-like or ambiguous txt with JSON body
  let format = fromExt || 'text';
  if (format === 'json' || (format === 'text' && header != null && looksLikeJson(header))) {
    if (format === 'text' && looksLikeJson(header)) {
      // Keep as text for product (txt stays text); only force json format for .json
      format = 'text';
    }
  }
  if (extension === 'json') format = 'json';
  if (extension === 'nfo') {
    format = header != null && looksLikeNfoXml(header) ? 'text' : 'nfo';
  }

  return {
    supported: true,
    format,
    family: 'text',
    kind: 'text',
    mime: null,
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
  NFO_XML_PREFIXES,
};
