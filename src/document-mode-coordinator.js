export function getDocumentModePresentation(mode) {
  const normalizedMode = MODES.has(mode) ? mode : 'read';
  const sourceActive = normalizedMode === 'source' || normalizedMode === 'source-edit';
  const editActive = normalizedMode === 'edit' || normalizedMode === 'source-edit';
  const sourceLabel = sourceActive ? 'Source' : 'Rendered';
  const sourceNextLabel = sourceActive ? 'Rendered' : 'Source';
  const editLabel = editActive ? 'Edit' : 'Read only';
  const editNextLabel = editActive ? 'Read only' : 'Edit';

  return {
    mode: normalizedMode,
    source: {
      active: sourceActive,
      state: sourceActive ? 'source' : 'rendered',
      label: sourceLabel,
      iconClass: sourceActive ? 'iconoir-code' : 'iconoir-page',
      ariaLabel: `${sourceLabel} view. Switch to ${sourceNextLabel} view`,
    },
    edit: {
      active: editActive,
      state: editActive ? 'edit' : 'read-only',
      label: editLabel,
      iconClass: editActive ? 'iconoir-edit-pencil' : 'iconoir-book',
      ariaLabel: `${editLabel} mode. Switch to ${editNextLabel} mode`,
    },
  };
}

const MODES = new Set(['read', 'edit', 'source', 'source-edit']);

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
    if (mode === 'edit' || mode === 'source-edit') return elements.editSurface;
    if (mode === 'source') return elements.sourceSurface;
    return elements.readSurface;
  };

  const clearOneShotAnimations = () => {
    for (const cleanup of [...animationCleanups]) cleanup();
    [elements.readSurface, elements.sourceSurface, elements.editSurface]
      .forEach((surface) => surface?.classList.remove('is-mode-morph-entering'));
    elements.minimap?.classList.remove('is-mode-chrome-morphing');
    elements.sourceControl?.querySelector('i')?.classList.remove('is-mode-changing');
    elements.editControl?.querySelector('i')?.classList.remove('is-mode-changing');
  };

  const isAvailable = (mode) => Boolean(adapters.isAvailable?.(mode));

  const refreshTooltip = (control, presentation, available, shortcut = '') => {
    if (!control || disposed) return;
    // A Source/Edit change can pass through Read. Keep tooltips stable until it settles.
    if (cycling) return;
    const hasDocument = Boolean(adapters.hasDocument?.());
    const nextTooltip = available
      ? presentation.label
      : hasDocument ? 'Unavailable for this document' : 'Open a file';
    const nextShortcut = available ? shortcut : '';
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

  const refreshControl = ({
    control,
    label,
    presentation,
    available,
    shortcut,
    suffix,
    updateTooltip,
  }) => {
    if (!control) return;
    const previousState = control.dataset.mode;
    control.disabled = !available;
    control.dataset.mode = presentation.state;
    control.setAttribute('aria-pressed', String(presentation.active));
    control.setAttribute('aria-label', available
      ? presentation.ariaLabel
      : adapters.hasDocument?.()
        ? `${presentation.label} is unavailable for this document`
        : 'Open a file to change document mode');

    const icon = control.querySelector('i');
    if (icon) {
      icon.className = presentation.iconClass;
      if (!cycling && previousState && previousState !== presentation.state) {
        replayOneShot(icon, 'is-mode-changing');
      }
    }
    if (label) label.textContent = `${presentation.label} ${suffix}`;
    if (updateTooltip) refreshTooltip(control, presentation, available, shortcut);
  };

  const refresh = ({ updateTooltip = true } = {}) => {
    if (disposed) return;
    const presentation = getDocumentModePresentation(current());
    refreshControl({
      control: elements.sourceControl,
      label: elements.sourceLabel,
      presentation: presentation.source,
      available: isAvailable('source'),
      shortcut: '',
      suffix: 'view',
      updateTooltip,
    });
    refreshControl({
      control: elements.editControl,
      label: elements.editLabel,
      presentation: presentation.edit,
      available: isAvailable('edit'),
      shortcut: 'Ctrl+Shift+E',
      suffix: 'mode',
      updateTooltip,
    });
  };

  const performChange = (requiredMode, update, announce) => {
    if (disposed || !isAvailable(requiredMode)) return Promise.resolve(false);
    if (activeTransition) cancelTransition();
    const generation = ++changeGeneration;
    const documentIdentity = adapters.getDocumentIdentity?.();
    const execute = async () => {
      if (disposed || !isAvailable(requiredMode)) return false;
      if (
        typeof adapters.getDocumentIdentity === 'function'
        && !Object.is(adapters.getDocumentIdentity(), documentIdentity)
      ) return false;
      const isCurrentDocument = () => (
        !disposed
        && isAvailable('read')
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
          // End the change before refreshTooltip so the settled mode is written once.
          cycling = false;
          refresh({ updateTooltip: true });
          if (succeeded && modeChanged) announce?.(nextMode);
        }
      }
    };
    const result = changeTail.then(execute, execute);
    changeTail = result.catch(() => {});
    return result;
  };

  const toggleSource = () => performChange('source', async (initialMode, { isCurrentDocument }) => {
    const sourceActive = initialMode === 'source' || initialMode === 'source-edit';
    await adapters.setSource?.(!sourceActive);
    return isCurrentDocument();
  }, (nextMode) => {
    hooks.onToast?.(`${getDocumentModePresentation(nextMode).source.label} view`);
  });

  const toggleEdit = () => performChange('edit', async (initialMode, { documentIdentity, isCurrentDocument }) => {
    if (initialMode === 'edit' || initialMode === 'source-edit') {
      const exited = await adapters.exitEdit?.();
      return Boolean(exited) && isCurrentDocument();
    }
    const entered = await adapters.enterEdit?.(documentIdentity);
    return Boolean(entered) && isCurrentDocument();
  }, (nextMode) => {
    hooks.onToast?.(`${getDocumentModePresentation(nextMode).edit.label} mode`);
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
    toggleSource,
    toggleEdit,
    cancelTransition,
    dispose,
  });
}
