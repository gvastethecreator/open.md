import { getWindowControlPresentation } from './core/reader.js';

export function createWindowChrome({ document, elements, nativeWindow, onError = () => {} }) {
  if (!document || !nativeWindow) throw new TypeError('Window Chrome requires document and nativeWindow');

  let started = false;
  let disposed = false;
  let unlistenResize = null;

  const reportFailure = (message, error) => onError(message, error);

  const syncMaximizePresentation = async () => {
    if (disposed) return;
    try {
      const maximized = await nativeWindow.isMaximized();
      if (disposed) return;
      const presentation = getWindowControlPresentation(maximized);
      const icon = elements.maximize?.querySelector('i');
      if (icon) icon.className = presentation.iconClass;
      if (elements.maximize) {
        elements.maximize.setAttribute('aria-label', presentation.label);
        elements.maximize.title = presentation.label;
      }
      document.body.classList.toggle('is-window-maximized', maximized);
    } catch (error) {
      reportFailure('Could not inspect the window state', error);
    }
  };

  const run = async (action, failureMessage, afterAction = null) => {
    if (disposed) return;
    try {
      await action();
      if (!disposed) await afterAction?.();
    } catch (error) {
      reportFailure(failureMessage, error);
    }
  };

  const minimize = () => run(() => nativeWindow.minimize(), 'Could not minimize the window');
  const maximize = () => run(
    () => nativeWindow.toggleMaximize(),
    'Could not resize the window',
    syncMaximizePresentation
  );
  const close = () => run(() => nativeWindow.close(), 'Could not close the window');

  const start = async () => {
    if (started || disposed) return false;
    started = true;
    elements.minimize?.addEventListener('click', minimize);
    elements.maximize?.addEventListener('click', maximize);
    elements.close?.addEventListener('click', close);
    await syncMaximizePresentation();
    let nextUnlisten = null;
    try {
      nextUnlisten = await nativeWindow.onResized(syncMaximizePresentation);
    } catch (error) {
      reportFailure('Could not watch the window state', error);
      return true;
    }
    if (disposed) {
      nextUnlisten?.();
    } else {
      unlistenResize = nextUnlisten;
    }
    return true;
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    elements.minimize?.removeEventListener('click', minimize);
    elements.maximize?.removeEventListener('click', maximize);
    elements.close?.removeEventListener('click', close);
    unlistenResize?.();
    unlistenResize = null;
  };

  return Object.freeze({ start, sync: syncMaximizePresentation, dispose });
}
