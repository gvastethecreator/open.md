// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { createEditorCaretMotion } from './editor-caret-motion.js';

let motion;
afterEach(() => {
  motion?.unmount();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function fixture() {
  document.body.innerHTML = '<div class="editor-view"><div class="editor-canvas" tabindex="0"><div data-classic-line="0"><span data-classic-content>Text</span></div></div></div>';
  const canvas = document.querySelector('.editor-canvas');
  const row = canvas.firstElementChild;
  row.classicLineIndex = 0;
  canvas.focus();
  canvas.getBoundingClientRect = () => ({ left: 50, right: 450, top: 0, bottom: 400 });
  canvas.parentElement.getBoundingClientRect = () => ({ left: 0, right: 500, top: 0, bottom: 400 });
  let rect = { left: 110, top: 30, height: 20 };
  let enabled = true;
  let reduced = false;
  const selection = {
    isCollapsed: true, rangeCount: 1, focusNode: row.firstElementChild.firstChild,
    getRangeAt: () => ({ cloneRange: () => ({ collapse() {}, getClientRects: () => [rect] }) }),
  };
  vi.spyOn(window, 'getSelection').mockReturnValue(selection);
  const queued = new Map();
  let id = 0;
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    queued.set(++id, callback);
    return id;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((key) => queued.delete(key));
  const flush = () => {
    const callbacks = [...queued.values()];
    queued.clear();
    callbacks.forEach((callback) => callback());
  };
  motion = createEditorCaretMotion({ window, canvas, isEnabled: () => enabled, shouldReduceMotion: () => reduced });
  motion.mount();
  const caret = document.querySelector('.editor-caret-slide');
  const trail = document.querySelector('.editor-caret-gradient');
  const animations = [];
  caret.animate = vi.fn((frames, options) => {
    const animation = { cancel: vi.fn(), onfinish: null, frames, options };
    animations.push(animation);
    return animation;
  });
  trail.animate = vi.fn(() => ({ cancel: vi.fn() }));
  flush();
  const move = (line, left, top) => {
    row.classicLineIndex = line;
    rect = { left, top, height: 20 };
    document.dispatchEvent(new Event('selectionchange'));
    flush();
  };
  return {
    canvas, caret, trail, animations, selection, flush, move,
    disable: () => { enabled = false; motion.refresh(); flush(); },
    reduce: () => { reduced = true; motion.refresh(); flush(); },
  };
}

describe('editor caret motion', () => {
  it('exits right when moving down and enters the destination from the left with a trail', () => {
    const view = fixture();
    view.move(1, 160, 70);
    const { frames } = view.animations[0];
    expect(frames[1].transform).toBe('translate3d(464px, 30px, 0)');
    expect(frames[2].transform).toBe('translate3d(-2px, 70px, 0)');
    expect(frames[1].offset).toBe(frames[2].offset);
    expect(frames.at(-1).transform).toBe('translate3d(110px, 70px, 0)');
    expect(view.trail.animate).toHaveBeenCalled();
    expect(view.canvas.querySelector('[data-classic-content]').classList.contains('is-caret-sliding')).toBe(true);
    expect(view.canvas.classList.contains('is-caret-sliding')).toBe(false);
    view.animations[0].onfinish();
    expect(view.canvas.querySelector('[data-classic-content]').classList.contains('is-caret-sliding')).toBe(false);
  });

  it('reverses the exit and entry edges when moving up', () => {
    const view = fixture();
    view.move(1, 160, 70);
    view.animations[0].onfinish();
    view.move(0, 120, 30);
    const { frames } = view.animations[1];
    expect(frames[1].transform).toBe('translate3d(-64px, 70px, 0)');
    expect(frames[2].transform).toBe('translate3d(402px, 30px, 0)');
    expect(view.caret.dataset.direction).toBe('left');
  });

  it('moves directly on one visual line, but wraps across edges on a soft-wrapped line', () => {
    const view = fixture();
    view.move(0, 130, 30);
    expect(view.animations[0].frames.map((frame) => frame.transform)).toEqual([
      'translate3d(60px, 30px, 0)', 'translate3d(80px, 30px, 0)',
    ]);
    view.animations[0].onfinish();
    view.move(0, 60, 54);
    expect(view.animations[1].frames[2].transform).toBe('translate3d(-2px, 54px, 0)');
  });

  it('retargets from the live caret and ignores completion of a cancelled flight', () => {
    const view = fixture();
    view.move(1, 160, 70);
    const first = view.animations[0];
    view.caret.getBoundingClientRect = () => ({ left: 220, top: 30 });
    view.move(2, 180, 110);
    expect(first.cancel).toHaveBeenCalledOnce();
    expect(view.animations[1].frames[0].transform).toBe('translate3d(170px, 30px, 0)');
    first.onfinish();
    expect(view.canvas.querySelector('[data-classic-content]').classList.contains('is-caret-sliding')).toBe(true);
    view.disable();
    expect(view.canvas.querySelector('[data-classic-content]').classList.contains('is-caret-sliding')).toBe(false);
    view.move(3, 180, 150);
    expect(view.animations).toHaveLength(2);
  });

  it('restores native caret motion for reduced motion and removes its overlay on unmount', () => {
    const view = fixture();
    view.move(1, 160, 70);
    view.reduce();
    expect(view.animations[0].cancel).toHaveBeenCalled();
    expect(view.canvas.querySelector('[data-classic-content]').classList.contains('is-caret-sliding')).toBe(false);
    view.move(2, 180, 110);
    expect(view.animations).toHaveLength(1);
    motion.unmount();
    expect(document.querySelector('.editor-caret-overlay')).toBeNull();
  });

  it('hides the animated caret during selection, composition, and scroll', () => {
    const view = fixture();
    view.move(1, 160, 70);
    view.selection.isCollapsed = false;
    view.move(2, 180, 110);
    expect(view.canvas.querySelector('[data-classic-content]').classList.contains('is-caret-sliding')).toBe(false);
    view.selection.isCollapsed = true;
    view.move(2, 180, 110);
    view.move(3, 180, 150);
    view.canvas.dispatchEvent(new Event('compositionstart'));
    view.flush();
    expect(view.canvas.querySelector('[data-classic-content]').classList.contains('is-caret-sliding')).toBe(false);
    view.canvas.dispatchEvent(new Event('compositionend'));
    view.flush();
    view.move(2, 180, 110);
    document.dispatchEvent(new Event('scroll'));
    view.flush();
    expect(view.canvas.querySelector('[data-classic-content]').classList.contains('is-caret-sliding')).toBe(false);
    expect(view.canvas.textContent).toBe('Text');
  });
});
