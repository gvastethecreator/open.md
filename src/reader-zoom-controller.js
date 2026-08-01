const DEFAULT_STEP = 0.1;
const DEFAULT_MIN = 0.5;
const DEFAULT_MAX = 3.0;

export function calculateNewZoom(current, deltaY, step, min, max) {
  const next = deltaY < 0 ? current + step : current - step;
  return Math.min(Math.max(next, min), max);
}

/**
 * Owns content zoom scale, wheel gesture policy, and status coupling hooks.
 */
export function createReaderZoomController({
  window,
  document,
  step = DEFAULT_STEP,
  min = DEFAULT_MIN,
  max = DEFAULT_MAX,
  hooks = {},
} = {}) {
  if (!window || !document) {
    throw new TypeError('Reader Zoom Controller requires window and document');
  }

  let zoom = 1;
  let disposed = false;

  const publish = () => {
    document.documentElement?.style?.setProperty?.('--content-scale', zoom.toFixed(2));
    hooks.onZoomChange?.(zoom);
  };

  const setZoom = (nextZoom) => {
    if (disposed) return zoom;
    const clamped = Math.min(Math.max(Number(nextZoom) || 1, min), max);
    zoom = clamped;
    publish();
    hooks.onToast?.(`Zoom: ${Math.round(zoom * 100)}%`);
    return zoom;
  };

  const handleWheel = (event) => {
    if (disposed || !event?.ctrlKey) return;
    event.preventDefault?.();
    setZoom(calculateNewZoom(zoom, event.deltaY, step, min, max));
  };

  publish();

  return Object.freeze({
    current: () => zoom,
    percent: () => zoom * 100,
    setZoom,
    zoomIn: () => setZoom(zoom + step),
    zoomOut: () => setZoom(zoom - step),
    reset: () => setZoom(1),
    handleWheel,
    dispose() {
      disposed = true;
    },
  });
}
