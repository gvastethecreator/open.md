const PREFERRED_THEME_NAMES = ['Github Light', 'Github Dark', 'GitHub', 'Ayu Light', 'Ayu Dark'];
const SUPPORTED_EXTENSIONS = ['.md', '.markdown', '.txt'];

export const DEFAULT_READING_TOOLS = Object.freeze({
  lineGuide: false,
  minimap: false,
  source: false,
  stats: false,
});

export function isSupportedFilePath(filePath) {
  return typeof filePath === 'string' && SUPPORTED_EXTENSIONS.some((ext) => filePath.toLowerCase().endsWith(ext));
}

export function getDisplayName(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') {
    return 'No file';
  }

  const normalizedPath = filePath.replace(/\\/g, '/');
  return normalizedPath.split('/').pop() || filePath;
}

export function getFileKind(filePath) {
  const displayName = getDisplayName(filePath).toLowerCase();
  return displayName.endsWith('.txt') ? 'Text' : 'Markdown';
}

export function normalizeDocumentPayload(payload) {
  if (typeof payload === 'string') {
    return {
      html: payload,
      source: '',
      lineCount: 1,
      characterCount: 0,
      wordCount: 0,
      readingTimeMinutes: 0,
    };
  }

  const source = typeof payload?.source === 'string' ? payload.source : '';
  const fallbackLineCount = source.split('\n').length;

  return {
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
}

export function normalizeReadingTools(value) {
  return Object.fromEntries(
    Object.keys(DEFAULT_READING_TOOLS).map((key) => [key, value?.[key] === true])
  );
}

export function normalizeOpenFileRequest(value) {
  const id = Math.floor(Number(value?.id));
  const paths = [...new Set(
    (Array.isArray(value?.paths) ? value.paths : [])
      .filter((path) => typeof path === 'string' && path.trim() !== '')
  )];

  return Number.isSafeInteger(id) && id > 0 && paths.length > 0 ? { id, paths } : null;
}

function isEscapedSourceToken(line, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && line[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

export function getMarkdownSourceTokenRanges(line) {
  const sourceLine = typeof line === 'string' ? line : '';
  const ranges = [];
  const codeIntervals = [];
  const addRange = (start, end) => {
    if (start >= 0 && end > start) ranges.push({ start, end });
  };

  const fence = sourceLine.match(/^\s{0,3}(`{3,}|~{3,})/);
  if (fence) {
    const start = sourceLine.indexOf(fence[1]);
    addRange(start, start + fence[1].length);
  } else {
    const structuralPatterns = [
      /^\s{0,3}(#{1,6})(?=\s|$)/,
      /^\s{0,3}(>)/,
      /^\s*([-+*])(?=\s)/,
      /^\s*(\d+[.)])(?=\s)/,
    ];
    for (const pattern of structuralPatterns) {
      const match = sourceLine.match(pattern);
      if (!match) continue;
      const start = sourceLine.indexOf(match[1]);
      addRange(start, start + match[1].length);
      break;
    }

    const taskMarker = sourceLine.match(/^\s*(?:[-+*]|\d+[.)])\s+(\[[ xX]\])/);
    if (taskMarker) {
      const start = sourceLine.indexOf(taskMarker[1]);
      addRange(start, start + taskMarker[1].length);
    }
  }

  const backtickPattern = /`+/g;
  let backtickMatch;
  while ((backtickMatch = backtickPattern.exec(sourceLine)) !== null) {
    if (isEscapedSourceToken(sourceLine, backtickMatch.index)) continue;
    const delimiter = backtickMatch[0];
    const closingIndex = sourceLine.indexOf(delimiter, backtickMatch.index + delimiter.length);
    addRange(backtickMatch.index, backtickMatch.index + delimiter.length);
    if (closingIndex < 0) continue;
    addRange(closingIndex, closingIndex + delimiter.length);
    codeIntervals.push([backtickMatch.index, closingIndex + delimiter.length]);
    backtickPattern.lastIndex = closingIndex + delimiter.length;
  }

  const isInsideCode = (index) => codeIntervals.some(([start, end]) => index > start && index < end);
  const emphasisPattern = /\*\*|__|~~|\*|_/g;
  const delimiterPositions = new Map();
  let emphasisMatch;
  while ((emphasisMatch = emphasisPattern.exec(sourceLine)) !== null) {
    const token = emphasisMatch[0];
    const index = emphasisMatch.index;
    if (isEscapedSourceToken(sourceLine, index) || isInsideCode(index)) continue;
    if (
      token === '_'
      && /[\p{L}\p{N}]/u.test(sourceLine[index - 1] || '')
      && /[\p{L}\p{N}]/u.test(sourceLine[index + 1] || '')
    ) {
      continue;
    }
    const positions = delimiterPositions.get(token) || [];
    positions.push(index);
    delimiterPositions.set(token, positions);
  }
  for (const [token, positions] of delimiterPositions) {
    for (let index = 0; index + 1 < positions.length; index += 2) {
      addRange(positions[index], positions[index] + token.length);
      addRange(positions[index + 1], positions[index + 1] + token.length);
    }
  }

  const linkPattern = /(!?)\[[^\]\n]*\]\([^\)\n]*\)/g;
  let linkMatch;
  while ((linkMatch = linkPattern.exec(sourceLine)) !== null) {
    if (isEscapedSourceToken(sourceLine, linkMatch.index) || isInsideCode(linkMatch.index)) continue;
    const openLength = linkMatch[1] ? 2 : 1;
    const bridgeIndex = sourceLine.indexOf('](', linkMatch.index + openLength);
    const closeIndex = linkMatch.index + linkMatch[0].length - 1;
    addRange(linkMatch.index, linkMatch.index + openLength);
    addRange(bridgeIndex, bridgeIndex + 2);
    addRange(closeIndex, closeIndex + 1);
  }

  const visibleRanges = [];
  for (const range of ranges.sort((left, right) => left.start - right.start || right.end - left.end)) {
    const previous = visibleRanges.at(-1);
    if (!previous || range.start >= previous.end) visibleRanges.push(range);
  }
  return visibleRanges;
}

export function getReadingProgress(scrollTop, scrollHeight, clientHeight) {
  const maxScroll = Math.max(0, Number(scrollHeight) - Number(clientHeight));
  if (maxScroll === 0) return 100;
  return Math.round(Math.min(Math.max(Number(scrollTop) / maxScroll, 0), 1) * 100);
}

export function getEstimatedMinutesRemaining(totalMinutes, progressPercent) {
  const total = Math.max(0, Number(totalMinutes) || 0);
  const progress = Math.min(Math.max(Number(progressPercent) || 0, 0), 100);
  return Math.ceil(total * (1 - (progress / 100)));
}

function formatMetricNumber(value) {
  return Math.max(0, Math.floor(Number(value) || 0)).toLocaleString('en-US');
}

export function getStatusMetricParts({
  lineCount,
  characterCount,
  zoomPercent,
  currentLine,
  showCurrentLine,
  readingProgress,
  readingTimeMinutes,
  showReadingStats,
}) {
  const safeLineCount = Math.max(1, Math.floor(Number(lineCount) || 1));
  const safeCharacterCount = Math.max(0, Math.floor(Number(characterCount) || 0));
  const safeZoom = Math.max(1, Math.round(Number(zoomPercent) || 100));
  const lineLabel = `${formatMetricNumber(safeLineCount)} ${safeLineCount === 1 ? 'line' : 'lines'}`;
  const characterValue = formatMetricNumber(safeCharacterCount);
  const characterLabel = `${characterValue} ${safeCharacterCount === 1 ? 'char' : 'chars'}`;
  const characterAccessibleLabel = `${characterValue} ${safeCharacterCount === 1 ? 'character' : 'characters'}`;
  const visible = [lineLabel, characterLabel, `Zoom ${safeZoom}%`];
  const accessible = [lineLabel, characterAccessibleLabel, `Zoom ${safeZoom} percent`];

  if (showCurrentLine) {
    const safeCurrentLine = Math.max(1, Math.floor(Number(currentLine) || 1));
    visible.push(`Ln ${safeCurrentLine}`);
    accessible.push(`Line ${safeCurrentLine}`);
  }

  if (showReadingStats) {
    const safeProgress = Math.min(100, Math.max(0, Math.round(Number(readingProgress) || 0)));
    const remainingMinutes = getEstimatedMinutesRemaining(readingTimeMinutes, safeProgress);
    visible.push(`${safeProgress}%`);
    accessible.push(`${safeProgress} percent through document`);

    if (Number(readingTimeMinutes) > 0) {
      visible.push(remainingMinutes > 0 ? `${remainingMinutes} min left` : 'read');
      accessible.push(remainingMinutes > 0 ? `${remainingMinutes} minutes left` : 'Document read');
    }
  }

  return { visible, accessible };
}

export function getWindowControlPresentation(isMaximized) {
  return isMaximized
    ? { label: 'Restore', iconClass: 'iconoir-multi-window' }
    : { label: 'Maximize', iconClass: 'iconoir-square' };
}

export function getVisibleSourceLineRange({ scrollTop, clientHeight, lineHeight, paddingTop, lineCount }) {
  const safeLineHeight = Math.max(1, Number(lineHeight) || 1);
  const safeLineCount = Math.max(1, Math.floor(Number(lineCount) || 1));
  const contentTop = Math.max(0, Number(scrollTop) - Number(paddingTop || 0));
  const first = Math.min(safeLineCount, Math.max(1, Math.floor(contentTop / safeLineHeight) + 1));
  const visibleLines = Math.ceil(Math.max(0, Number(clientHeight)) / safeLineHeight) + 2;
  const last = Math.min(safeLineCount, first + visibleLines);
  const current = first;

  return { first, last, current };
}

export function getCurrentLineFromAnchors(anchors, readingOffset) {
  if (!Array.isArray(anchors) || anchors.length === 0) return 1;

  let current = anchors[0].line;
  for (const anchor of anchors) {
    if (anchor.top > readingOffset) break;
    current = anchor.line;
  }
  return Math.max(1, Number(current) || 1);
}

function normalizeFilePath(filePath) {
  return String(filePath).replace(/\\/g, '/');
}

function normalizeHexColor(value) {
  if (typeof value !== 'string') return null;

  const match = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (!match) return null;

  const hex = match[1].length === 3
    ? [...match[1]].map((character) => character.repeat(2)).join('')
    : match[1];

  return `#${hex.toLowerCase()}`;
}

function hexToRgb(value) {
  const normalized = normalizeHexColor(value);
  if (!normalized) return null;

  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

function relativeLuminance(value) {
  const rgb = hexToRgb(value);
  if (!rgb) return null;

  const channels = [rgb.r, rgb.g, rgb.b].map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return (channels[0] * 0.2126) + (channels[1] * 0.7152) + (channels[2] * 0.0722);
}

export function getContrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);

  if (foregroundLuminance === null || backgroundLuminance === null) {
    return 1;
  }

  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function mixHexColors(background, foreground, foregroundWeight) {
  const backgroundRgb = hexToRgb(background);
  const foregroundRgb = hexToRgb(foreground);
  if (!backgroundRgb || !foregroundRgb) return background;

  const weight = Math.min(Math.max(foregroundWeight, 0), 1);
  const channel = (backgroundValue, foregroundValue) => (
    Math.round((backgroundValue * (1 - weight)) + (foregroundValue * weight))
      .toString(16)
      .padStart(2, '0')
  );

  return `#${channel(backgroundRgb.r, foregroundRgb.r)}${channel(backgroundRgb.g, foregroundRgb.g)}${channel(backgroundRgb.b, foregroundRgb.b)}`;
}

function chooseAccessibleColor(candidates, background, minimumRatio = 4.5) {
  for (const candidate of candidates) {
    const normalized = normalizeHexColor(candidate);
    if (normalized && getContrastRatio(normalized, background) >= minimumRatio) {
      return normalized;
    }
  }

  const blackRatio = getContrastRatio('#000000', background);
  const whiteRatio = getContrastRatio('#ffffff', background);
  return blackRatio >= whiteRatio ? '#000000' : '#ffffff';
}

export function getThemeTokens(theme = {}) {
  const background = normalizeHexColor(theme.background) || '#ffffff';
  const text = chooseAccessibleColor([theme.foreground], background);
  const accent = chooseAccessibleColor(
    [theme.color_05, theme.color_06, theme.color_02, theme.color_03, text],
    background
  );
  const quote = chooseAccessibleColor([theme.color_07, theme.color_08, text], background);
  const danger = chooseAccessibleColor(['#cf222e', '#ff7b72', text], background);
  let surface = mixHexColors(background, text, 0.055);

  if (getContrastRatio(text, surface) < 4.5) {
    surface = background;
  }

  return {
    background,
    text,
    surface,
    border: mixHexColors(background, text, 0.22),
    link: accent,
    accent,
    accentForeground: chooseAccessibleColor(['#000000', '#ffffff'], accent),
    quote,
    danger,
    shadow: isColorDark(background) ? 'rgba(0, 0, 0, 0.42)' : 'rgba(15, 23, 42, 0.16)',
  };
}

export function resolveRelativeFilePath(baseFilePath, relativePath) {
  if (!baseFilePath || !relativePath) return null;

  if (/^(?:[a-z]+:)?\/\//i.test(relativePath) || /^[a-zA-Z]:[\\/]/.test(relativePath)) {
    return relativePath;
  }

  const normalizedBase = normalizeFilePath(baseFilePath);
  const normalizedRelative = normalizeFilePath(relativePath);
  const baseParts = normalizedBase.split('/');
  baseParts.pop();

  const resolvedParts = [...baseParts];
  for (const segment of normalizedRelative.split('/')) {
    if (!segment || segment === '.') continue;

    if (segment === '..') {
      if (resolvedParts.length > 1 || !resolvedParts[0]?.endsWith(':')) {
        resolvedParts.pop();
      }
      continue;
    }

    resolvedParts.push(segment);
  }

  return resolvedParts.join('/');
}

export function getLinkAction(href, currentDocumentPath, absoluteHref = null) {
  if (typeof href !== 'string' || href.trim() === '') {
    return { type: 'blocked' };
  }

  const trimmedHref = href.trim();
  if (trimmedHref.startsWith('#')) {
    return { type: 'anchor', href: trimmedHref };
  }

  if (/^https?:\/\//i.test(trimmedHref)) {
    return { type: 'external', href: trimmedHref };
  }

  if (trimmedHref.startsWith('//') && absoluteHref && /^https?:\/\//i.test(absoluteHref)) {
    return { type: 'external', href: absoluteHref };
  }

  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(trimmedHref)) {
    return { type: 'blocked' };
  }

  const hashIndex = trimmedHref.indexOf('#');
  const fragment = hashIndex >= 0 ? trimmedHref.slice(hashIndex) : '';
  const pathWithoutFragment = hashIndex >= 0 ? trimmedHref.slice(0, hashIndex) : trimmedHref;
  const pathWithoutQuery = pathWithoutFragment.split('?')[0];

  let decodedPath = pathWithoutQuery;
  try {
    decodedPath = decodeURIComponent(pathWithoutQuery);
  } catch {
    return { type: 'blocked' };
  }

  const resolvedPath = resolveRelativeFilePath(currentDocumentPath, decodedPath);
  if (!resolvedPath || !isSupportedFilePath(resolvedPath)) {
    return { type: 'blocked' };
  }

  return { type: 'file', path: resolvedPath, fragment };
}

export function getViewportMode(hasFilePath, helpVisible) {
  if (helpVisible) return 'help';
  return hasFilePath ? 'content' : 'empty';
}

export function getImageSourcePolicy(rawSource) {
  if (typeof rawSource !== 'string' || rawSource.trim() === '') {
    return { type: 'blocked', reason: 'Image source missing' };
  }

  if (/^(?:data|blob):/i.test(rawSource)) {
    return { type: 'blocked', reason: 'Embedded image not loaded' };
  }

  if (/^(?:[a-z]+:)?\/\//i.test(rawSource)) {
    return { type: 'blocked', reason: 'Remote image not loaded' };
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(rawSource)) {
    return { type: 'blocked', reason: 'Unsupported image source' };
  }

  return { type: 'relative', source: rawSource };
}

export function getPreferredThemeIndex(themeList, savedThemeName = null) {
  if (!Array.isArray(themeList) || themeList.length === 0) {
    return -1;
  }

  if (savedThemeName) {
    const savedThemeIndex = themeList.findIndex(
      (theme) => theme.name.toLowerCase() === savedThemeName.toLowerCase()
    );

    if (savedThemeIndex >= 0) {
      return savedThemeIndex;
    }
  }

  for (const preferredThemeName of PREFERRED_THEME_NAMES) {
    const preferredThemeIndex = themeList.findIndex(
      (theme) => theme.name.toLowerCase() === preferredThemeName.toLowerCase()
    );

    if (preferredThemeIndex >= 0) {
      return preferredThemeIndex;
    }
  }

  return 0;
}

export function isColorDark(color) {
  const rgb = hexToRgb(color);
  if (!rgb) return false;
  const { r, g, b } = rgb;
  const brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return brightness < 155;
}

export function calculateNewZoom(current, deltaY, step, min, max) {
  let next = current;
  if (deltaY < 0) {
    next = current + step;
  } else {
    next = current - step;
  }
  return Math.min(Math.max(next, min), max);
}

export function getLineGutterLeft({
  viewLeft,
  stageLeft,
  paddingLeft,
  gutterWidth,
  gap = 12,
  minLeft = 4,
}) {
  const safeNumber = (value, fallback = 0) => (
    Number.isFinite(Number(value)) ? Number(value) : fallback
  );
  const textLeft = safeNumber(viewLeft) - safeNumber(stageLeft) + safeNumber(paddingLeft);
  return Math.max(
    safeNumber(minLeft, 4),
    textLeft - safeNumber(gutterWidth) - safeNumber(gap, 12)
  );
}

export function getMinimapViewportGeometry({
  scrollTop,
  scrollHeight,
  clientHeight,
  trackHeight,
  contentHeight = trackHeight,
  minHeight = 14,
}) {
  const safeTrackHeight = Math.max(0, Number(trackHeight) || 0);
  const safeContentHeight = Math.min(
    safeTrackHeight,
    Math.max(0, Number(contentHeight) || 0)
  );
  const safeScrollHeight = Math.max(1, Number(scrollHeight) || 1);
  const safeClientHeight = Math.max(0, Number(clientHeight) || 0);
  const maxScroll = Math.max(0, safeScrollHeight - safeClientHeight);
  const height = maxScroll === 0
    ? safeContentHeight
    : Math.min(
      safeContentHeight,
      Math.max(Number(minHeight) || 0, (safeClientHeight / safeScrollHeight) * safeContentHeight)
    );
  const progress = maxScroll === 0
    ? 0
    : Math.min(1, Math.max(0, (Number(scrollTop) || 0) / maxScroll));

  return {
    top: progress * Math.max(0, safeContentHeight - height),
    height,
  };
}
