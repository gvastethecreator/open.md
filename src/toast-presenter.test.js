import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { APP_REDUCE_MOTION_CLASS } from './reader-motion.js';
import { createToastPresenter } from './toast-presenter.js';

function fixture({ animate = true, reduced = false } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="toast" class="toast" role="status"><span class="toast-message"></span></div></body>');
  const toast = dom.window.document.querySelector('#toast');
  const originalRect = dom.window.Element.prototype.getBoundingClientRect;
  dom.window.Element.prototype.getBoundingClientRect = function getBoundingClientRect() {
    if (this === toast) {
      const liveMessage = toast.querySelector('.toast-message:not(.toast-message--previous)');
      return { width: 44 + (liveMessage?.textContent.length || 0) * 7, height: 32 };
    }
    if (this.classList?.contains('toast-surface')) return { width: 520, height: 96 };
    if (this.classList?.contains('toast-message')) {
      return { width: (this.textContent.length || 0) * 7, height: 18 };
    }
    return originalRect.call(this);
  };
  dom.window.matchMedia = () => ({ matches: reduced });
  const animations = [];
  if (animate) {
    dom.window.Element.prototype.animate = vi.fn(function animate(keyframes, options) {
      let resolve;
      let settled = false;
      const finished = new Promise((next) => { resolve = next; });
      const settle = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const animation = {
        cancel: vi.fn(settle),
        finished,
        keyframes,
        options,
        element: this,
        resolve: settle,
      };
      animations.push(animation);
      return animation;
    });
  } else {
    dom.window.Element.prototype.animate = undefined;
  }
  return { dom, toast, animations };
}

async function settle(animations) {
  animations.forEach((animation) => animation.resolve());
  await Promise.resolve();
  await Promise.resolve();
}

function liveMessage(toast) {
  return toast.querySelector('.toast-message:not(.toast-message--previous)');
}

function animationsFor(animations, className) {
  return animations.filter((animation) => animation.element.classList.contains(className));
}

describe('Toast Presenter', () => {
  it('shows one accessible message and hides it after the display interval', async () => {
    const { dom, toast } = fixture({ animate: false });
    const presenter = createToastPresenter({
      window: dom.window,
      document: dom.window.document,
      element: toast,
      duration: 5,
      exitDuration: 0,
    });

    presenter.show('Saved');
    expect(toast.classList.contains('show')).toBe(true);
    expect(liveMessage(toast).textContent).toBe('Saved');
    expect(toast.querySelectorAll('.toast-message')).toHaveLength(2);
    expect(toast.querySelector('.toast-message--previous').getAttribute('aria-hidden')).toBe('true');
    await new Promise((resolve) => setTimeout(resolve, 12));
    expect(toast.classList.contains('show')).toBe(false);
  });

  it('morphs a visible replacement with compositor-friendly WAAPI layers', async () => {
    const { dom, toast, animations } = fixture();
    const presenter = createToastPresenter({ window: dom.window, document: dom.window.document, element: toast, duration: 1000 });
    presenter.show('Saved');
    await settle(animations);
    const replacementStart = animations.length;
    presenter.show('Could not save this task');

    const replacementAnimations = animations.slice(replacementStart);
    expect(replacementAnimations).toHaveLength(3);
    expect(toast.querySelectorAll('.toast-message--previous')).toHaveLength(1);
    const [surfaceAnimation] = animationsFor(replacementAnimations, 'toast-surface');
    expect(surfaceAnimation.keyframes.every((frame) => (
      'clipPath' in frame
      && !('width' in frame)
      && !('height' in frame)
      && !('borderRadius' in frame)
      && !('filter' in frame)
    ))).toBe(true);
    const [outgoingAnimation] = replacementAnimations.filter((animation) => animation.element.classList.contains('toast-message--previous'));
    expect(outgoingAnimation.keyframes).toHaveLength(3);
    expect(outgoingAnimation.keyframes[1]).toMatchObject({
      opacity: 0,
      offset: 0.78,
    });
    expect(outgoingAnimation.keyframes.at(-1)).toMatchObject({
      opacity: 0,
      transform: 'translate(-50%, calc(-50% - 8px))',
    });
    const [incomingAnimation] = replacementAnimations.filter((animation) => animation.element === liveMessage(toast));
    expect(incomingAnimation.keyframes[0]).toMatchObject({
      opacity: 0,
      transform: 'translateY(8px)',
    });
    expect(incomingAnimation.keyframes[1]).toMatchObject({
      opacity: 0,
      offset: 0.52,
    });
    expect(incomingAnimation.keyframes.at(-1)).toMatchObject({
      opacity: 1,
      transform: 'translateY(0)',
    });
    await settle(replacementAnimations);
    expect(toast.querySelectorAll('.toast-message--previous')).toHaveLength(1);
    expect(toast.querySelector('.toast-message--previous').textContent).toBe('');
    expect(toast.style.width).toBe('');
    expect(toast.style.height).toBe('');
    presenter.dispose();
  });

  it('uses an instant replacement for reduced motion or missing Web Animations', () => {
    const reduced = fixture({ reduced: true });
    const reducedPresenter = createToastPresenter({ window: reduced.dom.window, document: reduced.dom.window.document, element: reduced.toast });
    reducedPresenter.show('One');
    reducedPresenter.show('Two');
    expect(reduced.animations).toHaveLength(0);
    expect(liveMessage(reduced.toast).textContent).toBe('Two');

    const appReduced = fixture();
    appReduced.dom.window.document.body.classList.add(APP_REDUCE_MOTION_CLASS);
    const appReducedPresenter = createToastPresenter({
      window: appReduced.dom.window,
      document: appReduced.dom.window.document,
      element: appReduced.toast,
    });
    appReducedPresenter.show('One');
    appReducedPresenter.show('Two');
    expect(appReduced.animations).toHaveLength(0);
    expect(liveMessage(appReduced.toast).textContent).toBe('Two');

    const fallback = fixture({ animate: false });
    const fallbackPresenter = createToastPresenter({ window: fallback.dom.window, document: fallback.dom.window.document, element: fallback.toast });
    fallbackPresenter.show('One');
    fallbackPresenter.show('Two');
    expect(fallback.toast.querySelectorAll('.toast-message')).toHaveLength(2);
    expect(liveMessage(fallback.toast).textContent).toBe('Two');
  });

  it('stages the text exit in WAAPI and lets a new message interrupt it', async () => {
    vi.useFakeTimers();
    try {
      const { dom, toast, animations } = fixture();
      const presenter = createToastPresenter({
        window: dom.window,
        document: dom.window.document,
        element: toast,
        duration: 100,
        exitDuration: 40,
      });

      presenter.show('One');
      await settle(animations);
      vi.advanceTimersByTime(100);
      expect(toast.classList.contains('show')).toBe(true);
      expect(toast.classList.contains('is-leaving')).toBe(true);
      const exitAnimations = animations.slice(-2);
      expect(exitAnimations.every((animation) => animation.options.duration <= 140)).toBe(true);

      presenter.show('Two');
      expect(toast.classList.contains('is-leaving')).toBe(false);
      expect(liveMessage(toast).textContent).toBe('Two');
      expect(exitAnimations.every((animation) => animation.cancel.mock.calls.length > 0)).toBe(true);

      vi.advanceTimersByTime(99);
      expect(toast.classList.contains('show')).toBe(true);
      vi.advanceTimersByTime(1);
      await settle(animations.slice(-2));
      expect(toast.classList.contains('show')).toBe(false);
      expect(toast.classList.contains('is-leaving')).toBe(false);
      presenter.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels rapid morphs and disposes all temporary state', () => {
    const { dom, toast, animations } = fixture();
    const presenter = createToastPresenter({ window: dom.window, document: dom.window.document, element: toast });
    presenter.show('One');
    presenter.show('Two');
    presenter.show('Three');
    expect(animations.slice(0, -3).every((animation) => animation.cancel.mock.calls.length > 0)).toBe(true);

    presenter.dispose();
    expect(toast.classList.contains('show')).toBe(false);
    expect(toast.querySelectorAll('.toast-message--previous')).toHaveLength(1);
    expect(toast.querySelector('.toast-message--previous').textContent).toBe('');
    expect(animations.every((animation) => animation.cancel.mock.calls.length > 0)).toBe(true);
  });

  it('keeps a truly transparent message from winning rapid replacement visibility', () => {
    const { dom, toast } = fixture();
    const presenter = createToastPresenter({ window: dom.window, document: dom.window.document, element: toast });
    presenter.show('One');
    presenter.show('Two');
    const current = liveMessage(toast);
    const visiblePrevious = toast.querySelector('.toast-message--previous');
    const computedStyle = vi.spyOn(dom.window, 'getComputedStyle').mockImplementation((element) => ({
      opacity: element === current ? '0' : element === visiblePrevious ? '0.75' : '1',
      filter: 'none',
      clipPath: 'inset(32px 230px round 4px)',
      transform: element === visiblePrevious ? 'matrix(1, 0, 0, 1, -20, -9)' : 'none',
    }));

    presenter.show('Three');

    expect(toast.querySelector('.toast-message--previous')?.textContent).toBe('One');
    computedStyle.mockRestore();
    presenter.dispose();
  });
});
