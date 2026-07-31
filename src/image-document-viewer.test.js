// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { createImageDocumentViewer } from './image-document-viewer.js';

function fixture() {
  const root = document.createElement('div');
  root.style.width = '400px';
  root.style.height = '300px';
  document.body.append(root);
  Object.defineProperty(root, 'getBoundingClientRect', {
    value: () => ({
      left: 0,
      top: 0,
      width: 400,
      height: 300,
      right: 400,
      bottom: 300,
    }),
  });
  return root;
}

describe('image document viewer', () => {
  it('mounts an image, fits on load, and disposes cleanly', async () => {
    const root = fixture();
    const onScaleChange = vi.fn();

    const viewer = createImageDocumentViewer({
      window,
      root,
      imageUrl: 'blob:test',
      alt: 'Cover',
      padding: 24,
      onScaleChange,
    });

    const img = root.querySelector('.image-document__img');
    expect(img).not.toBeNull();
    expect(img.alt).toBe('Cover');
    expect(root.classList.contains('image-document')).toBe(true);

    Object.defineProperty(img, 'naturalWidth', { value: 200, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 100, configurable: true });
    Object.defineProperty(img, 'complete', { value: true, configurable: true });
    img.dispatchEvent(new Event('load'));

    expect(viewer.getFitScale()).toBe(1);
    expect(viewer.getScale()).toBe(1);
    expect(onScaleChange).toHaveBeenCalled();

    viewer.dispose();
    expect(root.querySelector('.image-document__img')).toBeNull();
    expect(root.classList.contains('image-document')).toBe(false);
  });

  it('zooms with the wheel around the pointer and pans with pointer drag', async () => {
    const root = fixture();
    const viewer = createImageDocumentViewer({
      window,
      root,
      imageUrl: 'blob:test',
      padding: 0,
    });
    const img = root.querySelector('.image-document__img');
    Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true });
    Object.defineProperty(img, 'complete', { value: true, configurable: true });
    img.dispatchEvent(new Event('load'));

    const fit = viewer.getFitScale();
    expect(fit).toBeCloseTo(0.5, 5);
    expect(viewer.getScale()).toBeCloseTo(0.5, 5);

    root.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -200,
      clientX: 200,
      clientY: 150,
      bubbles: true,
      cancelable: true,
    }));
    expect(viewer.getScale()).toBeGreaterThan(fit);

    root.dispatchEvent(new PointerEvent('pointerdown', {
      button: 0,
      pointerId: 1,
      clientX: 100,
      clientY: 100,
      bubbles: true,
    }));
    root.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1,
      clientX: 140,
      clientY: 130,
      bubbles: true,
    }));
    expect(root.classList.contains('is-panning')).toBe(true);
    root.dispatchEvent(new PointerEvent('pointerup', {
      pointerId: 1,
      clientX: 140,
      clientY: 130,
      bubbles: true,
    }));
    expect(root.classList.contains('is-panning')).toBe(false);

    viewer.dispose();
  });

  it('disables zoom transition under reduced motion (F12)', () => {
    const root = fixture();
    const matchMedia = vi.fn((query) => ({
      matches: String(query).includes('prefers-reduced-motion'),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const fakeWindow = { ...window, matchMedia, document, ResizeObserver: window.ResizeObserver };

    const viewer = createImageDocumentViewer({
      window: fakeWindow,
      root,
      imageUrl: 'blob:test',
      animateZoom: true,
    });
    const img = root.querySelector('.image-document__img');
    expect(viewer.prefersReducedMotion()).toBe(true);
    expect(viewer.motionEnabled()).toBe(false);
    expect(img.style.transition).toBe('none');

    Object.defineProperty(img, 'naturalWidth', { value: 200, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 100, configurable: true });
    Object.defineProperty(img, 'complete', { value: true, configurable: true });
    img.dispatchEvent(new Event('load'));

    root.dispatchEvent(new MouseEvent('dblclick', {
      clientX: 200,
      clientY: 150,
      bubbles: true,
      cancelable: true,
    }));
    expect(img.style.transition === 'none' || img.style.transition === '').toBe(true);
    viewer.dispose();
  });

  it('honors defaultZoom 100% after load', () => {
    const root = fixture();
    const viewer = createImageDocumentViewer({
      window,
      root,
      imageUrl: 'blob:test',
      padding: 0,
      defaultZoom: '100%',
    });
    const img = root.querySelector('.image-document__img');
    Object.defineProperty(img, 'naturalWidth', { value: 800, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 600, configurable: true });
    Object.defineProperty(img, 'complete', { value: true, configurable: true });
    img.dispatchEvent(new Event('load'));
    expect(viewer.getScale()).toBe(1);
    viewer.dispose();
  });
});
