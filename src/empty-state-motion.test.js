// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEmptyStateMotion } from './empty-state-motion.js';

afterEach(() => vi.useRealTimers());

function animationEnd(name) {
  const event = new Event('animationend', { bubbles: true });
  Object.defineProperty(event, 'animationName', { value: name });
  return event;
}

describe('Empty State Motion', () => {
  it('owns delayed boot, busy filtering, hover replay and disposal', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="shell"><span></span></div><button id="open"></button>';
    const shell = document.querySelector('#shell');
    const openButton = document.querySelector('#open');
    const styleFlush = vi.fn(() => 0);
    Object.defineProperty(shell, 'offsetWidth', { configurable: true, get: styleFlush });
    const motion = createEmptyStateMotion({
      window,
      shell,
      openButton,
      isEmpty: () => true,
    });

    expect(motion.start()).toBe(true);
    expect(motion.start()).toBe(false);
    vi.advanceTimersByTime(1999);
    expect(shell.classList.contains('is-shimmering')).toBe(false);
    vi.advanceTimersByTime(1);
    expect(shell.classList.contains('is-shimmering')).toBe(true);
    expect(styleFlush).toHaveBeenCalledOnce();
    openButton.dispatchEvent(new Event('mouseenter'));
    expect(styleFlush).toHaveBeenCalledOnce();

    shell.dispatchEvent(animationEnd('another-animation'));
    expect(shell.classList.contains('is-shimmering')).toBe(true);
    shell.dispatchEvent(animationEnd('empty-logo-shimmer'));
    expect(shell.classList.contains('is-shimmering')).toBe(false);

    openButton.dispatchEvent(new Event('mouseenter'));
    expect(shell.classList.contains('is-shimmering')).toBe(true);
    expect(styleFlush).toHaveBeenCalledTimes(2);
    motion.dispose();
    expect(shell.classList.contains('is-shimmering')).toBe(false);
    openButton.dispatchEvent(new Event('mouseenter'));
    expect(shell.classList.contains('is-shimmering')).toBe(false);
  });

  it('skips the boot timer outside the empty state but keeps hover playback', () => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="shell"></div><button id="open"></button>';
    const shell = document.querySelector('#shell');
    const openButton = document.querySelector('#open');
    const motion = createEmptyStateMotion({
      window,
      shell,
      openButton,
      isEmpty: () => false,
    });
    motion.start();
    vi.runAllTimers();
    expect(shell.classList.contains('is-shimmering')).toBe(false);
    openButton.dispatchEvent(new Event('mouseenter'));
    expect(shell.classList.contains('is-shimmering')).toBe(true);
    motion.dispose();
  });
});
