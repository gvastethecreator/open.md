import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { createToastPresenter } from './toast-presenter.js';

function fixture({ animate = true, reduced = false } = {}) {
  const dom = new JSDOM('<!doctype html><body><div id="toast" class="toast" role="status"><span class="toast-message"></span></div></body>');
  const toast = dom.window.document.querySelector('#toast');
  toast.getBoundingClientRect = () => ({
    width: 44 + (toast.querySelector('.toast-message')?.textContent.length || 0) * 7,
    height: 32,
  });
  dom.window.matchMedia = () => ({ matches: reduced });
  const animations = [];
  if (animate) {
    const install = (element) => {
      element.animate = vi.fn((keyframes, options) => {
        let resolve;
        const finished = new Promise((next) => { resolve = next; });
        const animation = { cancel: vi.fn(), finished, keyframes, options, resolve };
        animations.push(animation);
        return animation;
      });
    };
    install(toast);
    install(toast.querySelector('.toast-message'));
    const originalClone = dom.window.Element.prototype.cloneNode;
    dom.window.Element.prototype.cloneNode = function cloneNode(...args) {
      const clone = originalClone.apply(this, args);
      install(clone);
      return clone;
    };
  }
  return { dom, toast, animations };
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
    expect(toast.querySelector('.toast-message').textContent).toBe('Saved');
    expect(toast.querySelectorAll('.toast-message')).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 12));
    expect(toast.classList.contains('show')).toBe(false);
  });

  it('morphs a visible replacement and cleans the outgoing message', async () => {
    const { dom, toast, animations } = fixture();
    const presenter = createToastPresenter({ window: dom.window, document: dom.window.document, element: toast, duration: 1000 });
    presenter.show('Saved');
    presenter.show('Could not save this task');

    expect(animations).toHaveLength(3);
    expect(toast.querySelectorAll('.toast-message--previous')).toHaveLength(1);
    expect(animations[0].keyframes.every((frame) => !('borderRadius' in frame))).toBe(true);
    expect(animations[1].keyframes.at(-1)).toMatchObject({
      opacity: 0,
      transform: 'translateY(-5px)',
    });
    expect(animations[2].keyframes[0]).toMatchObject({
      opacity: 0,
      transform: 'translateY(5px)',
    });
    expect(animations[2].keyframes.at(-1)).toMatchObject({
      opacity: 1,
      transform: 'translateY(0)',
    });
    animations.forEach((animation) => animation.resolve());
    await Promise.resolve();
    await Promise.resolve();
    expect(toast.querySelectorAll('.toast-message--previous')).toHaveLength(0);
    expect(toast.style.width).toBe('');
    presenter.dispose();
  });

  it('uses an instant replacement for reduced motion or missing Web Animations', () => {
    const reduced = fixture({ reduced: true });
    const reducedPresenter = createToastPresenter({ window: reduced.dom.window, document: reduced.dom.window.document, element: reduced.toast });
    reducedPresenter.show('One');
    reducedPresenter.show('Two');
    expect(reduced.animations).toHaveLength(0);
    expect(reduced.toast.textContent).toBe('Two');

    const fallback = fixture({ animate: false });
    const fallbackPresenter = createToastPresenter({ window: fallback.dom.window, document: fallback.dom.window.document, element: fallback.toast });
    fallbackPresenter.show('One');
    fallbackPresenter.show('Two');
    expect(fallback.toast.querySelectorAll('.toast-message')).toHaveLength(1);
  });

  it('stages the text exit and lets a new message interrupt it', () => {
    vi.useFakeTimers();
    try {
      const { dom, toast } = fixture({ animate: false });
      const presenter = createToastPresenter({
        window: dom.window,
        document: dom.window.document,
        element: toast,
        duration: 100,
        exitDuration: 40,
      });

      presenter.show('One');
      vi.advanceTimersByTime(100);
      expect(toast.classList.contains('show')).toBe(true);
      expect(toast.classList.contains('is-leaving')).toBe(true);

      presenter.show('Two');
      expect(toast.classList.contains('is-leaving')).toBe(false);
      expect(toast.querySelector('.toast-message').textContent).toBe('Two');

      vi.advanceTimersByTime(140);
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
    expect(animations.slice(0, 3).every((animation) => animation.cancel.mock.calls.length > 0)).toBe(true);

    presenter.dispose();
    expect(toast.classList.contains('show')).toBe(false);
    expect(toast.querySelectorAll('.toast-message--previous')).toHaveLength(0);
    expect(animations.every((animation) => animation.cancel.mock.calls.length > 0)).toBe(true);
  });

  it('keeps a truly transparent message from winning rapid replacement visibility', () => {
    const { dom, toast } = fixture();
    const presenter = createToastPresenter({ window: dom.window, document: dom.window.document, element: toast });
    presenter.show('One');
    presenter.show('Two');
    const current = toast.querySelector('.toast-message');
    const visiblePrevious = toast.querySelector('.toast-message--previous');
    const computedStyle = vi.spyOn(dom.window, 'getComputedStyle').mockImplementation((element) => ({
      opacity: element === current ? '0' : element === visiblePrevious ? '0.75' : '1',
      filter: 'none',
      borderRadius: '10px',
    }));

    presenter.show('Three');

    expect(toast.querySelector('.toast-message--previous')?.textContent).toBe('One');
    computedStyle.mockRestore();
    presenter.dispose();
  });
});
