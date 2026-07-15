import { describe, expect, it, vi } from 'vitest';
import {
  ImageResourceBudgetError,
  ImageResourcePool,
  getImageMimeType,
  toUint8Array,
} from './image-resources.js';

function createPool(options = {}) {
  const createdBlobs = [];
  const revokedUrls = [];
  let nextUrl = 0;
  const pool = new ImageResourcePool({
    createObjectURL: (blob) => {
      createdBlobs.push(blob);
      nextUrl += 1;
      return `blob:test-${nextUrl}`;
    },
    revokeObjectURL: (url) => revokedUrls.push(url),
    ...options,
  });
  return { pool, createdBlobs, revokedUrls };
}

describe('image resource pool', () => {
  it('accepts ArrayBuffer and byte views without widening their ranges', () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    const view = new Uint8Array(buffer, 1, 2);

    expect([...toUint8Array(buffer)]).toEqual([1, 2, 3, 4]);
    expect([...toUint8Array(view)]).toEqual([2, 3]);
    expect(toUint8Array(new DataView(buffer)).byteLength).toBe(4);
    expect(toUint8Array('base64-data')).toBeNull();
  });

  it('resolves supported image MIME types after decoding query and fragment', () => {
    expect(getImageMimeType('assets/photo.JPG?raw=1#preview')).toBe('image/jpeg');
    expect(getImageMimeType('assets/diagram%2Ewebp#preview')).toBe('image/webp');
    expect(getImageMimeType('assets/icon.svg')).toBeNull();
    expect(getImageMimeType('assets/no-extension')).toBeNull();
  });

  it('enforces a per-document byte budget before creating a URL', () => {
    const { pool, createdBlobs } = createPool({ budgetBytes: 4 });

    expect(pool.create(new Uint8Array([1, 2, 3]), 'image/png')).toBe('blob:test-1');
    expect(() => pool.create(new Uint8Array([4, 5]), 'image/png')).toThrow(ImageResourceBudgetError);
    expect(pool.bytesUsed).toBe(3);
    expect(createdBlobs).toHaveLength(1);
  });

  it('revokes one URL on decode failure and all URLs when a document is cleared', () => {
    const { pool, revokedUrls } = createPool();
    const first = pool.create(new Uint8Array([1]), 'image/png');
    const second = pool.create(new Uint8Array([2, 3]), 'image/jpeg');

    expect(pool.revoke(first)).toBe(true);
    expect(revokedUrls).toEqual([first]);
    expect(pool.bytesUsed).toBe(2);

    pool.clear();
    expect(revokedUrls).toEqual([first, second]);
    expect(pool.bytesUsed).toBe(0);
    expect(pool.size).toBe(0);

    const third = pool.create(new Uint8Array([4]), 'image/png');
    expect(third).toBe('blob:test-3');
    expect(pool.bytesUsed).toBe(1);
  });

  it('does not retain accounting when createObjectURL fails', () => {
    const revokeObjectURL = vi.fn();
    const pool = new ImageResourcePool({
      createObjectURL: () => {
        throw new Error('URL unavailable');
      },
      revokeObjectURL,
    });

    expect(() => pool.create(new Uint8Array([1, 2]), 'image/png')).toThrow('URL unavailable');
    expect(pool.bytesUsed).toBe(0);
    expect(pool.size).toBe(0);
    expect(revokeObjectURL).not.toHaveBeenCalled();
  });
});
