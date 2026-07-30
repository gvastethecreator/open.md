const BLOCK_DRAG_MIME = 'text/x-openmd-block';
const BLOCK_LAYOUT_DURATION = 220;
const BLOCK_LAYOUT_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function createEditorBlockInteractionController({
  window,
  elements = {},
  adapters = {},
  hooks = {},
}) {
  const { root, canvas } = elements;
  if (!window || !root || !canvas) {
    throw new TypeError('Editor Block Interaction Controller requires window, root and canvas');
  }

  let dragState = null;
  let started = false;
  let disposed = false;
  const animations = new Set();

  const cancelAnimations = () => {
    animations.forEach((animation) => animation.cancel?.());
    animations.clear();
  };

  const captureLayout = () => {
    const layout = new Map([...canvas.querySelectorAll('[data-block-id]')].map((wrapper) => [
      wrapper.dataset.blockId,
      wrapper.getBoundingClientRect(),
    ]));
    cancelAnimations();
    return layout;
  };

  const trackAnimation = (animation) => {
    animations.add(animation);
    Promise.resolve(animation.finished)
      .catch(() => undefined)
      .finally(() => animations.delete(animation));
  };

  const animateLayout = (previousLayout, { enteringId = null } = {}) => {
    if (
      disposed
      || !previousLayout
      || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ) return;
    canvas.querySelectorAll('[data-block-id]').forEach((wrapper) => {
      if (typeof wrapper.animate !== 'function') return;
      const previous = previousLayout.get(wrapper.dataset.blockId);
      const current = wrapper.getBoundingClientRect();
      const deltaX = previous ? previous.left - current.left : 0;
      const deltaY = previous ? previous.top - current.top : 0;
      const entering = wrapper.dataset.blockId === enteringId && !previous;
      if (!entering && Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;
      const animation = wrapper.animate(
        entering
          ? [
              { opacity: 0, transform: 'translateY(-5px) scale(0.985)' },
              { opacity: 1, transform: 'translateY(0) scale(1)' },
            ]
          : [
              { transform: `translate(${deltaX}px, ${deltaY}px)` },
              { transform: 'translate(0, 0)' },
            ],
        { duration: BLOCK_LAYOUT_DURATION, easing: BLOCK_LAYOUT_EASING },
      );
      trackAnimation(animation);
    });
  };

  const clearDropTargets = () => {
    canvas.querySelectorAll('.is-drag-target-before, .is-drag-target-after').forEach((element) => {
      element.classList.remove('is-drag-target-before', 'is-drag-target-after');
    });
  };

  const clearDragState = () => {
    clearDropTargets();
    canvas.querySelectorAll('.is-dragging').forEach((element) => element.classList.remove('is-dragging'));
    root.classList.remove('is-block-dragging');
    dragState = null;
  };

  const hasBlockDragType = (dataTransfer) => (
    [...(dataTransfer?.types || [])].includes(BLOCK_DRAG_MIME)
  );

  const getDropLocation = (event) => {
    const wrappers = [...canvas.querySelectorAll('[data-block-id]')];
    if (wrappers.length === 0) return null;
    const directTarget = event.target.closest?.('[data-block-id]');
    if (directTarget) {
      const rect = directTarget.getBoundingClientRect();
      return {
        wrapper: directTarget,
        position: event.clientY <= rect.top + (rect.height / 2) ? 'before' : 'after',
      };
    }
    const nextWrapper = wrappers.find((wrapper) => {
      const rect = wrapper.getBoundingClientRect();
      return event.clientY <= rect.top + (rect.height / 2);
    });
    return nextWrapper
      ? { wrapper: nextWrapper, position: 'before' }
      : { wrapper: wrappers.at(-1), position: 'after' };
  };

  const onDragStart = (event) => {
    const handle = event.target.closest?.('[data-block-menu]');
    const wrapper = handle?.closest('[data-block-id]');
    if (!wrapper || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    hooks.closeTransientUi?.();
    const sourceId = wrapper.dataset.blockId;
    dragState = { sourceId, targetId: null, position: null };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(BLOCK_DRAG_MIME, sourceId);
    const rect = wrapper.getBoundingClientRect();
    event.dataTransfer.setDragImage?.(
      wrapper,
      clamp(event.clientX - rect.left, 0, rect.width),
      clamp(event.clientY - rect.top, 0, rect.height),
    );
    wrapper.classList.add('is-dragging');
    root.classList.add('is-block-dragging');
  };

  const onDragEnd = () => clearDragState();

  const onDragOver = (event) => {
    if (!dragState && !hasBlockDragType(event.dataTransfer)) return;
    const location = getDropLocation(event);
    if (!location) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const targetId = location.wrapper.dataset.blockId;
    clearDropTargets();
    if (targetId === dragState?.sourceId) {
      dragState = { ...dragState, targetId: null, position: null };
      return;
    }
    location.wrapper.classList.add(`is-drag-target-${location.position}`);
    dragState = {
      sourceId: dragState?.sourceId || null,
      targetId,
      position: location.position,
    };
  };

  const onDrop = (event) => {
    if (!dragState && !hasBlockDragType(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const location = getDropLocation(event);
    const sourceId = event.dataTransfer?.getData(BLOCK_DRAG_MIME) || dragState?.sourceId;
    const targetId = location?.wrapper.dataset.blockId || dragState?.targetId;
    const position = location?.position || dragState?.position;
    if (!sourceId || !targetId || !position || sourceId === targetId) {
      clearDragState();
      return;
    }
    const blocks = adapters.getBlocks?.() || [];
    const sourceIndex = blocks.findIndex((block) => block.id === sourceId);
    const targetIndex = blocks.findIndex((block) => block.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) {
      clearDragState();
      return;
    }
    let destination = targetIndex + (position === 'after' ? 1 : 0);
    if (sourceIndex < destination) destination -= 1;
    destination = clamp(destination, 0, blocks.length - 1);
    clearDragState();
    if (destination === sourceIndex) {
      adapters.focusBlock?.(sourceId);
      return;
    }
    const previousLayout = captureLayout();
    if (!adapters.moveTo?.(sourceId, destination)) return;
    adapters.render?.();
    animateLayout(previousLayout);
    hooks.onReorder?.(sourceId, destination);
    adapters.focusBlock?.(sourceId);
  };

  const start = () => {
    if (started || disposed) return;
    started = true;
    canvas.addEventListener('dragstart', onDragStart);
    canvas.addEventListener('dragend', onDragEnd);
    canvas.addEventListener('dragover', onDragOver);
    canvas.addEventListener('drop', onDrop);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    canvas.removeEventListener('dragstart', onDragStart);
    canvas.removeEventListener('dragend', onDragEnd);
    canvas.removeEventListener('dragover', onDragOver);
    canvas.removeEventListener('drop', onDrop);
    clearDragState();
    cancelAnimations();
  };

  return Object.freeze({
    start,
    captureLayout,
    animateLayout,
    cancelAnimations,
    clearDragState,
    dispose,
  });
}
