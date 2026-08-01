const VIEWPORT_GAP = 8;
const SAFE_TOP = 38;
const SAFE_BOTTOM = 36;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function focusableItems(menu) {
  return [...menu.querySelectorAll('[role="menuitem"]:not(:disabled)')];
}

function prefersReducedMotion(window) {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

export function createContextMenuController({
  window,
  document,
  resolveContext,
  hooks = {},
}) {
  if (!window || !document || typeof resolveContext !== 'function') {
    throw new TypeError('Context Menu Controller requires window, document and a context resolver');
  }

  const menu = document.createElement('div');
  menu.id = 'app-context-menu';
  menu.className = 'app-context-menu';
  menu.hidden = true;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Context menu');

  let activeDescriptor = null;
  let returnFocus = null;
  let animation = null;
  let motionVersion = 0;
  let started = false;
  let disposed = false;

  const cancelAnimation = () => {
    animation?.cancel?.();
    animation = null;
  };

  const animate = (keyframes, options) => {
    cancelAnimation();
    if (prefersReducedMotion(window) || typeof menu.animate !== 'function') return null;
    try {
      animation = menu.animate(keyframes, options);
      return animation;
    } catch (error) {
      hooks.onDiagnostic?.('Could not animate the context menu', error);
      animation = null;
      return null;
    }
  };

  const finishClose = (version, shouldRestoreFocus) => {
    if (version !== motionVersion || disposed) return;
    menu.hidden = true;
    menu.dataset.state = 'closed';
    menu.replaceChildren();
    activeDescriptor = null;
    cancelAnimation();
    if (shouldRestoreFocus && returnFocus?.isConnected) {
      returnFocus.focus?.({ preventScroll: true });
    }
    returnFocus = null;
  };

  const close = ({ restoreFocus = false, immediate = false } = {}) => {
    if (menu.hidden) return;
    const version = ++motionVersion;
    menu.dataset.state = 'closing';
    if (immediate || prefersReducedMotion(window) || typeof menu.animate !== 'function') {
      finishClose(version, restoreFocus);
      return;
    }
    const exitAnimation = animate([
      { opacity: 1, transform: 'translateY(0) scale(1)' },
      { opacity: 0, transform: 'translateY(-2px) scale(0.985)' },
    ], {
      duration: 100,
      easing: 'cubic-bezier(0.4, 0, 1, 1)',
      fill: 'forwards',
    });
    if (!exitAnimation?.finished) {
      finishClose(version, restoreFocus);
      return;
    }
    exitAnimation.finished.then(
      () => finishClose(version, restoreFocus),
      () => {},
    );
  };

  const renderItems = (descriptor) => {
    const fragment = document.createDocumentFragment();
    descriptor.items.forEach((item) => {
      if (item.type === 'separator') {
        const separator = document.createElement('div');
        separator.className = 'app-context-menu-separator';
        separator.setAttribute('role', 'separator');
        fragment.append(separator);
        return;
      }

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'app-context-menu-item';
      button.dataset.contextAction = item.id;
      button.setAttribute('role', 'menuitem');
      button.disabled = Boolean(item.disabled);
      if (item.danger) button.classList.add('is-danger');

      const icon = document.createElement('i');
      icon.className = item.icon || 'iconoir-page';
      icon.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = item.label;
      button.append(icon, label);

      if (item.shortcut) {
        const shortcut = document.createElement('kbd');
        shortcut.textContent = item.shortcut;
        shortcut.setAttribute('aria-hidden', 'true');
        button.append(shortcut);
      }
      fragment.append(button);
    });
    menu.replaceChildren(fragment);
    menu.setAttribute('aria-label', descriptor.label || 'Context menu');
  };

  const position = (x, y) => {
    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.style.visibility = 'hidden';
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    const maxLeft = Math.max(VIEWPORT_GAP, window.innerWidth - rect.width - VIEWPORT_GAP);
    const maxTop = Math.max(SAFE_TOP, window.innerHeight - rect.height - SAFE_BOTTOM);
    const left = clamp(x, VIEWPORT_GAP, maxLeft);
    const top = clamp(y, SAFE_TOP, maxTop);
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    menu.style.transformOrigin = `${clamp(x - left, 12, Math.max(12, rect.width - 12))}px ${clamp(y - top, 8, Math.max(8, rect.height - 8))}px`;
    menu.dataset.horizontalCollision = String(left !== x);
    menu.dataset.verticalCollision = String(top !== y);
    menu.style.visibility = '';
  };

  const open = (descriptor, { x, y, target }) => {
    const items = descriptor?.items?.filter((item) => item?.type === 'separator' || item?.id);
    if (!items?.some((item) => item.type !== 'separator' && !item.disabled)) return false;

    ++motionVersion;
    cancelAnimation();
    activeDescriptor = { ...descriptor, items };
    const active = document.activeElement;
    returnFocus = descriptor.returnFocus
      || (active && active !== document.body ? active : target);
    renderItems(activeDescriptor);
    position(x, y);
    menu.dataset.state = 'opening';

    const enterAnimation = animate([
      { opacity: 0, transform: 'translateY(-4px) scale(0.98)' },
      { opacity: 1, transform: 'translateY(0) scale(1)' },
    ], {
      duration: 150,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'both',
    });
    enterAnimation?.finished?.then(
      () => {
        if (!menu.hidden) menu.dataset.state = 'open';
      },
      () => {},
    );
    if (!enterAnimation) menu.dataset.state = 'open';

    queueMicrotask(() => focusableItems(menu)[0]?.focus({ preventScroll: true }));
    return true;
  };

  const activate = (button) => {
    const item = activeDescriptor?.items.find((candidate) => candidate.id === button.dataset.contextAction);
    if (!item || item.disabled) return;
    const descriptor = activeDescriptor;
    close({ restoreFocus: true, immediate: true });
    try {
      Promise.resolve(item.onSelect?.(descriptor.context)).catch((error) => {
        hooks.onDiagnostic?.(`Context action failed: ${item.id}`, error);
      });
    } catch (error) {
      hooks.onDiagnostic?.(`Context action failed: ${item.id}`, error);
    }
  };

  const onContextMenu = (event) => {
    if (menu.contains(event.target)) {
      event.preventDefault();
      return;
    }
    let descriptor = null;
    try {
      descriptor = resolveContext({ event, target: event.target });
    } catch (error) {
      hooks.onDiagnostic?.('Could not resolve the context menu', error);
    }
    if (!descriptor || !open(descriptor, {
      x: event.clientX,
      y: event.clientY,
      target: event.target,
    })) {
      close({ immediate: true });
      return;
    }
    event.preventDefault();
  };

  const onMenuClick = (event) => {
    const button = event.target.closest?.('[data-context-action]');
    if (button && menu.contains(button)) activate(button);
  };

  const onMenuPointerMove = (event) => {
    event.target.closest?.('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  };

  const onMenuKeyDown = (event) => {
    const items = focusableItems(menu);
    if (items.length === 0) return;
    const index = Math.max(0, items.indexOf(document.activeElement));
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      items[(index + direction + items.length) % items.length].focus({ preventScroll: true });
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      items[event.key === 'Home' ? 0 : items.length - 1].focus({ preventScroll: true });
      return;
    }
    if ((event.key === 'Enter' || event.key === ' ') && document.activeElement?.matches?.('[data-context-action]')) {
      event.preventDefault();
      activate(document.activeElement);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close({ restoreFocus: true });
    }
  };

  const onPointerDown = (event) => {
    if (!menu.hidden && !menu.contains(event.target)) close();
  };
  const onFocusIn = (event) => {
    if (!menu.hidden && !menu.contains(event.target) && event.target !== returnFocus) close();
  };
  const onScroll = () => close();
  const onResize = () => close();

  const start = () => {
    if (started || disposed) return;
    started = true;
    document.body.append(menu);
    document.addEventListener('contextmenu', onContextMenu);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize, { passive: true });
    menu.addEventListener('click', onMenuClick);
    menu.addEventListener('pointermove', onMenuPointerMove);
    menu.addEventListener('keydown', onMenuKeyDown);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    document.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', onResize);
    menu.removeEventListener('click', onMenuClick);
    menu.removeEventListener('pointermove', onMenuPointerMove);
    menu.removeEventListener('keydown', onMenuKeyDown);
    ++motionVersion;
    cancelAnimation();
    menu.remove();
    activeDescriptor = null;
    returnFocus = null;
  };

  return Object.freeze({
    start,
    close,
    isOpen: () => !menu.hidden,
    element: () => menu,
    dispose,
  });
}
