// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { createEditorClassicSurface } from './editor-classic-surface.js';

function mountSurface(initial = '# Title\n\nHello **world**\n\n- item', options = {}) {
  document.body.innerHTML = '<div id="canvas"></div>';
  const canvas = document.getElementById('canvas');
  let source = initial;
  const applySource = vi.fn((next) => {
    source = next;
    return true;
  });
  const setCursor = vi.fn();
  const surface = createEditorClassicSurface({
    window,
    canvas,
    adapters: {
      isMarkdown: () => true,
      getSource: () => source,
      applySource,
      setCursor,
      highlightSource: () => Boolean(options.highlightSource),
    },
    hooks: { onPreviewChange: options.onPreviewChange },
  });
  surface.mount();
  return { surface, canvas, applySource, setCursor, getSource: () => source };
}

describe('Editor Classic Surface', () => {
  it('keeps untouched mixed line endings and uses the document ending for inserted lines', () => {
    const raw = '# Notes\u00a0\u200b\r\n\n* star\r\n\t- nested\n1) one\r\n***\r\n';
    const { surface, canvas, applySource, getSource } = mountSurface(raw);
    expect(surface.commitFromDom()).toBe(raw);
    expect(applySource).not.toHaveBeenCalled();
    surface.activateLine(2, { caret: 0 });
    const content = canvas.querySelector('[data-editor-mode="source"]');
    content.textContent = '* edited star';
    content.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    expect(getSource()).toBe(raw.replace('* star', '* edited star'));

    surface.activateLine(2, { caret: 3 });
    surface.handleKeydown(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    expect(getSource()).toBe(raw.replace('* star', '* e\r\ndited star'));
    surface.dispose();
  });

  it('shows only the active source line as Markdown; other lines are preview', () => {
    const { canvas } = mountSurface();
    expect(canvas.contentEditable).toBe('true');
    expect(canvas.classList.contains('is-classic-surface')).toBe(true);
    expect(canvas.querySelectorAll('.classic-line')).toHaveLength(5);
    expect(canvas.querySelectorAll('.classic-line.is-active-line')).toHaveLength(1);
    expect(canvas.querySelectorAll('[data-editor-mode="source"]')).toHaveLength(1);
    const active = canvas.querySelector('.is-active-line [data-editor-mode="source"]');
    expect(active?.textContent).toContain('# Title');
    // Active source keeps raw Markdown but uses heading typography, not plain body text.
    expect(active?.classList.contains('classic-line-content--heading1')).toBe(true);
    expect(active?.closest('.classic-line')?.classList.contains('classic-line--heading1')).toBe(true);
    // Inactive lines are rendered (strong for **world**, not raw markers).
    expect(canvas.querySelector('[data-editor-mode="preview"] strong')?.textContent).toBe('world');
    expect(canvas.querySelectorAll('[data-editor-mode="preview"]').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps fenced code, nested lists and images on their document kinds', () => {
    const source = [
      '# Title',
      '',
      '  - nested',
      '![Desk](assets/quiet-desk.webp)',
      '```js',
      'const ready = true;',
      '```',
      'After fence',
    ].join('\n');
    const onPreviewChange = vi.fn();
    const { surface, canvas } = mountSurface(source, { onPreviewChange });
    const rows = [...canvas.querySelectorAll('[data-classic-line]')];
    expect(rows[2].classList.contains('classic-line--bullet')).toBe(true);
    expect(rows[2].style.getPropertyValue('--block-indent')).toBe('1');
    expect(rows[3].classList.contains('classic-line--image')).toBe(true);
    expect(rows[3].querySelector('img.classic-line-image')?.getAttribute('data-document-source'))
      .toBe('assets/quiet-desk.webp');
    expect(rows[3].querySelector('img.classic-line-image')?.getAttribute('src')).toBeNull();
    expect(onPreviewChange).toHaveBeenLastCalledWith(canvas);
    expect(rows[4].classList.contains('classic-line--fence')).toBe(true);
    expect(rows[5].classList.contains('classic-line--code')).toBe(true);
    expect(rows[5].querySelector('[data-editor-mode="preview"]')?.textContent)
      .toContain('const ready = true;');
    expect(rows[6].classList.contains('classic-line--fence')).toBe(true);
    surface.activateLine(4);
    const fence = canvas.children[4].querySelector('[data-classic-content]');
    fence.textContent = '~~~js';
    surface.handleInput();
    expect(canvas.children[6].dataset.lineKind).toBe('code');
    expect(canvas.children[7].dataset.lineKind).toBe('code');
    const changedFence = canvas.children[4].querySelector('[data-classic-content]');
    changedFence.textContent = '```js';
    surface.handleInput();
    expect(canvas.children[6].dataset.lineKind).toBe('fence');
    expect(canvas.children[7].dataset.lineKind).toBe('paragraph');
    surface.dispose();
    expect(onPreviewChange).toHaveBeenLastCalledWith(null);
  });

  it('activates a preview line as the sole source line on click', () => {
    const { surface, canvas } = mountSurface();
    // Line index 2 is "Hello **world**" in "# Title\n\nHello **world**\n\n- item"
    surface.activateLine(2, { caret: 0, clearSelection: true });
    expect(canvas.querySelectorAll('[data-editor-mode="source"]')).toHaveLength(1);
    expect(canvas.querySelectorAll('.classic-line.is-active-line')).toHaveLength(1);
    expect(canvas.querySelector('.is-active-line [data-editor-mode="source"]')?.textContent)
      .toContain('**world**');
    expect(canvas.querySelector('[data-editor-mode="preview"]')).toBeTruthy();
  });

  it('does not rebuild or flip lines while a multi-line selection is dragged', () => {
    const { surface, canvas } = mountSurface('One\nTwo\nThree');
    const rows = [...canvas.querySelectorAll('[data-classic-line]')];
    const start = rows[0].querySelector('[data-classic-content]');
    const end = rows[2].querySelector('[data-classic-content]');
    if (!start.firstChild) start.textContent = 'One';
    const range = document.createRange();
    range.setStart(start.firstChild, 0);
    range.setEnd(end, 0);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    surface.handleSelectionChange();
    // Still only the caret/active line is source — no mid-drag preview→source thrash.
    expect(canvas.querySelectorAll('[data-editor-mode="source"]')).toHaveLength(1);
    expect(rows[0].classList.contains('is-in-selection')).toBe(true);
    expect(rows[2].classList.contains('is-in-selection')).toBe(true);
    // Content nodes are the same mode as before (preview stays preview).
    expect(rows[1].querySelector('[data-editor-mode="preview"]')).toBeTruthy();
    expect(rows[2].querySelector('[data-editor-mode="preview"]')).toBeTruthy();
  });

  it('replaces a multi-line selection as one source edit', () => {
    const { surface, canvas, getSource } = mountSurface('AlphaLong\nxy\nGammaLonger\nDelta');
    const rows = [...canvas.querySelectorAll('[data-classic-line]')];
    const start = rows[0].querySelector('[data-classic-content]');
    const end = rows[2].querySelector('[data-classic-content]');
    const range = document.createRange();
    range.setStart(start.firstChild, 2);
    range.setEnd(end.firstChild, 3);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const event = new InputEvent('beforeinput', {
      bubbles: true,
      cancelable: true,
      inputType: 'insertText',
      data: 'REPLACED',
    });
    expect(surface.handleBeforeInput(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(getSource()).toBe('AlREPLACEDmaLonger\nDelta');
    expect(canvas.querySelectorAll('.classic-line')).toHaveLength(2);
  });

  it('splits lines on Enter and keeps continuous host', () => {
    const { surface, canvas, applySource, getSource } = mountSurface('Before\nHello\nAfter');
    surface.activateLine(1);
    const untouched = [canvas.children[0], canvas.children[2]];
    const observer = new MutationObserver(() => {});
    observer.observe(canvas, { childList: true, attributes: true, subtree: true });
    const content = canvas.querySelector('[data-editor-mode="source"]');
    // Place caret in middle
    const text = content.firstChild;
    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    surface.handleKeydown(event);
    expect(event.defaultPrevented).toBe(true);
    expect(applySource).toHaveBeenCalled();
    expect(getSource()).toBe('Before\nHe\nllo\nAfter');
    expect(canvas.contentEditable).toBe('true');
    expect(canvas.querySelectorAll('.classic-line')).toHaveLength(4);
    expect(canvas.children[0]).toBe(untouched[0]);
    expect(canvas.children[3]).toBe(untouched[1]);
    expect(untouched[1].classicLineIndex).toBe(3);
    expect(observer.takeRecords().some((record) => record.target === untouched[1])).toBe(false);
    observer.disconnect();
    expect(canvas.querySelectorAll('[data-editor-mode="source"]')).toHaveLength(1);
  });

  it('keeps highlighted Source editable after Enter and normalizes browser line wrappers', () => {
    const { surface, canvas, getSource } = mountSurface('# Title', { highlightSource: true });
    const content = canvas.querySelector('[data-editor-mode="source"]');
    expect(content.querySelector('.source-markup-token')?.textContent).toBe('#');
    const endRange = document.createRange();
    endRange.selectNodeContents(content);
    endRange.collapse(false);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(endRange);

    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    expect(surface.handleKeydown(enter)).toBe(true);
    expect(getSource()).toBe('# Title\n');
    expect(canvas.querySelectorAll('.classic-line')).toHaveLength(2);

    const next = canvas.querySelector('.classic-line.is-active-line [data-classic-content]');
    next.innerHTML = '<div>**next**</div>';
    const nextRange = document.createRange();
    nextRange.selectNodeContents(next);
    nextRange.collapse(false);
    selection.removeAllRanges();
    selection.addRange(nextRange);
    expect(surface.handleInput()).toBe(true);

    expect(getSource()).toBe('# Title\n**next**');
    expect(canvas.querySelectorAll('.classic-line')).toHaveLength(2);
    expect(next.textContent).toBe('**next**');
    expect(canvas.contentEditable).toBe('true');
    expect(window.getSelection().rangeCount).toBe(1);
    next.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    const highlighted = canvas.querySelector('.classic-line.is-active-line [data-classic-content]');
    expect([...highlighted.querySelectorAll('.source-markup-token')].map((token) => token.textContent))
      .toEqual(['**', '**']);
  });

  it('owns insertParagraph beforeinput for keyboard and virtual-keyboard line breaks', () => {
    const { surface, canvas, getSource } = mountSurface('Alpha');
    const content = canvas.querySelector('[data-editor-mode="source"]');
    placeCaretIn(content, 2);
    const event = new InputEvent('beforeinput', {
      inputType: 'insertParagraph',
      bubbles: true,
      cancelable: true,
    });

    expect(surface.handleBeforeInput(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(getSource()).toBe('Al\npha');
    expect(canvas.querySelectorAll('.classic-line')).toHaveLength(2);
  });

  it('moves across hard lines with ArrowUp/Down using preferred column', () => {
    const { surface, canvas } = mountSurface('abc\nabcdef\nxy');
    // Start on first line mid column
    const first = canvas.querySelector('[data-editor-mode="source"]');
    const range = document.createRange();
    range.setStart(first.firstChild, 2);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    expect(surface.handleKeydown(down)).toBe(true);
    expect(down.defaultPrevented).toBe(true);
    expect(surface.activeLine()).toBe(1);
    const mid = canvas.querySelector('[data-editor-mode="source"]');
    expect(mid?.textContent).toBe('abcdef');

    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true });
    expect(surface.handleKeydown(up)).toBe(true);
    expect(surface.activeLine()).toBe(0);
  });

  it('retains sticky preferred column across shorter lines then restores on longer lines', () => {
    const { surface, canvas } = mountSurface('abcdef\nxy\nabcdefgh');
    const first = canvas.querySelector('[data-editor-mode="source"]');
    const range = document.createRange();
    range.setStart(first.firstChild, 5); // column index 5 on "abcdef"
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const down1 = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    expect(surface.handleKeydown(down1)).toBe(true);
    expect(surface.activeLine()).toBe(1);
    // Placed caret is clamped to "xy" length, but sticky preferred stays 5.
    expect(surface.preferredColumn()).toBe(5);
    const short = canvas.querySelector('[data-editor-mode="source"]');
    expect(short?.textContent).toBe('xy');
    expect(caretOffsetInSource(short)).toBe(2);

    const down2 = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
    expect(surface.handleKeydown(down2)).toBe(true);
    expect(surface.activeLine()).toBe(2);
    const long = canvas.querySelector('[data-editor-mode="source"]');
    expect(long?.textContent).toBe('abcdefgh');
    // Sticky column restores to 5 on the longer line.
    expect(caretOffsetInSource(long)).toBe(5);
  });

  it('clears sticky preferred column after click/input so the next vertical uses the live caret', () => {
    const { surface, canvas } = mountSurface('abcdef\nxy\nabcdefgh');
    placeCaretIn(canvas.querySelector('[data-editor-mode="source"]'), 5);
    expect(surface.handleKeydown(new KeyboardEvent('keydown', {
      key: 'ArrowDown', bubbles: true, cancelable: true,
    }))).toBe(true);
    expect(surface.preferredColumn()).toBe(5);

    // Pointer placement on the active short line ends sticky sequence.
    const shortRow = canvas.children[1];
    surface.handleClick({
      target: shortRow.querySelector('[data-classic-content]'),
      preventDefault: () => {},
    });
    placeCaretIn(canvas.querySelector('[data-editor-mode="source"]'), 0);
    surface.handleSelectionChange();
    expect(surface.preferredColumn()).toBe(0);

    expect(surface.handleKeydown(new KeyboardEvent('keydown', {
      key: 'ArrowDown', bubbles: true, cancelable: true,
    }))).toBe(true);
    expect(surface.activeLine()).toBe(2);
    // New vertical sequence captures from col 0, not the old sticky 5.
    expect(caretOffsetInSource(canvas.querySelector('[data-editor-mode="source"]'))).toBe(0);
  });

  it('crosses hard lines at edges with ArrowLeft/Right and updates preferred column', () => {
    const { surface, canvas } = mountSurface('ab\ncd\nef');
    surface.activateLine(1, { caret: 0, clearSelection: true });
    const content = canvas.querySelector('[data-editor-mode="source"]');
    placeCaretIn(content, 0);

    const left = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    expect(surface.handleKeydown(left)).toBe(true);
    expect(surface.activeLine()).toBe(0);
    expect(canvas.querySelector('[data-editor-mode="source"]')?.textContent).toBe('ab');
    expect(caretOffsetInSource(canvas.querySelector('[data-editor-mode="source"]'))).toBe(2);

    const right = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
    expect(surface.handleKeydown(right)).toBe(true);
    expect(surface.activeLine()).toBe(1);
    expect(caretOffsetInSource(canvas.querySelector('[data-editor-mode="source"]'))).toBe(0);
  });

  it('merges with previous line on Backspace at column 0', () => {
    const { surface, canvas, getSource } = mountSurface('Hello\nWorld');
    surface.activateLine(1, { caret: 0, clearSelection: true });
    placeCaretIn(canvas.querySelector('[data-editor-mode="source"]'), 0);

    const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    expect(surface.handleKeydown(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(getSource()).toBe('HelloWorld');
    expect(surface.activeLine()).toBe(0);
    expect(canvas.querySelectorAll('.classic-line')).toHaveLength(1);
    expect(caretOffsetInSource(canvas.querySelector('[data-editor-mode="source"]'))).toBe(5);
  });

  it('merges with the next line on Delete at the line end', () => {
    const { surface, canvas, getSource } = mountSurface('Hello\nWorld');
    surface.activateLine(0, { caret: 5, clearSelection: true });
    placeCaretIn(canvas.querySelector('[data-editor-mode="source"]'), 5);

    const event = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
    expect(surface.handleKeydown(event)).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(getSource()).toBe('HelloWorld');
    expect(surface.activeLine()).toBe(0);
    expect(canvas.querySelectorAll('.classic-line')).toHaveLength(1);
    expect(caretOffsetInSource(canvas.querySelector('[data-editor-mode="source"]'))).toBe(5);
  });

  it('places caret on empty hard lines and navigates Home/End', () => {
    const { surface, canvas } = mountSurface('a\n\nb');
    surface.activateLine(1, { caret: 0, clearSelection: true });
    const empty = canvas.querySelector('[data-editor-mode="source"]');
    expect(empty?.textContent).toBe('');
    // Empty line still receives a caret after navigation/render.
    expect(caretOffsetInSource(empty)).toBe(0);

    surface.activateLine(0, { caret: 0, clearSelection: true });
    placeCaretIn(canvas.querySelector('[data-editor-mode="source"]'), 0);
    const end = new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true });
    expect(surface.handleKeydown(end)).toBe(true);
    expect(caretOffsetInSource(canvas.querySelector('[data-editor-mode="source"]'))).toBe(1);

    const home = new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true });
    expect(surface.handleKeydown(home)).toBe(true);
    expect(caretOffsetInSource(canvas.querySelector('[data-editor-mode="source"]'))).toBe(0);
    expect(surface.preferredColumn()).toBe(0);
  });

  it('animates full-bleed band top+height and cancels prior animation on retarget', () => {
    const queued = [];
    const realRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => {
      queued.push(cb);
      return queued.length;
    };
    const flushRaf = () => {
      while (queued.length) queued.shift()();
    };

    document.body.innerHTML = '<div class="editor-view" id="host"><div id="canvas"></div><div id="band"></div></div>';
    const canvas = document.getElementById('canvas');
    const host = document.getElementById('host');
    const band = document.getElementById('band');
    host.getBoundingClientRect = () => ({ top: 0, left: 0, width: 400, height: 600, right: 400, bottom: 600 });
    Object.defineProperty(host, 'scrollTop', { value: 0, configurable: true });

    let source = 'line0\nline1\nline2';
    const animations = [];
    band.animate = vi.fn((keyframes, options) => {
      const anim = {
        keyframes,
        options,
        cancel: vi.fn(),
        addEventListener: vi.fn(),
      };
      animations.push(anim);
      return anim;
    });

    const surface = createEditorClassicSurface({
      window,
      canvas,
      adapters: {
        isMarkdown: () => true,
        getSource: () => source,
        applySource: (next) => { source = next; return true; },
        setCursor: vi.fn(),
        shouldReduceMotion: () => false,
        getActiveLineBand: () => band,
        getBandHost: () => host,
      },
    });
    const rowMetrics = [
      { top: 10, height: 20 },
      { top: 50, height: 40 },
      { top: 120, height: 22 },
    ];
    const stubRows = () => {
      canvas.querySelectorAll('[data-classic-line]').forEach((row) => {
        const i = row.classicLineIndex;
        const m = rowMetrics[i] || { top: 0, height: 18 };
        row.getBoundingClientRect = () => ({
          top: m.top,
          left: 0,
          width: 400,
          height: m.height,
          right: 400,
          bottom: m.top + m.height,
        });
      });
    };

    surface.mount();
    stubRows();
    flushRaf();

    expect(band.style.width).toBe('100%');
    expect(band.style.left === '0' || band.style.left === '0px').toBe(true);
    expect(band.hidden).toBe(false);
    expect(band.dataset.ready).toBe('1');
    // First paint must not animate (ready was 0).
    expect(band.animate).not.toHaveBeenCalled();

    surface.activateLine(1, { caret: 0, clearSelection: true });
    stubRows();
    flushRaf();
    surface.syncActiveLineBand();
    flushRaf();

    expect(band.animate).toHaveBeenCalled();
    const frames = band.animate.mock.calls.at(-1)[0];
    expect(frames[0].transform).toMatch(/translateY/);
    expect(frames[0].height).toBeDefined();
    expect(frames[1].transform).toBe('translateY(0)');
    expect(frames[1].height).toBeDefined();
    expect(band.style.width).toBe('100%');

    const firstAnim = animations.at(-1);
    band.getBoundingClientRect = () => ({
      top: 70, left: 0, width: 400, height: 30, right: 400, bottom: 100,
    });
    surface.activateLine(2, { caret: 0, clearSelection: true });
    stubRows();
    flushRaf();
    surface.syncActiveLineBand();
    flushRaf();
    expect(firstAnim.cancel).toHaveBeenCalled();
    expect(band.animate.mock.calls.length).toBeGreaterThanOrEqual(2);

    window.requestAnimationFrame = realRaf;
  });

  it('snaps the active-line band without WAAPI when reduce motion is on', () => {
    const queued = [];
    const realRaf = window.requestAnimationFrame;
    window.requestAnimationFrame = (cb) => {
      queued.push(cb);
      return queued.length;
    };
    const flushRaf = () => {
      while (queued.length) queued.shift()();
    };

    document.body.innerHTML = '<div class="editor-view" id="host"><div id="canvas"></div><div id="band"></div></div>';
    const canvas = document.getElementById('canvas');
    const host = document.getElementById('host');
    const band = document.getElementById('band');
    host.getBoundingClientRect = () => ({ top: 0, left: 0, width: 400, height: 600, right: 400, bottom: 600 });
    band.animate = vi.fn();
    let source = 'a\nb\nc';
    const surface = createEditorClassicSurface({
      window,
      canvas,
      adapters: {
        isMarkdown: () => true,
        getSource: () => source,
        applySource: (next) => { source = next; return true; },
        setCursor: vi.fn(),
        shouldReduceMotion: () => true,
        getActiveLineBand: () => band,
        getBandHost: () => host,
      },
    });
    surface.mount();
    canvas.querySelectorAll('[data-classic-line]').forEach((row, i) => {
      row.getBoundingClientRect = () => ({
        top: i * 24, left: 0, width: 400, height: 24, right: 400, bottom: (i + 1) * 24,
      });
    });
    flushRaf();
    band.dataset.ready = '1';
    band.dataset.top = '0';
    band.dataset.height = '20';
    surface.activateLine(1, { caret: 0 });
    canvas.querySelectorAll('[data-classic-line]').forEach((row, i) => {
      row.getBoundingClientRect = () => ({
        top: i * 24, left: 0, width: 400, height: 24, right: 400, bottom: (i + 1) * 24,
      });
    });
    flushRaf();
    surface.syncActiveLineBand();
    flushRaf();
    expect(band.animate).not.toHaveBeenCalled();
    expect(band.style.width).toBe('100%');
    window.requestAnimationFrame = realRaf;
  });

  it('reveals the active line with scrollIntoView on keyboard navigation, not on mount', () => {
    const scrollIntoView = vi.fn();
    const original = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    try {
      const { surface, canvas } = mountSurface('a\nb\nc\nd');
      expect(scrollIntoView).not.toHaveBeenCalled();

      placeCaretIn(canvas.querySelector('[data-editor-mode="source"]'), 0);
      const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      expect(surface.handleKeydown(down)).toBe(true);
      expect(surface.activeLine()).toBe(1);
      expect(scrollIntoView).toHaveBeenCalled();
      const options = scrollIntoView.mock.calls.at(-1)[0];
      expect(options).toMatchObject({ block: 'nearest', inline: 'nearest' });
    } finally {
      if (original) {
        Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
          configurable: true,
          value: original,
        });
      } else {
        delete HTMLElement.prototype.scrollIntoView;
      }
    }
  });

  it('pages by the reader-page viewport height, not the full canvas height', () => {
    document.body.innerHTML = '<section class="reader-page" id="page"><div id="canvas"></div></section>';
    const page = document.getElementById('page');
    const canvas = document.getElementById('canvas');
    Object.defineProperty(page, 'clientHeight', { configurable: true, value: 100 });
    Object.defineProperty(canvas, 'clientHeight', { configurable: true, value: 2000 });

    const lines = Array.from({ length: 40 }, (_v, i) => `line${i}`).join('\n');
    let source = lines;
    const surface = createEditorClassicSurface({
      window,
      canvas,
      adapters: {
        isMarkdown: () => true,
        getSource: () => source,
        applySource: (next) => { source = next; return true; },
        setCursor: vi.fn(),
      },
    });
    surface.mount();
    canvas.querySelectorAll('[data-classic-line]').forEach((row) => {
      row.getBoundingClientRect = () => ({
        top: 0, left: 0, width: 400, height: 20, right: 400, bottom: 20,
      });
    });

    placeCaretIn(canvas.querySelector('[data-editor-mode="source"]'), 0);
    const pageDown = new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true, cancelable: true });
    expect(surface.handleKeydown(pageDown)).toBe(true);
    // step = floor(100 / 20) = 5 — not floor(2000 / 28) which would jump near the end
    expect(surface.activeLine()).toBe(5);
    expect(surface.activeLine()).toBeLessThan(30);
  });

  it('places the caret at the click offset on a preview line, not the line end', () => {
    const { surface, canvas } = mountSurface('Short\nHello world\nTail');
    const previewRow = canvas.children[1];
    const preview = previewRow.querySelector('[data-classic-content]');
    const text = preview.firstChild;
    expect(text).toBeTruthy();
    const clickOffset = 4;
    const range = document.createRange();
    range.setStart(text.nodeType === 3 ? text : preview.childNodes[0], clickOffset);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);

    const event = {
      target: preview,
      clientX: 12,
      clientY: 8,
      preventDefault() { this.defaultPrevented = true; },
    };
    expect(surface.handleClick(event)).toBe(true);
    const active = canvas.querySelector('.is-active-line [data-editor-mode="source"]');
    expect(active?.textContent).toContain('Hello world');
    const caret = caretOffsetInSource(active);
    expect(caret).toBe(clickOffset);
    expect(caret).not.toBe(active.textContent.length);
  });

  it('does not rebuild the typing host during ordinary input or composing input', () => {
    const { surface, canvas, getSource } = mountSurface('Hello');
    const host = canvas.querySelector('[data-editor-mode="source"]');
    host.textContent = 'Hello!';
    placeCaretIn(host, 6);
    expect(surface.handleInput(new InputEvent('input', { bubbles: true, inputType: 'insertText' }))).toBe(true);
    expect(getSource()).toBe('Hello!');
    expect(canvas.querySelector('[data-editor-mode="source"]')).toBe(host);

    host.textContent = 'Hello!ñ';
    const composing = new InputEvent('input', {
      bubbles: true,
      inputType: 'insertCompositionText',
      isComposing: true,
    });
    const before = getSource();
    expect(surface.handleInput(composing)).toBe(true);
    expect(getSource()).toBe(before);
    expect(canvas.querySelector('[data-editor-mode="source"]')).toBe(host);

    const blocked = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    expect(surface.handleKeydown(blocked)).toBe(false);
    expect(blocked.defaultPrevented).toBe(false);
    expect(getSource()).toBe(before);
  });

  it('keeps ArrowDown on the same hard line when the line is visually wrapped', () => {
    const { surface, canvas } = mountSurface(`${'abcdefghij'.repeat(3)}\nnext`);
    const content = canvas.querySelector('[data-editor-mode="source"]');
    content.innerHTML = '<span>abcdefghij</span><span>abcdefghij</span><span>abcdefghij</span>';
    const original = Range.prototype.getClientRects;
    let measurements = 0;
    Range.prototype.getClientRects = function getClientRects() {
      measurements += 1;
      const before = document.createRange();
      before.selectNodeContents(content);
      before.setEnd(this.startContainer, this.startOffset);
      const offset = before.toString().length;
      const top = offset < 10 ? 0 : offset < 20 ? 16 : 32;
      const rect = {
        top, left: offset % 10, bottom: top + 16, right: (offset % 10) + 8, height: 16, width: 8,
      };
      return {
        length: 1,
        0: rect,
        item: (index) => (index === 0 ? rect : undefined),
        [Symbol.iterator]: function* iterate() { yield rect; },
      };
    };
    try {
      placeCaretIn(content.children[0], 4);
      surface.handleKeydown(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
      expect(measurements).toBe(0);
      const down = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      expect(surface.handleKeydown(down)).toBe(true);
      expect(surface.activeLine()).toBe(0);
      expect(caretOffsetInSource(canvas.querySelector('[data-editor-mode="source"]'))).toBe(14);

      placeCaretIn(content.children[1], 4);
      const downFromWrap = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      expect(surface.handleKeydown(downFromWrap)).toBe(true);
      expect(surface.activeLine()).toBe(0);
      const after = caretOffsetInSource(canvas.querySelector('[data-editor-mode="source"]'));
      expect(after).toBe(24);
      expect(after).not.toBe(content.textContent.length);
    } finally {
      Range.prototype.getClientRects = original;
    }
  });
});

function placeCaretIn(element, offset) {
  if (!element.firstChild) element.appendChild(document.createTextNode(element.textContent || ''));
  const text = element.firstChild;
  const range = document.createRange();
  const max = text.textContent?.length || 0;
  range.setStart(text, Math.max(0, Math.min(offset, max)));
  range.collapse(true);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function caretOffsetInSource(element) {
  if (!element) return -1;
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return -1;
  const range = selection.getRangeAt(0);
  if (!element.contains(range.startContainer)) return -1;
  const before = range.cloneRange();
  before.selectNodeContents(element);
  before.setEnd(range.startContainer, range.startOffset);
  return before.toString().length;
}
