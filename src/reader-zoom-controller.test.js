import { describe, expect, it, vi } from 'vitest';
import { createReaderZoomController } from './reader-zoom-controller.js';

function harness() {
  const root = { style: { setProperty: vi.fn() } };
  const document = { documentElement: root };
  const window = {};
  const onZoomChange = vi.fn();
  const onToast = vi.fn();
  const zoom = createReaderZoomController({
    window,
    document,
    hooks: { onZoomChange, onToast },
  });
  return { zoom, root, onZoomChange, onToast };
}

describe('reader zoom controller', () => {
  it('clamps zoom and publishes CSS scale', () => {
    const { zoom, root, onZoomChange, onToast } = harness();
    expect(zoom.setZoom(0.1)).toBe(0.5);
    expect(zoom.setZoom(9)).toBe(3);
    expect(root.style.setProperty).toHaveBeenCalledWith('--content-scale', '3.00');
    expect(onZoomChange).toHaveBeenCalledWith(3);
    expect(onToast).toHaveBeenCalledWith('Zoom: 300%');
  });

  it('handles ctrl-wheel and ignores plain wheel', () => {
    const { zoom } = harness();
    const preventDefault = vi.fn();
    zoom.handleWheel({ ctrlKey: false, deltaY: 100, preventDefault });
    expect(zoom.current()).toBe(1);
    expect(preventDefault).not.toHaveBeenCalled();

    zoom.handleWheel({ ctrlKey: true, deltaY: 100, preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    expect(zoom.current()).toBeLessThan(1);
  });

  it('stops mutating after dispose', () => {
    const { zoom, onZoomChange } = harness();
    onZoomChange.mockClear();
    zoom.dispose();
    expect(zoom.setZoom(2)).toBe(1);
    expect(onZoomChange).not.toHaveBeenCalled();
  });
});
