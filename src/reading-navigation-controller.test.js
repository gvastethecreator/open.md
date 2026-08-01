import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { createReadingNavigationController } from './reading-navigation-controller.js';

function setMetric(element, name, value) {
  Object.defineProperty(element, name, { configurable: true, value });
}

function fixture() {
  const dom = new JSDOM(`<!doctype html><html><body>
    <div id="reader"><div id="stage">
      <article id="read" style="padding-left:24px;font-size:16px;line-height:24px">
        <span class="source-line-anchor" data-source-line="1"></span><p id="read-copy">Read copy</p>
      </article>
      <pre id="source" style="padding-left:24px;padding-top:0;line-height:20px">one\ntwo\nthree\nfour\nfive</pre>
      <section id="edit"><div id="canvas" style="padding-left:24px;--editor-control-lane:52;--editor-line-gap:12">
        <div data-source-line-start="2" data-source-line-count="1" data-block-type="paragraph">
          <p data-editor-content id="edit-copy">Edit copy</p>
        </div>
      </div></section>
    </div></div>
    <section id="help"></section><button id="top"></button>
    <aside id="lines"></aside>
    <aside id="minimap"><div id="mini-doc"></div><div id="mini-view"></div></aside>
  </body></html>`);
  const document = dom.window.document;
  const elements = {
    readerPage: document.querySelector('#reader'),
    helpStage: document.querySelector('#help'),
    documentStage: document.querySelector('#stage'),
    readView: document.querySelector('#read'),
    sourceView: document.querySelector('#source'),
    editView: document.querySelector('#edit'),
    editorCanvas: document.querySelector('#canvas'),
    lineGutter: document.querySelector('#lines'),
    minimap: document.querySelector('#minimap'),
    minimapDocument: document.querySelector('#mini-doc'),
    minimapViewport: document.querySelector('#mini-view'),
    scrollToTop: document.querySelector('#top'),
  };
  let scrollTop = 0;
  Object.defineProperty(elements.readerPage, 'scrollTop', {
    configurable: true,
    get: () => scrollTop,
    set: (value) => { scrollTop = value; },
  });
  setMetric(elements.readerPage, 'scrollHeight', 1000);
  setMetric(elements.readerPage, 'clientHeight', 200);
  elements.readerPage.scrollTo = vi.fn(({ top }) => { scrollTop = top; });
  setMetric(elements.helpStage, 'scrollHeight', 600);
  setMetric(elements.helpStage, 'clientHeight', 200);
  elements.helpStage.scrollTo = vi.fn();
  setMetric(elements.minimap, 'clientWidth', 80);
  setMetric(elements.minimap, 'clientHeight', 400);
  elements.minimap.getBoundingClientRect = () => ({ top: 0, left: 0, width: 80, height: 400 });
  elements.documentStage.getBoundingClientRect = () => ({ top: 0, left: 0, width: 500, height: 900 });
  elements.lineGutter.getBoundingClientRect = () => ({ width: 34, height: 900 });
  [elements.readView, elements.sourceView, elements.editorCanvas].forEach((element) => {
    element.getBoundingClientRect = () => ({ top: 0, left: 60, width: 400, height: 800 });
    setMetric(element, 'scrollHeight', 800);
  });
  document.querySelector('#read-copy').getBoundingClientRect = () => ({ top: 24, left: 60, width: 300, height: 24 });
  document.querySelector('#edit-copy').getBoundingClientRect = () => ({ top: 48, left: 60, width: 300, height: 24 });

  let mode = 'read';
  let helpVisible = false;
  let lineGuide = true;
  let minimap = true;
  let currentDocument = { source: 'one\ntwo\nthree\nfour\nfive', lineCount: 5 };
  const onMetricsChange = vi.fn();
  const controller = createReadingNavigationController({
    window: dom.window,
    document,
    elements,
    adapters: {
      getDocument: () => currentDocument,
      getFilePath: () => 'notes.md',
      getMode: () => mode,
      isHelpVisible: () => helpVisible,
      isLineGuideEnabled: () => lineGuide,
      isMinimapEnabled: () => minimap,
      getEditorCursorLine: () => 2,
    },
    hooks: { onMetricsChange },
  });
  return {
    dom,
    document,
    elements,
    controller,
    onMetricsChange,
    setMode: (value) => { mode = value; },
    setHelp: (value) => { helpVisible = value; },
    setTools: (lines, mini) => { lineGuide = lines; minimap = mini; },
    clearDocument: () => { currentDocument = null; },
  };
}

describe('Reading Navigation Controller', () => {
  it('renders line guides and minimap snapshots from the active Read, Source and Edit view', () => {
    const view = fixture();
    view.controller.refreshTools();
    view.controller.refresh();
    expect(view.controller.activeView()).toBe(view.elements.readView);
    expect(view.elements.minimapDocument.textContent).toContain('Read copy');
    expect(view.elements.lineGutter.textContent).toContain('1');

    view.setMode('source');
    view.elements.readerPage.scrollTop = 20;
    view.controller.markDirty({ queue: false });
    view.controller.refresh();
    expect(view.controller.activeView()).toBe(view.elements.sourceView);
    expect(view.elements.minimapDocument.textContent).toContain('three');
    expect(view.controller.snapshot().currentLine).toBeGreaterThanOrEqual(1);

    view.setMode('edit');
    view.controller.markDirty({ queue: false });
    view.controller.refresh();
    expect(view.controller.activeView()).toBe(view.elements.editorCanvas);
    expect(view.elements.minimapDocument.textContent).toContain('Edit copy');
    expect(view.elements.lineGutter.querySelector('.is-current')?.textContent).toBe('2');
  });

  it('places Classic edit line-guide numbers on hard-line row geometry', () => {
    const view = fixture();
    // Replace Block islands with Classic source-line rows.
    view.elements.editorCanvas.innerHTML = `
      <div data-classic-line="0" class="classic-line"><div data-classic-content>one</div></div>
      <div data-classic-line="1" class="classic-line"><div data-classic-content>two</div></div>
      <div data-classic-line="2" class="classic-line is-active-line"><div data-classic-content>three</div></div>
    `;
    const tops = [24, 48, 96];
    view.elements.editorCanvas.querySelectorAll('[data-classic-line]').forEach((row, index) => {
      const content = row.querySelector('[data-classic-content]');
      const top = tops[index];
      const rect = { top, left: 60, width: 300, height: 24, right: 360, bottom: top + 24 };
      row.getBoundingClientRect = () => rect;
      content.getBoundingClientRect = () => rect;
    });

    view.setMode('edit');
    view.controller.refreshTools();
    view.controller.refresh();

    const current = view.elements.lineGutter.querySelector('.is-current');
    expect(current?.textContent).toBe('2');
    // stageTop = 0; classic line index 1 → source line 2 at top 48px
    expect(current?.style.top).toBe('48px');
    expect(view.elements.lineGutter.querySelector('[data-line="1"]')?.style.top).toBe('24px');
    expect(view.elements.lineGutter.querySelector('[data-line="3"]')?.style.top).toBe('96px');
  });

  it('force-refreshes the minimap during mode morph so the VT new snapshot is current', () => {
    const view = fixture();
    view.controller.refreshTools();
    view.controller.refresh();
    expect(view.elements.minimapDocument.textContent).toContain('Read copy');

    view.document.body.classList.add('is-mode-morphing');
    view.controller.prepareModeMorph();
    view.setMode('edit');
    // Morph lock blocks background updates; force must still rebuild the minimap.
    view.controller.markDirty({ queue: true });
    view.controller.refresh();
    expect(view.elements.minimapDocument.textContent).toContain('Read copy');
    view.controller.refresh({ force: true });
    expect(view.elements.minimapDocument.textContent).toContain('Edit copy');

    view.controller.finishModeMorph();
    expect(view.elements.minimapDocument.textContent).toContain('Edit copy');
  });

  it('transfers shared line-number nodes with VT names and does not remeasure on finish', () => {
    const view = fixture();
    view.controller.refreshTools();
    view.controller.refresh();
    const first = view.elements.lineGutter.querySelector('.line-number[data-line="1"]');
    expect(first).toBeTruthy();
    expect(first.style.viewTransitionName).toBe('');

    view.document.body.classList.add('is-mode-morphing');
    view.controller.prepareModeMorph();
    expect(first.style.viewTransitionName).toBe('openmd-ln-1');

    const previousTop = first.style.top;
    view.document.querySelector('#read-copy').getBoundingClientRect = () => (
      { top: 64, left: 60, width: 300, height: 24 }
    );
    view.controller.refresh();
    expect(first.style.top).toBe(previousTop);
    view.controller.refresh({ force: true });
    const reused = view.elements.lineGutter.querySelector('.line-number[data-line="1"]');
    expect(reused).toBe(first);
    expect(reused.style.top).not.toBe(previousTop);
    expect(reused.style.viewTransitionName).toBe('openmd-ln-1');

    const topAfterMorphRefresh = reused.style.top;
    view.controller.finishModeMorph();
    // Keep morph positions: post-VT remeasure was the land jump.
    expect(reused.style.top).toBe(topAfterMorphRefresh);
    expect(reused.style.viewTransitionName).toBe('');
  });

  it('maps minimap pointer and keyboard input to the reader scroll owner', () => {
    const view = fixture();
    view.controller.start();
    // Build the scaled mini-document so pointer maps against content height.
    // Fixture view 400×800 into track 80×400 → scale min(0.2, 0.5) = 0.2 → contentHeight 160.
    view.controller.refreshTools();
    view.controller.refresh({ force: true });

    // Half of content (y=80) → half of maxScroll (800).
    const pointer = new view.dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: 80 });
    Object.defineProperty(pointer, 'pointerId', { value: 7 });
    view.elements.minimap.dispatchEvent(pointer);
    expect(view.elements.readerPage.scrollTo).toHaveBeenLastCalledWith({ top: 400, behavior: 'auto' });

    // Click below the mini-document clamps to the document end.
    const below = new view.dom.window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientY: 300 });
    Object.defineProperty(below, 'pointerId', { value: 8 });
    view.elements.minimap.dispatchEvent(below);
    expect(view.elements.readerPage.scrollTo).toHaveBeenLastCalledWith({ top: 800, behavior: 'auto' });

    const key = new view.dom.window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'End' });
    view.elements.minimap.dispatchEvent(key);
    expect(key.defaultPrevented).toBe(true);
    expect(view.elements.readerPage.scrollTo).toHaveBeenLastCalledWith({ top: 800, behavior: 'auto' });
  });

  it('captures and restores one reader scroll position across mode changes', () => {
    const view = fixture();
    view.controller.refreshTools();
    view.elements.readerPage.scrollTop = 140;
    const scrollPosition = view.controller.captureScrollPosition();
    view.elements.readerPage.scrollTop = 280;
    view.controller.restoreScrollPosition(scrollPosition);
    expect(view.elements.readerPage.scrollTo).toHaveBeenLastCalledWith({ top: 140, behavior: 'auto' });

    view.elements.readerPage.scrollTop = 90;
    view.controller.restoreScrollPosition(scrollPosition, { sync: true });
    expect(view.elements.readerPage.scrollTo).toHaveBeenLastCalledWith({ top: 140, behavior: 'auto' });
    expect(view.elements.lineGutter.querySelector('.line-number')).toBeTruthy();

    view.dom.window.matchMedia = () => ({ matches: true });
    view.controller.scrollToTop();
    expect(view.elements.readerPage.scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'auto' });
  });

  it('owns observer/listener/RAF cleanup and resets navigation state', async () => {
    const view = fixture();
    const observed = [];
    const disconnect = vi.fn();
    view.dom.window.ResizeObserver = class {
      constructor(callback) { this.callback = callback; }
      observe(element) { observed.push(element); }
      disconnect() { disconnect(); }
    };
    view.controller.start();
    expect(observed).toHaveLength(5);
    view.elements.readerPage.scrollTop = 500;
    view.elements.readerPage.dispatchEvent(new view.dom.window.Event('scroll'));
    await new Promise((resolve) => view.dom.window.setTimeout(resolve, 5));
    expect(view.document.body.classList.contains('has-scroll-before')).toBe(true);

    view.controller.reset();
    expect(view.controller.snapshot()).toEqual({ currentLine: 1, readingProgress: 0 });
    const metricsCount = view.onMetricsChange.mock.calls.length;
    view.controller.dispose();
    expect(disconnect).toHaveBeenCalledOnce();
    view.elements.readerPage.dispatchEvent(new view.dom.window.Event('scroll'));
    await new Promise((resolve) => view.dom.window.setTimeout(resolve, 5));
    expect(view.onMetricsChange).toHaveBeenCalledTimes(metricsCount);
  });
});
