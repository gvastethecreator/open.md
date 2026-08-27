// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createResponsiveTypography, findFittedFontSize } from './responsive-typography.js';

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

  it('does not clear --pretext-font-size on an untouched heading', async () => {
    vi.resetModules();
    vi.doMock('@chenglou/pretext', () => ({
      prepare: () => ({}),
      layout: () => ({ lineCount: 1 }),
    }));
    const { createResponsiveTypography: createTypography } = await import('./responsive-typography.js');
    const root = document.createElement('div');
    root.innerHTML = '<div class="markdown-body"><h1 id="keep">Keep</h1><h1 id="edit">Edit</h1></div>';
    document.body.append(root);
    const keep = root.querySelector('#keep');
    const edit = root.querySelector('#edit');
    [keep, edit].forEach((heading) => {
      Object.defineProperty(heading, 'clientWidth', { configurable: true, value: 320 });
    });
    window.getComputedStyle = () => ({
      fontSize: '32px',
      lineHeight: '40px',
      fontStyle: 'normal',
      fontVariant: 'normal',
      fontWeight: '600',
      fontFamily: 'Inter',
      whiteSpace: 'normal',
      wordBreak: 'normal',
      letterSpacing: '0',
    });
    window.matchMedia = () => ({ matches: false });
    const frames = [];
    window.requestAnimationFrame = (callback) => {
      frames.push(callback);
      return frames.length;
    };
    window.cancelAnimationFrame = () => {};

    const typography = createTypography({ window, root: document });
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      ready = typography.refresh();
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
      while (frames.length > 0) frames.shift()(16);
    }
    expect(ready).toBe(true);

    keep.style.setProperty('--pretext-font-size', '32px');
    edit.style.setProperty('--pretext-font-size', '32px');
    keep.dataset.pretextFitted = 'sentinel';
    edit.dataset.pretextFitted = 'sentinel';
    edit.textContent = 'Changed heading';
    await Promise.resolve();
    await Promise.resolve();
    while (frames.length > 0) frames.shift()(16);

    expect(keep.style.getPropertyValue('--pretext-font-size')).toBe('32px');
    expect(keep.dataset.pretextFitted).toBe('sentinel');
    expect(edit.dataset.pretextFitted).not.toBe('sentinel');
    typography.dispose();
    root.remove();
    vi.doUnmock('@chenglou/pretext');
  });

  it('refits every heading when ResizeObserver fires with entries', async () => {
    vi.resetModules();
    vi.doMock('@chenglou/pretext', () => ({
      prepare: () => ({}),
      layout: () => ({ lineCount: 1 }),
    }));
    const { createResponsiveTypography: createTypography } = await import('./responsive-typography.js');
    const root = document.createElement('div');
    root.innerHTML = '<div class="markdown-body"><h1 id="keep">Keep</h1><h1 id="edit">Edit</h1></div>';
    document.body.append(root);
    const keep = root.querySelector('#keep');
    const edit = root.querySelector('#edit');
    [keep, edit].forEach((heading) => {
      Object.defineProperty(heading, 'clientWidth', { configurable: true, value: 320 });
    });
    window.getComputedStyle = () => ({
      fontSize: '32px',
      lineHeight: '40px',
      fontStyle: 'normal',
      fontVariant: 'normal',
      fontWeight: '600',
      fontFamily: 'Inter',
      whiteSpace: 'normal',
      wordBreak: 'normal',
      letterSpacing: '0',
    });
    window.matchMedia = () => ({ matches: false });
    const frames = [];
    window.requestAnimationFrame = (callback) => {
      frames.push(callback);
      return frames.length;
    };
    window.cancelAnimationFrame = () => {};
    const observers = [];
    const OriginalResizeObserver = window.ResizeObserver;
    window.ResizeObserver = class {
      constructor(callback) {
        this.callback = callback;
        observers.push(this);
      }

      observe() {}

      disconnect() {}
    };

    const typography = createTypography({ window, root: document });
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      ready = typography.refresh();
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
      while (frames.length > 0) frames.shift()(16);
    }
    expect(ready).toBe(true);
    expect(observers.length).toBeGreaterThan(0);

    keep.style.setProperty('--pretext-font-size', '32px');
    edit.style.setProperty('--pretext-font-size', '32px');
    keep.dataset.pretextFitted = 'sentinel';
    edit.dataset.pretextFitted = 'sentinel';
    observers[0].callback(
      [{ target: root.querySelector('.markdown-body') }],
      observers[0],
    );
    while (frames.length > 0) frames.shift()(16);

    expect(keep.dataset.pretextFitted).not.toBe('sentinel');
    expect(edit.dataset.pretextFitted).not.toBe('sentinel');
    typography.dispose();
    root.remove();
    window.ResizeObserver = OriginalResizeObserver;
    vi.doUnmock('@chenglou/pretext');
  });

  it('refits every heading when fonts.ready resolves with a FontFaceSet', async () => {
    vi.resetModules();
    vi.doMock('@chenglou/pretext', () => ({
      prepare: () => ({}),
      layout: () => ({ lineCount: 1 }),
    }));
    const { createResponsiveTypography: createTypography } = await import('./responsive-typography.js');
    const root = document.createElement('div');
    root.innerHTML = '<div class="markdown-body"><h1 id="keep">Keep</h1></div>';
    document.body.append(root);
    const keep = root.querySelector('#keep');
    Object.defineProperty(keep, 'clientWidth', { configurable: true, value: 320 });
    window.getComputedStyle = () => ({
      fontSize: '32px',
      lineHeight: '40px',
      fontStyle: 'normal',
      fontVariant: 'normal',
      fontWeight: '600',
      fontFamily: 'Inter',
      whiteSpace: 'normal',
      wordBreak: 'normal',
      letterSpacing: '0',
    });
    window.matchMedia = () => ({ matches: false });
    const frames = [];
    window.requestAnimationFrame = (callback) => {
      frames.push(callback);
      return frames.length;
    };
    window.cancelAnimationFrame = () => {};
    let resolveFonts;
    const fontsReady = new Promise((resolve) => {
      resolveFonts = resolve;
    });
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { ready: fontsReady },
    });

    const typography = createTypography({ window, root: document });
    let ready = false;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      ready = typography.refresh();
      if (ready) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
      while (frames.length > 0) frames.shift()(16);
    }
    expect(ready).toBe(true);

    keep.style.setProperty('--pretext-font-size', '32px');
    keep.dataset.pretextFitted = 'sentinel';
    const fontFaceSet = {
      forEach(callback) {
        callback({ family: 'Inter' });
      },
    };
    resolveFonts(fontFaceSet);
    await fontsReady;
    await Promise.resolve();
    while (frames.length > 0) frames.shift()(16);

    expect(keep.dataset.pretextFitted).not.toBe('sentinel');
    typography.dispose();
    root.remove();
    delete document.fonts;
    vi.doUnmock('@chenglou/pretext');
  });
});
