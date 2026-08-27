import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { createStatusPresenter } from './status-presenter.js';

function fixture({ reduced = false } = {}) {
  const dom = new JSDOM('<!doctype html><body><span id="primary"></span><span id="context"></span><div id="metrics"></div></body>');
  const document = dom.window.document;
  const metrics = document.querySelector('#metrics');
  const animations = [];
  dom.window.matchMedia = () => ({ matches: reduced });
  dom.window.Element.prototype.animate = vi.fn((keyframes, options) => {
    const animation = { cancel: vi.fn(), finished: Promise.resolve(), keyframes, options };
    animations.push(animation);
    return animation;
  });
  return {
    dom,
    document,
    elements: {
      primary: document.querySelector('#primary'),
      context: document.querySelector('#context'),
      metrics,
    },
    animations,
  };
}

describe('Status Presenter', () => {
  it('renders identity, accessible metrics and reuses metric nodes by kind', () => {
    const view = fixture();
    const presenter = createStatusPresenter({
      window: view.dom.window,
      document: view.document,
      elements: view.elements,
    });

    presenter.setIdentity({ primary: 'guide.md', context: 'Markdown' });
    presenter.project({
      path: 'guide.txt',
      document: { kind: 'text', format: 'text', source: 'hello', lineCount: 12, characterCount: 5 },
      zoomPercent: 125,
      readingTools: {},
    });

    const lines = view.elements.metrics.querySelector('[data-status-kind="lines"]');
    const zoom = view.elements.metrics.querySelector('[data-status-kind="zoom"]');
    expect(view.elements.primary.textContent).toBe('guide.txt');
    expect(view.elements.context.dataset.tooltip).toBe('guide.txt · Text');
    expect(view.elements.metrics.getAttribute('aria-label')).toContain('12 lines');
    expect(view.elements.metrics.dataset.tooltip).toBeUndefined();
    expect(zoom.querySelector('.status-metric-value').textContent).toBe('125%');

    presenter.project({
      path: 'guide.txt',
      document: { kind: 'text', format: 'text', source: 'hello', lineCount: 13, characterCount: 5 },
      zoomPercent: 150,
      readingTools: {},
    });
    expect(view.elements.metrics.querySelector('[data-status-kind="lines"]')).toBe(lines);
    expect(view.elements.metrics.querySelector('[data-status-kind="zoom"]')).toBe(zoom);
    expect(view.elements.metrics.querySelector('.status-metric-value').textContent).toBe('150%');
  });

  it('animates changed zoom values and cancels them on dispose', () => {
    const view = fixture();
    const presenter = createStatusPresenter({
      window: view.dom.window,
      document: view.document,
      elements: view.elements,
    });

    const snapshot = {
      path: 'guide.txt',
      document: { kind: 'text', format: 'text', source: 'hello', lineCount: 1, characterCount: 5 },
      readingTools: {},
    };
    presenter.project({ ...snapshot, zoomPercent: 110 });
    presenter.project({ ...snapshot, zoomPercent: 120 });
    expect(view.animations).toHaveLength(1);
    presenter.dispose();
    expect(view.animations[0].cancel).toHaveBeenCalledOnce();

    presenter.project({ ...snapshot, zoomPercent: 130 });
    expect(view.elements.metrics.querySelector('.status-metric-value').textContent).toBe('120%');
  });

  it('composes document and editor metric snapshots behind one interface', () => {
    const view = fixture();
    const presenter = createStatusPresenter({
      window: view.dom.window,
      document: view.document,
      elements: view.elements,
    });

    presenter.project({
      path: 'guide.md',
      document: {
        kind: 'markdown',
        format: 'markdown',
        source: '# Guide',
        lineCount: 10,
        characterCount: 40,
        readingTimeMinutes: 5,
      },
      zoomPercent: 100,
      navigation: { currentLine: 3, readingProgress: 20 },
      readingTools: { lineGuide: true, stats: false },
    });
    expect(view.elements.metrics.querySelector('[data-status-kind="lines"]')?.textContent).toContain('10');
    expect(view.elements.metrics.querySelector('[data-status-kind="current-line"]')?.textContent).toBe('Ln 3');

    presenter.project({
      path: 'guide.md',
      document: { kind: 'markdown', format: 'markdown', source: '# Guide' },
      editMode: true,
      editorSnapshot: {
        cursor: { line: 2, column: 4 },
        stats: { lines: 3, words: 9, characters: 20 },
      },
      zoomPercent: 125,
    });
    expect(view.elements.metrics.querySelector('[data-status-kind="current-line"]')?.textContent).toBe('Ln 2');
    expect(view.elements.metrics.querySelector('[data-status-kind="column"]')?.textContent).toBe('Col 4');
    expect(view.elements.metrics.getAttribute('aria-label')).toContain('Zoom 125 percent');
  });

  it('projects help, ready, document, source and edit identity from one snapshot', () => {
    const view = fixture();
    const presenter = createStatusPresenter({
      window: view.dom.window,
      document: view.document,
      elements: view.elements,
    });

    presenter.project({ helpVisible: true });
    expect(view.elements.primary.textContent).toBe('About + Help');
    expect(view.elements.context.textContent).toBe('F1 to close');
    expect(view.elements.metrics.hidden).toBe(true);

    presenter.project({});
    expect(view.elements.primary.textContent).toBe('open.md');
    expect(view.elements.context.textContent).toBe('Ready');

    presenter.project({
      path: 'C:/docs/guide.md',
      document: {
        kind: 'markdown',
        format: 'markdown',
        source: '# Guide',
        lineCount: 4,
        characterCount: 20,
      },
      zoomPercent: 100,
      readingTools: {},
    });
    expect(view.elements.primary.textContent).toBe('guide.md');
    expect(view.elements.context.textContent).toBe('Markdown');
    expect(view.elements.metrics.querySelector('[data-status-kind="lines"]')).toBeTruthy();

    presenter.project({
      path: 'C:/photos/shot.png',
      document: { kind: 'image', format: 'png', source: '', lineCount: 1, characterCount: 0 },
      imageState: {
        naturalWidth: 800,
        naturalHeight: 600,
        scale: 0.5,
        fitScale: 0.5,
      },
    });
    expect(view.elements.context.textContent).toBe('Image');
    expect(view.elements.metrics.querySelector('[data-status-kind="dimensions"]')?.textContent).toContain('800');
    expect(view.elements.metrics.querySelector('[data-status-kind="zoom"]')?.textContent).toMatch(/Fit|50%/);

    presenter.project({
      path: 'C:/docs/data.csv',
      document: {
        kind: 'text',
        format: 'csv',
        source: 'name,note\nAda,"a,b"',
        lineCount: 2,
        characterCount: 21,
      },
      zoomPercent: 100,
      readingTools: {},
    });
    expect(view.elements.context.textContent).toBe('CSV');
    expect(view.elements.metrics.querySelector('[data-status-kind="csv-shape"]')?.textContent).toBe('2×2');

    presenter.project({
      path: 'C:/docs/guide.md',
      document: {
        kind: 'markdown',
        format: 'markdown',
        source: '# Guide',
        lineCount: 4,
        characterCount: 20,
      },
      sourceActive: true,
      zoomPercent: 100,
      readingTools: {},
    });
    expect(view.elements.context.textContent).toBe('Source');

    presenter.project({
      path: 'C:/docs/guide.md',
      document: { kind: 'markdown', format: 'markdown', source: '# Guide' },
      editMode: true,
      editorSnapshot: {
        cursor: { line: 1, column: 2 },
        stats: { lines: 1, words: 2, characters: 5 },
      },
      zoomPercent: 100,
    });
    expect(view.elements.context.textContent).toBe('Editing');
    expect(view.elements.metrics.querySelector('[data-status-kind="column"]')?.textContent).toBe('Col 2');

    presenter.project({
      path: 'C:/docs/config.json',
      document: {
        kind: 'text',
        format: 'json',
        source: '{"a":1,"b":2,"c":3}',
      },
      editMode: true,
      editorSnapshot: { presentation: 'json-props' },
      editorSource: '{"a":1,"b":2,"c":3}',
      zoomPercent: 100,
    });
    expect(view.elements.context.textContent).toBe('Editing');
    expect(view.elements.metrics.querySelector('[data-status-kind="json-keys"]')?.textContent).toContain('3');
  });

  it('uses an instant path for reduced motion and clears the surface', () => {
    const view = fixture({ reduced: true });
    const presenter = createStatusPresenter({
      window: view.dom.window,
      document: view.document,
      elements: view.elements,
    });

    const snapshot = {
      path: 'guide.txt',
      document: { kind: 'text', format: 'text', source: 'hello', lineCount: 1, characterCount: 5 },
      readingTools: {},
    };
    presenter.project({ ...snapshot, zoomPercent: 110 });
    presenter.project({ ...snapshot, zoomPercent: 120 });
    expect(view.animations).toHaveLength(0);

    presenter.project({});
    expect(view.elements.primary.textContent).toBe('open.md');
    expect(view.elements.context.textContent).toBe('Ready');
    expect(view.elements.metrics.hidden).toBe(true);
    expect(view.elements.metrics.hasAttribute('aria-label')).toBe(false);
  });
});
