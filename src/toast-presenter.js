import { MOTION_EASE_EXIT, MOTION_EASE_OUT, MOTION_FAST_MS, shouldReduceMotion } from './reader-motion.js';

const TOAST_RADIUS = 4;
const ENTER_DURATION = 160;
const MORPH_DURATION = 180;
const OUTGOING_DURATION = 120;
const INCOMING_DURATION = 160;
const INCOMING_DELAY = 20;

function ensureToastElement(document, element) {
  const toast = element || document.createElement('div');
  if (!element) {
    toast.id = 'toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.setAttribute('aria-atomic', 'true');
  return toast;
}

function ensureToastLayers(document, toast) {
  const existingMessage = toast.querySelector('.toast-message:not(.toast-message--previous)');
  const initialText = existingMessage?.textContent || toast.textContent || '';
  const surface = toast.querySelector('.toast-surface') || document.createElement('span');
  const previousMessage = toast.querySelector('.toast-message--previous') || document.createElement('span');
  const message = existingMessage || document.createElement('span');

  surface.className = 'toast-surface';
  surface.setAttribute('aria-hidden', 'true');
  previousMessage.className = 'toast-message toast-message--previous';
  previousMessage.setAttribute('aria-hidden', 'true');
  previousMessage.textContent = '';
  message.className = 'toast-message';
  message.removeAttribute('aria-hidden');
  message.textContent = initialText;
  toast.replaceChildren(surface, previousMessage, message);

  return { surface, previousMessage, message };
}

function finiteOpacity(value, fallback = 1) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundedInset(top, right, bottom, left) {
  const clean = (value) => Math.max(0, value).toFixed(2).replace(/\.00$/, '');
  return `inset(${clean(top)}px ${clean(right)}px ${clean(bottom)}px ${clean(left)}px round ${TOAST_RADIUS}px)`;
}

function clipForBox(surface, box) {
  const surfaceBox = surface.getBoundingClientRect();
  if (!(surfaceBox.width > 0) || !(surfaceBox.height > 0)) {
    return `inset(0 round ${TOAST_RADIUS}px)`;
  }
  const width = Math.min(surfaceBox.width, Math.max(0, box.width));
  const height = Math.min(surfaceBox.height, Math.max(0, box.height));
  const horizontal = (surfaceBox.width - width) / 2;
  const vertical = (surfaceBox.height - height) / 2;
  return roundedInset(vertical, horizontal, vertical, horizontal);
}

export function createToastPresenter({
  window,
  document,
  element = null,
  duration = 2000,
  exitDuration = 120,
}) {
  if (!window || !document) throw new TypeError('Toast Presenter requires window and document');

  const toast = ensureToastElement(document, element);
  const { surface, previousMessage, message } = ensureToastLayers(document, toast);
  let timeoutId = null;
  let sequence = 0;
  let animations = [];
  let disposed = false;

  const reducedMotion = () => shouldReduceMotion(window);
  const canAnimate = () => !reducedMotion()
    && typeof surface.animate === 'function'
    && typeof message.animate === 'function';

  const clearPrevious = () => {
    previousMessage.textContent = '';
    previousMessage.style.removeProperty('width');
  };

  const cancelAnimations = ({ invalidate = true, clearOutgoing = true } = {}) => {
    if (invalidate) sequence += 1;
    const active = animations;
    animations = [];
    active.forEach((animation) => animation.cancel());
    toast.classList.remove('is-animating', 'is-leaving');
    if (clearOutgoing) clearPrevious();
  };

  const animate = (target, keyframes, options) => {
    try {
      return target.animate(keyframes, { ...options, fill: 'both' });
    } catch {
      return null;
    }
  };

  const runSequence = (nextAnimations, onFinish) => {
    const currentSequence = ++sequence;
    animations = nextAnimations.filter(Boolean);
    if (!animations.length) {
      onFinish();
      return;
    }
    Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
      if (disposed || currentSequence !== sequence) return;
      const completed = animations;
      animations = [];
      onFinish();
      completed.forEach((animation) => animation.cancel());
    });
  };

  const setSurfaceForCurrentBox = () => {
    const clipPath = clipForBox(surface, toast.getBoundingClientRect());
    surface.style.clipPath = clipPath;
    return clipPath;
  };

  const finishVisibleMotion = () => {
    toast.classList.remove('is-animating', 'is-leaving');
    clearPrevious();
  };

  const enter = () => {
    const targetClip = setSurfaceForCurrentBox();
    if (!canAnimate()) {
      finishVisibleMotion();
      return;
    }
    toast.classList.add('is-animating');
    const surfaceAnimation = animate(surface, [
      {
        clipPath: targetClip,
        opacity: 0,
        transform: 'translate(-50%, calc(-50% + 2px)) scale(0.985)',
      },
      {
        clipPath: targetClip,
        opacity: 1,
        transform: 'translate(-50%, -50%) scale(1)',
      },
    ], { duration: MOTION_FAST_MS, easing: MOTION_EASE_OUT });
    const messageAnimation = animate(message, [
      { opacity: 0, transform: 'translateY(4px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: ENTER_DURATION, easing: MOTION_EASE_OUT });
    runSequence([surfaceAnimation, messageAnimation], finishVisibleMotion);
  };

  const replaceMessage = (nextMessage) => {
    const visibleBox = toast.getBoundingClientRect();
    const candidates = [message, previousMessage].filter((candidate) => candidate.textContent);
    const outgoingElement = candidates.reduce((mostVisible, candidate) => {
      const candidateOpacity = finiteOpacity(window.getComputedStyle(candidate).opacity);
      const currentOpacity = finiteOpacity(window.getComputedStyle(mostVisible).opacity);
      return candidateOpacity > currentOpacity ? candidate : mostVisible;
    }, message);
    const outgoingOpacity = finiteOpacity(window.getComputedStyle(outgoingElement).opacity);
    const outgoingWidth = outgoingElement.getBoundingClientRect().width;
    const outgoingText = outgoingElement.textContent;
    const surfaceStyle = window.getComputedStyle(surface);
    const startClip = surfaceStyle.clipPath && surfaceStyle.clipPath !== 'none'
      ? surfaceStyle.clipPath
      : clipForBox(surface, visibleBox);
    const surfaceOpacity = finiteOpacity(surfaceStyle.opacity);

    cancelAnimations();
    toast.classList.add('show');
    message.textContent = nextMessage;
    previousMessage.textContent = outgoingText;
    if (outgoingWidth > 0) previousMessage.style.width = `${outgoingWidth}px`;
    const targetClip = setSurfaceForCurrentBox();

    if (!canAnimate()) {
      finishVisibleMotion();
      return;
    }

    toast.classList.add('is-animating');
    const surfaceAnimation = animate(surface, [
      {
        clipPath: startClip,
        opacity: surfaceOpacity,
        transform: 'translate(-50%, -50%) scale(1)',
      },
      {
        clipPath: targetClip,
        opacity: 1,
        transform: 'translate(-50%, -50%) scale(1)',
      },
    ], { duration: MORPH_DURATION, easing: MOTION_EASE_OUT });
    const outgoingAnimation = animate(previousMessage, [
      {
        opacity: outgoingOpacity,
        transform: 'translate(-50%, -50%)',
        offset: 0,
        easing: MOTION_EASE_EXIT,
      },
      {
        opacity: 0,
        transform: 'translate(-50%, calc(-50% - 8px))',
        offset: 0.78,
      },
      {
        opacity: 0,
        transform: 'translate(-50%, calc(-50% - 8px))',
        offset: 1,
      },
    ], { duration: OUTGOING_DURATION, easing: 'linear' });
    const incomingAnimation = animate(message, [
      { opacity: 0, transform: 'translateY(8px)', offset: 0 },
      {
        opacity: 0,
        transform: 'translateY(8px)',
        offset: 0.52,
        easing: MOTION_EASE_OUT,
      },
      { opacity: 1, transform: 'translateY(0)', offset: 1 },
    ], {
      duration: INCOMING_DURATION,
      delay: INCOMING_DELAY,
      easing: 'linear',
    });
    runSequence([surfaceAnimation, outgoingAnimation, incomingAnimation], finishVisibleMotion);
  };

  const revive = () => {
    const surfaceStyle = window.getComputedStyle(surface);
    const messageStyle = window.getComputedStyle(message);
    cancelAnimations();
    toast.classList.add('show', 'is-animating');
    if (!canAnimate()) {
      finishVisibleMotion();
      return;
    }
    const surfaceAnimation = animate(surface, [
      { opacity: finiteOpacity(surfaceStyle.opacity), transform: surfaceStyle.transform || 'none' },
      { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' },
    ], { duration: 100, easing: MOTION_EASE_OUT });
    const messageAnimation = animate(message, [
      { opacity: finiteOpacity(messageStyle.opacity), transform: messageStyle.transform || 'none' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 120, easing: MOTION_EASE_OUT });
    runSequence([surfaceAnimation, messageAnimation], finishVisibleMotion);
  };

  const hideImmediately = () => {
    cancelAnimations();
    toast.classList.remove('show', 'is-leaving', 'is-animating');
  };

  const beginExit = () => {
    timeoutId = null;
    if (!toast.classList.contains('show')) return;
    if (!canAnimate() || exitDuration <= 0) {
      hideImmediately();
      return;
    }

    const surfaceStyle = window.getComputedStyle(surface);
    const messageStyle = window.getComputedStyle(message);
    cancelAnimations();
    toast.classList.add('show', 'is-leaving', 'is-animating');
    const surfaceAnimation = animate(surface, [
      { opacity: finiteOpacity(surfaceStyle.opacity), transform: surfaceStyle.transform || 'none' },
      { opacity: 0, transform: 'translate(-50%, calc(-50% - 2px)) scale(0.99)' },
    ], { duration: exitDuration, easing: MOTION_EASE_EXIT });
    const messageAnimation = animate(message, [
      { opacity: finiteOpacity(messageStyle.opacity), transform: messageStyle.transform || 'none' },
      { opacity: 0, transform: 'translateY(-4px)' },
    ], { duration: Math.min(exitDuration, OUTGOING_DURATION), easing: MOTION_EASE_EXIT });
    runSequence([surfaceAnimation, messageAnimation], () => {
      toast.classList.remove('show', 'is-leaving', 'is-animating');
      clearPrevious();
    });
  };

  const scheduleExit = () => {
    window.clearTimeout(timeoutId);
    timeoutId = window.setTimeout(beginExit, duration);
  };

  const show = (nextValue) => {
    if (disposed) return;
    const nextMessage = String(nextValue);
    window.clearTimeout(timeoutId);
    timeoutId = null;
    const isVisible = toast.classList.contains('show');
    const sameMessage = message.textContent === nextMessage;

    if (!isVisible) {
      cancelAnimations();
      message.textContent = nextMessage;
      toast.classList.add('show');
      enter();
    } else if (sameMessage) {
      if (toast.classList.contains('is-leaving')) revive();
    } else {
      replaceMessage(nextMessage);
    }
    scheduleExit();
  };

  const cancel = () => {
    if (disposed) return;
    cancelAnimations();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.clearTimeout(timeoutId);
    timeoutId = null;
    cancelAnimations();
    surface.style.removeProperty('clip-path');
    toast.classList.remove('show', 'is-leaving', 'is-animating');
  };

  return Object.freeze({ show, cancel, dispose, element: toast });
}
