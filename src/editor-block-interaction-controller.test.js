import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { createEditorBlockInteractionController } from './editor-block-interaction-controller.js';

function fixture({ reduced = false, pendingAnimations = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body><main id="root"><div id="canvas">
    <div data-block-id="a"><button data-block-menu></button></div>
    <div data-block-id="b"><button data-block-menu></button></div>
    <div data-block-id="c"><button data-block-menu></button></div>
  </div></main></body></html>`);
  const document = dom.window.document;
  const root = document.querySelector('#root');
  const canvas = document.querySelector('#canvas');
  dom.window.matchMedia = () => ({ matches: reduced });
  let blocks = ['a', 'b', 'c'];
  const animations = [];
  const layout = () => {
    [...canvas.querySelectorAll('[data-block-id]')].forEach((wrapper) => {
      wrapper.getBoundingClientRect = () => {
        const index = [...canvas.children].indexOf(wrapper);
        return { left: 20, top: index * 50, width: 200, height: 40, right: 220, bottom: (index * 50) + 40 };
      };
      wrapper.animate = vi.fn((keyframes, options) => {
        const animation = {
          keyframes,
          options,
          cancel: vi.fn(),
          finished: pendingAnimations ? new Promise(() => {}) : Promise.resolve(),
        };
        animations.push(animation);
        return animation;
      });
    });
  };
  layout();
  const moveTo = vi.fn((id, destination) => {
    const source = blocks.indexOf(id);
    if (source < 0 || source === destination) return false;
    const [block] = blocks.splice(source, 1);
    blocks.splice(destination, 0, block);
    return true;
  });
  const render = vi.fn(() => {
    blocks.forEach((id) => canvas.append(canvas.querySelector(`[data-block-id="${id}"]`)));
    layout();
  });
  const focusBlock = vi.fn();
  const closeTransientUi = vi.fn();
  const controller = createEditorBlockInteractionController({
    window: dom.window,
    elements: { root, canvas },
    adapters: {
      getBlocks: () => blocks.map((id) => ({ id })),
      moveTo,
      render,
      focusBlock,
    },
    hooks: { closeTransientUi },
  });
  controller.start();
  return { dom, document, root, canvas, controller, animations, moveTo, render, focusBlock, closeTransientUi, blocks: () => blocks };
}

function dataTransfer() {
  const values = new Map();
  return {
    types: ['text/x-openmd-block'],
    effectAllowed: '',
    dropEffect: '',
    setData: (type, value) => values.set(type, value),
    getData: (type) => values.get(type) || '',
    setDragImage: vi.fn(),
  };
}

function dragEvent(view, type, target, { y = 0, transfer } = {}) {
  const event = new view.dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: 30, clientY: y });
  Object.defineProperty(event, 'dataTransfer', { value: transfer });
  target.dispatchEvent(event);
  return event;
}

describe('Editor Block Interaction Controller', () => {
  it('animates FLIP reflow and entering blocks with the shared motion contract', () => {
    const view = fixture();
    const previous = view.controller.captureLayout();
    const entering = view.document.createElement('div');
    entering.dataset.blockId = 'new';
    entering.getBoundingClientRect = () => ({ left: 20, top: 150, width: 200, height: 40 });
    entering.animate = vi.fn((keyframes, options) => {
      const animation = { keyframes, options, cancel: vi.fn(), finished: Promise.resolve() };
      view.animations.push(animation);
      return animation;
    });
    view.canvas.prepend(view.canvas.lastElementChild);
    view.canvas.append(entering);
    view.controller.animateLayout(previous, { enteringId: 'new' });
    expect(view.animations.length).toBeGreaterThanOrEqual(2);
    expect(view.animations.at(-1).keyframes[0]).toMatchObject({ opacity: 0 });
    expect(view.animations.at(-1).options).toMatchObject({ duration: 220 });
  });

  it('bypasses layout motion when reduced motion is active', () => {
    const view = fixture({ reduced: true });
    const previous = view.controller.captureLayout();
    view.canvas.prepend(view.canvas.lastElementChild);
    view.controller.animateLayout(previous);
    expect(view.animations).toHaveLength(0);
  });

  it('maps before/after drag targets to deterministic model destinations and ignores self-drop', () => {
    const view = fixture();
    const transfer = dataTransfer();
    const handle = view.canvas.querySelector('[data-block-id="a"] [data-block-menu]');
    dragEvent(view, 'dragstart', handle, { y: 10, transfer });
    expect(view.closeTransientUi).toHaveBeenCalledOnce();
    const target = view.canvas.querySelector('[data-block-id="c"]');
    dragEvent(view, 'dragover', target, { y: 140, transfer });
    expect(target.classList.contains('is-drag-target-after')).toBe(true);
    dragEvent(view, 'drop', target, { y: 140, transfer });
    expect(view.moveTo).toHaveBeenCalledWith('a', 2);
    expect(view.blocks()).toEqual(['b', 'c', 'a']);
    expect(view.focusBlock).toHaveBeenCalledWith('a');
    expect(view.root.classList.contains('is-block-dragging')).toBe(false);

    const secondTransfer = dataTransfer();
    const a = view.canvas.querySelector('[data-block-id="a"]');
    dragEvent(view, 'dragstart', a.querySelector('[data-block-menu]'), { y: 110, transfer: secondTransfer });
    dragEvent(view, 'drop', a, { y: 110, transfer: secondTransfer });
    expect(view.moveTo).toHaveBeenCalledTimes(1);
  });

  it('cancels interrupted animations and removes drag/listener state on dispose', () => {
    const view = fixture({ pendingAnimations: true });
    const first = view.controller.captureLayout();
    view.canvas.prepend(view.canvas.lastElementChild);
    view.controller.animateLayout(first);
    expect(view.animations.length).toBeGreaterThan(0);
    view.controller.captureLayout();
    view.animations.forEach((animation) => expect(animation.cancel).toHaveBeenCalledOnce());

    const transfer = dataTransfer();
    dragEvent(view, 'dragstart', view.canvas.querySelector('[data-block-menu]'), { transfer });
    view.controller.dispose();
    expect(view.root.classList.contains('is-block-dragging')).toBe(false);
    expect(view.canvas.querySelector('.is-dragging')).toBeNull();
    const moveCount = view.moveTo.mock.calls.length;
    dragEvent(view, 'drop', view.canvas.lastElementChild, { y: 200, transfer });
    expect(view.moveTo).toHaveBeenCalledTimes(moveCount);
  });
});
