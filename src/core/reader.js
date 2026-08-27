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
export {
  getContrastRatio,
  getPreferredThemeIndex,
  getThemeTokens,
  isColorDark,
} from '../theme-tokens.js';

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
