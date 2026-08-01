const TOOLTIP_ID = 'app-tooltip';
const FIRST_HOVER_DELAY = 420;
const HOVER_GRACE_WINDOW = 600;
const GRACE_HOVER_DELAY = 40;
const HIDE_DELAY = 140;
const SAFE_ZONE_PAD = 10;
const VIEWPORT_GAP = 8;
const TOOLTIP_GAP = 8;
/** Micro copy swap — text only (transitions-dev text-states-swap scale). */
const TEXT_SWAP_MS = 160;
/** Shell width tween — geometry only (card-resize scale). */
const WIDTH_MORPH_MS = 180;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';

const TRAILING_SHORTCUT = /^(.*?)\s*(?:·|\(|—)\s*((?:(?:Ctrl|Cmd|Command|Shift|Alt|Option|Meta|Win)\+)*(?:[A-Za-z0-9]+|F\d{1,2}|\+|Esc|Enter|Tab|Space))\s*\)?\s*$/u;

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

function expandRect(rect, pad) {
  return {
    left: rect.left - pad,
    top: rect.top - pad,
    right: rect.right + pad,
    bottom: rect.bottom + pad,
  };
}

function pointInRect(x, y, rect) {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function bridgeRect(anchor, tooltipRect, side) {
  if (!tooltipRect) return null;
  if (side === 'top') {
    return {
      left: Math.min(anchor.left, tooltipRect.left) - SAFE_ZONE_PAD,
      right: Math.max(anchor.right, tooltipRect.right) + SAFE_ZONE_PAD,
      top: tooltipRect.bottom,
      bottom: anchor.top,
    };
  }
  if (side === 'bottom') {
    return {
      left: Math.min(anchor.left, tooltipRect.left) - SAFE_ZONE_PAD,
      right: Math.max(anchor.right, tooltipRect.right) + SAFE_ZONE_PAD,
      top: anchor.bottom,
      bottom: tooltipRect.top,
    };
  }
  if (side === 'left') {
    return {
      left: tooltipRect.right,
      right: anchor.left,
      top: Math.min(anchor.top, tooltipRect.top) - SAFE_ZONE_PAD,
      bottom: Math.max(anchor.bottom, tooltipRect.bottom) + SAFE_ZONE_PAD,
    };
  }
  return {
    left: anchor.right,
    right: tooltipRect.left,
    top: Math.min(anchor.top, tooltipRect.top) - SAFE_ZONE_PAD,
    bottom: Math.max(anchor.bottom, tooltipRect.bottom) + SAFE_ZONE_PAD,
  };
}

function preferredTooltipSide(target) {
  const raw = target?.dataset?.tooltipSide?.trim()?.toLowerCase();
  if (raw === 'left' || raw === 'right' || raw === 'top' || raw === 'bottom') return raw;
  return null;
}

function tooltipShowDelay(target, { withinGrace, immediate }) {
  if (immediate) return 0;
  if (withinGrace) return GRACE_HOVER_DELAY;
  const custom = Number(target?.dataset?.tooltipDelay);
  if (Number.isFinite(custom) && custom >= 0) return custom;
  return FIRST_HOVER_DELAY;
}

function splitShortcutKeys(shortcut) {
  return String(shortcut).split('+').map((part) => part.trim()).filter(Boolean);
}

function resolveTooltipCopy(target) {
  const raw = target?.dataset?.tooltip?.trim() || '';
  if (!raw) return { text: '', keys: [] };
  const explicit = target.dataset.tooltipShortcut?.trim();
  if (explicit) return { text: raw, keys: splitShortcutKeys(explicit) };
  const matched = raw.match(TRAILING_SHORTCUT);
  if (!matched?.[1]?.trim() || !matched[2]) return { text: raw, keys: [] };
  return { text: matched[1].trim(), keys: splitShortcutKeys(matched[2]) };
}

function copySignature(copy) {
  return `${copy.text}\u0000${copy.keys.join('+')}`;
}

/**
 * Tooltip shell is always solid when open.
 * Content changes: text layers crossfade; shell only tweens width/left.
 * Pattern mirrors toast-presenter (surface vs message) + transitions-dev
 * text-states-swap / card-resize (animate the piece that changes).
 */
export function createTooltipController({ window, document, hooks = {} }) {
  if (!window || !document) {
    throw new TypeError('Tooltip Controller requires window and document');
  }

  const tooltip = document.createElement('div');
  tooltip.id = TOOLTIP_ID;
  tooltip.className = 'app-tooltip';
  tooltip.hidden = true;
  tooltip.setAttribute('role', 'tooltip');

  // Stack like toast: previous + current share one grid cell.
  const previous = document.createElement('span');
  previous.className = 'app-tooltip-message app-tooltip-message--previous';
  previous.setAttribute('aria-hidden', 'true');
  const message = document.createElement('span');
  message.className = 'app-tooltip-message';
  tooltip.append(previous, message);

  let activeTarget = null;
  let pendingTarget = null;
  let renderedSignature = '';
  let showTimerId = null;
  let hideTimerId = null;
  let shellAnimation = null;
  let contentAnimations = [];
  let contentVersion = 0;
  let motionVersion = 0;
  let lastHiddenAt = Number.NEGATIVE_INFINITY;
  let lastPointer = { x: Number.NaN, y: Number.NaN };
  let observer = null;
  let started = false;
  let disposed = false;

  const cancelTimer = (name) => {
    if (name === 'show' && showTimerId !== null) window.clearTimeout(showTimerId);
    if (name === 'hide' && hideTimerId !== null) window.clearTimeout(hideTimerId);
    if (name === 'show') showTimerId = null;
    if (name === 'hide') hideTimerId = null;
  };

  const cancelShellAnimation = () => {
    shellAnimation?.cancel?.();
    shellAnimation = null;
    tooltip.getAnimations?.().forEach((entry) => entry.cancel());
  };

  const cancelContentAnimations = () => {
    contentAnimations.forEach((entry) => entry.cancel());
    contentAnimations = [];
    message.getAnimations?.().forEach((entry) => entry.cancel());
    previous.getAnimations?.().forEach((entry) => entry.cancel());
  };

  const pinShellVisible = () => {
    cancelShellAnimation();
    tooltip.style.opacity = '1';
    tooltip.style.transform = 'none';
  };

  const clearShellInlineMotion = () => {
    cancelShellAnimation();
    tooltip.style.removeProperty('opacity');
    tooltip.style.removeProperty('transform');
    tooltip.style.removeProperty('width');
  };

  const updateDescription = (target, add) => {
    if (!target?.getAttribute) return;
    const tokens = new Set((target.getAttribute('aria-describedby') || '').split(/\s+/u).filter(Boolean));
    if (add) tokens.add(TOOLTIP_ID);
    else tokens.delete(TOOLTIP_ID);
    if (tokens.size) target.setAttribute('aria-describedby', [...tokens].join(' '));
    else target.removeAttribute('aria-describedby');
  };

  const paintCopy = (host, copy) => {
    host.replaceChildren();
    if (copy.text) {
      const text = document.createElement('span');
      text.className = 'app-tooltip-text';
      text.textContent = copy.text;
      host.append(text);
    }
    if (copy.keys.length) {
      const keys = document.createElement('span');
      keys.className = 'app-tooltip-keys';
      keys.setAttribute('aria-hidden', 'true');
      copy.keys.forEach((key) => {
        const chip = document.createElement('kbd');
        chip.textContent = key;
        keys.append(chip);
      });
      host.append(keys);
    }
  };

  const run = (target, keyframes, options) => {
    if (prefersReducedMotion(window) || typeof target.animate !== 'function') return null;
    try {
      return target.animate(keyframes, { ...options, fill: 'both' });
    } catch (error) {
      hooks.onDiagnostic?.('Could not animate the tooltip', error);
      return null;
    }
  };

  const desiredLeftForWidth = (target, width) => {
    const anchor = target.getBoundingClientRect();
    return clamp(
      anchor.left + (anchor.width - width) / 2,
      VIEWPORT_GAP,
      Math.max(VIEWPORT_GAP, window.innerWidth - width - VIEWPORT_GAP),
    );
  };

  const desiredTopForHeight = (target, height) => {
    const anchor = target.getBoundingClientRect();
    return clamp(
      anchor.top + (anchor.height - height) / 2,
      VIEWPORT_GAP,
      Math.max(VIEWPORT_GAP, window.innerHeight - height - VIEWPORT_GAP),
    );
  };

  const resolveSide = (target, anchor, rect) => {
    const preferred = preferredTooltipSide(target);
    const fitsLeft = anchor.left - rect.width - TOOLTIP_GAP >= VIEWPORT_GAP;
    const fitsRight = anchor.right + TOOLTIP_GAP + rect.width <= window.innerWidth - VIEWPORT_GAP;
    const fitsAbove = anchor.top - rect.height - TOOLTIP_GAP >= VIEWPORT_GAP;
    const fitsBelow = anchor.bottom + TOOLTIP_GAP + rect.height <= window.innerHeight - VIEWPORT_GAP;

    if (preferred === 'left') {
      if (fitsLeft) return 'left';
      if (fitsRight) return 'right';
    }
    if (preferred === 'right') {
      if (fitsRight) return 'right';
      if (fitsLeft) return 'left';
    }
    if (preferred === 'top' && fitsAbove) return 'top';
    if (preferred === 'bottom' && fitsBelow) return 'bottom';
    if (preferred === 'top' || preferred === 'bottom') {
      return fitsAbove || !fitsBelow ? 'top' : 'bottom';
    }
    return fitsAbove || !fitsBelow ? 'top' : 'bottom';
  };

  const position = (target, { measureSilently = false } = {}) => {
    const anchor = target.getBoundingClientRect();
    tooltip.style.removeProperty('width');
    if (!measureSilently) {
      tooltip.style.left = '0px';
      tooltip.style.top = '0px';
      tooltip.style.visibility = 'hidden';
    }
    tooltip.hidden = false;
    const rect = tooltip.getBoundingClientRect();
    const side = resolveSide(target, anchor, rect);

    let left;
    let top;
    if (side === 'left') {
      left = clamp(
        anchor.left - rect.width - TOOLTIP_GAP,
        VIEWPORT_GAP,
        Math.max(VIEWPORT_GAP, window.innerWidth - rect.width - VIEWPORT_GAP),
      );
      top = desiredTopForHeight(target, rect.height);
    } else if (side === 'right') {
      left = clamp(
        anchor.right + TOOLTIP_GAP,
        VIEWPORT_GAP,
        Math.max(VIEWPORT_GAP, window.innerWidth - rect.width - VIEWPORT_GAP),
      );
      top = desiredTopForHeight(target, rect.height);
    } else {
      left = desiredLeftForWidth(target, rect.width);
      const desiredTop = side === 'top'
        ? anchor.top - rect.height - TOOLTIP_GAP
        : anchor.bottom + TOOLTIP_GAP;
      top = clamp(
        desiredTop,
        VIEWPORT_GAP,
        Math.max(VIEWPORT_GAP, window.innerHeight - rect.height - VIEWPORT_GAP),
      );
    }

    tooltip.style.left = `${Math.round(left)}px`;
    tooltip.style.top = `${Math.round(top)}px`;
    if (side === 'left' || side === 'right') {
      tooltip.style.setProperty('--tooltip-arrow-offset', `${Math.round(clamp(
        anchor.top + anchor.height / 2 - top,
        10,
        Math.max(10, rect.height - 10),
      ))}px`);
    } else {
      tooltip.style.setProperty('--tooltip-arrow-offset', `${Math.round(clamp(
        anchor.left + anchor.width / 2 - left,
        10,
        Math.max(10, rect.width - 10),
      ))}px`);
    }
    tooltip.dataset.side = side;
    if (!measureSilently) tooltip.style.visibility = '';
    return tooltip.getBoundingClientRect();
  };

  const isInsideSafeZone = (target, clientX = lastPointer.x, clientY = lastPointer.y) => {
    if (!target?.isConnected || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return false;
    const anchor = target.getBoundingClientRect();
    if (pointInRect(clientX, clientY, expandRect(anchor, SAFE_ZONE_PAD))) return true;
    if (tooltip.hidden || activeTarget !== target) return false;
    const tipRect = tooltip.getBoundingClientRect();
    if (pointInRect(clientX, clientY, expandRect(tipRect, SAFE_ZONE_PAD))) return true;
    const bridge = bridgeRect(anchor, tipRect, tooltip.dataset.side);
    return Boolean(bridge && pointInRect(clientX, clientY, bridge));
  };

  const settleContent = () => {
    previous.replaceChildren();
    previous.style.removeProperty('opacity');
    previous.style.removeProperty('transform');
    message.style.removeProperty('opacity');
    message.style.removeProperty('transform');
    tooltip.classList.remove('is-label-morphing');
    tooltip.style.removeProperty('width');
  };

  const show = (target) => {
    if (disposed || !target?.isConnected || !target.dataset.tooltip?.trim()) return;
    cancelTimer('show');
    cancelTimer('hide');
    contentVersion += 1;
    cancelContentAnimations();
    settleContent();

    const wasOpen = !tooltip.hidden;
    const previousRect = wasOpen ? tooltip.getBoundingClientRect() : null;
    if (activeTarget && activeTarget !== target) updateDescription(activeTarget, false);
    activeTarget = target;
    pendingTarget = null;

    const copy = resolveTooltipCopy(target);
    paintCopy(message, copy);
    renderedSignature = copySignature(copy);
    previous.replaceChildren();

    const nextRect = position(target);
    updateDescription(target, true);
    pinShellVisible();
    tooltip.dataset.state = wasOpen ? 'open' : 'opening';

    if (wasOpen) {
      // Retarget: slide shell only — never re-fade the surface.
      const dx = previousRect.left - nextRect.left;
      const dy = previousRect.top - nextRect.top;
      shellAnimation = run(tooltip, [
        { opacity: 1, transform: `translate(${dx}px, ${dy}px)` },
        { opacity: 1, transform: 'translate(0, 0)' },
      ], { duration: 120, easing: EASE_OUT });
      shellAnimation?.finished?.then(() => {
        if (activeTarget === target && !tooltip.hidden) {
          clearShellInlineMotion();
          pinShellVisible();
          tooltip.style.removeProperty('opacity');
          tooltip.style.removeProperty('transform');
          tooltip.dataset.state = 'open';
        }
      }, () => {});
      if (!shellAnimation) {
        clearShellInlineMotion();
        tooltip.dataset.state = 'open';
      }
      return;
    }

    const openSide = tooltip.dataset.side;
    const openTravel = openSide === 'left'
      ? { x: 3, y: 0 }
      : openSide === 'right'
        ? { x: -3, y: 0 }
        : openSide === 'top'
          ? { x: 0, y: 3 }
          : { x: 0, y: -3 };
    shellAnimation = run(tooltip, [
      { opacity: 0, transform: `translate(${openTravel.x}px, ${openTravel.y}px) scale(0.98)` },
      { opacity: 1, transform: 'translate(0, 0) scale(1)' },
    ], { duration: 130, easing: EASE_OUT });
    shellAnimation?.finished?.then(() => {
      if (activeTarget === target && !tooltip.hidden) {
        clearShellInlineMotion();
        tooltip.dataset.state = 'open';
      }
    }, () => {});
    if (!shellAnimation) tooltip.dataset.state = 'open';
  };

  /**
   * Open shell content change:
   * - shell: width + left only (always opacity 1)
   * - text: previous fades out, current fades in (only layers)
   */
  const refreshActiveLabel = () => {
    if (disposed || !activeTarget?.isConnected || tooltip.hidden) return;
    if (!activeTarget.dataset.tooltip?.trim()) {
      hide({ immediate: true });
      return;
    }

    const copy = resolveTooltipCopy(activeTarget);
    const signature = copySignature(copy);
    if (signature === renderedSignature) {
      position(activeTarget, { measureSilently: true });
      tooltip.dataset.state = 'open';
      return;
    }

    const version = ++contentVersion;
    cancelContentAnimations();
    pinShellVisible();

    const startRect = tooltip.getBoundingClientRect();
    const startWidth = startRect.width;
    const startLeft = startRect.left;

    // Capture outgoing pixels from the live message layer only.
    previous.replaceChildren(...[...message.childNodes].map((node) => node.cloneNode(true)));
    previous.style.opacity = '1';
    paintCopy(message, copy);
    message.style.opacity = '0';
    renderedSignature = signature;

    // Natural width of new content (shell stays painted).
    tooltip.style.width = 'auto';
    const endWidth = tooltip.getBoundingClientRect().width;
    const endLeft = desiredLeftForWidth(activeTarget, endWidth);
    tooltip.style.width = `${Math.round(startWidth)}px`;
    tooltip.style.left = `${Math.round(startLeft)}px`;
    tooltip.dataset.state = 'open';
    tooltip.classList.add('is-label-morphing');

    const finish = () => {
      if (disposed || version !== contentVersion) return;
      cancelContentAnimations();
      settleContent();
      tooltip.style.removeProperty('opacity');
      tooltip.style.removeProperty('transform');
      if (activeTarget?.isConnected && !tooltip.hidden) {
        position(activeTarget, { measureSilently: true });
      }
      tooltip.dataset.state = 'open';
    };

    if (prefersReducedMotion(window) || typeof message.animate !== 'function') {
      finish();
      return;
    }

    // Geometry only on the shell — opacity locked at 1 in both keyframes.
    shellAnimation = run(tooltip, [
      { width: `${Math.round(startWidth)}px`, left: `${Math.round(startLeft)}px`, opacity: 1 },
      { width: `${Math.round(endWidth)}px`, left: `${Math.round(endLeft)}px`, opacity: 1 },
    ], { duration: WIDTH_MORPH_MS, easing: EASE_OUT });

    const outgoing = run(previous, [
      { opacity: 1 },
      { opacity: 0 },
    ], { duration: TEXT_SWAP_MS, easing: 'linear' });

    const incoming = run(message, [
      { opacity: 0 },
      { opacity: 1 },
    ], { duration: TEXT_SWAP_MS, easing: 'linear' });

    contentAnimations = [outgoing, incoming].filter(Boolean);

    Promise.allSettled(
      [shellAnimation, outgoing, incoming].filter(Boolean).map((entry) => entry.finished),
    ).then(finish, finish);
  };

  const finishHide = (version) => {
    if (version !== motionVersion || disposed) return;
    if (activeTarget) updateDescription(activeTarget, false);
    activeTarget = null;
    pendingTarget = null;
    renderedSignature = '';
    contentVersion += 1;
    cancelContentAnimations();
    settleContent();
    tooltip.hidden = true;
    tooltip.dataset.state = 'closed';
    lastHiddenAt = Date.now();
    clearShellInlineMotion();
  };

  const hide = ({ immediate = false } = {}) => {
    cancelTimer('show');
    cancelTimer('hide');
    pendingTarget = null;
    if (tooltip.hidden) return;
    const version = ++motionVersion;
    contentVersion += 1;
    cancelContentAnimations();
    tooltip.dataset.state = 'closing';
    if (immediate || prefersReducedMotion(window) || typeof tooltip.animate !== 'function') {
      finishHide(version);
      return;
    }
    const closeSide = tooltip.dataset.side;
    const closeTravel = closeSide === 'left'
      ? { x: -2, y: 0 }
      : closeSide === 'right'
        ? { x: 2, y: 0 }
        : closeSide === 'top'
          ? { x: 0, y: -2 }
          : { x: 0, y: 2 };
    shellAnimation = run(tooltip, [
      { opacity: 1, transform: 'translate(0, 0) scale(1)' },
      { opacity: 0, transform: `translate(${closeTravel.x}px, ${closeTravel.y}px) scale(0.985)` },
    ], { duration: 90, easing: 'cubic-bezier(0.4, 0, 1, 1)' });
    if (!shellAnimation?.finished) {
      finishHide(version);
      return;
    }
    shellAnimation.finished.then(
      () => finishHide(version),
      () => {},
    );
  };

  const scheduleShow = (target, { immediate = false } = {}) => {
    if (!target || target === activeTarget) {
      if (target === activeTarget) cancelTimer('hide');
      return;
    }
    cancelTimer('show');
    cancelTimer('hide');
    pendingTarget = target;
    const withinGrace = Date.now() - lastHiddenAt <= HOVER_GRACE_WINDOW || !tooltip.hidden;
    const delay = tooltipShowDelay(target, { withinGrace, immediate });
    if (delay === 0) {
      show(target);
      return;
    }
    showTimerId = window.setTimeout(() => {
      showTimerId = null;
      if (pendingTarget === target) show(target);
    }, delay);
  };

  const scheduleHide = (delay = HIDE_DELAY) => {
    cancelTimer('show');
    pendingTarget = null;
    cancelTimer('hide');
    if (delay <= 0) {
      hide();
      return;
    }
    hideTimerId = window.setTimeout(() => {
      hideTimerId = null;
      if (activeTarget && isInsideSafeZone(activeTarget)) return;
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

  let mutationFrame = null;
  const flushMutations = () => {
    mutationFrame = null;
    if (!activeTarget?.isConnected) return;
    if (activeTarget.dataset.tooltip?.trim()) refreshActiveLabel();
    else hide({ immediate: true });
  };

  const onMutations = (records) => {
    let shouldRefresh = false;
    records.forEach((record) => {
      if (record.type === 'childList') record.addedNodes.forEach(migrateTree);
      if (record.type === 'attributes' && record.attributeName === 'title') migrateTitle(record.target);
      if (
        record.type === 'attributes'
        && (record.attributeName === 'data-tooltip' || record.attributeName === 'data-tooltip-shortcut')
        && record.target === activeTarget
      ) {
        shouldRefresh = true;
      }
    });
    // Coalesce bursts (mode cycle + status/editor feedback) into one label morph.
    if (!shouldRefresh || !activeTarget) return;
    if (mutationFrame !== null) return;
    mutationFrame = window.requestAnimationFrame?.(flushMutations) ?? null;
    if (mutationFrame === null) flushMutations();
  };

  const trackPointer = (event) => {
    if (typeof event.clientX === 'number' && typeof event.clientY === 'number') {
      lastPointer = { x: event.clientX, y: event.clientY };
    }
  };

  const onPointerOver = (event) => {
    trackPointer(event);
    const target = tooltipTarget(event.target);
    if (!target || target.contains(event.relatedTarget)) return;
    scheduleShow(target);
  };
  const onPointerOut = (event) => {
    trackPointer(event);
    const target = tooltipTarget(event.target);
    if (!target || target.contains(event.relatedTarget)) return;
    const nextTarget = tooltipTarget(event.relatedTarget);
    if (nextTarget) {
      scheduleShow(nextTarget);
      return;
    }
    if (activeTarget === target && isInsideSafeZone(target, event.clientX, event.clientY)) {
      cancelTimer('hide');
      return;
    }
    scheduleHide();
  };
  const onPointerMove = (event) => {
    trackPointer(event);
    if (!activeTarget || tooltip.hidden || hideTimerId === null) return;
    if (isInsideSafeZone(activeTarget, event.clientX, event.clientY)) cancelTimer('hide');
  };
  const onFocusIn = (event) => scheduleShow(tooltipTarget(event.target), { immediate: true });
  const onFocusOut = (event) => {
    if (activeTarget?.contains(event.relatedTarget)) return;
    scheduleHide(0);
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape' && (!tooltip.hidden || pendingTarget)) hide({ immediate: true });
  };
  const onDismiss = (event) => {
    const eventTarget = event?.target;
    if (
      eventTarget
      && (
        activeTarget?.contains?.(eventTarget)
        || pendingTarget?.contains?.(eventTarget)
        || tooltipTarget(eventTarget) === activeTarget
      )
    ) {
      return;
    }
    if (event?.type === 'scroll') {
      if (document.body.classList.contains('is-mode-morphing')) return;
      if (activeTarget && isInsideSafeZone(activeTarget)) return;
    }
    hide({ immediate: true });
  };

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
      attributeFilter: ['title', 'data-tooltip', 'data-tooltip-shortcut'],
    });
    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('pointermove', onPointerMove, { passive: true });
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
    if (mutationFrame !== null) window.cancelAnimationFrame?.(mutationFrame);
    mutationFrame = null;
    document.removeEventListener('pointerover', onPointerOver);
    document.removeEventListener('pointerout', onPointerOut);
    document.removeEventListener('pointermove', onPointerMove);
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
    contentVersion += 1;
    cancelContentAnimations();
    clearShellInlineMotion();
    if (activeTarget) updateDescription(activeTarget, false);
    activeTarget = null;
    pendingTarget = null;
    renderedSignature = '';
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
