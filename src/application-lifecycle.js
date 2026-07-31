export function createApplicationLifecycleController({
  window,
  isDirty = () => false,
  hooks = {},
} = {}) {
  if (!window) {
    throw new TypeError('Application Lifecycle requires window');
  }

  const AbortControllerClass = window.AbortController || globalThis.AbortController;
  const abortController = new AbortControllerClass();
  const cleanups = [];
  const owned = new Set();
  let phase = 'idle';
  let startPromise = null;
  let disposePromise = null;

  const reportCleanupError = (error) => {
    hooks.onDiagnostic?.('Application cleanup failed', error);
  };

  const cleanupFor = (owner) => {
    if (typeof owner === 'function') return owner;
    if (owner && typeof owner.dispose === 'function') return () => owner.dispose();
    return null;
  };

  const own = (owner) => {
    const cleanup = cleanupFor(owner);
    if (!cleanup) throw new TypeError('Application Lifecycle can only own cleanup functions or disposable objects');
    if (owned.has(owner)) return owner;

    if (phase === 'disposing' || phase === 'disposed') {
      try {
        Promise.resolve(cleanup()).catch(reportCleanupError);
      } catch (error) {
        reportCleanupError(error);
      }
      throw new Error('Application Lifecycle is disposed');
    }

    owned.add(owner);
    cleanups.push({ owner, cleanup });
    return owner;
  };

  const listen = (target, type, listener, options) => {
    if (target == null) return () => {};
    if (
      typeof target.addEventListener !== 'function'
      || typeof target.removeEventListener !== 'function'
      || typeof type !== 'string'
      || type.length === 0
      || typeof listener !== 'function'
    ) {
      throw new TypeError('Application Lifecycle received an invalid event binding');
    }

    target.addEventListener(type, listener, options);
    let active = true;
    const unlisten = () => {
      if (!active) return;
      active = false;
      target.removeEventListener(type, listener, options);
    };
    own(unlisten);
    return unlisten;
  };

  const dispose = () => {
    if (disposePromise) return disposePromise;
    phase = 'disposing';
    abortController.abort();
    disposePromise = (async () => {
      const cleanupErrors = [];
      while (cleanups.length > 0) {
        const entry = cleanups.pop();
        try {
          await entry.cleanup();
        } catch (error) {
          cleanupErrors.push(error);
          reportCleanupError(error);
        } finally {
          owned.delete(entry.owner);
        }
      }
      owned.clear();
      phase = 'disposed';
      return { status: 'disposed', cleanupErrors };
    })();
    return disposePromise;
  };

  const beforeUnload = (event) => {
    if (isDirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
    void dispose();
  };

  const scope = Object.freeze({
    signal: abortController.signal,
    own,
    listen,
  });

  const start = (setup) => {
    if (startPromise) return startPromise;
    if (phase === 'disposing' || phase === 'disposed') {
      return Promise.reject(new Error('Application Lifecycle is disposed'));
    }
    if (setup != null && typeof setup !== 'function') {
      return Promise.reject(new TypeError('Application Lifecycle setup must be a function'));
    }

    phase = 'starting';
    startPromise = (async () => {
      try {
        listen(window, 'beforeunload', beforeUnload);
        await setup?.(scope);
        if (phase === 'disposing' || phase === 'disposed') return { status: 'disposed' };
        phase = 'started';
        return { status: 'started' };
      } catch (error) {
        await dispose();
        throw error;
      }
    })();
    return startPromise;
  };

  return Object.freeze({
    start,
    dispose,
    isStarted: () => startPromise !== null,
    isDisposed: () => phase === 'disposing' || phase === 'disposed',
  });
}
