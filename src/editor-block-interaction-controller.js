import { MOTION_EASE_OUT, shouldReduceMotion } from './reader-motion.js';

const BLOCK_DRAG_MIME = 'text/x-openmd-block';
const BLOCK_LAYOUT_DURATION = 220;
const BLOCK_LAYOUT_EASING = MOTION_EASE_OUT;
const AUTO_SCROLL_EDGE = 72;
const AUTO_SCROLL_MAX_SPEED = 14;

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
  let dragPreview = null;
  let dragWrappers = null;
  let dragWrapperIndexes = null;
  let dragIdIndexes = null;
  let originalWrapperOrder = null;
  let originalVisibleIds = null;
  let reorderCommitted = false;
  let autoScrollFrame = null;
  let autoScrollVelocity = 0;
  let lastDragClientY = null;
  const animations = new Set();
  const document = root.ownerDocument;
  const scrollOwner = root.closest?.('.reader-page') || null;

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
      || (adapters.shouldReduceMotion?.() ?? shouldReduceMotion(window))
    ) return;
    canvas.querySelectorAll('[data-block-id]').forEach((wrapper) => {
      if (typeof wrapper.animate !== 'function') return;
      const previous = previousLayout.get(wrapper.dataset.blockId);
      const current = wrapper.getBoundingClientRect();
      const deltaX = previous ? previous.left - current.left : 0;
      const deltaY = previous ? previous.top - current.top : 0;
      const entering = wrapper.dataset.blockId === enteringId && !previous;
      if (!entering && Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;
      // Translate-only FLIP: scale/filter keyframes force layer rebuilds and pop
      // when many blocks reflow together.
      const animation = wrapper.animate(
        entering
          ? [
              { opacity: 0, transform: 'translateY(-5px)' },
              { opacity: 1, transform: 'translateY(0)' },
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

  const removeDragPreview = () => {
    dragPreview?.remove();
    dragPreview = null;
  };

  const stopAutoScroll = () => {
    autoScrollVelocity = 0;
    if (autoScrollFrame !== null) window.cancelAnimationFrame?.(autoScrollFrame);
    autoScrollFrame = null;
  };

  const isSpacer = (wrapper) => wrapper?.hasAttribute?.('data-block-spacer');

  const visibleWrappers = (wrappers = [...canvas.querySelectorAll('[data-block-id]')]) => {
    const visible = wrappers.filter((wrapper) => !isSpacer(wrapper));
    return visible.length > 0 ? visible : wrappers;
  };

  const refreshDropCaches = () => {
    const wrappers = [...canvas.querySelectorAll('[data-block-id]')];
    const visible = visibleWrappers(wrappers);
    dragWrappers = visible;
    dragWrapperIndexes = new Map(visible.map((wrapper, index) => [wrapper, index]));
    dragIdIndexes = new Map(visible.map((wrapper, index) => [wrapper.dataset.blockId, index]));
    return visible;
  };

  const restoreOriginalOrder = () => {
    if (!originalWrapperOrder?.length) return false;
    const current = [...canvas.querySelectorAll('[data-block-id]')];
    const same = current.length === originalWrapperOrder.length
      && current.every((wrapper, index) => wrapper === originalWrapperOrder[index]);
    if (same) return false;
    const previousLayout = captureLayout();
    originalWrapperOrder.forEach((wrapper) => {
      if (wrapper.isConnected || canvas.contains(wrapper)) canvas.append(wrapper);
    });
    refreshDropCaches();
    animateLayout(previousLayout);
    return true;
  };

  const applyLiveReorder = (sourceId, location) => {
    if (!sourceId || !location?.wrapper) return false;
    const all = [...canvas.querySelectorAll('[data-block-id]')];
    if (all.length === 0) return false;

    const slots = [];
    all.forEach((wrapper, index) => {
      if (!isSpacer(wrapper)) slots.push(index);
    });
    const visible = slots.length > 0 ? slots.map((index) => all[index]) : all;
    const source = visible.find((wrapper) => wrapper.dataset.blockId === sourceId);
    const target = location.wrapper;
    if (!source || !visible.includes(target)) return false;

    const sourceIndex = visible.indexOf(source);
    const targetIndex = visible.indexOf(target);
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return false;

    let destination = targetIndex + (location.position === 'after' ? 1 : 0);
    if (sourceIndex < destination) destination -= 1;
    if (destination === sourceIndex) return false;

    const nextVisible = visible.slice();
    const [moving] = nextVisible.splice(sourceIndex, 1);
    nextVisible.splice(destination, 0, moving);

    const nextAll = all.slice();
    if (slots.length > 0) {
      slots.forEach((slot, index) => {
        nextAll[slot] = nextVisible[index];
      });
    } else {
      nextVisible.forEach((wrapper, index) => {
        nextAll[index] = wrapper;
      });
    }

    if (nextAll.every((wrapper, index) => wrapper === all[index])) return false;

    const previousLayout = captureLayout();
    nextAll.forEach((wrapper) => canvas.append(wrapper));
    refreshDropCaches();
    animateLayout(previousLayout);
    return true;
  };

  const commitFromDom = (sourceId) => {
    if (!sourceId) return false;
    const finalVisibleIds = visibleWrappers().map((wrapper) => wrapper.dataset.blockId);
    if (
      originalVisibleIds
      && originalVisibleIds.length === finalVisibleIds.length
      && originalVisibleIds.every((id, index) => id === finalVisibleIds[index])
    ) {
      return false;
    }

    const sourceIndex = finalVisibleIds.indexOf(sourceId);
    if (sourceIndex < 0) return false;
    const previousId = finalVisibleIds[sourceIndex - 1];
    const nextId = finalVisibleIds[sourceIndex + 1];
    if (previousId) return Boolean(adapters.moveRelative?.(sourceId, previousId, 'after'));
    if (nextId) return Boolean(adapters.moveRelative?.(sourceId, nextId, 'before'));
    return false;
  };

  const runAutoScroll = () => {
    autoScrollFrame = null;
    if (!dragState || !scrollOwner || autoScrollVelocity === 0) return;
    const previousScrollTop = scrollOwner.scrollTop;
    scrollOwner.scrollTop += autoScrollVelocity;
    if (scrollOwner.scrollTop === previousScrollTop) {
      stopAutoScroll();
      return;
    }
    if (lastDragClientY !== null) {
      setDropLocation(normalizeDropLocation(
        getDropLocation({ target: canvas, clientY: lastDragClientY }),
        dragState.sourceId,
      ));
    }
    autoScrollFrame = window.requestAnimationFrame?.(runAutoScroll) ?? null;
  };

  const updateAutoScroll = (clientY) => {
    lastDragClientY = clientY;
    if (!scrollOwner || scrollOwner.scrollHeight <= scrollOwner.clientHeight) return;
    const rect = scrollOwner.getBoundingClientRect();
    const edge = Math.min(AUTO_SCROLL_EDGE, rect.height * 0.18);
    if (clientY < rect.top + edge) {
      const strength = clamp((rect.top + edge - clientY) / edge, 0, 1);
      autoScrollVelocity = -Math.max(2, AUTO_SCROLL_MAX_SPEED * strength);
    } else if (clientY > rect.bottom - edge) {
      const strength = clamp((clientY - (rect.bottom - edge)) / edge, 0, 1);
      autoScrollVelocity = Math.max(2, AUTO_SCROLL_MAX_SPEED * strength);
    } else {
      stopAutoScroll();
      return;
    }
    if (autoScrollFrame === null) {
      autoScrollFrame = window.requestAnimationFrame?.(runAutoScroll) ?? null;
      if (autoScrollFrame === null) scrollOwner.scrollTop += autoScrollVelocity;
    }
  };

  const createDragPreview = (wrapper) => {
    removeDragPreview();
    const preview = document.createElement('div');
    preview.className = 'editor-drag-preview';
    preview.setAttribute('aria-hidden', 'true');
    const icon = document.createElement('i');
    icon.className = 'iconoir-menu-scale';
    icon.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = wrapper.querySelector('[data-editor-content]')?.textContent.trim()
      || wrapper.dataset.blockType
      || 'Block';
    preview.append(icon, label);
    document.body.append(preview);
    dragPreview = preview;
    return preview;
  };

  const clearDragState = () => {
    clearDropTargets();
    canvas.querySelectorAll('.is-dragging').forEach((element) => {
      element.classList.remove('is-dragging');
      element.querySelector('[data-block-menu]')?.removeAttribute('aria-grabbed');
    });
    root.classList.remove('is-block-dragging');
    stopAutoScroll();
    removeDragPreview();
    dragWrappers = null;
    dragWrapperIndexes = null;
    dragIdIndexes = null;
    originalWrapperOrder = null;
    originalVisibleIds = null;
    lastDragClientY = null;
    dragState = null;
  };

  const hasBlockDragType = (dataTransfer) => (
    [...(dataTransfer?.types || [])].includes(BLOCK_DRAG_MIME)
  );

  const dropWrappers = () => {
    if (dragWrappers) return dragWrappers;
    return refreshDropCaches();
  };

  const getDropLocation = (event) => {
    const wrappers = dropWrappers();
    if (wrappers.length === 0) return null;
    const directTarget = event.target.closest?.('[data-block-id]');
    if (directTarget && wrappers.includes(directTarget)) {
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

  const normalizeDropLocation = (location, sourceId) => {
    if (!location || !sourceId) return location;
    dropWrappers();
    const sourceIndex = dragIdIndexes?.get(sourceId) ?? -1;
    const targetIndex = dragWrapperIndexes?.get(location.wrapper) ?? -1;
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return null;
    const slot = targetIndex + (location.position === 'after' ? 1 : 0);
    return slot === sourceIndex || slot === sourceIndex + 1 ? null : location;
  };

  const setDropLocation = (location) => {
    const targetId = location?.wrapper.dataset.blockId || null;
    const position = location?.position || null;
    if (dragState?.targetId === targetId && dragState?.position === position) return;
    if (location && dragState?.sourceId) {
      applyLiveReorder(dragState.sourceId, location);
    }
    clearDropTargets();
    dragState = {
      sourceId: dragState?.sourceId || null,
      targetId,
      position,
    };
  };

  const onDragStart = (event) => {
    const handle = event.target.closest?.('[data-block-menu], [data-block-drag]');
    if (!handle || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    const wrapperFromHandle = handle.closest?.('[data-block-id]');
    const sourceId = wrapperFromHandle?.dataset.blockId
      || handle.dataset.blockId
      || adapters.getDragBlockId?.()
      || null;
    const wrapper = wrapperFromHandle
      || (sourceId
        ? [...canvas.querySelectorAll('[data-block-id]')].find((node) => node.dataset.blockId === sourceId)
        : null);
    if (!sourceId || !wrapper || wrapper.hasAttribute('data-block-spacer')) {
      event.preventDefault();
      return;
    }
    hooks.closeTransientUi?.();
    reorderCommitted = false;
    originalWrapperOrder = [...canvas.querySelectorAll('[data-block-id]')];
    originalVisibleIds = visibleWrappers(originalWrapperOrder).map((item) => item.dataset.blockId);
    dragState = { sourceId, targetId: null, position: null };
    refreshDropCaches();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(BLOCK_DRAG_MIME, sourceId);
    event.dataTransfer.setDragImage?.(createDragPreview(wrapper), 16, 16);
    wrapper.classList.add('is-dragging');
    handle.setAttribute('aria-grabbed', 'true');
    root.classList.add('is-block-dragging');
  };

  const onDragEnd = () => {
    if (!reorderCommitted) restoreOriginalOrder();
    clearDragState();
    reorderCommitted = false;
  };

  const onDragOver = (event) => {
    if (!dragState && !hasBlockDragType(event.dataTransfer)) return;
    const location = normalizeDropLocation(getDropLocation(event), dragState?.sourceId);
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    updateAutoScroll(event.clientY);
    setDropLocation(location);
  };

  const onDrop = (event) => {
    if (!dragState && !hasBlockDragType(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const sourceId = event.dataTransfer?.getData(BLOCK_DRAG_MIME) || dragState?.sourceId;
    if (!sourceId) {
      clearDragState();
      reorderCommitted = false;
      return;
    }

    const location = normalizeDropLocation(getDropLocation(event), sourceId);
    if (location) applyLiveReorder(sourceId, location);

    const changed = commitFromDom(sourceId);
    reorderCommitted = true;
    clearDragState();

    if (!changed) {
      adapters.focusBlock?.(sourceId);
      return;
    }

    const previousLayout = captureLayout();
    adapters.render?.();
    animateLayout(previousLayout);
    hooks.onReorder?.(sourceId);
    adapters.focusBlock?.(sourceId);
  };

  const unbind = () => {
    root.removeEventListener('dragstart', onDragStart);
    root.removeEventListener('dragend', onDragEnd);
    canvas.removeEventListener('dragover', onDragOver);
    canvas.removeEventListener('drop', onDrop);
  };

  const start = () => {
    if (started || disposed) return;
    started = true;
    // Drag may start from the floating block toolbar (outside the canvas).
    root.addEventListener('dragstart', onDragStart);
    root.addEventListener('dragend', onDragEnd);
    canvas.addEventListener('dragover', onDragOver);
    canvas.addEventListener('drop', onDrop);
  };

  const stop = () => {
    if (!started || disposed) return;
    unbind();
    started = false;
    clearDragState();
    reorderCommitted = false;
    cancelAnimations();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (started) {
      unbind();
      started = false;
    }
    clearDragState();
    reorderCommitted = false;
    cancelAnimations();
  };

  return Object.freeze({
    start,
    stop,
    captureLayout,
    animateLayout,
    cancelAnimations,
    clearDragState,
    dispose,
  });
}
