import { describe, expect, it } from 'vitest';
import { findFittedFontSize } from './responsive-typography.js';

describe('responsive typography', () => {
  it('keeps the base size when the heading already meets its line budget', () => {
    expect(findFittedFontSize({
      baseSize: 36,
      minSize: 26,
      maxLines: 2,
      measure: () => 2,
    })).toEqual({ fontSize: 36, lineCount: 2, fitted: false });
  });

  it('finds the largest half-pixel size that meets the line budget', () => {
    const result = findFittedFontSize({
      baseSize: 36,
      minSize: 24,
      maxLines: 2,
      measure: (size) => size <= 29 ? 2 : 3,
    });

    expect(result.fitted).toBe(true);
    expect(result.lineCount).toBe(2);
    expect(result.fontSize).toBeGreaterThanOrEqual(28.5);
    expect(result.fontSize).toBeLessThanOrEqual(29);
  });

  it('uses the minimum safely when even the smallest size exceeds the budget', () => {
    expect(findFittedFontSize({
      baseSize: 36,
      minSize: 24,
      maxLines: 2,
      measure: () => 4,
    })).toEqual({ fontSize: 24, lineCount: 4, fitted: true });
  });
});
