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

const readerMetrics = [
  { kind: 'lines', visible: '12 lines' },
  { kind: 'zoom', visible: '125%' },
];

describe('Status Presenter', () => {
  it('renders identity, accessible metrics and reuses metric nodes by kind', () => {
    const view = fixture();
    const presenter = createStatusPresenter({
      window: view.dom.window,
      document: view.document,
      elements: view.elements,
    });

    presenter.setIdentity({ primary: 'guide.md', context: 'Markdown' });
    presenter.renderMetrics(readerMetrics, '12 lines. Zoom 125 percent.');

    const lines = view.elements.metrics.querySelector('[data-status-kind="lines"]');
    const zoom = view.elements.metrics.querySelector('[data-status-kind="zoom"]');
    expect(view.elements.primary.textContent).toBe('guide.md');
    expect(view.elements.context.dataset.tooltip).toBe('guide.md · Markdown');
    expect(view.elements.metrics.getAttribute('aria-label')).toBe('12 lines. Zoom 125 percent.');
    expect(view.elements.metrics.dataset.tooltip).toBeUndefined();
    expect(zoom.querySelector('.status-metric-value').textContent).toBe('125%');

    presenter.renderMetrics([
      { kind: 'zoom', visible: '150%' },
      { kind: 'lines', visible: '13 lines' },
    ], '13 lines. Zoom 150 percent.');
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

    presenter.renderMetrics([{ kind: 'zoom', visible: '110%' }], 'Zoom 110 percent.');
    presenter.renderMetrics([{ kind: 'zoom', visible: '120%' }], 'Zoom 120 percent.');
    expect(view.animations).toHaveLength(1);
    presenter.dispose();
    expect(view.animations[0].cancel).toHaveBeenCalledOnce();

    presenter.renderMetrics([{ kind: 'zoom', visible: '130%' }], 'Zoom 130 percent.');
    expect(view.elements.metrics.querySelector('.status-metric-value').textContent).toBe('120%');
  });

  it('composes document and editor metric snapshots behind one interface', () => {
    const view = fixture();
    const presenter = createStatusPresenter({
      window: view.dom.window,
      document: view.document,
      elements: view.elements,
    });

    presenter.renderDocumentMetrics({
      lineCount: 10,
      characterCount: 40,
      zoomPercent: 100,
      currentLine: 3,
      showCurrentLine: true,
      readingProgress: 20,
      readingTimeMinutes: 5,
      showReadingStats: false,
    });
    expect(view.elements.metrics.querySelector('[data-status-kind="lines"]')?.textContent).toContain('10');
    expect(view.elements.metrics.querySelector('[data-status-kind="current-line"]')?.textContent).toBe('Ln 3');

    presenter.renderEditorMetrics({
      cursor: { line: 2, column: 4 },
      stats: { blocks: 3, words: 9, characters: 20 },
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
      formatLabel: 'Markdown',
      documentMetrics: {
        lineCount: 4,
        characterCount: 20,
        zoomPercent: 100,
        showCurrentLine: false,
        showReadingStats: false,
      },
    });
    expect(view.elements.primary.textContent).toBe('guide.md');
    expect(view.elements.context.textContent).toBe('Markdown');
    expect(view.elements.metrics.querySelector('[data-status-kind="lines"]')).toBeTruthy();

    presenter.project({
      path: 'C:/docs/guide.md',
      formatLabel: 'Markdown',
      sourceActive: true,
      documentMetrics: {
        lineCount: 4,
        characterCount: 20,
        zoomPercent: 100,
        showCurrentLine: false,
        showReadingStats: false,
      },
    });
    expect(view.elements.context.textContent).toBe('Source');

    presenter.project({
      path: 'C:/docs/guide.md',
      editMode: true,
      editorMetrics: {
        cursor: { line: 1, column: 2 },
        stats: { blocks: 1, words: 2, characters: 5 },
        zoomPercent: 100,
      },
    });
    expect(view.elements.context.textContent).toBe('Editing');
    expect(view.elements.metrics.querySelector('[data-status-kind="column"]')?.textContent).toBe('Col 2');
  });

  it('uses an instant path for reduced motion and clears the surface', () => {
    const view = fixture({ reduced: true });
    const presenter = createStatusPresenter({
      window: view.dom.window,
      document: view.document,
      elements: view.elements,
    });

    presenter.renderMetrics([{ kind: 'zoom', visible: '110%' }], 'Zoom 110 percent.');
    presenter.renderMetrics([{ kind: 'zoom', visible: '120%' }], 'Zoom 120 percent.');
    expect(view.animations).toHaveLength(0);

    presenter.clear();
    expect(view.elements.primary.textContent).toBe('open.md');
    expect(view.elements.context.textContent).toBe('Ready');
    expect(view.elements.metrics.hidden).toBe(true);
    expect(view.elements.metrics.hasAttribute('aria-label')).toBe(false);
  });
});
