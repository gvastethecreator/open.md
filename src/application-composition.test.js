import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(root, 'index.html'), 'utf8');

describe('application composition seam', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  // Full-suite boot imports main + mounts the real shell; under parallel
  // jsdom workers this can exceed the default 5s without hanging.
  it('exports startOpenMdApplication and boots without Tauri imports in main', async () => {
    const mainSource = readFileSync(join(root, 'src/main.js'), 'utf8');
    const ingressSource = readFileSync(join(root, 'src/document-ingress-controller.js'), 'utf8');
    expect(mainSource).not.toMatch(/from '@tauri-apps\//);
    expect(ingressSource).not.toMatch(/from '@tauri-apps\//);
    expect(mainSource).not.toMatch(/from '\.\/editor-session\.js'/);
    const adapterSource = readFileSync(join(root, 'src/application-runtime-adapters.js'), 'utf8');
    expect(adapterSource).not.toMatch(/from '\.\/mermaid-renderer\.js'/);
    expect(mainSource).toMatch(/export async function startOpenMdApplication/);
    expect(mainSource).toMatch(/createDocumentLinkController/);

    const dom = new JSDOM(html, {
      url: 'https://open.md.local/',
      pretendToBeVisual: true,
      runScripts: 'outside-only',
    });
    dom.window.__VITEST__ = true;
    dom.window.matchMedia = () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    });
    dom.window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    vi.stubGlobal('window', dom.window);
    vi.stubGlobal('document', dom.window.document);
    vi.stubGlobal('HTMLElement', dom.window.HTMLElement);
    vi.stubGlobal('Element', dom.window.Element);
    vi.stubGlobal('Node', dom.window.Node);
    vi.stubGlobal('CustomEvent', dom.window.CustomEvent);
    vi.stubGlobal('DOMParser', dom.window.DOMParser);
    vi.stubGlobal('MutationObserver', dom.window.MutationObserver);
    vi.stubGlobal('requestAnimationFrame', (cb) => dom.window.setTimeout(() => cb(0), 0));
    vi.stubGlobal('cancelAnimationFrame', (id) => dom.window.clearTimeout(id));

    const { startOpenMdApplication } = await import('./main.js');
    const app = await startOpenMdApplication();
    expect(app.currentPath()).toBeNull();
    expect(app.zoom()).toBe(1);
    await app.dispose();
  }, 20_000);
});
