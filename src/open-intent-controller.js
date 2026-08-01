import { getDisplayName } from './document-path.js';
import { isSupportedFilePath } from './format-detect.js';

const OPEN_ORIGINS = new Set(['launch', 'association', 'picker', 'drop', 'link']);
const LOCAL_ORIGINS = new Set(['picker', 'drop', 'link']);
const MAX_REMEMBERED_DELIVERIES = 512;

function pathKey(path) {
  const normalized = path.trim().replace(/\\/g, '/');
  const isWindowsPath = /^[a-z]:/i.test(normalized) || normalized.startsWith('//');
  return isWindowsPath ? normalized.toLocaleLowerCase('en-US') : normalized;
}

export function orderNativeOpenRequests(...batches) {
  const seen = new Set();
  const requests = [];
  for (const batch of batches) {
    for (const request of Array.isArray(batch) ? batch : []) {
      const key = request?.id === undefined || request?.id === null
        ? null
        : String(request.id);
      if (key !== null && seen.has(key)) continue;
      if (key !== null) seen.add(key);
      requests.push({ request, index: requests.length });
    }
  }

  requests.sort((left, right) => {
    const leftId = Number(left.request?.id);
    const rightId = Number(right.request?.id);
    if (Number.isSafeInteger(leftId) && Number.isSafeInteger(rightId) && leftId !== rightId) {
      return leftId - rightId;
    }
    return left.index - right.index;
  });
  return requests.map(({ request }) => request);
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
  const assertActive = () => {
    if (disposed) throw new Error('Open intent controller is disposed');
  };

  const pruneDeliveries = () => {
    if (deliveries.size <= MAX_REMEMBERED_DELIVERIES) return;
    for (const [key, entry] of deliveries) {
      if (deliveries.size <= MAX_REMEMBERED_DELIVERIES) break;
      if (entry.settled && entry.acknowledged) deliveries.delete(key);
    }
  };

  const acknowledgeDelivery = async (entry) => {
    if (entry.acknowledged) return;
    if (typeof entry.acknowledge !== 'function') {
      entry.acknowledged = true;
      pruneDeliveries();
      return;
    }
    if (entry.acknowledging) return entry.acknowledging;

    entry.acknowledging = (async () => {
      try {
        await entry.acknowledge();
        entry.acknowledged = true;
      } catch (error) {
        onDiagnostic?.('Could not acknowledge the file-open request', error);
      } finally {
        entry.acknowledging = null;
        pruneDeliveries();
      }
    })();
    return entry.acknowledging;
  };

  const execute = async (intent) => {
    assertActive();
    const supported = [];
    const rejected = [];
    for (const item of intent.items) {
      if (isSupportedFilePath(item.path)) supported.push(item);
      else rejected.push({ path: item.path, reason: 'unsupported' });
    }

    if (rejected.length > 0) {
      onFeedback?.('Only Markdown, text, and image files are supported');
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
      assertActive();
      windowItems = rest;
      if (result?.status === 'ready') openedHere.push(first.path);
      else if (result?.status === 'superseded') {
        if (LOCAL_ORIGINS.has(intent.origin)) superseded = true;
        else windowItems = supported;
      }
      else if (result?.status === 'failed') failures.push({ path: first.path, error: result.error });
    }

    for (const item of windowItems) {
      try {
        assertActive();
        if (typeof openWindow !== 'function') throw new Error('Window adapter unavailable');
        await openWindow(item.path);
        assertActive();
        openedInWindows.push(item.path);
      } catch (error) {
        assertActive();
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
    if (deliveryKey && deliveries.has(deliveryKey)) {
      const entry = deliveries.get(deliveryKey);
      if (typeof entry.acknowledge !== 'function'
        && typeof intent.delivery?.acknowledge === 'function') {
        entry.acknowledge = intent.delivery.acknowledge;
        entry.acknowledged = false;
      }
      if (entry.settled && !entry.acknowledged) void acknowledgeDelivery(entry);
      return entry.operation;
    }

    const operation = ready ? schedule(intent) : enqueueUntilReady(intent);
    if (!deliveryKey) return operation;

    const entry = {
      settled: false,
      acknowledged: false,
      acknowledging: null,
      acknowledge: intent.delivery?.acknowledge,
      operation: null,
    };
    entry.operation = operation.then(
      async (result) => {
        entry.settled = true;
        await acknowledgeDelivery(entry);
        return result;
      },
      (error) => {
        entry.settled = true;
        deliveries.delete(deliveryKey);
        throw error;
      }
    );
    deliveries.set(deliveryKey, entry);
    pruneDeliveries();
    return entry.operation;
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
