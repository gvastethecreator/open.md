import { describe, expect, it } from 'vitest';
import {
  detectImageFormatFromMagic,
  looksLikeJson,
  resolveDocumentFormat,
} from './format-detect.js';

const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_SIG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);
const GIF_SIG = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
const WEBP_SIG = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
const BMP_SIG = new Uint8Array([0x42, 0x4d, 0x00, 0x00]);
const AVIF_SIG = new Uint8Array([
  0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
]);

describe('format detect', () => {
  it('detects image magic signatures', () => {
    expect(detectImageFormatFromMagic(PNG_SIG)).toBe('png');
    expect(detectImageFormatFromMagic(JPEG_SIG)).toBe('jpeg');
    expect(detectImageFormatFromMagic(GIF_SIG)).toBe('gif');
    expect(detectImageFormatFromMagic(WEBP_SIG)).toBe('webp');
    expect(detectImageFormatFromMagic(BMP_SIG)).toBe('bmp');
    expect(detectImageFormatFromMagic(AVIF_SIG)).toBe('avif');
    expect(detectImageFormatFromMagic(new Uint8Array([0x00, 0x01, 0x02]))).toBeNull();
  });

  it('rejects unknown extensions without expanding support', () => {
    const resolved = resolveDocumentFormat('payload.bin', PNG_SIG);
    expect(resolved.supported).toBe(false);
    expect(resolved.format).toBeNull();
  });

  it('reclassifies text companion path with PNG magic to image (F4)', () => {
    const resolved = resolveDocumentFormat('notes.txt', PNG_SIG);
    expect(resolved.supported).toBe(true);
    expect(resolved.kind).toBe('image');
    expect(resolved.format).toBe('png');
    expect(resolved.reclassified).toBe(true);
    expect(resolved.mime).toBe('image/png');
  });

  it('fail-closes image extension with non-image bytes (F3)', () => {
    const resolved = resolveDocumentFormat('photo.png', new Uint8Array([0x00, 0x01, 0x02, 0x03]));
    expect(resolved.supported).toBe(true);
    expect(resolved.failClosed).toMatch(/damaged|not a supported image/i);
    expect(resolved.kind).toBe('image');
  });

  it('keeps markdown and json extension mapping without header', () => {
    expect(resolveDocumentFormat('README.md').format).toBe('markdown');
    expect(resolveDocumentFormat('config.json').format).toBe('json');
    expect(resolveDocumentFormat('data.csv').format).toBe('csv');
    expect(resolveDocumentFormat('setup.ini').format).toBe('ini');
  });

  it('detects JSON leading character after BOM/whitespace', () => {
    expect(looksLikeJson(new TextEncoder().encode('  \n{"a":1}'))).toBe(true);
    expect(looksLikeJson(new TextEncoder().encode('\uFEFF[1]'))).toBe(true);
    expect(looksLikeJson(new TextEncoder().encode('not json'))).toBe(false);
  });
});
