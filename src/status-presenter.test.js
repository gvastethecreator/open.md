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
