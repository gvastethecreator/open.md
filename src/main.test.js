import { describe, it, expect } from 'vitest';
import allThemes from './themes.runtime.json';
import {
  isColorDark,
  calculateNewZoom,
  getContrastRatio,
  getPreferredThemeIndex,
  getThemeTokens,
  getDisplayName,
  getFileKind,
  getCurrentLineFromAnchors,
  getEstimatedMinutesRemaining,
  getLineGutterLeft,
  getMarkdownSourceTokenRanges,
  getImageSourcePolicy,
  getLinkAction,
  getMinimapViewportGeometry,
  getReadingProgress,
  getStatusMetricParts,
  getViewportMode,
  getVisibleSourceLineRange,
  getWindowControlPresentation,
  isSupportedFilePath,
  normalizeDocumentPayload,
  normalizeOpenFileRequest,
  normalizeReadingTools,
  resolveRelativeFilePath,
} from './core/reader.js';

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

  describe('semantic theme tokens', () => {
    it('keeps every bundled theme readable on its main surfaces', () => {
      const failures = [];

      for (const theme of allThemes) {
        const tokens = getThemeTokens(theme);
        const checks = [
          ['text/background', getContrastRatio(tokens.text, tokens.background), 4.5],
          ['link/background', getContrastRatio(tokens.link, tokens.background), 4.5],
          ['accent/background', getContrastRatio(tokens.accent, tokens.background), 4.5],
          ['accent foreground/accent', getContrastRatio(tokens.accentForeground, tokens.accent), 4.5],
          ['quote/background', getContrastRatio(tokens.quote, tokens.background), 4.5],
          ['text/surface', getContrastRatio(tokens.text, tokens.surface), 4.5],
        ];

        for (const [label, ratio, minimum] of checks) {
          if (ratio < minimum) {
            failures.push(`${theme.name}: ${label} ${ratio.toFixed(2)} < ${minimum}`);
          }
        }
      }

      expect(failures).toEqual([]);
    });

    it('falls back safely when a theme contains invalid colors', () => {
      const tokens = getThemeTokens({
        name: 'Broken',
        background: 'not-a-color',
        foreground: '#fff',
        color_05: 'also-broken',
      });

      expect(tokens.background).toBe('#ffffff');
      expect(getContrastRatio(tokens.text, tokens.background)).toBeGreaterThanOrEqual(4.5);
      expect(getContrastRatio(tokens.link, tokens.background)).toBeGreaterThanOrEqual(4.5);
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

    it('labels the file kind for the minimal status bar', () => {
      expect(getFileKind('C:\\docs\\guide.md')).toBe('Markdown');
      expect(getFileKind('notes.markdown')).toBe('Markdown');
      expect(getFileKind('notes.TXT')).toBe('Text');
    });

    it('resolves relative markdown links from the current document', () => {
      expect(resolveRelativeFilePath('C:\\docs\\guide\\intro.md', '../api/reference.md')).toBe(
        'C:/docs/api/reference.md'
      );
      expect(resolveRelativeFilePath('C:\\docs\\guide\\intro.md', './deep/note.txt')).toBe(
        'C:/docs/guide/deep/note.txt'
      );
    });

    it('classifies safe links and blocks unsupported schemes', () => {
      expect(getLinkAction('#details', 'C:\\docs\\guide\\intro.md')).toEqual({
        type: 'anchor',
        href: '#details',
      });
      expect(getLinkAction('https://example.com/docs', 'C:\\docs\\guide\\intro.md')).toEqual({
        type: 'external',
        href: 'https://example.com/docs',
      });
      expect(
        getLinkAction('../api/reference.md?raw=1#usage', 'C:\\docs\\guide\\intro.md')
      ).toEqual({
        type: 'file',
        path: 'C:/docs/api/reference.md',
        fragment: '#usage',
      });
      expect(getLinkAction('javascript:alert(1)', 'C:\\docs\\guide\\intro.md')).toEqual({
        type: 'blocked',
      });
      expect(getLinkAction('file:///C:/private.txt', 'C:\\docs\\guide\\intro.md')).toEqual({
        type: 'blocked',
      });
      expect(getLinkAction('./image.png', 'C:\\docs\\guide\\intro.md')).toEqual({
        type: 'blocked',
      });
    });
  });

  describe('image source policy', () => {
    it('allows only document-relative image sources', () => {
      expect(getImageSourcePolicy('./assets/cover.png')).toEqual({
        type: 'relative',
        source: './assets/cover.png',
      });
      expect(getImageSourcePolicy('data:image/svg+xml;base64,PHN2Zz4=')).toMatchObject({
        type: 'blocked',
        reason: 'Embedded image not loaded',
      });
      expect(getImageSourcePolicy('https://example.com/cover.png')).toMatchObject({
        type: 'blocked',
        reason: 'Remote image not loaded',
      });
      expect(getImageSourcePolicy('file:outside.png')).toMatchObject({
        type: 'blocked',
        reason: 'Unsupported image source',
      });
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

  describe('reading tools', () => {
    it('finds Markdown delimiters without changing source content', () => {
      const tokens = (line) => getMarkdownSourceTokenRanges(line)
        .map(({ start, end }) => line.slice(start, end));

      expect(tokens('# open.md')).toEqual(['#']);
      expect(tokens('- **bold** and `code`')).toEqual(['-', '**', '**', '`', '`']);
      expect(tokens('> Quote')).toEqual(['>']);
      expect(tokens('[Docs](guide.md)')).toEqual(['[', '](', ')']);
      expect(tokens('plain a_b identifier')).toEqual([]);
    });

    it('normalizes structured and legacy document payloads', () => {
      expect(normalizeDocumentPayload({
        html: '<h1>Title</h1>',
        source: '# Title\n',
        lineCount: 2,
        characterCount: 8,
        wordCount: 2,
        readingTimeMinutes: 1,
      })).toEqual({
        html: '<h1>Title</h1>',
        source: '# Title\n',
        lineCount: 2,
        characterCount: 8,
        wordCount: 2,
        readingTimeMinutes: 1,
      });
      expect(normalizeDocumentPayload('<p>Legacy</p>')).toMatchObject({
        html: '<p>Legacy</p>',
        source: '',
        lineCount: 1,
        characterCount: 0,
      });
    });

    it('keeps essential document counts and labels zoom explicitly', () => {
      expect(getStatusMetricParts({
        lineCount: 42,
        characterCount: 1280,
        zoomPercent: 100,
        currentLine: 9,
        showCurrentLine: true,
        readingProgress: 25,
        readingTimeMinutes: 8,
        showReadingStats: true,
      })).toEqual({
        visible: ['42 lines', '1,280 chars', 'Zoom 100%', 'Ln 9', '25%', '6 min left'],
        accessible: [
          '42 lines',
          '1,280 characters',
          'Zoom 100 percent',
          'Line 9',
          '25 percent through document',
          '6 minutes left',
        ],
      });
    });

    it('uses the correct accessible maximize and restore presentation', () => {
      expect(getWindowControlPresentation(false)).toEqual({
        label: 'Maximize',
        iconClass: 'iconoir-square',
      });
      expect(getWindowControlPresentation(true)).toEqual({
        label: 'Restore',
        iconClass: 'iconoir-multi-window',
      });
    });

    it('accepts only explicit persisted booleans', () => {
      expect(normalizeReadingTools({
        lineGuide: true,
        minimap: 'true',
        source: false,
        stats: 1,
      })).toEqual({
        lineGuide: true,
        minimap: false,
        source: false,
        stats: false,
      });
    });

    it('normalizes and deduplicates native file-open requests', () => {
      expect(normalizeOpenFileRequest({
        id: 7,
        paths: ['C:\\docs\\one.md', 'C:\\docs\\one.md', 'C:\\docs\\two.markdown', 42],
      })).toEqual({
        id: 7,
        paths: ['C:\\docs\\one.md', 'C:\\docs\\two.markdown'],
      });
      expect(normalizeOpenFileRequest({ id: 0, paths: ['README.md'] })).toBeNull();
      expect(normalizeOpenFileRequest({ id: 9, paths: [] })).toBeNull();
    });

    it('calculates bounded progress and remaining time', () => {
      expect(getReadingProgress(250, 1000, 500)).toBe(50);
      expect(getReadingProgress(-20, 1000, 500)).toBe(0);
      expect(getReadingProgress(0, 400, 500)).toBe(100);
      expect(getEstimatedMinutesRemaining(8, 25)).toBe(6);
      expect(getEstimatedMinutesRemaining(8, 100)).toBe(0);
    });

    it('uses the first visible raw source line as the current reading line', () => {
      expect(getVisibleSourceLineRange({
        scrollTop: 60,
        clientHeight: 100,
        lineHeight: 20,
        paddingTop: 20,
        lineCount: 100,
      })).toEqual({ first: 3, last: 10, current: 3 });
    });

    it('maps rendered scroll position to the nearest prior source anchor', () => {
      const anchors = [
        { line: 1, top: 40 },
        { line: 5, top: 180 },
        { line: 12, top: 420 },
      ];
      expect(getCurrentLineFromAnchors(anchors, 300)).toBe(5);
      expect(getCurrentLineFromAnchors([], 300)).toBe(1);
    });

    it('places the line gutter from the measured text edge, never over the content', () => {
      expect(getLineGutterLeft({
        viewLeft: 70,
        stageLeft: 0,
        paddingLeft: 52,
        gutterWidth: 34,
        gap: 12,
      })).toBe(76);
      expect(getLineGutterLeft({
        viewLeft: 0,
        stageLeft: 0,
        paddingLeft: 20,
        gutterWidth: 34,
        gap: 12,
      })).toBe(4);
    });

    it('maps the real scroll viewport into the minimap track', () => {
      expect(getMinimapViewportGeometry({
        scrollTop: 750,
        scrollHeight: 2000,
        clientHeight: 500,
        trackHeight: 360,
      })).toEqual({ top: 135, height: 90 });
      expect(getMinimapViewportGeometry({
        scrollTop: 0,
        scrollHeight: 400,
        clientHeight: 500,
        trackHeight: 360,
      })).toEqual({ top: 0, height: 360 });
      expect(getMinimapViewportGeometry({
        scrollTop: 250,
        scrollHeight: 1000,
        clientHeight: 500,
        trackHeight: 360,
        contentHeight: 90,
      })).toEqual({ top: 22.5, height: 45 });
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
