export const MAX_IMAGE_RESOURCE_BYTES = 64 * 1024 * 1024;

const IMAGE_MIME_TYPES = Object.freeze({
  avif: 'image/avif',
  bmp: 'image/bmp',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
});

export class ImageResourceBudgetError extends Error {
  constructor(limitBytes, usedBytes, requestedBytes) {
    const limitMiB = (limitBytes / (1024 * 1024)).toFixed(0);
    super(`The document image budget is ${limitMiB} MiB; this image would exceed it.`);
    this.name = 'ImageResourceBudgetError';
    this.code = 'IMAGE_RESOURCE_BUDGET_EXCEEDED';
    this.limitBytes = limitBytes;
    this.usedBytes = usedBytes;
    this.requestedBytes = requestedBytes;
  }
}

export function getImageMimeType(source) {
  if (typeof source !== 'string' || source.trim() === '') return null;

  const withoutQueryOrFragment = source.trim().split(/[?#]/, 1)[0];
  let decodedSource = withoutQueryOrFragment;
  try {
    decodedSource = decodeURIComponent(withoutQueryOrFragment);
  } catch {
    return null;
  }

  const normalizedSource = decodedSource.replace(/\\/g, '/');
  const extension = normalizedSource.slice(normalizedSource.lastIndexOf('.') + 1).toLowerCase();
  return IMAGE_MIME_TYPES[extension] || null;
}

export function toUint8Array(value) {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }

  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }

  return null;
}

export class ImageResourcePool {
  #resources = new Map();

  #bytesUsed = 0;

  #budgetBytes;

  #createObjectURL;

  #revokeObjectURL;

  constructor({
    budgetBytes = MAX_IMAGE_RESOURCE_BYTES,
    createObjectURL = (blob) => URL.createObjectURL(blob),
    revokeObjectURL = (url) => URL.revokeObjectURL(url),
  } = {}) {
    this.#budgetBytes = budgetBytes;
    this.#createObjectURL = createObjectURL;
    this.#revokeObjectURL = revokeObjectURL;
  }

  get budgetBytes() {
    return this.#budgetBytes;
  }

  get bytesUsed() {
    return this.#bytesUsed;
  }

  get size() {
    return this.#resources.size;
  }

  create(response, mimeType) {
    const bytes = toUint8Array(response);
    if (!bytes) {
      throw new TypeError('The image response did not contain raw bytes.');
    }
    if (typeof mimeType !== 'string' || mimeType.trim() === '') {
      throw new TypeError('An image MIME type is required.');
    }

    const requestedBytes = bytes.byteLength;
    if (this.#bytesUsed + requestedBytes > this.#budgetBytes) {
      throw new ImageResourceBudgetError(this.#budgetBytes, this.#bytesUsed, requestedBytes);
    }

    const objectUrl = this.#createObjectURL(new Blob([bytes], { type: mimeType }));
    if (typeof objectUrl !== 'string' || objectUrl === '') {
      throw new Error('Could not create a local image URL.');
    }

    this.#resources.set(objectUrl, requestedBytes);
    this.#bytesUsed += requestedBytes;
    return objectUrl;
  }

  revoke(objectUrl) {
    const bytes = this.#resources.get(objectUrl);
    if (bytes === undefined) return false;

    this.#resources.delete(objectUrl);
    this.#bytesUsed -= bytes;
    try {
      this.#revokeObjectURL(objectUrl);
    } catch {
      // Releasing the accounting entry keeps the pool usable even if the browser
      // rejects a stale URL during teardown.
    }
    return true;
  }

  clear() {
    for (const objectUrl of this.#resources.keys()) {
      this.revoke(objectUrl);
    }
  }
}
