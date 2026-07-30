const BLOCK_DRAG_MIME = 'text/x-openmd-block';
const BLOCK_LAYOUT_DURATION = 220;
const BLOCK_LAYOUT_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
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

  const removeDragPreview = () => {
    dragPreview?.remove();
    dragPreview = null;
  };

  const stopAutoScroll = () => {
    autoScrollVelocity = 0;
    if (autoScrollFrame !== null) window.cancelAnimationFrame?.(autoScrollFrame);
    autoScrollFrame = null;
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
    lastDragClientY = null;
    dragState = null;
  };

  const hasBlockDragType = (dataTransfer) => (
    [...(dataTransfer?.types || [])].includes(BLOCK_DRAG_MIME)
  );

  const dropWrappers = () => {
    if (dragWrappers) return dragWrappers;
    const wrappers = [...canvas.querySelectorAll('[data-block-id]')];
    const visible = wrappers.filter((wrapper) => !wrapper.hasAttribute('data-block-spacer'));
    dragWrappers = visible.length > 0 ? visible : wrappers;
    dragWrapperIndexes = new Map(dragWrappers.map((wrapper, index) => [wrapper, index]));
    dragIdIndexes = new Map(dragWrappers.map((wrapper, index) => [wrapper.dataset.blockId, index]));
    return dragWrappers;
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
    clearDropTargets();
    if (location) location.wrapper.classList.add(`is-drag-target-${position}`);
    dragState = {
      sourceId: dragState?.sourceId || null,
      targetId,
      position,
    };
  };

  const onDragStart = (event) => {
    const handle = event.target.closest?.('[data-block-menu]');
    const wrapper = handle?.closest('[data-block-id]');
    if (!wrapper || wrapper.hasAttribute('data-block-spacer') || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    hooks.closeTransientUi?.();
    const sourceId = wrapper.dataset.blockId;
    dragState = { sourceId, targetId: null, position: null };
    dropWrappers();
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(BLOCK_DRAG_MIME, sourceId);
    event.dataTransfer.setDragImage?.(createDragPreview(wrapper), 16, 16);
    wrapper.classList.add('is-dragging');
    handle.setAttribute('aria-grabbed', 'true');
    root.classList.add('is-block-dragging');
  };

  const onDragEnd = () => clearDragState();

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
    const location = normalizeDropLocation(getDropLocation(event), sourceId);
    const targetId = location?.wrapper.dataset.blockId;
    const position = location?.position;
    if (!sourceId || !targetId || !position || sourceId === targetId) {
      clearDragState();
      return;
    }
    clearDragState();
    const previousLayout = captureLayout();
    if (!adapters.moveRelative?.(sourceId, targetId, position)) {
      adapters.focusBlock?.(sourceId);
      return;
    }
    adapters.render?.();
    animateLayout(previousLayout);
    hooks.onReorder?.(sourceId, targetId, position);
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
