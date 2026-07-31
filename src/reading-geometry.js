/**
 * Reading chrome geometry: scroll progress, edges, line ranges, gutters, minimap.
 */

export function getScrollEdgeState(scrollTop, scrollHeight, clientHeight, threshold = 1) {
  const top = Math.max(0, Number(scrollTop) || 0);
  const maxScroll = Math.max(0, (Number(scrollHeight) || 0) - (Number(clientHeight) || 0));
  const edgeThreshold = Math.max(0, Number(threshold) || 0);

  return {
    before: maxScroll > edgeThreshold && top > edgeThreshold,
    after: maxScroll > edgeThreshold && top < maxScroll - edgeThreshold,
  };
}

export function getReadingProgress(scrollTop, scrollHeight, clientHeight) {
  const maxScroll = Math.max(0, Number(scrollHeight) - Number(clientHeight));
  if (maxScroll === 0) return 100;
  return Math.round(Math.min(Math.max(Number(scrollTop) / maxScroll, 0), 1) * 100);
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
