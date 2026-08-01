import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createScrollbarVisibilityController } from './scrollbar-visibility-controller.js';

function fixture() {
  const dom = new JSDOM('<!doctype html><html><body><section id="page" class="reader-page"></section></body></html>');
  const page = dom.window.document.querySelector('#page');
  const controller = createScrollbarVisibilityController({
    window: dom.window,
    document: dom.window.document,
    roots: [page],
    showDelay: 280,
    hideDelay: 420,
    scrollHold: 720,
  });
  controller.start();
  return { dom, page, controller };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('Scrollbar Visibility Controller', () => {
  it('shows after a hover delay and hides after leave delay', async () => {
    vi.useFakeTimers();
    const { page, controller } = fixture();

    page.dispatchEvent(new page.ownerDocument.defaultView.PointerEvent('pointerenter', { bubbles: true }));
    expect(page.classList.contains('is-scrollbar-visible')).toBe(false);
    await vi.advanceTimersByTimeAsync(279);
    expect(page.classList.contains('is-scrollbar-visible')).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(page.classList.contains('is-scrollbar-visible')).toBe(true);

    page.dispatchEvent(new page.ownerDocument.defaultView.PointerEvent('pointerleave', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(419);
    expect(page.classList.contains('is-scrollbar-visible')).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(page.classList.contains('is-scrollbar-visible')).toBe(false);

    controller.dispose();
  });

  it('cancels hide and reverses when the pointer re-enters during the hide delay', async () => {
    vi.useFakeTimers();
    const { page, controller } = fixture();

    page.dispatchEvent(new page.ownerDocument.defaultView.PointerEvent('pointerenter', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(280);
    expect(page.classList.contains('is-scrollbar-visible')).toBe(true);

    page.dispatchEvent(new page.ownerDocument.defaultView.PointerEvent('pointerleave', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(200);
    expect(page.classList.contains('is-scrollbar-visible')).toBe(true);

    // Re-enter: cancel hide — class stays on (CSS reverse, no hard cut).
    page.dispatchEvent(new page.ownerDocument.defaultView.PointerEvent('pointerenter', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(500);
    expect(page.classList.contains('is-scrollbar-visible')).toBe(true);

    controller.dispose();
  });

  it('cancels a pending show when the pointer leaves before the delay', async () => {
    vi.useFakeTimers();
    const { page, controller } = fixture();

    page.dispatchEvent(new page.ownerDocument.defaultView.PointerEvent('pointerenter', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(100);
    page.dispatchEvent(new page.ownerDocument.defaultView.PointerEvent('pointerleave', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(400);
    expect(page.classList.contains('is-scrollbar-visible')).toBe(false);

    controller.dispose();
  });

  it('shows promptly while scrolling and releases after the hold window', async () => {
    vi.useFakeTimers();
    const { page, controller } = fixture();

    page.dispatchEvent(new page.ownerDocument.defaultView.Event('scroll', { bubbles: true }));
    expect(page.classList.contains('is-scrollbar-visible')).toBe(true);
    await vi.advanceTimersByTimeAsync(719);
    expect(page.classList.contains('is-scrollbar-visible')).toBe(true);
    await vi.advanceTimersByTimeAsync(1 + 420);
    expect(page.classList.contains('is-scrollbar-visible')).toBe(false);

    controller.dispose();
  });
});
