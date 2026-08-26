import { MOTION_EASE_OUT, MOTION_FAST_MS, shouldReduceMotion } from './reader-motion.js';

const DEFAULT_PADDING = 24;
const MIN_SCALE = 0.05;
const MAX_SCALE = 32;
const ZOOM_SENSITIVITY = 0.0015;
const ZOOM_TRANSITION = `transform ${MOTION_FAST_MS}ms ${MOTION_EASE_OUT}`;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Lightweight pan/zoom surface for a standalone image document.
 * Default view is centered and fit-to-window with padding (no upscale past 1×).
 * Zoom transitions ease unless reduced motion is on or animateZoom is false.
 */
export function createImageDocumentViewer({
  window,
  root,
  imageUrl,
  alt = '',
  padding = DEFAULT_PADDING,
  onScaleChange,
  animateZoom = true,
  defaultZoom = 'fit',
} = {}) {
  if (!window || !root || typeof imageUrl !== 'string' || !imageUrl) {
    throw new TypeError('Image document viewer requires window, root, and imageUrl');
  }

  const { document } = window;
  const motionEnabled = () => Boolean(animateZoom) && !shouldReduceMotion(window);
  const img = document.createElement('img');
  img.className = 'image-document__img';
  img.alt = typeof alt === 'string' ? alt : '';
  img.draggable = false;
  img.decoding = 'async';
  img.src = imageUrl;
  img.style.transition = motionEnabled() ? ZOOM_TRANSITION : 'none';

  root.classList.add('image-document');
  root.replaceChildren(img);
  root.tabIndex = -1;

  let naturalWidth = 0;
  let naturalHeight = 0;
  let scale = 1;
  let fitScale = 1;
  let translateX = 0;
  let translateY = 0;
  let dragging = false;
  let dragPointerId = null;
  let lastPointerX = 0;
  let lastPointerY = 0;
  let disposed = false;
  let ready = false;
  let wheelBurstTimer = null;

  const publishScale = () => {
    onScaleChange?.(scale, fitScale);
  };

  const applyTransform = ({ animate = false } = {}) => {
    if (!motionEnabled() || !animate) {
      img.style.transition = 'none';
    } else {
      img.style.transition = ZOOM_TRANSITION;
    }
    img.style.transform = `translate(${translateX}px, ${translateY}px) scale(${scale})`;
  };

  const viewportSize = () => {
    const rect = root.getBoundingClientRect();
    return {
      width: Math.max(1, rect.width),
      height: Math.max(1, rect.height),
    };
  };

  const computeFitScale = () => {
    if (!naturalWidth || !naturalHeight) return 1;
    const { width, height } = viewportSize();
    const pad = Math.max(0, Number(padding) || 0);
    const availableWidth = Math.max(1, width - pad * 2);
    const availableHeight = Math.max(1, height - pad * 2);
    return Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight);
  };

  const centerAtScale = (nextScale, { animate = false } = {}) => {
    const { width, height } = viewportSize();
    scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    translateX = (width - naturalWidth * scale) / 2;
    translateY = (height - naturalHeight * scale) / 2;
    applyTransform({ animate });
    publishScale();
  };

  const fitToWindow = ({ animate = false } = {}) => {
    fitScale = computeFitScale();
    centerAtScale(fitScale, { animate });
  };

  const zoomAt = (clientX, clientY, nextScale, { animate = false } = {}) => {
    const clamped = clamp(nextScale, MIN_SCALE, MAX_SCALE);
    if (clamped === scale) return;

    const rect = root.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const imageX = (localX - translateX) / scale;
    const imageY = (localY - translateY) / scale;

    scale = clamped;
    translateX = localX - imageX * scale;
    translateY = localY - imageY * scale;
    applyTransform({ animate });
    publishScale();
  };

  const onWheel = (event) => {
    if (disposed || !ready) return;
    event.preventDefault();
    event.stopPropagation();
    // Continuous wheel: snap transforms; short ease only after a pause if motion allowed.
    if (wheelBurstTimer != null) window.clearTimeout(wheelBurstTimer);
    img.style.transition = 'none';
    const factor = Math.exp(-event.deltaY * ZOOM_SENSITIVITY);
    zoomAt(event.clientX, event.clientY, scale * factor, { animate: false });
    if (motionEnabled()) {
      wheelBurstTimer = window.setTimeout(() => {
        wheelBurstTimer = null;
        if (!disposed) img.style.transition = ZOOM_TRANSITION;
      }, 80);
    }
  };

  const onPointerDown = (event) => {
    if (disposed || !ready || event.button !== 0) return;
    dragging = true;
    dragPointerId = event.pointerId;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    root.classList.add('is-panning');
    root.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  };

  const onPointerMove = (event) => {
    if (!dragging || event.pointerId !== dragPointerId) return;
    const dx = event.clientX - lastPointerX;
    const dy = event.clientY - lastPointerY;
    lastPointerX = event.clientX;
    lastPointerY = event.clientY;
    translateX += dx;
    translateY += dy;
    applyTransform({ animate: false });
  };

  const endDrag = (event) => {
    if (!dragging || (event && event.pointerId !== dragPointerId)) return;
    dragging = false;
    dragPointerId = null;
    root.classList.remove('is-panning');
  };

  const onDoubleClick = (event) => {
    if (disposed || !ready) return;
    event.preventDefault();
    const nearFit = Math.abs(scale - fitScale) < 0.02;
    if (nearFit) {
      zoomAt(event.clientX, event.clientY, Math.min(MAX_SCALE, fitScale * 2), { animate: true });
    } else {
      fitToWindow({ animate: true });
    }
  };

  const onResize = () => {
    if (disposed || !ready) return;
    const wasFit = Math.abs(scale - fitScale) < 0.02;
    fitScale = computeFitScale();
    if (wasFit) centerAtScale(fitScale);
  };

  const resizeObserver = typeof window.ResizeObserver === 'function'
    ? new window.ResizeObserver(onResize)
    : null;

  root.addEventListener('wheel', onWheel, { passive: false });
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', endDrag);
  root.addEventListener('pointercancel', endDrag);
  root.addEventListener('lostpointercapture', endDrag);
  root.addEventListener('dblclick', onDoubleClick);
  resizeObserver?.observe(root);

  const settle = () => {
    if (disposed) return;
    naturalWidth = img.naturalWidth || 1;
    naturalHeight = img.naturalHeight || 1;
    ready = true;
    fitScale = computeFitScale();
    if (defaultZoom === '100%' || defaultZoom === '1:1') {
      centerAtScale(1, { animate: false });
    } else {
      fitToWindow({ animate: false });
    }
  };

  if (img.complete && img.naturalWidth > 0) {
    settle();
  } else {
    img.addEventListener('load', settle, { once: true });
    img.addEventListener('error', () => {
      if (disposed) return;
      ready = false;
      root.replaceChildren();
      const message = document.createElement('p');
      message.className = 'image-document__error';
      message.setAttribute('role', 'status');
      message.textContent = 'Could not display this image';
      root.append(message);
    }, { once: true });
  }

  return Object.freeze({
    fit: () => {
      if (!disposed && ready) fitToWindow({ animate: true });
    },
    actualSize: () => {
      if (!disposed && ready) centerAtScale(1, { animate: true });
    },
    setScale: (nextScale, options = {}) => {
      if (disposed || !ready) return;
      const { width, height } = viewportSize();
      zoomAt(width / 2 + root.getBoundingClientRect().left, height / 2 + root.getBoundingClientRect().top, nextScale, {
        animate: Boolean(options.animate),
      });
    },
    getScale: () => scale,
    getFitScale: () => fitScale,
    getState: () => Object.freeze({
      ready,
      naturalWidth,
      naturalHeight,
      scale,
      fitScale,
      imageUrl,
    }),
    prefersReducedMotion: () => shouldReduceMotion(window),
    motionEnabled,
    dispose() {
      if (disposed) return;
      disposed = true;
      dragging = false;
      if (wheelBurstTimer != null) window.clearTimeout(wheelBurstTimer);
      wheelBurstTimer = null;
      resizeObserver?.disconnect();
      root.removeEventListener('wheel', onWheel);
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerup', endDrag);
      root.removeEventListener('pointercancel', endDrag);
      root.removeEventListener('lostpointercapture', endDrag);
      root.removeEventListener('dblclick', onDoubleClick);
      root.classList.remove('image-document', 'is-panning');
      root.replaceChildren();
    },
  });
}
