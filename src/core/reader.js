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
import {
  getCsvStatusMetrics,
  getDocumentStatusMetrics,
  getEstimatedMinutesRemaining,
  getFormatStatusMetrics,
  getImageStatusMetrics,
  getJsonStatusMetrics,
  getTextCompanionStatusMetrics,
  getZoomStatusMetric,
} from '../status-metrics.js';

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
  getMinimapScrollTopFromPointer,
  getMinimapViewportGeometry,
  getReadingProgress,
  getScrollEdgeState,
  getVisibleSourceLineRange,
} from '../reading-geometry.js';
export {
  getCsvStatusMetrics,
  getDocumentStatusMetrics,
  getEstimatedMinutesRemaining,
  getFormatStatusMetrics,
  getImageStatusMetrics,
  getJsonStatusMetrics,
  getTextCompanionStatusMetrics,
  getZoomStatusMetric,
};
export { getDocumentModePresentation } from '../document-mode-coordinator.js';
export { getViewportMode } from '../reader-viewport-controller.js';
export { calculateNewZoom } from '../reader-zoom-controller.js';
export { getWindowControlPresentation } from '../window-chrome.js';

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

/** Compatibility wrapper — prefer getDocumentStatusMetrics / getFormatStatusMetrics */
export function getStatusMetricParts(fields = {}) {
  return getDocumentStatusMetrics(fields);
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
  const headingMinimum = 4.5;

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
    heading1: chooseAdaptiveColor([theme.color_05, theme.color_06, accent, text], background, headingMinimum),
    heading2: chooseAdaptiveColor([theme.color_06, theme.color_05, accent, text], background, headingMinimum),
    heading3: chooseAdaptiveColor([theme.color_03, theme.color_07, accent, text], background, headingMinimum),
    heading4: chooseAdaptiveColor([theme.color_07, theme.color_03, quote, text], background, headingMinimum),
    heading5: chooseAdaptiveColor([theme.color_02, theme.color_06, danger, text], background, headingMinimum),
    heading6: chooseAdaptiveColor([theme.color_08, theme.color_07, quote, text], background, headingMinimum),
  };
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
