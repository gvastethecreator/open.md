import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import mermaid from 'mermaid';
import allThemes from './themes.json';

let currentZoom = 1;
const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3.0;
const THEME_STORAGE_KEY = 'openmd-theme';
const READING_TOOLS_STORAGE_KEY = 'openmd-reading-tools-v1';
const PREFERRED_THEME_NAMES = ['Github Light', 'Github Dark', 'GitHub', 'Ayu Light', 'Ayu Dark'];
const CURATED_THEME_NAMES = ['Paper', 'Github Light', 'Github Dark', 'Ayu Light', 'Ayu Dark'];
const SUPPORTED_EXTENSIONS = ['.md', '.markdown', '.txt'];
const MAX_LOCAL_IMAGES = 100;
const IMAGE_LOAD_CONCURRENCY = 4;

export const DEFAULT_READING_TOOLS = Object.freeze({
  lineGuide: false,
  minimap: false,
  source: false,
  stats: false,
});

let themes = [];
let currentThemeIndex = -1;
let dragDropUnlisten = null;
let fileOpenRequestUnlisten = null;
let toastTimeoutId = null;
let scrollRafId = null;
let currentFilePath = null;
let isHelpVisible = false;
let focusBeforeHelp = null;
let loadRequestId = 0;
let currentDocument = null;
let readingTools = { ...DEFAULT_READING_TOOLS };
let isReadingToolsOpen = false;
let currentSourceLine = 1;
let currentReadingProgress = 0;
let readingUiRafId = null;
let minimapResizeObserver = null;
let isMinimapDragging = false;
let isMinimapDocumentDirty = true;
let minimapCloneRevision = 0;
let minimapContentHeight = 0;
let viewScrollPositions = { rendered: 0, source: 0 };
let windowChromeUnlisteners = [];
let fileOpenRequestsReady = false;
let queuedFileOpenRequests = [];
let fileOpenRequestChain = Promise.resolve();
const handledFileOpenRequestIds = new Set();

const ui = {
  windowFileTitle: null,
  windowMinimizeButton: null,
  windowMaximizeButton: null,
  windowCloseButton: null,
  content: null,
  documentStage: null,
  sourceView: null,
  sourceContent: null,
  lineGutter: null,
  documentMinimap: null,
  minimapDocument: null,
  minimapViewport: null,
  viewport: null,
  readerPage: null,
  emptyStage: null,
  helpStage: null,
  emptyOpenButton: null,
  toolbarOpenButton: null,
  helpToggleButton: null,
  closeHelpButton: null,
  helpTitle: null,
  scrollToTop: null,
  toast: null,
  toolbar: null,
  toolbarActions: null,
  actionsToggleButton: null,
  statusPrimary: null,
  statusContext: null,
  statusMetrics: null,
  readingToolsButton: null,
  readingToolsShell: null,
  readingToolsPanel: null,
  readingToolToggles: [],
};

try {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
} catch (e) {
  console.error('Mermaid init error:', e);
}

function cacheElements() {
  ui.windowFileTitle = document.getElementById('window-file-title');
  ui.windowMinimizeButton = document.getElementById('window-minimize-button');
  ui.windowMaximizeButton = document.getElementById('window-maximize-button');
  ui.windowCloseButton = document.getElementById('window-close-button');
  ui.content = document.getElementById('content');
  ui.documentStage = document.getElementById('document-stage');
  ui.sourceView = document.getElementById('source-view');
  ui.sourceContent = document.getElementById('source-content');
  ui.lineGutter = document.getElementById('line-gutter');
  ui.documentMinimap = document.getElementById('document-minimap');
  ui.minimapDocument = document.getElementById('minimap-document');
  ui.minimapViewport = document.getElementById('minimap-viewport');
  ui.viewport = document.getElementById('viewport');
  ui.readerPage = document.getElementById('reader-page');
  ui.emptyStage = document.getElementById('empty-stage');
  ui.helpStage = document.getElementById('help-stage');
  ui.emptyOpenButton = document.getElementById('empty-open-button');
  ui.toolbarOpenButton = document.getElementById('toolbar-open-button');
  ui.helpToggleButton = document.getElementById('help-toggle-button');
  ui.closeHelpButton = document.getElementById('close-help-button');
  ui.helpTitle = document.getElementById('help-title');
  ui.scrollToTop = document.getElementById('scroll-to-top');
  ui.toast = document.getElementById('toast');
  ui.toolbar = document.getElementById('app-toolbar');
  ui.toolbarActions = document.getElementById('toolbar-actions');
  ui.actionsToggleButton = document.getElementById('actions-toggle-button');
  ui.statusPrimary = document.getElementById('status-pill');
  ui.statusContext = document.getElementById('status-context');
  ui.statusMetrics = document.getElementById('status-metrics');
  ui.readingToolsButton = document.getElementById('reading-tools-button');
  ui.readingToolsShell = document.getElementById('reading-tools-shell');
  ui.readingToolsPanel = document.getElementById('reading-tools-panel');
  ui.readingToolToggles = [...document.querySelectorAll('[data-reading-tool]')];
}

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

function renderSourceContent(source, isMarkdown = true) {
  if (!ui.sourceContent) return;
  if (!isMarkdown) {
    ui.sourceContent.textContent = String(source);
    return;
  }

  const fragment = document.createDocumentFragment();
  const lines = String(source).split('\n');
  lines.forEach((line, lineIndex) => {
    let cursor = 0;
    for (const range of getMarkdownSourceTokenRanges(line)) {
      if (range.start > cursor) fragment.append(document.createTextNode(line.slice(cursor, range.start)));
      const token = document.createElement('strong');
      token.className = 'source-markup-token';
      token.textContent = line.slice(range.start, range.end);
      fragment.append(token);
      cursor = range.end;
    }
    if (cursor < line.length) fragment.append(document.createTextNode(line.slice(cursor)));
    if (lineIndex < lines.length - 1) fragment.append(document.createTextNode('\n'));
  });

  ui.sourceContent.replaceChildren(fragment);
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

function updateWindowTitle(filePath = null) {
  const visibleTitle = isHelpVisible ? 'Help' : filePath ? getDisplayName(filePath) : 'Ready';
  document.title = visibleTitle === 'Ready' ? 'OpenMD' : `OpenMD — ${visibleTitle}`;
  if (ui.windowFileTitle) {
    ui.windowFileTitle.textContent = visibleTitle;
    ui.windowFileTitle.title = visibleTitle;
  }
}

async function setupWindowChrome() {
  if (!window.__TAURI_INTERNALS__) return;

  const appWindow = getCurrentWindow();
  const syncMaximizePresentation = async () => {
    const maximized = await appWindow.isMaximized();
    const presentation = getWindowControlPresentation(maximized);
    const icon = ui.windowMaximizeButton?.querySelector('i');
    if (icon) icon.className = presentation.iconClass;
    if (ui.windowMaximizeButton) {
      ui.windowMaximizeButton.setAttribute('aria-label', presentation.label);
      ui.windowMaximizeButton.title = presentation.label;
    }
    document.body.classList.toggle('is-window-maximized', maximized);
  };

  const runWindowAction = async (action, failureMessage, afterAction = null) => {
    try {
      await action();
      await afterAction?.();
    } catch (error) {
      console.error(failureMessage, error);
      showToast(failureMessage, 'error');
    }
  };

  const toggleMaximize = () => runWindowAction(
    () => appWindow.toggleMaximize(),
    'Could not resize the window',
    syncMaximizePresentation
  );

  ui.windowMinimizeButton?.addEventListener('click', () => {
    runWindowAction(() => appWindow.minimize(), 'Could not minimize the window');
  });
  ui.windowMaximizeButton?.addEventListener('click', toggleMaximize);
  ui.windowCloseButton?.addEventListener('click', () => {
    runWindowAction(() => appWindow.close(), 'Could not close the window');
  });
  await syncMaximizePresentation();
  windowChromeUnlisteners.push(await appWindow.onResized(syncMaximizePresentation));
}

function updateWindowUrl(filePath = null) {
  if (typeof window === 'undefined') return;

  const url = new URL(window.location.href);
  if (filePath) {
    url.searchParams.set('file', filePath);
  } else {
    url.searchParams.delete('file');
  }

  window.history.replaceState({}, '', url);
}

function renderImageError(image, reason) {
  const message = document.createElement('span');
  message.className = 'image-error';
  message.setAttribute('role', 'status');
  const label = image.getAttribute('alt')?.trim();
  message.textContent = label ? `${label}: ${reason}` : reason;
  image.replaceWith(message);
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

async function hydrateRelativeImages(documentPath, requestId) {
  if (!ui.content || !documentPath) return;

  const images = [...ui.content.querySelectorAll('img')];
  images.slice(MAX_LOCAL_IMAGES).forEach((image) => {
    renderImageError(image, 'Image limit exceeded');
  });

  const pendingImages = images.slice(0, MAX_LOCAL_IMAGES);
  let nextImageIndex = 0;

  const hydrateNextImage = async () => {
    while (nextImageIndex < pendingImages.length) {
      const image = pendingImages[nextImageIndex];
      nextImageIndex += 1;

      const policy = getImageSourcePolicy(image.getAttribute('src'));
      if (policy.type !== 'relative') {
        renderImageError(image, policy.reason);
        continue;
      }

      image.removeAttribute('src');
      image.setAttribute('aria-busy', 'true');

      try {
        const dataUrl = await invoke('get_image_data', {
          documentPath,
          relativeSource: policy.source,
        });

        if (requestId !== loadRequestId || !image.isConnected) return;
        image.src = dataUrl;
        image.removeAttribute('aria-busy');
      } catch (error) {
        console.warn('Could not load a relative image:', error);
        if (requestId === loadRequestId && image.isConnected) {
          renderImageError(image, 'Image unavailable');
        }
      }
    }
  };

  const workerCount = Math.min(IMAGE_LOAD_CONCURRENCY, pendingImages.length);
  await Promise.all(Array.from({ length: workerCount }, hydrateNextImage));
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

function populateThemeSelect() {
  const select = document.getElementById('theme-select');
  if (!select) return;
  select.innerHTML = '';

  const curatedNames = new Set(CURATED_THEME_NAMES.map((name) => name.toLowerCase()));
  const recommendedGroup = document.createElement('optgroup');
  recommendedGroup.label = 'Recommended';
  const catalogGroup = document.createElement('optgroup');
  catalogGroup.label = 'All themes';

  const appendOption = (group, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = themes[index].name;
    if (index === currentThemeIndex) option.selected = true;
    group.appendChild(option);
  };

  for (const themeName of CURATED_THEME_NAMES) {
    const index = themes.findIndex((theme) => theme.name.toLowerCase() === themeName.toLowerCase());
    if (index >= 0) appendOption(recommendedGroup, index);
  }

  for (let i = 0; i < themes.length; i += 1) {
    if (!curatedNames.has(themes[i].name.toLowerCase())) {
      appendOption(catalogGroup, i);
    }
  }

  if (recommendedGroup.children.length > 0) select.appendChild(recommendedGroup);
  if (catalogGroup.children.length > 0) select.appendChild(catalogGroup);
}
function updateThemeCopy() {
  const select = document.getElementById('theme-select');
  if (select && currentThemeIndex >= 0) {
    select.value = String(currentThemeIndex);
    const themeLabel = `Theme: ${themes[currentThemeIndex].name}`;
    select.title = themeLabel;
    select.setAttribute('aria-label', themeLabel);
    select.closest('.theme-field')?.setAttribute('title', themeLabel);
  }
}
function setStatusText(primary, context = '', title = [primary, context].filter(Boolean).join(' · ')) {
  const primaryElement = ui.statusPrimary || document.getElementById('status-pill');
  const contextElement = ui.statusContext || document.getElementById('status-context');
  if (!primaryElement) return;

  primaryElement.textContent = primary;
  primaryElement.title = title;
  if (contextElement) {
    contextElement.textContent = context;
    contextElement.title = title;
  }
}
function updateStatus(filePath = null) {
  if (isHelpVisible) {
    setStatusText('Help', 'F1 to close');
    updateStatusMetrics();
    return;
  }

  if (filePath) {
    const viewLabel = currentDocument && readingTools.source ? 'Source' : getFileKind(filePath);
    setStatusText(getDisplayName(filePath), viewLabel);
    updateStatusMetrics();
    return;
  }

  setStatusText('OpenMD', 'Ready');
  updateStatusMetrics();
}

function updateStatusMetrics() {
  if (!ui.statusMetrics) return;

  const isAvailable = Boolean(currentDocument && currentFilePath && !isHelpVisible);
  if (!isAvailable) {
    ui.statusMetrics.hidden = true;
    ui.statusMetrics.textContent = '';
    ui.statusMetrics.removeAttribute('aria-label');
    return;
  }

  const metrics = getStatusMetricParts({
    lineCount: currentDocument.lineCount,
    characterCount: currentDocument.characterCount,
    zoomPercent: currentZoom * 100,
    currentLine: currentSourceLine,
    showCurrentLine: readingTools.lineGuide,
    readingProgress: currentReadingProgress,
    readingTimeMinutes: currentDocument.readingTimeMinutes,
    showReadingStats: readingTools.stats,
  });

  ui.statusMetrics.hidden = false;
  ui.statusMetrics.textContent = metrics.visible.join(' · ');
  ui.statusMetrics.title = metrics.accessible.join('. ');
  ui.statusMetrics.setAttribute('aria-label', metrics.accessible.join('. '));
}

function hasLoadedDocument() {
  return Boolean(currentDocument && currentFilePath);
}

function isSourceViewActive() {
  return hasLoadedDocument() && readingTools.source;
}

function loadReadingToolPreferences() {
  try {
    const saved = localStorage.getItem(READING_TOOLS_STORAGE_KEY);
    readingTools = saved ? normalizeReadingTools(JSON.parse(saved)) : { ...DEFAULT_READING_TOOLS };
  } catch (error) {
    console.warn('Could not read saved reading tools:', error);
    readingTools = { ...DEFAULT_READING_TOOLS };
  }
}

function saveReadingToolPreferences() {
  try {
    localStorage.setItem(READING_TOOLS_STORAGE_KEY, JSON.stringify(readingTools));
  } catch (error) {
    console.warn('Could not save reading tools:', error);
  }
}

function setReadingToolsOpen(nextOpen, { returnFocus = false } = {}) {
  const canOpen = hasLoadedDocument() && !isHelpVisible;
  isReadingToolsOpen = Boolean(nextOpen && canOpen);
  document.body.classList.toggle('is-reading-tools-open', isReadingToolsOpen);
  ui.readingToolsButton?.setAttribute('aria-expanded', String(isReadingToolsOpen));

  if (ui.readingToolsButton) {
    const label = isReadingToolsOpen ? 'Close reading tools' : 'Open reading tools';
    ui.readingToolsButton.setAttribute('aria-label', label);
    ui.readingToolsButton.title = label;
  }

  if (ui.readingToolsPanel) {
    ui.readingToolsPanel.setAttribute('aria-hidden', String(!isReadingToolsOpen));
    ui.readingToolsPanel.toggleAttribute('inert', !isReadingToolsOpen);
  }

  if (!isReadingToolsOpen && returnFocus) {
    queueMicrotask(() => ui.readingToolsButton?.focus());
  }
}

function updateReadingToolControls() {
  const available = hasLoadedDocument();
  const hasActiveTool = available && Object.values(readingTools).some(Boolean);

  if (ui.readingToolsButton) {
    ui.readingToolsButton.disabled = !available;
    ui.readingToolsButton.classList.toggle('is-active', hasActiveTool);
    if (!available) ui.readingToolsButton.title = 'Open a file to use reading tools';
  }

  ui.readingToolToggles.forEach((toggle) => {
    const tool = toggle.dataset.readingTool;
    toggle.disabled = !available;
    toggle.setAttribute('aria-checked', String(Boolean(readingTools[tool])));
  });

  if (!available) setReadingToolsOpen(false);
}

function applyReadingTools() {
  const available = hasLoadedDocument();
  const sourceActive = available && readingTools.source;
  const lineGuideActive = available && readingTools.lineGuide;
  const minimapActive = available && readingTools.minimap;

  document.body.classList.toggle('is-source-view', sourceActive);
  document.body.classList.toggle('is-line-guide', lineGuideActive);
  document.body.classList.toggle('is-minimap', minimapActive);
  ui.content?.classList.toggle('hidden', sourceActive);
  ui.sourceView?.classList.toggle('hidden', !sourceActive);

  if (ui.lineGutter) {
    ui.lineGutter.hidden = !lineGuideActive;
    if (!lineGuideActive) ui.lineGutter.replaceChildren();
  }

  if (ui.documentMinimap) {
    ui.documentMinimap.hidden = !minimapActive;
    isMinimapDocumentDirty = minimapActive;
    if (!minimapActive) {
      minimapContentHeight = 0;
      ui.minimapDocument?.replaceChildren();
    }
  }

  updateReadingToolControls();
  updateStatus(currentFilePath);
  queueReadingUiUpdate();
}

function setReadingTool(tool, nextValue) {
  if (!Object.hasOwn(DEFAULT_READING_TOOLS, tool) || !hasLoadedDocument()) return;

  const next = Boolean(nextValue);
  if (readingTools[tool] === next) return;

  if (tool === 'source' && ui.readerPage) {
    const previousView = readingTools.source ? 'source' : 'rendered';
    viewScrollPositions[previousView] = ui.readerPage.scrollTop;
  }

  readingTools = { ...readingTools, [tool]: next };
  saveReadingToolPreferences();
  applyReadingTools();

  if (tool === 'source' && ui.readerPage) {
    const nextView = next ? 'source' : 'rendered';
    requestAnimationFrame(() => {
      ui.readerPage?.scrollTo({ top: viewScrollPositions[nextView] || 0, behavior: 'auto' });
      queueReadingUiUpdate();
      (next ? ui.sourceView : ui.content)?.focus({ preventScroll: true });
    });
  }

  const labels = {
    lineGuide: 'Line guide',
    minimap: 'Minimap',
    source: 'Source view',
    stats: 'Reading stats',
  };
  showToast(`${labels[tool]} ${next ? 'on' : 'off'}`);
}

function syncViewportState() {
  const mode = getViewportMode(Boolean(currentFilePath), isHelpVisible);
  const readerMode = currentFilePath ? 'content' : 'empty';
  const sourceActive = readerMode === 'content' && isSourceViewActive();

  if (ui.emptyStage) {
    ui.emptyStage.classList.toggle('hidden', readerMode !== 'empty');
  }

  if (ui.helpStage) {
    ui.helpStage.setAttribute('aria-hidden', String(mode !== 'help'));
    ui.helpStage.toggleAttribute('inert', mode !== 'help');
  }

  if (ui.documentStage) {
    ui.documentStage.classList.toggle('hidden', readerMode !== 'content');
  }

  if (ui.content) {
    ui.content.classList.toggle('hidden', readerMode !== 'content' || sourceActive);
  }

  if (ui.sourceView) {
    ui.sourceView.classList.toggle('hidden', readerMode !== 'content' || !sourceActive);
  }

  if (ui.readerPage) {
    ui.readerPage.setAttribute('aria-hidden', String(mode === 'help'));
    ui.readerPage.toggleAttribute('inert', mode === 'help');
  }

  if (ui.viewport) {
    ui.viewport.setAttribute('data-page', mode === 'help' ? '2' : '1');
  }

  document.body.classList.toggle('is-help-open', mode === 'help');
  ui.helpToggleButton?.setAttribute('aria-expanded', String(mode === 'help'));
  if (ui.helpToggleButton) {
    const helpLabel = mode === 'help' ? 'Close help' : 'Open help';
    ui.helpToggleButton.setAttribute('aria-label', helpLabel);
    ui.helpToggleButton.title = `${helpLabel} (F1)`;
  }
}

function setHelpVisible(nextVisible, { manageFocus = true } = {}) {
  if (nextVisible === isHelpVisible) return;

  if (nextVisible && manageFocus) {
    focusBeforeHelp = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }

  isHelpVisible = nextVisible;
  if (nextVisible) setReadingToolsOpen(false);
  syncViewportState();
  updateStatus(currentFilePath);
  updateWindowTitle(currentFilePath);
  setActionsPinned(false);

  if (nextVisible) {
    ui.helpStage?.scrollTo({ top: 0, behavior: 'auto' });
  }
  handleScroll();

  if (!manageFocus) return;

  if (nextVisible) {
    queueMicrotask(() => ui.helpTitle?.focus());
    return;
  }

  const returnTarget = focusBeforeHelp?.isConnected
    ? focusBeforeHelp
    : ui.helpToggleButton;
  focusBeforeHelp = null;
  queueMicrotask(() => returnTarget?.focus());
}

function toggleHelp() {
  setHelpVisible(!isHelpVisible);
}

function setDragState(isActive) {
  document.body.classList.toggle('is-dragging', isActive);
}

async function initThemes() {
  try {
    themes = [...allThemes].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
    let savedThemeName = null;
    try {
      savedThemeName = localStorage.getItem(THEME_STORAGE_KEY);
    } catch (error) {
      console.warn('Could not read the saved theme:', error);
    }
    currentThemeIndex = getPreferredThemeIndex(themes, savedThemeName);

    populateThemeSelect();
    updateThemeCopy();

    if (currentThemeIndex >= 0) {
      applyTheme(themes[currentThemeIndex], { silent: true });
    }
  } catch (error) {
    console.error('Failed to initialize themes:', error);
    showToast('Could not load themes');
  }
}

function applyTheme(theme, { silent = false } = {}) {
  if (!theme) return;

  const root = document.documentElement;
  const tokens = getThemeTokens(theme);
  root.style.setProperty('--bg-color', tokens.background);
  root.style.setProperty('--text-color', tokens.text);
  root.style.setProperty('--border-color', tokens.border);
  root.style.setProperty('--link-color', tokens.link);
  root.style.setProperty('--accent-color', tokens.accent);
  root.style.setProperty('--ui-accent', tokens.accent);
  root.style.setProperty('--accent-foreground', tokens.accentForeground);
  root.style.setProperty('--code-bg', tokens.surface);
  root.style.setProperty('--heading-1', tokens.text);
  root.style.setProperty('--heading-2', tokens.text);
  root.style.setProperty('--heading-3', tokens.text);
  root.style.setProperty('--heading-4', tokens.text);
  root.style.setProperty('--heading-5', tokens.text);
  root.style.setProperty('--quote-color', tokens.quote);
  root.style.setProperty('--panel-bg', tokens.surface);
  root.style.setProperty('--toolbar-bg', tokens.surface);
  root.style.setProperty('--danger-color', tokens.danger);
  root.style.setProperty('--shadow-color', tokens.shadow);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', tokens.background);

  const isDark = isColorDark(tokens.background);
  root.style.colorScheme = isDark ? 'dark' : 'light';
  try {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: isDark ? 'dark' : 'default' });
  } catch (e) {
    console.error('Mermaid re-init error:', e);
  }

  currentThemeIndex = themes.findIndex((item) => item.name === theme.name);

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme.name);
  } catch (error) {
    console.warn('Could not persist the selected theme:', error);
  }
  updateThemeCopy();

  if (!silent) {
    showToast(`Theme: ${theme.name}`);
  }

  if (currentFilePath && ui.content?.querySelector('.mermaid')) {
    renderMermaidDiagrams({ reset: true })
      .then(markMinimapDirty)
      .catch((error) => {
        console.error('Mermaid theme update error:', error);
        showToast('The diagram could not update for this theme');
      });
  }
  isMinimapDocumentDirty = true;
  queueReadingUiUpdate();
}

export function isColorDark(color) {
  const rgb = hexToRgb(color);
  if (!rgb) return false;
  const { r, g, b } = rgb;
  const brightness = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  return brightness < 155;
}

function showToast(message) {
  let toast = ui.toast || document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    toast.className = 'toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.setAttribute('aria-atomic', 'true');
    document.body.appendChild(toast);
    ui.toast = toast;
  }
  toast.textContent = message;
  toast.classList.add('show');

  clearTimeout(toastTimeoutId);
  toastTimeoutId = setTimeout(() => {
    toast.classList.remove('show');
  }, 2000);
}

function cycleTheme(direction = 1) {
  if (themes.length === 0) return;
  currentThemeIndex = (currentThemeIndex + direction + themes.length) % themes.length;
  applyTheme(themes[currentThemeIndex]);
}

function renderLoadingState(filePath) {
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.setAttribute('role', 'status');
  loading.textContent = `Opening ${getDisplayName(filePath)}…`;
  ui.content.replaceChildren(loading);
}

function renderErrorState(error) {
  const panel = document.createElement('div');
  panel.className = 'error';

  const title = document.createElement('h1');
  title.textContent = 'Could not open the file';

  const message = document.createElement('p');
  message.textContent = String(error);

  const retryButton = document.createElement('button');
  retryButton.className = 'primary-button';
  retryButton.type = 'button';
  const retryIcon = document.createElement('i');
  retryIcon.className = 'iconoir-folder';
  retryIcon.setAttribute('aria-hidden', 'true');
  const retryLabel = document.createElement('span');
  retryLabel.textContent = 'Choose another file';
  retryButton.append(retryIcon, retryLabel);
  retryButton.addEventListener('click', openFilePicker);

  panel.append(title, message, retryButton);
  ui.content.replaceChildren(panel);
}

function enhanceTables() {
  ui.content.querySelectorAll('table').forEach((table) => {
    if (table.parentElement?.classList.contains('table-scroll')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll';
    wrapper.setAttribute('tabindex', '0');
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Scrollable table');
    table.before(wrapper);
    wrapper.appendChild(table);
  });
}

function enhanceCodeBlocks() {
  ui.content.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code');
    if (!code || pre.querySelector('.copy-code-btn')) return;

    const button = document.createElement('button');
    button.className = 'copy-code-btn';
    button.type = 'button';
    button.setAttribute('aria-label', 'Copy code block');
    button.title = 'Copy code';
    const icon = document.createElement('i');
    icon.className = 'iconoir-copy';
    icon.setAttribute('aria-hidden', 'true');
    button.appendChild(icon);
    button.addEventListener('click', async () => {
      try {
        if (!navigator.clipboard?.writeText) {
          throw new Error('Clipboard access is unavailable');
        }
        await navigator.clipboard.writeText(code.innerText);
        icon.className = 'iconoir-check';
        button.setAttribute('aria-label', 'Code copied');
        button.title = 'Copied';
        showToast('Code copied');
      } catch (error) {
        console.error('Could not copy code:', error);
        icon.className = 'iconoir-refresh';
        button.setAttribute('aria-label', 'Retry copying code');
        button.title = 'Retry copy';
        showToast('Could not copy the code');
      }

      setTimeout(() => {
        icon.className = 'iconoir-copy';
        button.setAttribute('aria-label', 'Copy code block');
        button.title = 'Copy code';
      }, 2000);
    });

    pre.appendChild(button);
  });
}

async function renderMermaidDiagrams({ reset = false } = {}) {
  if (!ui.content) return;

  const diagrams = [...ui.content.querySelectorAll('.mermaid')];
  if (diagrams.length === 0) return;

  diagrams.forEach((diagram) => {
    if (!diagram.dataset.mermaidSource) {
      diagram.dataset.mermaidSource = diagram.textContent || '';
    }

    if (reset) {
      diagram.textContent = diagram.dataset.mermaidSource;
      diagram.removeAttribute('data-processed');
    }
  });

  await mermaid.run({ nodes: diagrams, suppressErrors: true });
}

function focusLoadedContent(fragment = '') {
  ui.readerPage?.scrollTo({ top: 0, behavior: 'auto' });

  if (isSourceViewActive()) {
    ui.sourceView?.focus({ preventScroll: true });
    return;
  }

  if (fragment) {
    let fragmentId = fragment.slice(1);
    try {
      fragmentId = decodeURIComponent(fragmentId);
    } catch {
      fragmentId = '';
    }

    const fragmentTarget = fragmentId
      ? [...ui.content.querySelectorAll('[id]')].find((element) => element.id === fragmentId)
      : null;

    if (fragmentTarget) {
      fragmentTarget.setAttribute('tabindex', '-1');
      fragmentTarget.focus({ preventScroll: true });
      fragmentTarget.scrollIntoView({ block: 'start' });
      return;
    }
  }

  ui.content.focus({ preventScroll: true });
}

async function loadContent(filePath = null, { fragment = '' } = {}) {
  if (!ui.content) {
    console.error('Content element not found!');
    return;
  }

  if (!filePath) {
    const urlParams = new URLSearchParams(window.location.search);
    filePath = urlParams.get('file');
  }

  if (!filePath) {
    loadRequestId += 1;
    currentFilePath = null;
    currentDocument = null;
    isMinimapDocumentDirty = true;
    currentSourceLine = 1;
    currentReadingProgress = 0;
    viewScrollPositions = { rendered: 0, source: 0 };
    isHelpVisible = false;
    focusBeforeHelp = null;
    ui.content.removeAttribute('aria-busy');
    ui.content.replaceChildren();
    if (ui.sourceContent) ui.sourceContent.textContent = '';
    syncViewportState();
    applyReadingTools();
    updateWindowTitle();
    updateWindowUrl();
    return;
  }

  const requestId = ++loadRequestId;
  currentFilePath = filePath;
  currentDocument = null;
  isMinimapDocumentDirty = true;
  currentSourceLine = 1;
  currentReadingProgress = 0;
  viewScrollPositions = { rendered: 0, source: 0 };
  isHelpVisible = false;
  focusBeforeHelp = null;
  setReadingToolsOpen(false);
  if (ui.sourceContent) ui.sourceContent.textContent = '';
  ui.content.setAttribute('aria-busy', 'true');
  renderLoadingState(filePath);
  syncViewportState();
  applyReadingTools();
  setStatusText(getDisplayName(filePath), 'Opening…');
  updateWindowTitle(filePath);

  try {
    const documentPayload = normalizeDocumentPayload(
      await invoke('get_file_content', { path: filePath })
    );
    if (requestId !== loadRequestId) return;
    currentDocument = documentPayload;
    ui.content.innerHTML = documentPayload.html;
    renderSourceContent(documentPayload.source, getFileKind(filePath) === 'Markdown');
    ui.content.removeAttribute('aria-busy');
    updateWindowTitle(filePath);
    updateWindowUrl(filePath);

    const images = ui.content.querySelectorAll('img');
    images.forEach((img) => {
      img.setAttribute('loading', 'lazy');
    });

    await hydrateRelativeImages(filePath, requestId);
    if (requestId !== loadRequestId) return;
    enhanceTables();
    enhanceCodeBlocks();

    try {
      await renderMermaidDiagrams();
    } catch (error) {
      console.error('Mermaid render error:', error);
      showToast('One or more diagrams could not be rendered');
    }

    applyReadingTools();
    focusLoadedContent(fragment);
    handleScroll();
  } catch (error) {
    if (requestId !== loadRequestId) return;
    console.error('Error loading content:', error);
    ui.content.removeAttribute('aria-busy');
    currentDocument = null;
    isMinimapDocumentDirty = true;
    if (ui.sourceContent) ui.sourceContent.textContent = '';
    updateWindowTitle(filePath);
    updateWindowUrl(filePath);
    renderErrorState(error);
    applyReadingTools();
    setStatusText(getDisplayName(filePath), 'Could not open');
    focusLoadedContent();
  }
}

function handleLinkClick(event) {
  const target = event.target instanceof Element ? event.target.closest('a') : null;
  const hrefAttribute = target?.getAttribute('href');

  if (!target || !hrefAttribute) return;

  const action = getLinkAction(hrefAttribute, currentFilePath, target.href);
  if (action.type === 'anchor') return;

  event.preventDefault();

  if (action.type === 'external') {
    openUrl(action.href).catch((error) => {
      console.error('Failed to open URL:', error);
      showToast('Could not open the external link');
    });
    return;
  }

  if (action.type === 'file') {
    loadContent(action.path, { fragment: action.fragment });
    return;
  }

  showToast('This link type is not supported');
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

function setZoom(newZoom) {
  currentZoom = Math.min(Math.max(newZoom, MIN_ZOOM), MAX_ZOOM);
  document.documentElement.style.setProperty('--content-scale', currentZoom.toFixed(2));
  isMinimapDocumentDirty = true;
  updateStatus(currentFilePath);
  queueReadingUiUpdate();
  showToast(`Zoom: ${Math.round(currentZoom * 100)}%`);
}

function handleZoom(event) {
  if (event.ctrlKey) {
    event.preventDefault();
    setZoom(calculateNewZoom(currentZoom, event.deltaY, ZOOM_STEP, MIN_ZOOM, MAX_ZOOM));
  }
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

function getRenderedLineAnchors() {
  if (!ui.content || !ui.documentStage) return [];

  const stageTop = ui.documentStage.getBoundingClientRect().top;
  const seenLines = new Set();
  return [...ui.content.querySelectorAll('.source-line-anchor[data-source-line]')]
    .map((anchor) => {
      let visualTarget = anchor.nextElementSibling;
      while (visualTarget?.classList.contains('source-line-anchor')) {
        visualTarget = visualTarget.nextElementSibling;
      }
      visualTarget ||= anchor;
      const targetRect = visualTarget.getBoundingClientRect();
      const targetStyles = getComputedStyle(visualTarget);
      const targetLineHeight = Number.parseFloat(targetStyles.lineHeight);
      return {
        line: Number.parseInt(anchor.dataset.sourceLine, 10),
        top: targetRect.top - stageTop,
        lineHeight: Number.isFinite(targetLineHeight)
          ? targetLineHeight
          : Math.min(Math.max(targetRect.height, 16), 28),
      };
    })
    .filter((anchor) => {
      if (!Number.isFinite(anchor.line) || anchor.line < 1 || seenLines.has(anchor.line)) return false;
      seenLines.add(anchor.line);
      return true;
    })
    .sort((left, right) => left.top - right.top);
}

function createLineNumber(line, top, isCurrent = false, lineHeight = 20) {
  const label = document.createElement('span');
  label.className = `line-number${isCurrent ? ' is-current' : ''}`;
  label.textContent = String(line);
  label.style.top = `${Math.max(0, top)}px`;
  label.style.height = `${Math.max(1, lineHeight)}px`;
  label.style.lineHeight = `${Math.max(1, lineHeight)}px`;
  return label;
}

function positionLineGutter() {
  if (!ui.lineGutter || !ui.documentStage) return;
  const activeView = isSourceViewActive() ? ui.sourceView : ui.content;
  if (!activeView) return;

  const viewRect = activeView.getBoundingClientRect();
  const stageRect = ui.documentStage.getBoundingClientRect();
  const viewStyles = getComputedStyle(activeView);
  const compact = window.matchMedia?.('(max-width: 460px)').matches;
  const digitWidth = String(currentDocument?.lineCount || 1).length * (compact ? 6 : 7);
  ui.lineGutter.style.width = `${Math.max(compact ? 29 : 34, digitWidth + 8)}px`;
  const gutterRect = ui.lineGutter.getBoundingClientRect();
  const gap = compact ? 8 : 12;
  const left = getLineGutterLeft({
    viewLeft: viewRect.left,
    stageLeft: stageRect.left,
    paddingLeft: Number.parseFloat(viewStyles.paddingLeft) || 0,
    gutterWidth: gutterRect.width || 34,
    gap,
  });
  ui.lineGutter.style.left = `${left}px`;
}

function renderLineGuide() {
  if (!ui.lineGutter || ui.lineGutter.hidden || !ui.readerPage || !currentDocument) return;

  positionLineGutter();
  const { scrollTop, clientHeight } = ui.readerPage;
  const fragment = document.createDocumentFragment();
  let nextCurrentLine = 1;

  if (isSourceViewActive()) {
    const styles = getComputedStyle(ui.sourceView);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 20;
    const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
    const range = getVisibleSourceLineRange({
      scrollTop,
      clientHeight,
      lineHeight,
      paddingTop,
      lineCount: currentDocument.lineCount,
    });
    nextCurrentLine = range.current;

    for (let line = range.first; line <= range.last; line += 1) {
      const top = paddingTop + ((line - 1) * lineHeight);
      fragment.appendChild(createLineNumber(line, top, line === nextCurrentLine, lineHeight));
    }
  } else {
    const anchors = getRenderedLineAnchors();
    const readingOffset = scrollTop + Math.min(48, clientHeight * 0.08);
    nextCurrentLine = getCurrentLineFromAnchors(anchors, readingOffset);
    const visibleStart = scrollTop - 18;
    const visibleEnd = scrollTop + clientHeight + 18;
    let lastVisibleTop = Number.NEGATIVE_INFINITY;
    let currentIsVisible = false;

    for (const anchor of anchors) {
      if (anchor.top < visibleStart || anchor.top > visibleEnd) continue;
      const isCurrent = anchor.line === nextCurrentLine;
      if (!isCurrent && anchor.top - lastVisibleTop < 13) continue;
      fragment.appendChild(createLineNumber(anchor.line, anchor.top, isCurrent, anchor.lineHeight));
      lastVisibleTop = anchor.top;
      currentIsVisible ||= isCurrent;
    }

    if (!currentIsVisible) {
      fragment.appendChild(createLineNumber(nextCurrentLine, readingOffset, true));
    }
  }

  ui.lineGutter.replaceChildren(fragment);
  if (nextCurrentLine !== currentSourceLine) {
    currentSourceLine = nextCurrentLine;
    updateStatusMetrics();
  }
}

function markMinimapDirty() {
  isMinimapDocumentDirty = true;
  queueReadingUiUpdate();
}

function sanitizeMinimapClone(clone) {
  clone.setAttribute('aria-hidden', 'true');
  clone.setAttribute('inert', '');
  clone.classList.remove('hidden');
  clone.querySelectorAll('.copy-code-btn').forEach((button) => button.remove());

  const elements = [clone, ...clone.querySelectorAll('*')];
  const idMap = new Map();
  const prefix = `openmd-minimap-${++minimapCloneRevision}-`;

  elements.forEach((element) => {
    if (element.id) {
      const nextId = `${prefix}${element.id}`;
      idMap.set(element.id, nextId);
      element.id = nextId;
    }
    element.removeAttribute('tabindex');
    element.removeAttribute('autofocus');
    element.removeAttribute('aria-live');
    element.removeAttribute('aria-controls');
    if (element.matches('a')) element.removeAttribute('href');
    if (element.matches('audio, video')) element.removeAttribute('controls');
  });

  if (idMap.size > 0) {
    elements.forEach((element) => {
      [...element.attributes].forEach((attribute) => {
        let nextValue = attribute.value;
        idMap.forEach((nextId, previousId) => {
          nextValue = nextValue.replaceAll(`#${previousId}`, `#${nextId}`);
        });
        if (nextValue !== attribute.value) element.setAttribute(attribute.name, nextValue);
      });
    });
  }
}

function renderMinimapDocument() {
  if (
    !isMinimapDocumentDirty
    || !ui.documentMinimap
    || ui.documentMinimap.hidden
    || !ui.minimapDocument
    || !ui.readerPage
  ) return;

  const activeView = isSourceViewActive() ? ui.sourceView : ui.content;
  if (!activeView) return;
  const trackRect = ui.documentMinimap.getBoundingClientRect();
  const viewRect = activeView.getBoundingClientRect();
  const viewStyles = getComputedStyle(activeView);
  if (trackRect.width <= 0 || trackRect.height <= 0 || viewRect.width <= 0) return;

  const documentWidth = Math.max(1, viewRect.width);
  const documentHeight = Math.max(
    1,
    activeView.scrollHeight,
    viewRect.height,
    ui.readerPage.scrollHeight
  );
  const clone = activeView.cloneNode(true);
  sanitizeMinimapClone(clone);
  clone.style.width = `${documentWidth}px`;
  clone.style.maxWidth = 'none';
  clone.style.minHeight = '0';
  clone.style.margin = '0';

  ui.minimapDocument.style.width = `${documentWidth}px`;
  ui.minimapDocument.style.height = `${documentHeight}px`;
  ui.minimapDocument.style.fontSize = viewStyles.fontSize;
  ui.minimapDocument.style.lineHeight = viewStyles.lineHeight;
  const scale = Math.min(trackRect.width / documentWidth, trackRect.height / documentHeight);
  minimapContentHeight = documentHeight * scale;
  ui.minimapDocument.style.left = `${(trackRect.width - (documentWidth * scale)) / 2}px`;
  ui.minimapDocument.style.transform = `scale(${scale})`;
  ui.minimapDocument.replaceChildren(clone);
  isMinimapDocumentDirty = false;
}

function updateMinimapViewport() {
  if (
    !ui.documentMinimap
    || ui.documentMinimap.hidden
    || !ui.minimapViewport
    || !ui.readerPage
  ) return;

  const geometry = getMinimapViewportGeometry({
    scrollTop: ui.readerPage.scrollTop,
    scrollHeight: ui.readerPage.scrollHeight,
    clientHeight: ui.readerPage.clientHeight,
    trackHeight: ui.documentMinimap.getBoundingClientRect().height,
    contentHeight: minimapContentHeight,
  });
  ui.minimapViewport.style.top = `${geometry.top}px`;
  ui.minimapViewport.style.height = `${geometry.height}px`;
  ui.documentMinimap.setAttribute('aria-valuenow', String(currentReadingProgress));
  ui.documentMinimap.setAttribute('aria-valuetext', `${currentReadingProgress}% through document`);
}

function updateReadingUi() {
  if (!currentDocument || !ui.readerPage || isHelpVisible) return;
  const nextProgress = getReadingProgress(
    ui.readerPage.scrollTop,
    ui.readerPage.scrollHeight,
    ui.readerPage.clientHeight
  );
  const progressChanged = nextProgress !== currentReadingProgress;
  currentReadingProgress = nextProgress;
  renderLineGuide();
  renderMinimapDocument();
  updateMinimapViewport();
  if (progressChanged) updateStatusMetrics();
}

function queueReadingUiUpdate() {
  if (readingUiRafId) return;
  readingUiRafId = requestAnimationFrame(() => {
    readingUiRafId = null;
    updateReadingUi();
  });
}

function scrollFromMinimapPointer(event) {
  if (!ui.documentMinimap || !ui.readerPage) return;
  const rect = ui.documentMinimap.getBoundingClientRect();
  const ratio = Math.min(Math.max((event.clientY - rect.top) / Math.max(1, rect.height), 0), 1);
  const maxScroll = Math.max(0, ui.readerPage.scrollHeight - ui.readerPage.clientHeight);
  ui.readerPage.scrollTo({ top: ratio * maxScroll, behavior: 'auto' });
}

function handleMinimapPointerDown(event) {
  if (event.button !== 0) return;
  isMinimapDragging = true;
  ui.documentMinimap?.setPointerCapture?.(event.pointerId);
  scrollFromMinimapPointer(event);
}

function handleMinimapPointerMove(event) {
  if (isMinimapDragging) scrollFromMinimapPointer(event);
}

function handleMinimapPointerUp(event) {
  isMinimapDragging = false;
  if (ui.documentMinimap?.hasPointerCapture?.(event.pointerId)) {
    ui.documentMinimap.releasePointerCapture(event.pointerId);
  }
}

function handleMinimapKeyboard(event) {
  if (!ui.readerPage) return;
  const maxScroll = Math.max(0, ui.readerPage.scrollHeight - ui.readerPage.clientHeight);
  let nextScroll = null;

  if (event.key === 'Home') nextScroll = 0;
  if (event.key === 'End') nextScroll = maxScroll;
  if (event.key === 'ArrowUp') nextScroll = ui.readerPage.scrollTop - 48;
  if (event.key === 'ArrowDown') nextScroll = ui.readerPage.scrollTop + 48;
  if (event.key === 'PageUp') nextScroll = ui.readerPage.scrollTop - (ui.readerPage.clientHeight * 0.8);
  if (event.key === 'PageDown') nextScroll = ui.readerPage.scrollTop + (ui.readerPage.clientHeight * 0.8);
  if (nextScroll === null) return;

  event.preventDefault();
  ui.readerPage.scrollTo({ top: Math.min(Math.max(nextScroll, 0), maxScroll), behavior: 'auto' });
}

function setupReadingResizeObserver() {
  if (typeof ResizeObserver !== 'function') return;
  minimapResizeObserver = new ResizeObserver(() => {
    isMinimapDocumentDirty = true;
    queueReadingUiUpdate();
  });
  [ui.documentStage, ui.content, ui.sourceView].filter(Boolean).forEach((element) => {
    minimapResizeObserver.observe(element);
  });
}

function getActiveScroller() {
  return isHelpVisible ? ui.helpStage : ui.readerPage;
}

function handleScroll() {
  if (scrollRafId) return;
  scrollRafId = requestAnimationFrame(() => {
    scrollRafId = null;
    if (!ui.scrollToTop) return;
    const scroller = getActiveScroller();
    if (!scroller) return;
    const { scrollTop, scrollHeight, clientHeight } = scroller;
    const maxScroll = scrollHeight - clientHeight;

    if (maxScroll > 0 && scrollTop > maxScroll * 0.5) {
      ui.scrollToTop.classList.add('show');
    } else {
      ui.scrollToTop.classList.remove('show');
    }
    if (!isHelpVisible) updateReadingUi();
  });
}

function scrollToTop() {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  getActiveScroller()?.scrollTo({
    top: 0,
    behavior: reduceMotion ? 'auto' : 'smooth'
  });
}

function setActionsPinned(nextPinned) {
  document.body.classList.toggle('is-actions-pinned', nextPinned);
  ui.actionsToggleButton?.setAttribute('aria-expanded', String(nextPinned));
  if (ui.actionsToggleButton) {
    const label = nextPinned ? 'Hide actions' : 'Show actions';
    ui.actionsToggleButton.setAttribute('aria-label', label);
    ui.actionsToggleButton.title = label;
  }
}

function toggleActions() {
  setActionsPinned(!document.body.classList.contains('is-actions-pinned'));
}

function toggleReadingTools() {
  setReadingToolsOpen(!isReadingToolsOpen);
}

function handleReadingToolToggle(event) {
  const tool = event.currentTarget.dataset.readingTool;
  setReadingTool(tool, event.currentTarget.getAttribute('aria-checked') !== 'true');
}

function setupActionRevealMode() {
  if (!ui.actionsToggleButton || !window.matchMedia) return;
  const hoverQuery = window.matchMedia('(hover: hover)');
  const syncToggle = () => {
    ui.actionsToggleButton.hidden = hoverQuery.matches;
    if (hoverQuery.matches) setActionsPinned(false);
  };
  syncToggle();
  hoverQuery.addEventListener?.('change', syncToggle);
}

function handleKeyboard(event) {
  if (event.key === 'F1') {
    event.preventDefault();
    toggleHelp();
    return;
  }

  if (event.key === 'Escape' && isHelpVisible) {
    event.preventDefault();
    setHelpVisible(false);
    return;
  }

  if (event.key === 'Escape' && isReadingToolsOpen) {
    event.preventDefault();
    setReadingToolsOpen(false, { returnFocus: true });
    return;
  }

  if (event.key === 'Escape' && document.body.classList.contains('is-actions-pinned')) {
    event.preventDefault();
    setActionsPinned(false);
    return;
  }

  if (event.ctrlKey && event.key.toLowerCase() === 'o') {
    event.preventDefault();
    openFilePicker();
    return;
  }

  if (event.ctrlKey && (event.key === '=' || event.key === '+')) {
    event.preventDefault();
    setZoom(currentZoom + ZOOM_STEP);
  } else if (event.ctrlKey && event.key === '-') {
    event.preventDefault();
    setZoom(currentZoom - ZOOM_STEP);
  } else if (event.ctrlKey && event.key === '0') {
    event.preventDefault();
    setZoom(1.0);
  }

  const isTypingField = ['INPUT', 'SELECT', 'TEXTAREA'].includes(event.target?.tagName)
    || event.target?.isContentEditable;
  if (!isTypingField && (event.key === 't' || event.key === 'T') && !event.metaKey && !event.altKey) {
    event.preventDefault();
    if (event.ctrlKey || event.shiftKey) {
      cycleTheme(-1);
    } else {
      cycleTheme(1);
    }
  }
}

function handleThemeSelection(event) {
  const index = parseInt(event.target.value, 10);
  if (!isNaN(index) && index >= 0 && index < themes.length) {
    applyTheme(themes[index]);
    setReadingToolsOpen(false);
    setActionsPinned(false);
  }
}

async function handleIncomingFiles(filePaths) {
  const supportedFiles = (filePaths || []).filter(isSupportedFilePath);

  if (supportedFiles.length === 0) {
    showToast('Only .md, .markdown and .txt files are supported');
    return;
  }

  await loadContent(supportedFiles[0]);

  if (supportedFiles.length > 1) {
    for (let index = 1; index < supportedFiles.length; index += 1) {
      try {
        await invoke('open_new_window', { path: supportedFiles[index] });
      } catch (error) {
        console.error('Could not open an additional window:', error);
        showToast(`Could not open ${getDisplayName(supportedFiles[index])}`);
      }
    }

    showToast(`${supportedFiles.length} files opened`);
  }
}

async function handleNativeOpenFileRequest(value) {
  const request = normalizeOpenFileRequest(value);
  if (!request || handledFileOpenRequestIds.has(request.id)) return;
  handledFileOpenRequestIds.add(request.id);

  try {
    const supportedFiles = request.paths.filter(isSupportedFilePath);
    if (supportedFiles.length === 0) {
      showToast('Only .md, .markdown and .txt files are supported');
      return;
    }

    if (!currentFilePath) {
      await handleIncomingFiles(supportedFiles);
      return;
    }

    for (const path of supportedFiles) {
      try {
        await invoke('open_new_window', { path });
      } catch (error) {
        console.error('Could not open an associated file:', error);
        showToast(`Could not open ${getDisplayName(path)}`);
      }
    }

    if (supportedFiles.length > 1) showToast(`${supportedFiles.length} files opened`);
  } finally {
    if (window.__TAURI_INTERNALS__) {
      invoke('acknowledge_open_file_request', { id: request.id }).catch((error) => {
        console.warn('Could not acknowledge the file-open request:', error);
      });
    }
  }
}

function scheduleNativeOpenFileRequest(value) {
  const request = normalizeOpenFileRequest(value);
  if (!request) return;

  if (!fileOpenRequestsReady) {
    queuedFileOpenRequests.push(request);
    return;
  }

  fileOpenRequestChain = fileOpenRequestChain
    .then(() => handleNativeOpenFileRequest(request))
    .catch((error) => {
      console.error('Could not process the file-open request:', error);
      showToast('Could not open the associated file');
    });
}

async function setupFileAssociationEvents() {
  if (!window.__TAURI_INTERNALS__ || getCurrentWindow().label !== 'main') return;

  try {
    fileOpenRequestUnlisten = await listen('open-file-request', (event) => {
      scheduleNativeOpenFileRequest(event.payload);
    });
    const pendingRequests = await invoke('take_pending_open_file_requests');
    if (Array.isArray(pendingRequests)) pendingRequests.forEach(scheduleNativeOpenFileRequest);
  } catch (error) {
    console.warn('Native file-open events are unavailable in this runtime:', error);
  }
}

async function flushQueuedFileOpenRequests() {
  fileOpenRequestsReady = true;
  const requests = queuedFileOpenRequests;
  queuedFileOpenRequests = [];
  requests.forEach(scheduleNativeOpenFileRequest);
  await fileOpenRequestChain;
}

async function openFilePicker() {
  setReadingToolsOpen(false);
  setActionsPinned(false);
  try {
    const selected = await open({
      multiple: true,
      directory: false,
      filters: [
        {
          name: 'Markdown and text',
          extensions: ['md', 'markdown', 'txt'],
        },
      ],
    });

    if (selected === null) {
      return;
    }

    await handleIncomingFiles(Array.isArray(selected) ? selected : [selected]);
  } catch (error) {
    console.error('Open dialog failed:', error);
    showToast('Could not open the file picker');
  }
}

function setupDomDragSafety() {
  window.addEventListener('dragover', (event) => {
    event.preventDefault();
  });

  window.addEventListener('drop', (event) => {
    event.preventDefault();
  });
}

async function setupDragAndDrop() {
  setupDomDragSafety();

  if (!window.__TAURI_INTERNALS__) return;

  try {
    dragDropUnlisten = await getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type === 'over') {
        setDragState(true);
        return;
      }

      if (event.payload.type === 'drop') {
        setDragState(false);
        await handleIncomingFiles(event.payload.paths);
        return;
      }

      setDragState(false);
    });
  } catch (error) {
    console.warn('Drag & drop listener unavailable in this runtime:', error);
  }
}

function registerEvents() {
  window.addEventListener('wheel', handleZoom, { passive: false });
  window.addEventListener('keydown', handleKeyboard);
  window.addEventListener('beforeunload', () => {
    if (typeof dragDropUnlisten === 'function') {
      dragDropUnlisten();
    }
    if (typeof fileOpenRequestUnlisten === 'function') {
      fileOpenRequestUnlisten();
    }
    minimapResizeObserver?.disconnect();
    windowChromeUnlisteners.forEach((unlisten) => unlisten());
    windowChromeUnlisteners = [];
  });
  window.addEventListener('resize', queueReadingUiUpdate, { passive: true });
  document.addEventListener('click', handleLinkClick);
  document.addEventListener('pointerdown', (event) => {
    if (isReadingToolsOpen && !ui.readingToolsShell?.contains(event.target)) {
      setReadingToolsOpen(false);
    }
    if (
      document.body.classList.contains('is-actions-pinned')
      && !ui.toolbar?.contains(event.target)
    ) {
      setActionsPinned(false);
    }
  });

  ui.emptyOpenButton?.addEventListener('click', openFilePicker);
  ui.toolbarOpenButton?.addEventListener('click', openFilePicker);
  ui.helpToggleButton?.addEventListener('click', toggleHelp);
  ui.closeHelpButton?.addEventListener('click', () => setHelpVisible(false));
  ui.scrollToTop?.addEventListener('click', scrollToTop);
  ui.readerPage?.addEventListener('scroll', handleScroll, { passive: true });
  ui.helpStage?.addEventListener('scroll', handleScroll, { passive: true });
  ui.actionsToggleButton?.addEventListener('click', toggleActions);
  ui.readingToolsButton?.addEventListener('click', toggleReadingTools);
  ui.readingToolToggles.forEach((toggle) => {
    toggle.addEventListener('click', handleReadingToolToggle);
  });
  ui.documentMinimap?.addEventListener('pointerdown', handleMinimapPointerDown);
  ui.documentMinimap?.addEventListener('pointermove', handleMinimapPointerMove);
  ui.documentMinimap?.addEventListener('pointerup', handleMinimapPointerUp);
  ui.documentMinimap?.addEventListener('pointercancel', handleMinimapPointerUp);
  ui.documentMinimap?.addEventListener('keydown', handleMinimapKeyboard);
  document.getElementById('theme-select')?.addEventListener('change', handleThemeSelection);
}

async function init() {
  cacheElements();
  loadReadingToolPreferences();
  syncViewportState();
  registerEvents();
  await setupFileAssociationEvents();
  await setupWindowChrome();
  setupActionRevealMode();
  setupReadingResizeObserver();
  await initThemes();
  const queryFilePath = new URLSearchParams(window.location.search).get('file');
  let initialFilePath = queryFilePath;

  if (!initialFilePath && window.__TAURI_INTERNALS__) {
    try {
      initialFilePath = await invoke('get_initial_file_path');
    } catch (error) {
      console.warn('Could not inspect the launch file:', error);
    }
  }

  await loadContent(initialFilePath);
  await flushQueuedFileOpenRequests();
  await setupDragAndDrop();
}

if (typeof window !== 'undefined' && !window.__VITEST__) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      init().catch((error) => console.error('OpenMD initialization failed:', error));
    });
  } else {
    init().catch((error) => console.error('OpenMD initialization failed:', error));
  }
}
