import { getDocumentModePresentation } from './core/reader.js';

const MODES = new Set(['read', 'edit', 'source']);

export function createDocumentModeCoordinator({
  window,
  document,
  elements = {},
  adapters = {},
  hooks = {},
}) {
  if (!window || !document || typeof adapters.getMode !== 'function') {
    throw new TypeError('Document Mode Coordinator requires window, document and getMode');
  }

  let activeTransition = null;
  let fallbackTimeoutId = null;
  let morphGeneration = 0;
  let changeGeneration = 0;
  let changeTail = Promise.resolve();
  let cycling = false;
  let disposed = false;
  const animationCleanups = new Set();

  const current = () => {
    const mode = adapters.getMode();
    return MODES.has(mode) ? mode : 'read';
  };

  const surfaceFor = (mode = current()) => {
    if (mode === 'edit') return elements.editSurface;
    if (mode === 'source') return elements.sourceSurface;
    return elements.readSurface;
  };

  const clearOneShotAnimations = () => {
    for (const cleanup of [...animationCleanups]) cleanup();
    [elements.readSurface, elements.sourceSurface, elements.editSurface]
      .forEach((surface) => surface?.classList.remove('is-mode-morph-entering'));
    elements.minimap?.classList.remove('is-mode-chrome-morphing');
    elements.control?.querySelector('i')?.classList.remove('is-mode-changing');
  };

  const refreshTooltip = () => {
    const control = elements.control;
    if (!control || disposed) return;
    // Mid-cycle adapters can pass through intermediate modes (e.g. Edit→Read→Source).
    // Freezing the open tooltip until the cycle settles avoids thrash/re-open fades.
    if (cycling) return;
    const presentation = getDocumentModePresentation(current());
    const available = Boolean(adapters.isAvailable?.());
    // Short label only; aria-label keeps the longer description.
    const nextTooltip = available ? presentation.label : 'Open a file';
    const nextShortcut = available ? 'Ctrl+Shift+E' : '';
    // Only write when copy changes so MutationObserver does not re-enter for no-ops.
    if (control.dataset.tooltip !== nextTooltip) control.dataset.tooltip = nextTooltip;
    if (nextShortcut) {
      if (control.dataset.tooltipShortcut !== nextShortcut) {
        control.dataset.tooltipShortcut = nextShortcut;
      }
    } else if (control.dataset.tooltipShortcut) {
      delete control.dataset.tooltipShortcut;
    }
  };

  const finishMorph = (generation, { force = false } = {}) => {
    if (!force && generation !== morphGeneration) return;
    if (fallbackTimeoutId !== null) window.clearTimeout(fallbackTimeoutId);
    fallbackTimeoutId = null;
    activeTransition = null;
    clearOneShotAnimations();
    document.body.classList.remove('is-mode-morphing', 'is-mode-morphing-fallback');
    delete document.body.dataset.modeMorphFrom;
    delete document.body.dataset.modeMorphTo;
    hooks.finishNavigationMorph?.();
  };

  const replayOneShot = (element, className) => {
    if (!element || !className || disposed) return;
    element.classList.remove(className);
    let frameId = null;
    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      if (frameId !== null) window.cancelAnimationFrame?.(frameId);
      element.removeEventListener('animationend', cleanup);
      element.classList.remove(className);
      animationCleanups.delete(cleanup);
    };
    animationCleanups.add(cleanup);
    frameId = window.requestAnimationFrame?.(() => {
      frameId = null;
      if (disposed || !element.isConnected) {
        cleanup();
        return;
      }
      element.classList.add(className);
      element.addEventListener('animationend', cleanup, { once: true });
    }) ?? null;
  };

  const replayChromeMorph = () => {
    // Line numbers keep element identity and translate via CSS / view transitions.
    if (document.body.classList.contains('is-minimap')) {
      replayOneShot(elements.minimap, 'is-mode-chrome-morphing');
    }
  };

  const cancelTransition = () => {
    if (activeTransition) activeTransition.skipTransition?.();
    morphGeneration += 1;
    finishMorph(morphGeneration, { force: true });
  };

  const runMorph = async (update) => {
    cancelTransition();
    hooks.cancelCompetingTransition?.();
    const initialMode = current();
    const reduced = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    if (reduced) return update();

    const generation = ++morphGeneration;
    document.body.classList.add('is-mode-morphing');
    document.body.dataset.modeMorphFrom = initialMode;
    hooks.prepareNavigationMorph?.();

    const runFallback = async () => {
      document.body.classList.add('is-mode-morphing-fallback');
      try {
        const result = await update();
        if (disposed || generation !== morphGeneration) return result;
        const nextMode = current();
        document.body.dataset.modeMorphTo = nextMode;
        if (nextMode === initialMode) {
          finishMorph(generation);
          return result;
        }
        hooks.animateNavigationMorph?.();
        replayOneShot(surfaceFor(nextMode), 'is-mode-morph-entering');
        replayChromeMorph();
        fallbackTimeoutId = window.setTimeout(() => finishMorph(generation), 380);
        return result;
      } catch (error) {
        finishMorph(generation);
        throw error;
      }
    };

    if (typeof document.startViewTransition !== 'function') return runFallback();

    let updateResult;
    let transition;
    try {
      transition = document.startViewTransition(async () => {
        updateResult = await update();
        if (disposed || generation !== morphGeneration) return;
        document.body.dataset.modeMorphTo = current();
      });
    } catch {
      return runFallback();
    }

    activeTransition = transition;
    transition.ready?.catch?.(() => {});
    fallbackTimeoutId = window.setTimeout(() => finishMorph(generation), 440);
    Promise.resolve(transition.finished).then(
      () => finishMorph(generation),
      () => finishMorph(generation),
    );

    try {
      await transition.updateCallbackDone;
      if (disposed || generation !== morphGeneration) return updateResult;
      if (current() === initialMode) transition.skipTransition?.();
      return updateResult;
    } catch (error) {
      transition.skipTransition?.();
      finishMorph(generation);
      throw error;
    }
  };

  const refresh = ({ forceAnimation = false, updateTooltip = true } = {}) => {
    const control = elements.control;
    if (!control || disposed) return;
    const presentation = getDocumentModePresentation(current());
    const previousMode = control.dataset.mode;
    const available = Boolean(adapters.isAvailable?.());

    control.disabled = !available;
    control.dataset.mode = presentation.mode;
    control.setAttribute('aria-label', available
      ? presentation.ariaLabel
      : 'Open a file to change document mode');
    // updateTooltip is honored only when not mid-cycle (see refreshTooltip).
    if (updateTooltip) refreshTooltip();

    const icon = control.querySelector('i');
    if (icon) {
      // Keep the same <i> node; only class changes. Replacing the node would
      // fire pointerout/over and re-open the tooltip with a full shell fade.
      icon.className = presentation.iconClass;
      if (!cycling && (forceAnimation || (previousMode && previousMode !== presentation.mode))) {
        replayOneShot(icon, 'is-mode-changing');
      }
    }
    if (elements.label) elements.label.textContent = `${presentation.label} mode`;
  };

  const announceMode = (mode) => {
    const presentation = getDocumentModePresentation(mode);
    hooks.onToast?.(`${presentation.label} mode`);
  };

  const performChange = (update) => {
    if (disposed || !adapters.isAvailable?.()) return Promise.resolve(false);
    if (activeTransition) cancelTransition();
    const generation = ++changeGeneration;
    const documentIdentity = adapters.getDocumentIdentity?.();
    const execute = async () => {
      if (disposed || !adapters.isAvailable?.()) return false;
      if (
        typeof adapters.getDocumentIdentity === 'function'
        && !Object.is(adapters.getDocumentIdentity(), documentIdentity)
      ) return false;
      const isCurrentDocument = () => (
        !disposed
        && adapters.isAvailable?.()
        && (
          typeof adapters.getDocumentIdentity !== 'function'
          || Object.is(adapters.getDocumentIdentity(), documentIdentity)
        )
      );
      const hasScrollSnapshot = typeof hooks.captureScrollPosition === 'function';
      const scrollPosition = hasScrollSnapshot
        ? hooks.captureScrollPosition()
        : undefined;
      const initialMode = current();
      hooks.closeTransientUi?.();
      cycling = true;
      let restoredInsideMorph = false;
      let succeeded = false;
      try {
        succeeded = Boolean(await runMorph(async () => {
          const result = await update(initialMode, { documentIdentity, isCurrentDocument });
          if (hasScrollSnapshot && isCurrentDocument()) {
            hooks.restoreScrollPosition?.(scrollPosition, { sync: true });
            restoredInsideMorph = true;
          } else if (isCurrentDocument()) {
            hooks.syncNavigationChrome?.();
          }
          return result;
        }));
        return succeeded;
      } finally {
        if (hasScrollSnapshot && isCurrentDocument() && !restoredInsideMorph) {
          hooks.restoreScrollPosition?.(scrollPosition, { sync: true });
        }
        if (generation === changeGeneration && !disposed) {
          const nextMode = current();
          const modeChanged = nextMode !== initialMode;
          // End cycle before refreshTooltip so the settled mode is written once.
          cycling = false;
          refresh({ forceAnimation: modeChanged, updateTooltip: true });
          if (succeeded && modeChanged) announceMode(nextMode);
        }
      }
    };
    const result = changeTail.then(execute, execute);
    changeTail = result.catch(() => {});
    return result;
  };

  const cycle = () => performChange(async (initialMode, { documentIdentity, isCurrentDocument }) => {
    if (initialMode === 'edit') {
      if (!await adapters.exitEdit?.()) return false;
      if (!isCurrentDocument()) return false;
      await adapters.setSource?.(true);
      return isCurrentDocument();
    }
    if (initialMode === 'source') {
      await adapters.setSource?.(false);
      return isCurrentDocument();
    }
    if (!isCurrentDocument()) return false;
    const entered = await adapters.enterEdit?.(documentIdentity);
    return Boolean(entered) && isCurrentDocument();
  });

  const toggleEdit = () => performChange(async (initialMode, { documentIdentity, isCurrentDocument }) => {
    if (initialMode === 'edit') {
      const exited = await adapters.exitEdit?.();
      return Boolean(exited) && isCurrentDocument();
    }
    if (initialMode === 'source') {
      await adapters.setSource?.(false);
      if (!isCurrentDocument()) return false;
    }
    const entered = await adapters.enterEdit?.(documentIdentity);
    return Boolean(entered) && isCurrentDocument();
  });

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    changeGeneration += 1;
    cycling = false;
    cancelTransition();
  };

  return Object.freeze({
    current,
    refresh,
    cycle,
    toggleEdit,
    cancelTransition,
    dispose,
  });
}
