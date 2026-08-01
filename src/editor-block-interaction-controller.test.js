import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import { createEditorBlockInteractionController } from './editor-block-interaction-controller.js';

function fixture({ reduced = false, pendingAnimations = false, withSpacer = false, scrollable = false } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body><section class="${scrollable ? 'reader-page' : ''}"><main id="root"><div id="canvas">
    <div data-block-id="a"><button data-block-menu></button></div>
    ${withSpacer ? '<div data-block-id="gap" data-block-spacer><button data-block-menu></button></div>' : ''}
    <div data-block-id="b"><button data-block-menu></button></div>
    <div data-block-id="c"><button data-block-menu></button></div>
  </div></main></section></body></html>`);
  const document = dom.window.document;
  const root = document.querySelector('#root');
  const canvas = document.querySelector('#canvas');
  const scrollOwner = document.querySelector('.reader-page');
  dom.window.matchMedia = () => ({ matches: reduced });
  const frames = new Map();
  let nextFrameId = 1;
  dom.window.requestAnimationFrame = (callback) => {
    const id = nextFrameId;
    nextFrameId += 1;
    frames.set(id, callback);
    return id;
  };
  dom.window.cancelAnimationFrame = (id) => frames.delete(id);
  if (scrollable) {
    Object.defineProperties(scrollOwner, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 1_000 },
    });
    scrollOwner.getBoundingClientRect = () => ({
      top: 0, bottom: 200, left: 0, right: 240, width: 240, height: 200,
    });
  }
  let blocks = withSpacer ? ['a', 'gap', 'b', 'c'] : ['a', 'b', 'c'];
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
  const moveRelative = vi.fn((id, targetId, position) => {
    const isSpacerId = (blockId) => canvas.querySelector(`[data-block-id="${blockId}"]`)
      ?.hasAttribute('data-block-spacer');
    const visibleSlots = blocks
      .map((blockId, index) => (isSpacerId(blockId) ? -1 : index))
      .filter((index) => index >= 0);
    const visibleBlocks = visibleSlots.map((index) => blocks[index]);
    const source = visibleBlocks.indexOf(id);
    const target = visibleBlocks.indexOf(targetId);
    let destination = target + (position === 'after' ? 1 : 0);
    if (source < destination) destination -= 1;
    if (source < 0 || target < 0 || source === destination) return false;
    const [block] = visibleBlocks.splice(source, 1);
    visibleBlocks.splice(destination, 0, block);
    visibleSlots.forEach((slot, index) => {
      blocks[slot] = visibleBlocks[index];
    });
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
      moveRelative,
      render,
      focusBlock,
    },
    hooks: { closeTransientUi },
  });
  controller.start();
  const runAnimationFrame = () => {
    const entry = frames.entries().next().value;
    if (!entry) return false;
    const [id, callback] = entry;
    frames.delete(id);
    callback(0);
    return true;
  };
  return {
    dom,
    document,
    root,
    canvas,
    scrollOwner,
    controller,
    animations,
    moveRelative,
    render,
    focusBlock,
    closeTransientUi,
    blocks: () => blocks,
    runAnimationFrame,
    pendingFrames: () => frames.size,
  };
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
    expect(view.animations.at(-1).keyframes[0]).toMatchObject({ opacity: 0, transform: 'translateY(-5px)' });
    expect(view.animations.at(-1).options).toMatchObject({ duration: 220 });
  });

  it('bypasses layout motion when reduced motion is active', () => {
    const view = fixture({ reduced: true });
    const previous = view.controller.captureLayout();
    view.canvas.prepend(view.canvas.lastElementChild);
    view.controller.animateLayout(previous);
    expect(view.animations).toHaveLength(0);
  });

  it('reorders blocks live on dragover, commits once on drop, and ignores self-drop', () => {
    const view = fixture();
    const transfer = dataTransfer();
    const handle = view.canvas.querySelector('[data-block-id="a"] [data-block-menu]');
    dragEvent(view, 'dragstart', handle, { y: 10, transfer });
    expect(view.closeTransientUi).toHaveBeenCalledOnce();
    const preview = view.document.querySelector('.editor-drag-preview');
    expect(preview?.textContent).toContain('Block');
    expect(transfer.setDragImage).toHaveBeenCalledOnce();
    expect(transfer.setDragImage.mock.calls[0][0]).toBe(preview);
    expect(transfer.setDragImage.mock.calls[0].slice(1)).toEqual([16, 16]);
    const target = view.canvas.querySelector('[data-block-id="c"]');
    dragEvent(view, 'dragover', target, { y: 140, transfer });
    expect([...view.canvas.querySelectorAll('[data-block-id]')].map((node) => node.dataset.blockId))
      .toEqual(['b', 'c', 'a']);
    expect(view.canvas.querySelector('[data-block-id="a"]').classList.contains('is-dragging')).toBe(true);
    expect(view.moveRelative).not.toHaveBeenCalled();
    dragEvent(view, 'drop', target, { y: 140, transfer });
    expect(view.moveRelative).toHaveBeenCalledWith('a', 'c', 'after');
    expect(view.blocks()).toEqual(['b', 'c', 'a']);
    expect(view.focusBlock).toHaveBeenCalledWith('a');
    expect(view.root.classList.contains('is-block-dragging')).toBe(false);

    const secondTransfer = dataTransfer();
    const a = view.canvas.querySelector('[data-block-id="a"]');
    dragEvent(view, 'dragstart', a.querySelector('[data-block-menu]'), { y: 110, transfer: secondTransfer });
    dragEvent(view, 'drop', a, { y: 110, transfer: secondTransfer });
    expect(view.moveRelative).toHaveBeenCalledTimes(1);
  });

  it('restores the original order when a live drag ends without a drop commit', () => {
    const view = fixture();
    const transfer = dataTransfer();
    const source = view.canvas.querySelector('[data-block-id="a"]');
    const target = view.canvas.querySelector('[data-block-id="c"]');

    dragEvent(view, 'dragstart', source.querySelector('[data-block-menu]'), { y: 10, transfer });
    dragEvent(view, 'dragover', target, { y: 140, transfer });
    expect([...view.canvas.querySelectorAll('[data-block-id]')].map((node) => node.dataset.blockId))
      .toEqual(['b', 'c', 'a']);
    dragEvent(view, 'dragend', source, { y: 140, transfer });

    expect(view.moveRelative).not.toHaveBeenCalled();
    expect([...view.canvas.querySelectorAll('[data-block-id]')].map((node) => node.dataset.blockId))
      .toEqual(['a', 'b', 'c']);
    expect(view.root.classList.contains('is-block-dragging')).toBe(false);
  });

  it('skips spacer rows, keeps separators stable, and commits the live visible order', async () => {
    const view = fixture({ withSpacer: true });
    const transfer = dataTransfer();
    const source = view.canvas.querySelector('[data-block-id="a"] [data-block-menu]');
    const spacer = view.canvas.querySelector('[data-block-id="gap"]');
    const target = view.canvas.querySelector('[data-block-id="b"]');

    dragEvent(view, 'dragstart', source, { y: 10, transfer });
    dragEvent(view, 'dragover', spacer, { y: 80, transfer });
    expect([...view.canvas.querySelectorAll('[data-block-id]')].map((node) => node.dataset.blockId))
      .toEqual(['a', 'gap', 'b', 'c']);

    dragEvent(view, 'dragover', target, { y: 139, transfer });
    dragEvent(view, 'dragover', target, { y: 139, transfer });
    await Promise.resolve();
    expect([...view.canvas.querySelectorAll('[data-block-id]')].map((node) => node.dataset.blockId))
      .toEqual(['b', 'gap', 'a', 'c']);
    expect(view.moveRelative).not.toHaveBeenCalled();

    dragEvent(view, 'drop', target, { y: 139, transfer });
    expect(view.moveRelative).toHaveBeenCalledWith('a', 'b', 'after');
    expect(view.blocks()).toEqual(['b', 'gap', 'a', 'c']);
  });

  it('does not start a drag from a Markdown spacer row', () => {
    const view = fixture({ withSpacer: true });
    const transfer = dataTransfer();
    const spacerHandle = view.canvas.querySelector('[data-block-spacer] [data-block-menu]');
    const event = dragEvent(view, 'dragstart', spacerHandle, { y: 60, transfer });

    expect(event.defaultPrevented).toBe(true);
    expect(view.root.classList.contains('is-block-dragging')).toBe(false);
    expect(view.document.querySelector('.editor-drag-preview')).toBeNull();
  });

  it('auto-scrolls near an editor edge and cancels the frame on drag end', () => {
    const view = fixture({ scrollable: true });
    const transfer = dataTransfer();
    const source = view.canvas.querySelector('[data-block-id="a"] [data-block-menu]');
    const target = view.canvas.querySelector('[data-block-id="c"]');

    dragEvent(view, 'dragstart', source, { y: 10, transfer });
    dragEvent(view, 'dragover', target, { y: 198, transfer });
    expect(view.pendingFrames()).toBe(1);
    expect(view.runAnimationFrame()).toBe(true);
    expect(view.scrollOwner.scrollTop).toBeGreaterThan(0);
    expect(view.pendingFrames()).toBe(1);

    dragEvent(view, 'dragend', source, { y: 198, transfer });
    expect(view.pendingFrames()).toBe(0);
    expect(view.document.querySelector('.editor-drag-preview')).toBeNull();
    expect(view.root.classList.contains('is-block-dragging')).toBe(false);
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
    const moveCount = view.moveRelative.mock.calls.length;
    dragEvent(view, 'drop', view.canvas.lastElementChild, { y: 200, transfer });
    expect(view.moveRelative).toHaveBeenCalledTimes(moveCount);
  });
});
