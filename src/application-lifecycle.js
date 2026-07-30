export function createApplicationLifecycleController({
  window,
  document,
  mounts = [],
  events = [],
  startup,
  disposables = [],
  isDirty = () => false,
  hooks = {},
} = {}) {
  if (!window || !document) {
    throw new TypeError('Application Lifecycle requires window and document');
  }

  let disposed = false;
  let started = false;
  let startPromise = null;
  const eventCleanups = [];

  const eventList = () => (typeof events === 'function' ? events() : events);
  const disposableList = () => (typeof disposables === 'function' ? disposables() : disposables);

  const bindEvents = () => {
    for (const binding of eventList() || []) {
      if (!binding?.target?.addEventListener || !binding.type || !binding.listener) continue;
      binding.target.addEventListener(binding.type, binding.listener, binding.options);
      eventCleanups.push(() => binding.target.removeEventListener(binding.type, binding.listener, binding.options));
    }
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    eventCleanups.splice(0).reverse().forEach((cleanup) => cleanup());

    const seen = new Set();
    [...(disposableList() || [])].reverse().forEach((disposable) => {
      const disposeOne = typeof disposable === 'function'
        ? disposable
        : disposable?.dispose?.bind(disposable);
      if (!disposeOne || seen.has(disposeOne)) return;
      seen.add(disposeOne);
      try {
        disposeOne();
      } catch (error) {
        hooks.onDiagnostic?.('Application cleanup failed', error);
      }
    });
  };

  const beforeUnload = (event) => {
    if (isDirty()) {
      event.preventDefault();
      event.returnValue = '';
    }
    dispose();
  };

  const start = () => {
    if (disposed) return Promise.reject(new Error('Application Lifecycle is disposed'));
    if (startPromise) return startPromise;
    startPromise = (async () => {
      try {
        for (const mount of mounts || []) {
          if (disposed) return { status: 'disposed' };
          await mount?.();
        }
        if (disposed) return { status: 'disposed' };
        bindEvents();
        window.addEventListener('beforeunload', beforeUnload);
        eventCleanups.push(() => window.removeEventListener('beforeunload', beforeUnload));
        await startup?.();
        return { status: 'started' };
      } catch (error) {
        dispose();
        throw error;
      }
    })();
    started = true;
    return startPromise;
  };

  return Object.freeze({
    start,
    dispose,
    isStarted: () => started,
    isDisposed: () => disposed,
  });
}
