// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { createEditorClassicSurface } from './editor-classic-surface.js';

function mountSurface(initial = '# Title\n\nHello **world**\n\n- item') {
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
    },
  });
  surface.mount();
  return { surface, canvas, applySource, setCursor, getSource: () => source };
}

describe('Editor Classic Surface', () => {
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

  it('splits lines on Enter and keeps continuous host', () => {
    const { surface, canvas, applySource, getSource } = mountSurface('Hello');
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
    expect(getSource()).toBe('He\nllo');
    expect(canvas.contentEditable).toBe('true');
    expect(canvas.querySelectorAll('.classic-line')).toHaveLength(2);
    expect(canvas.querySelectorAll('[data-editor-mode="source"]')).toHaveLength(1);
  });
});
