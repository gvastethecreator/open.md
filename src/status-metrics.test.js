import { describe, expect, it } from 'vitest';
import {
  getFormatStatusMetrics,
  getImageStatusMetrics,
  getJsonStatusMetrics,
} from './status-metrics.js';

describe('status metrics by format profile', () => {
  it('hides reading-time for text companions', () => {
    const metrics = getFormatStatusMetrics('text', {
      lineCount: 10,
      characterCount: 40,
      zoomPercent: 100,
      showReadingStats: true,
      readingTimeMinutes: 5,
      readingProgress: 20,
    });
    expect(metrics.items.some((item) => item.kind === 'reading-time')).toBe(false);
    expect(metrics.items.some((item) => item.kind === 'lines')).toBe(true);
  });

  it('reports JSON keys and invalid state', () => {
    const valid = getJsonStatusMetrics({
      lineCount: 3,
      characterCount: 12,
      zoomPercent: 100,
      keyCount: 4,
      rootType: 'object',
    });
    expect(valid.items[0]).toMatchObject({ kind: 'json-keys', visible: '4 keys' });

    const invalid = getJsonStatusMetrics({
      lineCount: 1,
      characterCount: 1,
      zoomPercent: 100,
      invalid: true,
    });
    expect(invalid.items[0]).toMatchObject({ kind: 'json-state', visible: 'Invalid' });
  });

  it('reports image dimensions and fit zoom (F10)', () => {
    const fit = getImageStatusMetrics({
      naturalWidth: 1920,
      naturalHeight: 1080,
      scale: 0.5,
      fitScale: 0.5,
    });
    expect(fit.items.find((item) => item.kind === 'dimensions')?.visible).toBe('1,920×1,080');
    expect(fit.items.find((item) => item.kind === 'zoom')?.visible).toBe('Fit');

    const zoomed = getImageStatusMetrics({
      naturalWidth: 100,
      naturalHeight: 50,
      scale: 1,
      fitScale: 0.4,
    });
    expect(zoomed.items.find((item) => item.kind === 'zoom')?.visible).toBe('100%');
    expect(zoomed.items.some((item) => item.kind === 'lines')).toBe(false);
  });

  it('reports CSV shape when row and column counts are known', () => {
    const metrics = getFormatStatusMetrics('csv', {
      lineCount: 4,
      characterCount: 40,
      zoomPercent: 100,
      rowCount: 3,
      columnCount: 2,
    });
    expect(metrics.items[0]).toMatchObject({ kind: 'csv-shape', visible: '3×2' });
  });
});
