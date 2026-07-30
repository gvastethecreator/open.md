const TOOLTIP_ID = 'app-tooltip';
const FIRST_HOVER_DELAY = 420;
const HOVER_GRACE_WINDOW = 600;
const GRACE_HOVER_DELAY = 40;
const VIEWPORT_GAP = 8;
const TOOLTIP_GAP = 8;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function prefersReducedMotion(window) {
  return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
}

function tooltipTarget(node) {
  const target = node?.closest?.('[data-tooltip]');
  return target?.dataset.tooltip?.trim() ? target : null;
}

export function createTooltipController({ window, document, hooks = {} }) {
  if (!window || !document) {
    throw new TypeError('Tooltip Controller requires window and document');
  }

  const tooltip = document.createElement('div');
  tooltip.id = TOOLTIP_ID;
  tooltip.className = 'app-tooltip';
  tooltip.hidden = true;
  tooltip.setAttribute('role', 'tooltip');
  const label = document.createElement('span');
  label.className = 'app-tooltip-label';
  tooltip.append(label);

  let activeTarget = null;
  let pendingTarget = null;
  let showTimerId = null;
  let hideTimerId = null;
  let animation = null;
  let motionVersion = 0;
  let lastHiddenAt = Number.NEGATIVE_INFINITY;
  let observer = null;
  let started = false;
  let disposed = false;

  const cancelTimer = (name) => {
    if (name === 'show' && showTimerId !== null) window.clearTimeout(showTimerId);
    if (name === 'hide' && hideTimerId !== null) window.clearTimeout(hideTimerId);
    if (name === 'show') showTimerId = null;
    if (name === 'hide') hideTimerId = null;
  };

  const cancelAnimation = () => {
    animation?.cancel?.();
    animation = null;
  };

  const updateDescription = (target, add) => {
    if (!target?.getAttribute) return;
    const tokens = new Set((target.getAttribute('aria-describedby') || '').split(/\s+/u).filter(Boolean));
    if (add) tokens.add(TOOLTIP_ID);
    else tokens.delete(TOOLTIP_ID);
    if (tokens.size) target.setAttribute('aria-describedby', [...tokens].join(' '));
    else target.removeAttribute('aria-describedby');
  };

  const animate = (keyframes, options) => {
    cancelAnimation();
    if (prefersReducedMotion(window) || typeof tooltip.animate !== 'function') return null;
    try {
      animation = tooltip.animate(keyframes, options);
      return animation;
    } catch (error) {
      hooks.onDiagnostic?.('Could not animate the tooltip', error);
      animation = null;
      return null;
    }
  };

  const position = (target) => {
    const anchor = target.getBoundingClientRect();
    tooltip.style.left = '0px';
    tooltip.style.top = '0px';
    tooltip.style.visibility = 'hidden';
    tooltip.hidden = false;
    const rect = tooltip.getBoundingClientRect();
    const fitsAbove = anchor.top - rect.height - TOOLTIP_GAP >= VIEWPORT_GAP;
    const fitsBelow = anchor.bottom + TOOLTIP_GAP + rect.height <= window.innerHeight - VIEWPORT_GAP;
    const side = fitsAbove || !fitsBelow ? 'top' : 'bottom';
    const desiredTop = side === 'top'
      ? anchor.top - rect.height - TOOLTIP_GAP
      : anchor.bottom + TOOLTIP_GAP;
    const left = clamp(
      anchor.left + (anchor.width - rect.width) / 2,
      VIEWPORT_GAP,
      Math.max(VIEWPORT_GAP, window.innerWidth - rect.width - VIEWPORT_GAP),
    );
    const top = clamp(
      desiredTop,
      VIEWPORT_GAP,
      Math.max(VIEWPORT_GAP, window.innerHeight - rect.height - VIEWPORT_GAP),
    );
    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
    tooltip.style.setProperty('--tooltip-arrow-offset', `${Math.round(clamp(
      anchor.left + anchor.width / 2 - left,
      10,
      Math.max(10, rect.width - 10),
    ))}px`);
    tooltip.dataset.side = side;
    tooltip.style.visibility = '';
    return tooltip.getBoundingClientRect();
  };

  const show = (target) => {
    if (disposed || !target?.isConnected || !target.dataset.tooltip?.trim()) return;
    cancelTimer('show');
    cancelTimer('hide');
    const previousRect = !tooltip.hidden ? tooltip.getBoundingClientRect() : null;
    if (activeTarget && activeTarget !== target) updateDescription(activeTarget, false);
    activeTarget = target;
    pendingTarget = null;
    label.textContent = target.dataset.tooltip.trim();
    const nextRect = position(target);
    updateDescription(target, true);
    tooltip.dataset.state = 'opening';
    const sideTravel = tooltip.dataset.side === 'top' ? 3 : -3;
    const retargetX = previousRect ? previousRect.left - nextRect.left : 0;
    const retargetY = previousRect ? previousRect.top - nextRect.top : sideTravel;
    const enterAnimation = animate([
      { opacity: previousRect ? 0.72 : 0, transform: `translate(${retargetX}px, ${retargetY}px) scale(0.98)` },
      { opacity: 1, transform: 'translate(0, 0) scale(1)' },
    ], {
      duration: previousRect ? 120 : 130,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'both',
    });
    enterAnimation?.finished?.then(
      () => {
        if (!tooltip.hidden && activeTarget === target) tooltip.dataset.state = 'open';
      },
      () => {},
    );
    if (!enterAnimation) tooltip.dataset.state = 'open';
  };

  const finishHide = (version) => {
    if (version !== motionVersion || disposed) return;
    if (activeTarget) updateDescription(activeTarget, false);
    activeTarget = null;
    pendingTarget = null;
    tooltip.hidden = true;
    tooltip.dataset.state = 'closed';
    label.textContent = '';
    lastHiddenAt = Date.now();
    cancelAnimation();
  };

  const hide = ({ immediate = false } = {}) => {
    cancelTimer('show');
    cancelTimer('hide');
    pendingTarget = null;
    if (tooltip.hidden) return;
    const version = ++motionVersion;
    tooltip.dataset.state = 'closing';
    if (immediate || prefersReducedMotion(window) || typeof tooltip.animate !== 'function') {
      finishHide(version);
      return;
    }
    const sideTravel = tooltip.dataset.side === 'top' ? -2 : 2;
    const exitAnimation = animate([
      { opacity: 1, transform: 'translateY(0) scale(1)' },
      { opacity: 0, transform: `translateY(${sideTravel}px) scale(0.985)` },
    ], {
      duration: 90,
      easing: 'cubic-bezier(0.4, 0, 1, 1)',
      fill: 'forwards',
    });
    if (!exitAnimation?.finished) {
      finishHide(version);
      return;
    }
    exitAnimation.finished.then(
      () => finishHide(version),
      () => {},
    );
  };

  const scheduleShow = (target, { immediate = false } = {}) => {
    if (!target || target === activeTarget) return;
    cancelTimer('show');
    cancelTimer('hide');
    pendingTarget = target;
    const withinGrace = Date.now() - lastHiddenAt <= HOVER_GRACE_WINDOW || !tooltip.hidden;
    const delay = immediate ? 0 : withinGrace ? GRACE_HOVER_DELAY : FIRST_HOVER_DELAY;
    if (delay === 0) {
      show(target);
      return;
    }
    showTimerId = window.setTimeout(() => {
      showTimerId = null;
      if (pendingTarget === target) show(target);
    }, delay);
  };

  const scheduleHide = (delay = 70) => {
    cancelTimer('show');
    pendingTarget = null;
    cancelTimer('hide');
    if (delay <= 0) {
      hide();
      return;
    }
    hideTimerId = window.setTimeout(() => {
      hideTimerId = null;
      hide();
    }, delay);
  };

  const migrateTitle = (element) => {
    if (!element?.hasAttribute?.('title')) return;
    const title = element.getAttribute('title')?.trim();
    if (title) element.dataset.tooltip = title;
    element.removeAttribute('title');
  };

  const migrateTree = (node) => {
    if (node?.nodeType !== 1) return;
    migrateTitle(node);
    node.querySelectorAll?.('[title]').forEach(migrateTitle);
  };

  const onMutations = (records) => {
    records.forEach((record) => {
      if (record.type === 'childList') record.addedNodes.forEach(migrateTree);
      if (record.type === 'attributes' && record.attributeName === 'title') migrateTitle(record.target);
      if (
        record.type === 'attributes'
        && record.attributeName === 'data-tooltip'
        && record.target === activeTarget
      ) {
        if (activeTarget.dataset.tooltip?.trim()) show(activeTarget);
        else hide({ immediate: true });
      }
    });
  };

  const onPointerOver = (event) => {
    const target = tooltipTarget(event.target);
    if (!target || target.contains(event.relatedTarget)) return;
    scheduleShow(target);
  };
  const onPointerOut = (event) => {
    const target = tooltipTarget(event.target);
    if (!target || target.contains(event.relatedTarget)) return;
    const nextTarget = tooltipTarget(event.relatedTarget);
    if (nextTarget) {
      scheduleShow(nextTarget);
      return;
    }
    scheduleHide();
  };
  const onFocusIn = (event) => scheduleShow(tooltipTarget(event.target), { immediate: true });
  const onFocusOut = (event) => {
    if (activeTarget?.contains(event.relatedTarget)) return;
    scheduleHide(0);
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape' && (!tooltip.hidden || pendingTarget)) hide({ immediate: true });
  };
  const onDismiss = () => hide({ immediate: true });

  const start = () => {
    if (started || disposed) return;
    started = true;
    document.body.append(tooltip);
    document.querySelectorAll('[title]').forEach(migrateTitle);
    observer = new window.MutationObserver(onMutations);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['title', 'data-tooltip'],
    });
    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onDismiss, true);
    document.addEventListener('contextmenu', onDismiss, true);
    document.addEventListener('scroll', onDismiss, true);
    window.addEventListener('resize', onDismiss, { passive: true });
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    observer?.disconnect();
    observer = null;
    document.removeEventListener('pointerover', onPointerOver);
    document.removeEventListener('pointerout', onPointerOut);
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('focusout', onFocusOut);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('pointerdown', onDismiss, true);
    document.removeEventListener('contextmenu', onDismiss, true);
    document.removeEventListener('scroll', onDismiss, true);
    window.removeEventListener('resize', onDismiss);
    cancelTimer('show');
    cancelTimer('hide');
    ++motionVersion;
    cancelAnimation();
    if (activeTarget) updateDescription(activeTarget, false);
    activeTarget = null;
    pendingTarget = null;
    tooltip.remove();
  };

  return Object.freeze({
    start,
    hide,
    current: () => activeTarget,
    element: () => tooltip,
    dispose,
  });
}
