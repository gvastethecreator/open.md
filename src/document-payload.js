/**
 * Frontend document payload contract: validate and normalize open/save results.
 */

const KNOWN_KINDS = new Set(['image', 'markdown', 'text']);
const KNOWN_ENCODINGS = new Set(['utf-8', 'cp437']);
const KNOWN_FORMATS = new Set([
  'markdown', 'text', 'json', 'yaml', 'toml', 'ini', 'env', 'csv', 'nfo', 'log',
  'png', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'image',
]);

const IMAGE_FORMATS = new Set(['png', 'jpeg', 'gif', 'webp', 'bmp', 'avif', 'image']);

export function normalizeDocumentPayload(payload) {
  if (
    !payload
    || typeof payload !== 'object'
    || Array.isArray(payload)
    || typeof payload.html !== 'string'
    || typeof payload.source !== 'string'
  ) {
    throw new TypeError('Invalid document payload');
  }

  const source = payload.source;
  const fallbackLineCount = source.split('\n').length;
  const kindRaw = typeof payload.kind === 'string' ? payload.kind : undefined;
  const kind = kindRaw && KNOWN_KINDS.has(kindRaw)
    ? kindRaw
    : kindRaw === 'image'
      ? 'image'
      : undefined;
  const formatRaw = typeof payload.format === 'string' ? payload.format : undefined;
  let format = formatRaw && KNOWN_FORMATS.has(formatRaw) ? formatRaw : undefined;
  if (!format && kind === 'image') format = 'image';
  if (!format && kind === 'markdown') format = 'markdown';
  if (!format && kind === 'text') format = 'text';
  // Legacy payloads: kind image only
  const resolvedKind = kind === 'image'
    ? 'image'
    : kind === 'markdown'
      ? 'markdown'
      : kind === 'text'
        ? 'text'
        : (format && IMAGE_FORMATS.has(format)
          ? 'image'
          : format === 'markdown'
            ? 'markdown'
            : format
              ? 'text'
              : undefined);

  const resolvedFormat = format
    || (resolvedKind === 'image' ? 'image' : undefined)
    || (resolvedKind === 'markdown' ? 'markdown' : undefined)
    || (resolvedKind === 'text' ? 'text' : undefined);

  const normalized = {
    html: typeof payload?.html === 'string' ? payload.html : '',
    source,
    lineCount: Math.max(1, Number.isFinite(payload?.lineCount) ? Math.floor(payload.lineCount) : fallbackLineCount),
    characterCount: Math.max(
      0,
      Number.isFinite(payload?.characterCount) ? Math.floor(payload.characterCount) : [...source].length
    ),
    wordCount: Math.max(0, Number.isFinite(payload?.wordCount) ? Math.floor(payload.wordCount) : 0),
    readingTimeMinutes: Math.max(
      0,
      Number.isFinite(payload?.readingTimeMinutes) ? Math.floor(payload.readingTimeMinutes) : 0
    ),
  };
  if (resolvedKind) normalized.kind = resolvedKind;
  if (resolvedFormat) normalized.format = resolvedFormat;
  const encodingRaw = typeof payload.sourceEncoding === 'string' ? payload.sourceEncoding : undefined;
  if (encodingRaw && KNOWN_ENCODINGS.has(encodingRaw)) {
    normalized.sourceEncoding = encodingRaw;
  }
  return normalized;
}
