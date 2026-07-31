/**
 * Compatibility facade for pure reader helpers.
 *
 * Domain ownership lives in dedicated modules; this file re-exports them so
 * existing tests and residual callers stay stable while production code
 * imports the deep owners directly.
 */

import {
  isSupportedFilePath as detectSupportedFilePath,
  resolveDocumentFormat,
} from '../format-detect.js';

export {
  getDisplayName,
  getImageSourcePolicy,
  getLinkAction,
  isImageFilePath,
  resolveRelativeFilePath,
} from '../document-path.js';
export { normalizeDocumentPayload } from '../document-payload.js';
export {
  getMarkdownSourceTokenRanges,
  setMarkdownTaskChecked,
} from '../markdown-source.js';
export {
  getCurrentLineFromAnchors,
  getLineGutterLeft,
  getMinimapViewportGeometry,
  getReadingProgress,
  getScrollEdgeState,
  getVisibleSourceLineRange,
} from '../reading-geometry.js';

const PREFERRED_THEME_NAMES = ['Github Light', 'Github Dark', 'GitHub', 'Ayu Light', 'Ayu Dark'];

/**
 * Path support authority lives in `format-detect.js`. These re-exports keep
 * existing callers stable while that module owns extension tables and heuristics.
 */
export function isSupportedFilePath(filePath) {
  return detectSupportedFilePath(filePath);
}

/**
 * Coarse product label for status/chrome. Prefer format descriptors when a
 * resolved document format is available.
 */
export function getFileKind(filePath) {
  const family = resolveDocumentFormat(filePath).family;
  if (family === 'markdown') return 'Markdown';
  if (family === 'image') return 'Image';
  return 'Text';
}

export function getEstimatedMinutesRemaining(totalMinutes, progressPercent) {
  const total = Math.max(0, Number(totalMinutes) || 0);
  const progress = Math.min(Math.max(Number(progressPercent) || 0, 0), 100);
  return Math.ceil(total * (1 - (progress / 100)));
}

function formatMetricNumber(value) {
  return Math.max(0, Math.floor(Number(value) || 0)).toLocaleString('en-US');
}

export function getZoomStatusMetric(zoomPercent) {
  const safeZoom = Math.max(1, Math.round(Number(zoomPercent) || 100));
  return safeZoom === 100
    ? null
    : {
        kind: 'zoom',
        visible: `${safeZoom}%`,
        accessible: `Zoom ${safeZoom} percent`,
      };
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
  const lineLabel = `${formatMetricNumber(safeLineCount)} ${safeLineCount === 1 ? 'line' : 'lines'}`;
  const characterValue = formatMetricNumber(safeCharacterCount);
  const characterLabel = `${characterValue} ${safeCharacterCount === 1 ? 'char' : 'chars'}`;
  const characterAccessibleLabel = `${characterValue} ${safeCharacterCount === 1 ? 'character' : 'characters'}`;
  const items = [
    { kind: 'lines', visible: lineLabel, accessible: lineLabel },
    { kind: 'characters', visible: characterLabel, accessible: characterAccessibleLabel },
  ];

  if (showCurrentLine) {
    const safeCurrentLine = Math.max(1, Math.floor(Number(currentLine) || 1));
    items.push({
      kind: 'current-line',
      visible: `Ln ${safeCurrentLine}`,
      accessible: `Line ${safeCurrentLine}`,
    });
  }

  const zoom = getZoomStatusMetric(zoomPercent);
  if (zoom) items.push(zoom);

  if (showReadingStats) {
    const safeProgress = Math.min(100, Math.max(0, Math.round(Number(readingProgress) || 0)));
    const remainingMinutes = getEstimatedMinutesRemaining(readingTimeMinutes, safeProgress);
    items.push({
      kind: 'progress',
      visible: `${safeProgress}%`,
      accessible: `${safeProgress} percent through document`,
    });

    if (Number(readingTimeMinutes) > 0) {
      items.push({
        kind: 'reading-time',
        visible: remainingMinutes > 0 ? `${remainingMinutes} min left` : 'read',
        accessible: remainingMinutes > 0 ? `${remainingMinutes} minutes left` : 'Document read',
      });
    }
  }

  return {
    items,
    visible: items.map(({ visible }) => visible),
    accessible: items.map(({ accessible }) => accessible),
  };
}

export function getWindowControlPresentation(isMaximized) {
  return isMaximized
    ? { label: 'Restore', iconClass: 'iconoir-multi-window' }
    : { label: 'Maximize', iconClass: 'iconoir-square' };
}

const DOCUMENT_MODE_PRESENTATIONS = Object.freeze({
  read: Object.freeze({ label: 'Read', iconClass: 'iconoir-book', nextMode: 'edit' }),
  edit: Object.freeze({ label: 'Edit', iconClass: 'iconoir-edit-pencil', nextMode: 'source' }),
  source: Object.freeze({ label: 'Source', iconClass: 'iconoir-code', nextMode: 'read' }),
});

export function getDocumentModePresentation(mode) {
  const normalizedMode = Object.hasOwn(DOCUMENT_MODE_PRESENTATIONS, mode) ? mode : 'read';
  const current = DOCUMENT_MODE_PRESENTATIONS[normalizedMode];
  const next = DOCUMENT_MODE_PRESENTATIONS[current.nextMode];

  return {
    mode: normalizedMode,
    label: current.label,
    iconClass: current.iconClass,
    nextMode: current.nextMode,
    nextLabel: next.label,
    ariaLabel: `${current.label} mode. Switch to ${next.label} mode`,
    title: `${current.label} mode · Next: ${next.label}`,
  };
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

function adaptColorToContrast(value, background, minimumRatio = 4.5) {
  const normalized = normalizeHexColor(value);
  if (!normalized) return null;
  if (getContrastRatio(normalized, background) >= minimumRatio) return normalized;

  const contrastTarget = getContrastRatio('#000000', background) >= getContrastRatio('#ffffff', background)
    ? '#000000'
    : '#ffffff';

  for (let weight = 0.06; weight <= 1; weight += 0.06) {
    const adjusted = mixHexColors(normalized, contrastTarget, Math.min(weight, 1));
    if (getContrastRatio(adjusted, background) >= minimumRatio) return adjusted;
  }

  return contrastTarget;
}

function chooseAdaptiveColor(candidates, background, minimumRatio = 4.5) {
  for (const candidate of candidates) {
    const adjusted = adaptColorToContrast(candidate, background, minimumRatio);
    if (adjusted) return adjusted;
  }

  return chooseAccessibleColor([], background, minimumRatio);
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
  let codeBackground = mixHexColors(background, text, 0.09);

  if (getContrastRatio(text, surface) < 4.5) {
    surface = background;
  }
  if (getContrastRatio(text, codeBackground) < 4.5) {
    codeBackground = background;
  }

  const isLightCodeSurface = !isColorDark(codeBackground);
  const codeTextMinimum = isLightCodeSurface ? 7 : 4.5;
  const syntaxMinimum = isLightCodeSurface ? 6 : 4.5;
  const codeText = chooseAccessibleColor(
    [theme.foreground, text],
    codeBackground,
    codeTextMinimum,
  );

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
    codeBackground,
    codeText,
    syntaxComment: chooseAdaptiveColor([theme.color_08, quote, text], codeBackground, syntaxMinimum),
    syntaxKeyword: chooseAdaptiveColor([theme.color_06, theme.color_05, accent, text], codeBackground, syntaxMinimum),
    syntaxString: chooseAdaptiveColor([theme.color_03, theme.color_07, accent, text], codeBackground, syntaxMinimum),
    syntaxNumber: chooseAdaptiveColor([theme.color_02, theme.color_06, danger, text], codeBackground, syntaxMinimum),
    syntaxTitle: chooseAdaptiveColor([theme.color_05, theme.color_07, accent, text], codeBackground, syntaxMinimum),
    syntaxProperty: chooseAdaptiveColor([theme.color_07, theme.color_05, accent, text], codeBackground, syntaxMinimum),
    syntaxMeta: chooseAdaptiveColor([theme.color_06, theme.color_02, accent, text], codeBackground, syntaxMinimum),
    syntaxAddition: chooseAdaptiveColor([theme.color_03, theme.color_07, text], codeBackground, syntaxMinimum),
    syntaxDeletion: chooseAdaptiveColor([theme.color_02, danger, text], codeBackground, syntaxMinimum),
  };
}

export function getViewportMode(hasFilePath, helpVisible) {
  if (helpVisible) return 'help';
  return hasFilePath ? 'content' : 'empty';
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
