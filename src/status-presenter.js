import { getDisplayName } from './document-path.js';
import {
  getFormatLabel,
  getStatusProfile,
  resolveFormatId,
} from './format-registry.js';
import { MOTION_EASE_OUT, shouldReduceMotion } from './reader-motion.js';
import { getFormatStatusMetrics, getZoomStatusMetric } from './status-metrics.js';

function metricNodes(metrics) {
  return [...(metrics?.querySelectorAll?.('.status-metric') || [])];
}

function summarizeJsonSource(source) {
  try {
    const value = JSON.parse(String(source ?? ''));
    if (Array.isArray(value)) {
      return { rootType: 'array', itemCount: value.length, keyCount: null, invalid: false };
    }
    if (value && typeof value === 'object') {
      return {
        rootType: 'object',
        keyCount: Object.keys(value).length,
        itemCount: null,
        invalid: false,
      };
    }
    return { rootType: typeof value, keyCount: 0, itemCount: null, invalid: false };
  } catch {
    return { rootType: null, keyCount: null, itemCount: null, invalid: true };
  }
}

function summarizeCsvSource(source) {
  const text = String(source ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!text) return { rowCount: 0, columnCount: 0 };
  const lines = text.split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  if (lines.length === 0) return { rowCount: 0, columnCount: 0 };

  let columnCount = 0;
  for (const line of lines.slice(0, 50)) {
    let columns = 1;
    let inQuotes = false;
    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"') inQuotes = !inQuotes;
      else if (character === ',' && !inQuotes) columns += 1;
    }
    columnCount = Math.max(columnCount, columns);
  }
  return { rowCount: lines.length, columnCount };
}

export function createStatusPresenter({ window, document, elements = {} }) {
  const primary = elements.primary || document.getElementById('status-pill');
  const context = elements.context || document.getElementById('status-context');
  const metrics = elements.metrics || document.getElementById('status-metrics');
  const animations = new Set();
  let disposed = false;

  function cancelAnimations() {
    animations.forEach((animation) => animation.cancel?.());
    animations.clear();
    metricNodes(metrics).forEach((node) => {
      node.getAnimations?.().forEach((animation) => animation.cancel());
    });
  }

  function setIdentity({ primary: nextPrimary, context: nextContext = '', title } = {}) {
    if (disposed || !primary) return;

    const visiblePrimary = String(nextPrimary ?? '');
    const visibleContext = String(nextContext ?? '');
    const tooltip = title ?? [visiblePrimary, visibleContext].filter(Boolean).join(' · ');
    primary.textContent = visiblePrimary;
    primary.dataset.tooltip = tooltip;
    if (context) {
      context.textContent = visibleContext;
      context.dataset.tooltip = tooltip;
    }
  }

  function renderMetrics(items = [], accessibleLabel = '') {
    if (disposed || !metrics) return;

    const existingByKind = new Map(metricNodes(metrics).map((item) => [item.dataset.statusKind, item]));
    const nodes = items.map(({ kind, visible }) => {
      const item = existingByKind.get(kind) || document.createElement('span');
      item.className = `status-metric status-metric--${kind}`;
      item.dataset.statusKind = kind;

      if (kind === 'zoom') {
        let icon = item.querySelector('i');
        let value = item.querySelector('.status-metric-value');
        if (!icon) {
          icon = document.createElement('i');
          icon.className = 'iconoir-search';
          icon.setAttribute('aria-hidden', 'true');
          item.append(icon);
        }
        if (!value) {
          value = document.createElement('span');
          value.className = 'status-metric-value';
          item.append(value);
        }

        const changed = Boolean(value.textContent) && value.textContent !== visible;
        value.textContent = visible;
        if (
          changed
          && !shouldReduceMotion(window)
          && typeof value.animate === 'function'
        ) {
          value.getAnimations?.().forEach((animation) => animation.cancel());
          const animation = value.animate([
            { opacity: 0, transform: 'translateY(3px)' },
            { opacity: 1, transform: 'translateY(0)' },
          ], {
            duration: 160,
            easing: MOTION_EASE_OUT,
          });
          animations.add(animation);
          animation.finished?.finally(() => animations.delete(animation));
        }
      } else {
        item.textContent = visible;
      }
      return item;
    });

    const currentKinds = metricNodes(metrics).map((item) => item.dataset.statusKind);
    const nextKinds = items.map(({ kind }) => kind);
    if (
      currentKinds.length !== nextKinds.length
      || currentKinds.some((kind, index) => kind !== nextKinds[index])
    ) {
      metrics.replaceChildren(...nodes);
    }

    metrics.hidden = nodes.length === 0;
    // Metrics are visible in the status bar; do not mirror them in a tooltip.
    delete metrics.dataset.tooltip;
    if (nodes.length === 0) {
      metrics.removeAttribute('aria-label');
      return;
    }
    metrics.setAttribute('aria-label', accessibleLabel);
  }

  function clear() {
    if (disposed) return;
    setIdentity({ primary: 'open.md', context: 'Ready' });
    renderMetrics([], '');
  }

  /** Project identity + metrics from one raw application snapshot. */
  function project({
    helpVisible = false,
    editMode = false,
    path = null,
    document: documentSnapshot = null,
    sourceActive = false,
    editorSnapshot = null,
    editorSource = null,
    zoomPercent = 100,
    navigation = null,
    readingTools = null,
    imageState = null,
  } = {}) {
    if (disposed) return;

    if (helpVisible) {
      setIdentity({ primary: 'About + Help', context: 'F1 to close' });
      renderMetrics([], '');
      return;
    }

    if (!path) {
      clear();
      return;
    }

    const formatId = resolveFormatId(path, documentSnapshot);
    const statusProfile = getStatusProfile(formatId, {
      kind: documentSnapshot?.kind,
      path,
    });

    if (editMode) {
      setIdentity({ primary: getDisplayName(path), context: 'Editing' });
      if (editorSnapshot?.presentation === 'json-props') {
        const source = String(editorSource ?? documentSnapshot?.source ?? '');
        renderDocumentMetrics({
          statusProfile: 'json',
          lineCount: source.split('\n').length,
          characterCount: [...source].length,
          zoomPercent,
          ...summarizeJsonSource(source),
        });
      } else if (editorSnapshot) {
        renderEditorMetrics({
          cursor: editorSnapshot.cursor,
          stats: editorSnapshot.stats,
          zoomPercent,
        });
      } else {
        renderMetrics([], '');
      }
      return;
    }

    const formatLabel = getFormatLabel(formatId, {
      kind: documentSnapshot?.kind,
      path,
    });
    const contextLabel = sourceActive ? 'Source' : formatLabel;
    setIdentity({ primary: getDisplayName(path), context: contextLabel });
    if (!documentSnapshot) {
      renderMetrics([], '');
      return;
    }

    const baseMetrics = {
      statusProfile,
      lineCount: documentSnapshot.lineCount,
      characterCount: documentSnapshot.characterCount,
      zoomPercent,
    };
    if (statusProfile === 'image') {
      renderDocumentMetrics({
        ...baseMetrics,
        naturalWidth: imageState?.naturalWidth || 0,
        naturalHeight: imageState?.naturalHeight || 0,
        scale: imageState?.scale ?? 1,
        fitScale: imageState?.fitScale ?? 1,
      });
      return;
    }
    if (statusProfile === 'json') {
      renderDocumentMetrics({
        ...baseMetrics,
        ...summarizeJsonSource(documentSnapshot.source),
      });
      return;
    }
    if (statusProfile === 'csv') {
      const shape = summarizeCsvSource(documentSnapshot.source);
      renderDocumentMetrics({
        ...baseMetrics,
        rowCount: documentSnapshot.rowCount ?? shape.rowCount,
        columnCount: documentSnapshot.columnCount ?? shape.columnCount,
      });
      return;
    }
    renderDocumentMetrics({
      ...baseMetrics,
      currentLine: navigation?.currentLine || 1,
      showCurrentLine: Boolean(readingTools?.lineGuide),
      ...(statusProfile === 'markdown'
        ? {
            readingProgress: navigation?.readingProgress || 0,
            readingTimeMinutes: documentSnapshot.readingTimeMinutes,
            showReadingStats: Boolean(readingTools?.stats),
          }
        : {}),
    });
  }

  function renderDocumentMetrics({ statusProfile = 'markdown', ...fields } = {}) {
    const metrics = getFormatStatusMetrics(statusProfile || 'markdown', fields);
    renderMetrics(metrics.items, metrics.accessible.join('. '));
    return metrics;
  }

  function renderEditorMetrics({ cursor, stats, zoomPercent } = {}) {
    const zoom = getZoomStatusMetric(zoomPercent);
    const lines = Number(stats?.lines ?? stats?.blocks) || 0;
    const words = Number(stats?.words) || 0;
    const characters = Number(stats?.characters) || 0;
    const items = cursor
      ? [
          { kind: 'current-line', visible: `Ln ${cursor.line}` },
          ...(zoom ? [zoom] : []),
          { kind: 'column', visible: `Col ${cursor.column}` },
        ]
      : [
          { kind: 'lines', visible: `${lines} ${lines === 1 ? 'line' : 'lines'}` },
          { kind: 'words', visible: `${words} ${words === 1 ? 'word' : 'words'}` },
          ...(zoom ? [zoom] : []),
        ];
    const accessibleLabel = cursor
      ? `Line ${cursor.line}. Column ${cursor.column}. ${lines} lines. ${words} words. ${characters} characters.${zoom ? ` ${zoom.accessible}.` : ''}`
      : `${lines} lines. ${words} words. ${characters} characters.${zoom ? ` ${zoom.accessible}.` : ''}`;
    renderMetrics(items, accessibleLabel);
    return { items, accessibleLabel };
  }

  return Object.freeze({
    setIdentity,
    project,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimations();
    },
  });
}
