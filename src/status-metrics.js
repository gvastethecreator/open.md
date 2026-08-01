/**
 * Pure status metric builders keyed by format status profile.
 */

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

export function getEstimatedMinutesRemaining(totalMinutes, progressPercent) {
  const total = Math.max(0, Number(totalMinutes) || 0);
  const progress = Math.min(Math.max(Number(progressPercent) || 0, 0), 100);
  return Math.ceil(total * (1 - (progress / 100)));
}

function pack(items) {
  return {
    items,
    visible: items.map(({ visible }) => visible),
    accessible: items.map(({ accessible }) => accessible),
  };
}

/**
 * Document-style metrics (Markdown / generic text). Reading stats optional.
 */
export function getDocumentStatusMetrics({
  lineCount,
  characterCount,
  zoomPercent,
  currentLine,
  showCurrentLine,
  readingProgress,
  readingTimeMinutes,
  showReadingStats,
} = {}) {
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
    const total = Math.max(0, Number(readingTimeMinutes) || 0);
    const remainingMinutes = getEstimatedMinutesRemaining(total, safeProgress);
    items.push({
      kind: 'progress',
      visible: `${safeProgress}%`,
      accessible: `${safeProgress} percent through document`,
    });
    if (total > 0) {
      items.push({
        kind: 'reading-time',
        visible: remainingMinutes > 0 ? `${remainingMinutes} min left` : 'read',
        accessible: remainingMinutes > 0 ? `${remainingMinutes} minutes left` : 'Document read',
      });
    }
  }

  return pack(items);
}

/**
 * Companion text: lines/chars/zoom; never reading-time by default.
 */
export function getTextCompanionStatusMetrics({
  lineCount,
  characterCount,
  zoomPercent,
  currentLine,
  showCurrentLine,
} = {}) {
  return getDocumentStatusMetrics({
    lineCount,
    characterCount,
    zoomPercent,
    currentLine,
    showCurrentLine,
    showReadingStats: false,
  });
}

/**
 * JSON: structural glance + lines/chars.
 */
export function getJsonStatusMetrics({
  lineCount,
  characterCount,
  zoomPercent,
  keyCount = null,
  itemCount = null,
  rootType = null,
  invalid = false,
} = {}) {
  const items = [];
  if (invalid) {
    items.push({ kind: 'json-state', visible: 'Invalid', accessible: 'Invalid JSON' });
  } else if (rootType === 'array' && itemCount != null) {
    const n = Math.max(0, Math.floor(Number(itemCount) || 0));
    items.push({
      kind: 'json-items',
      visible: `${formatMetricNumber(n)} ${n === 1 ? 'item' : 'items'}`,
      accessible: `${n} ${n === 1 ? 'item' : 'items'}`,
    });
  } else if (keyCount != null) {
    const n = Math.max(0, Math.floor(Number(keyCount) || 0));
    items.push({
      kind: 'json-keys',
      visible: `${formatMetricNumber(n)} ${n === 1 ? 'key' : 'keys'}`,
      accessible: `${n} ${n === 1 ? 'key' : 'keys'}`,
    });
  }
  const base = getTextCompanionStatusMetrics({ lineCount, characterCount, zoomPercent });
  return pack([...items, ...base.items]);
}

/**
 * CSV: rows × cols when known.
 */
export function getCsvStatusMetrics({
  lineCount,
  characterCount,
  zoomPercent,
  rowCount = null,
  columnCount = null,
} = {}) {
  const items = [];
  if (rowCount != null && columnCount != null) {
    const rows = Math.max(0, Math.floor(Number(rowCount) || 0));
    const cols = Math.max(0, Math.floor(Number(columnCount) || 0));
    items.push({
      kind: 'csv-shape',
      visible: `${formatMetricNumber(rows)}×${formatMetricNumber(cols)}`,
      accessible: `${rows} rows by ${cols} columns`,
    });
  }
  const base = getTextCompanionStatusMetrics({ lineCount, characterCount, zoomPercent });
  return pack([...items, ...base.items]);
}

/**
 * Image document: dimensions + scale (always show scale, including fit).
 */
export function getImageStatusMetrics({
  naturalWidth = 0,
  naturalHeight = 0,
  scale = 1,
  fitScale = 1,
} = {}) {
  const width = Math.max(0, Math.round(Number(naturalWidth) || 0));
  const height = Math.max(0, Math.round(Number(naturalHeight) || 0));
  const items = [];
  if (width > 0 && height > 0) {
    items.push({
      kind: 'dimensions',
      visible: `${formatMetricNumber(width)}×${formatMetricNumber(height)}`,
      accessible: `${width} by ${height} pixels`,
    });
  }
  const safeScale = Math.max(0.0001, Number(scale) || 1);
  const safeFit = Math.max(0.0001, Number(fitScale) || safeScale);
  const nearFit = Math.abs(safeScale - safeFit) < 0.02;
  const percent = Math.max(1, Math.round(safeScale * 100));
  items.push({
    kind: 'zoom',
    visible: nearFit && safeScale <= 1.001 ? 'Fit' : `${percent}%`,
    accessible: nearFit && safeScale <= 1.001
      ? 'Zoom fit to window'
      : `Zoom ${percent} percent`,
  });
  return pack(items);
}

/**
 * Dispatch by status profile.
 */
export function getFormatStatusMetrics(profile, fields = {}) {
  switch (profile) {
    case 'image':
      return getImageStatusMetrics(fields);
    case 'json':
      return getJsonStatusMetrics(fields);
    case 'csv':
      return getCsvStatusMetrics(fields);
    case 'markdown':
      return getDocumentStatusMetrics(fields);
    case 'text':
    default:
      return getTextCompanionStatusMetrics(fields);
  }
}
