// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditorCaretTrail } from './editor-caret-trail.js';

function makeCanvas() {
  const canvas = document.createElement('canvas');
  const calls = { clear: 0, fill: 0 };
  const ctx = {
    clearRect: () => { calls.clear += 1; },
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    closePath: () => {},
    fill: () => { calls.fill += 1; },
  };
  canvas.getContext = () => ctx;
  canvas.hidden = true;
  document.body.appendChild(canvas);
  return { canvas, calls };
}

describe('editor caret trail', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('starts on moveTo and stops under reduce motion without leaving a runaway loop', () => {
    const { canvas } = makeCanvas();
    let reduce = false;
    const rafQueue = [];
    const win = {
      ...window,
      innerWidth: 800,
      innerHeight: 600,
      requestAnimationFrame: (cb) => {
        rafQueue.push(cb);
        return rafQueue.length;
      },
      cancelAnimationFrame: (id) => {
        /* no-op for token cancel */
        void id;
      },
      setTimeout: window.setTimeout.bind(window),
      clearTimeout: window.clearTimeout.bind(window),
      getComputedStyle: () => ({ getPropertyValue: () => '#7c6af7' }),
      addEventListener: () => {},
      removeEventListener: () => {},
      matchMedia: () => ({ matches: false }),
    };
    const trail = createEditorCaretTrail({
      window: win,
      canvas,
      adapters: { shouldReduceMotion: () => reduce },
    });

    trail.moveTo(10, 20, 18, 2);
    expect(trail.isVisible()).toBe(true);
    expect(canvas.hidden).toBe(false);
    // Drain a few frames — token must not re-enter infinitely when rAF is sync-queued.
    let steps = 0;
    while (rafQueue.length && steps < 5) {
      const cb = rafQueue.shift();
      cb();
      steps += 1;
    }
    expect(steps).toBeGreaterThan(0);
    expect(steps).toBeLessThanOrEqual(5);

    reduce = true;
    trail.moveTo(30, 40, 18, 2);
    expect(trail.isVisible()).toBe(false);
    expect(canvas.hidden).toBe(true);

    trail.dispose();
  });

  it('hides and stops the loop after idle timeout', () => {
    vi.useFakeTimers();
    const { canvas } = makeCanvas();
    const rafQueue = [];
    const win = {
      innerWidth: 800,
      innerHeight: 600,
      requestAnimationFrame: (cb) => {
        rafQueue.push(cb);
        return rafQueue.length;
      },
      cancelAnimationFrame: () => {},
      setTimeout: (...args) => window.setTimeout(...args),
      clearTimeout: (...args) => window.clearTimeout(...args),
      getComputedStyle: () => ({ getPropertyValue: () => '#abc' }),
      addEventListener: () => {},
      removeEventListener: () => {},
      document,
    };
    const trail = createEditorCaretTrail({
      window: win,
      canvas,
      adapters: { shouldReduceMotion: () => false },
    });

    trail.moveTo(12, 24, 16, 2);
    expect(trail.isVisible()).toBe(true);
    vi.advanceTimersByTime(250);
    expect(trail.isVisible()).toBe(false);
    expect(canvas.hidden).toBe(true);
    trail.dispose();
  });

  it('dispose stops further motion even if rAF is synchronous', () => {
    const { canvas } = makeCanvas();
    const timeouts = [];
    const trail = createEditorCaretTrail({
      window: {
        innerWidth: 100,
        innerHeight: 100,
        requestAnimationFrame: (cb) => {
          // Sync re-entry yields to setTimeout(0).
          cb();
          return 1;
        },
        cancelAnimationFrame: () => {},
        setTimeout: (fn) => {
          timeouts.push(fn);
          return timeouts.length;
        },
        clearTimeout: (id) => {
          const index = Number(id) - 1;
          if (index >= 0) timeouts[index] = null;
        },
        getComputedStyle: () => ({ getPropertyValue: () => '' }),
        addEventListener: () => {},
        removeEventListener: () => {},
        document: { hidden: false, addEventListener: () => {}, removeEventListener: () => {} },
      },
      canvas,
      adapters: { shouldReduceMotion: () => false },
    });
    trail.moveTo(1, 2, 10, 2);
    expect(trail.isVisible()).toBe(true);
    trail.dispose();
    // Deferred frames must be cleared — draining must not resurrect the trail.
    timeouts.filter(Boolean).forEach((fn) => fn());
    trail.moveTo(5, 6, 10, 2);
    expect(trail.isVisible()).toBe(false);
  });

  it('stops and ignores moveTo while the document is hidden', () => {
    const { canvas } = makeCanvas();
    const doc = {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const pendingTimeouts = [];
    const trail = createEditorCaretTrail({
      window: {
        innerWidth: 200,
        innerHeight: 200,
        requestAnimationFrame: (cb) => {
          pendingTimeouts.push(cb);
          return pendingTimeouts.length;
        },
        cancelAnimationFrame: () => {},
        // Do not run idle stop synchronously — only queue.
        setTimeout: (fn) => {
          pendingTimeouts.push(fn);
          return pendingTimeouts.length;
        },
        clearTimeout: () => {},
        getComputedStyle: () => ({ getPropertyValue: () => '#fff' }),
        addEventListener: () => {},
        removeEventListener: () => {},
        document: doc,
      },
      canvas,
      adapters: { shouldReduceMotion: () => false },
    });

    trail.moveTo(8, 9, 16, 2);
    expect(trail.isVisible()).toBe(true);

    doc.hidden = true;
    const onVis = doc.addEventListener.mock.calls.find((c) => c[0] === 'visibilitychange')?.[1];
    expect(typeof onVis).toBe('function');
    onVis();
    expect(trail.isVisible()).toBe(false);

    trail.moveTo(20, 30, 16, 2);
    expect(trail.isVisible()).toBe(false);
    trail.dispose();
  });
});
