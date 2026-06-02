import { describe, it, expect } from 'vitest';
import {
  isColorDark,
  calculateNewZoom,
  getPreferredThemeIndex,
  getDisplayName,
  getViewportMode,
  isSupportedFilePath,
  resolveRelativeFilePath,
} from './main.js';

describe('Frontend Logic Tests', () => {
  describe('getPreferredThemeIndex', () => {
    const sampleThemes = [
      { name: '3024 Day', background: '#fff', foreground: '#111' },
      { name: 'Github Light', background: '#fff', foreground: '#111' },
      { name: 'Ayu Dark', background: '#000', foreground: '#eee' },
    ];

    it('prefers the saved theme when present', () => {
      expect(getPreferredThemeIndex(sampleThemes, 'Ayu Dark')).toBe(2);
    });

    it('falls back to a preferred bundled theme when the saved one is missing', () => {
      expect(getPreferredThemeIndex(sampleThemes, 'Missing Theme')).toBe(1);
    });

    it('returns 0 when there is no preferred match', () => {
      expect(
        getPreferredThemeIndex([
          { name: '3024 Day', background: '#fff', foreground: '#111' },
          { name: 'Aci', background: '#000', foreground: '#eee' },
        ])
      ).toBe(0);
    });
  });

  describe('file helpers', () => {
    it('detects supported file extensions case-insensitively', () => {
      expect(isSupportedFilePath('README.md')).toBe(true);
      expect(isSupportedFilePath('notes.MARKDOWN')).toBe(true);
      expect(isSupportedFilePath('log.txt')).toBe(true);
      expect(isSupportedFilePath('photo.png')).toBe(false);
    });

    it('extracts a friendly display name from Windows paths', () => {
      expect(getDisplayName('C:\\docs\\guide.md')).toBe('guide.md');
      expect(getDisplayName('')).toBe('No file');
    });

    it('resolves relative markdown links from the current document', () => {
      expect(resolveRelativeFilePath('C:\\docs\\guide\\intro.md', '../api/reference.md')).toBe(
        'C:/docs/api/reference.md'
      );
      expect(resolveRelativeFilePath('C:\\docs\\guide\\intro.md', './deep/note.txt')).toBe(
        'C:/docs/guide/deep/note.txt'
      );
    });
  });

  describe('viewport mode helpers', () => {
    it('prioritizes the help screen over all other content', () => {
      expect(getViewportMode(true, true)).toBe('help');
      expect(getViewportMode(false, true)).toBe('help');
    });

    it('shows content when there is a file and help is closed', () => {
      expect(getViewportMode(true, false)).toBe('content');
    });

    it('shows the empty screen when there is no file and help is closed', () => {
      expect(getViewportMode(false, false)).toBe('empty');
    });
  });

  describe('isColorDark', () => {
    it('correctly identifies dark colors', () => {
      expect(isColorDark('#000000')).toBe(true);
      expect(isColorDark('#1a1a1a')).toBe(true);
      expect(isColorDark('#2b2b2b')).toBe(true);
    });

    it('correctly identifies light colors', () => {
      expect(isColorDark('#ffffff')).toBe(false);
      expect(isColorDark('#f0f0f0')).toBe(false);
      expect(isColorDark('#e5e5e5')).toBe(false);
    });

    it('handles invalid inputs gracefully', () => {
      expect(isColorDark('')).toBe(false);
      expect(isColorDark(null)).toBe(false);
      expect(isColorDark(undefined)).toBe(false);
      expect(isColorDark('#fff')).toBe(false);
    });
  });

  describe('calculateNewZoom', () => {
    const MIN_ZOOM = 0.5;
    const MAX_ZOOM = 3.0;
    const STEP = 0.1;

    it('increases zoom when deltaY is negative (scrolling up)', () => {
      expect(calculateNewZoom(1.0, -100, STEP, MIN_ZOOM, MAX_ZOOM)).toBeCloseTo(1.1);
    });

    it('decreases zoom when deltaY is positive (scrolling down)', () => {
      expect(calculateNewZoom(1.0, 100, STEP, MIN_ZOOM, MAX_ZOOM)).toBeCloseTo(0.9);
    });

    it('does not exceed MAX_ZOOM limit', () => {
      expect(calculateNewZoom(3.0, -100, STEP, MIN_ZOOM, MAX_ZOOM)).toBe(3.0);
    });

    it('does not go below MIN_ZOOM limit', () => {
      expect(calculateNewZoom(0.5, 100, STEP, MIN_ZOOM, MAX_ZOOM)).toBe(0.5);
    });
  });
});
