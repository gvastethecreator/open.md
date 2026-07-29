import { getDisplayName, isSupportedFilePath } from './core/reader.js';

const OPEN_ORIGINS = new Set(['launch', 'association', 'picker', 'drop', 'link']);
const LOCAL_ORIGINS = new Set(['picker', 'drop', 'link']);
const MAX_REMEMBERED_DELIVERIES = 512;

function pathKey(path) {
  return path.trim().replace(/\\/g, '/').toLocaleLowerCase('en-US');
}

function normalizeIntent(value) {
  if (!OPEN_ORIGINS.has(value?.origin)) {
    throw new TypeError('Open intent has an invalid origin');
  }

  const seen = new Set();
  const items = [];
  for (const candidate of Array.isArray(value.items) ? value.items : []) {
    if (!candidate || typeof candidate.path !== 'string' || candidate.path.trim() === '') continue;
    const key = pathKey(candidate.path);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      path: candidate.path.trim(),
      fragment: typeof candidate.fragment === 'string' ? candidate.fragment : '',
    });
  }

  const deliveryKey = value.delivery?.key;
  const delivery = deliveryKey !== undefined && deliveryKey !== null
    ? {
        key: String(deliveryKey),
        acknowledge: value.delivery?.acknowledge,
      }
    : null;

  return { origin: value.origin, items, delivery };
}

function createResult({ status, openedHere, openedInWindows, rejected, failures }) {
  return { status, openedHere, openedInWindows, rejected, failures };
}

export function createOpenIntentController({
  session,
  openWindow,
  onFeedback,
  onDiagnostic,
}) {
  if (typeof session?.open !== 'function' || typeof session?.current !== 'function') {
    throw new Error('Open intent controller requires a document session');
  }

  let ready = false;
  let started = false;
  let disposed = false;
  let orderedChain = Promise.resolve();
  const waiting = [];
  const deliveries = new Map();

  const execute = async (intent) => {
    const supported = [];
    const rejected = [];
    for (const item of intent.items) {
      if (isSupportedFilePath(item.path)) supported.push(item);
      else rejected.push({ path: item.path, reason: 'unsupported' });
    }

    if (rejected.length > 0) {
      onFeedback?.('Only .md, .markdown and .txt files are supported');
    }

    if (supported.length === 0) {
      return createResult({
        status: 'rejected',
        openedHere: [],
        openedInWindows: [],
        rejected,
        failures: [],
      });
    }

    const openedHere = [];
    const openedInWindows = [];
    const failures = [];
    const occupied = session.current()?.state !== 'idle';
    const shouldOpenHere = LOCAL_ORIGINS.has(intent.origin) || !occupied;
    let windowItems = supported;
    let superseded = false;

    if (shouldOpenHere) {
      const [first, ...rest] = supported;
      const result = await session.open({ path: first.path, fragment: first.fragment });
      windowItems = rest;
      if (result?.status === 'ready') openedHere.push(first.path);
      else if (result?.status === 'superseded') superseded = true;
      else if (result?.status === 'failed') failures.push({ path: first.path, error: result.error });
    }

    for (const item of windowItems) {
      try {
        if (typeof openWindow !== 'function') throw new Error('Window adapter unavailable');
        await openWindow(item.path);
        openedInWindows.push(item.path);
      } catch (error) {
        failures.push({ path: item.path, error });
        onDiagnostic?.('Could not open an additional window', error);
        onFeedback?.(`Could not open ${getDisplayName(item.path)}`);
      }
    }

    const partial = rejected.length > 0 || failures.length > 0;
    return createResult({
      status: superseded ? 'superseded' : partial ? 'partial' : 'completed',
      openedHere,
      openedInWindows,
      rejected,
      failures,
    });
  };

  const scheduleOrdered = (intent) => {
    const operation = orderedChain.then(() => execute(intent));
    orderedChain = operation.catch(() => undefined);
    return operation;
  };

  const schedule = (intent, forceOrdered = false) => {
    const ordered = forceOrdered || intent.origin === 'association' || intent.origin === 'launch';
    return ordered ? scheduleOrdered(intent) : execute(intent);
  };

  const enqueueUntilReady = (intent) => new Promise((resolve, reject) => {
    waiting.push({ intent, resolve, reject });
  });

  const submit = (value) => {
    if (disposed) return Promise.reject(new Error('Open intent controller is disposed'));

    let intent;
    try {
      intent = normalizeIntent(value);
    } catch (error) {
      return Promise.reject(error);
    }

    const deliveryKey = intent.delivery?.key || null;
    if (deliveryKey && deliveries.has(deliveryKey)) return deliveries.get(deliveryKey);

    const operation = ready ? schedule(intent) : enqueueUntilReady(intent);
    const acknowledgedOperation = (async () => {
      try {
        return await operation;
      } finally {
        if (typeof intent.delivery?.acknowledge === 'function') {
          try {
            await intent.delivery.acknowledge();
          } catch (error) {
            onDiagnostic?.('Could not acknowledge the file-open request', error);
          }
        }
      }
    })();

    if (deliveryKey) {
      if (deliveries.size >= MAX_REMEMBERED_DELIVERIES) {
        deliveries.delete(deliveries.keys().next().value);
      }
      deliveries.set(deliveryKey, acknowledgedOperation);
    }
    return acknowledgedOperation;
  };

  const start = async (initialIntent = null) => {
    if (disposed) throw new Error('Open intent controller is disposed');
    if (started) return orderedChain;
    started = true;

    if (initialIntent) {
      await schedule(normalizeIntent(initialIntent), true);
    }

    ready = true;
    const queued = waiting.splice(0);
    for (const entry of queued) {
      schedule(entry.intent, true).then(entry.resolve, entry.reject);
    }
    await orderedChain;
  };

  return Object.freeze({
    start,
    submit,
    dispose() {
      if (disposed) return;
      disposed = true;
      const error = new Error('Open intent controller is disposed');
      waiting.splice(0).forEach(({ reject }) => reject(error));
    },
  });
}
