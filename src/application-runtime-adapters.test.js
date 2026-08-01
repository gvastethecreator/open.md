import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
import {
  createApplicationRuntimeAdapters,
  NATIVE_ACCESS_ERROR,
} from './application-runtime-adapters.js';

function fixture({ native = false, preview = false } = {}) {
  const dom = new JSDOM('<!doctype html><body></body>');
  const window = dom.window;
  if (native) window.__TAURI_INTERNALS__ = {};
  if (preview) {
    window.__OPENMD_PREVIEW_DOCUMENTS__ = {
      'preview.md': {
        html: '<h1>Preview</h1>',
        source: '# Preview',
        lineCount: 1,
        characterCount: 9,
        wordCount: 2,
        readingTimeMinutes: 1,
      },
    };
  }
  return { dom, window };
}

describe('Application Runtime Adapters', () => {
  it('uses DEV preview documents and preserves deterministic save failure/delay behavior', async () => {
    const view = fixture({ preview: true });
    const adapters = createApplicationRuntimeAdapters({ window: view.window });
    const opened = await adapters.documents.open('preview.md');
    expect(opened).toEqual(view.window.__OPENMD_PREVIEW_DOCUMENTS__['preview.md']);

    const saved = await adapters.documents.save('preview.md', '# Updated\n\nText');
    expect(saved.source).toBe('# Updated\n\nText');
    expect(view.window.__OPENMD_PREVIEW_DOCUMENTS__['preview.md'].source).toBe('# Updated\n\nText');

    view.window.__OPENMD_PREVIEW_SAVE_FAILURE__ = true;
    await expect(adapters.documents.save('preview.md', 'nope')).rejects.toThrow('Preview save failure');
    expect(view.window.__OPENMD_PREVIEW_DOCUMENTS__['preview.md'].source).toBe('# Updated\n\nText');
  });

  it('fails browser-native operations with one stable error and never invokes Tauri', async () => {
    const view = fixture();
    const invoke = vi.fn();
    const adapters = createApplicationRuntimeAdapters({ window: view.window, invoke });

    await expect(adapters.documents.open('notes.md')).rejects.toMatchObject({
      code: 'NATIVE_ACCESS_UNAVAILABLE',
      message: NATIVE_ACCESS_ERROR,
    });
    await expect(adapters.windows.openDocument('notes.md')).rejects.toThrow(NATIVE_ACCESS_ERROR);
    expect(adapters.windows.setAlwaysOnTop).toBeUndefined();
    expect(invoke).not.toHaveBeenCalled();
  });

  it('maps native document, image, window and pin operations without leaking commands', async () => {
    const view = fixture({ native: true });
    const invoke = vi.fn(async (command, args) => {
      if (command === 'get_initial_file_paths') return ['launch.md'];
      return { command, args };
    });
    const nativeWindow = { setAlwaysOnTop: vi.fn(async () => {}) };
    const openUrl = vi.fn(async () => {});
    const adapters = createApplicationRuntimeAdapters({
      window: view.window,
      invoke,
      getCurrentWindow: () => nativeWindow,
      openUrl,
    });

    await adapters.documents.open('notes.md');
    await adapters.documents.save('notes.md', 'Updated');
    await adapters.documents.readImage('notes.md', 'assets/pixel.png');
    await adapters.documents.readImageFile('photo.png');
    await adapters.windows.openDocument('other.md');
    await adapters.windows.setAlwaysOnTop(true);
    await adapters.openRequests.acknowledge(7);
    await adapters.windows.openExternalUrl('https://example.com');
    await expect(adapters.openRequests.getInitialFilePaths()).resolves.toEqual(['launch.md']);
    await expect(adapters.openRequests.listPending()).resolves.toEqual([]);
    await expect(adapters.system.getProcessInstanceMode()).resolves.toEqual({
      allowMultipleInstances: true,
      processAllowsMultipleInstances: true,
      restartRequired: false,
      available: true,
    });
    await adapters.system.setAllowMultipleInstances(false);
    await expect(adapters.system.getFileAssociationStatus()).resolves.toMatchObject({
      available: true,
      command: 'get_file_association_status',
    });
    await adapters.system.requestFileAssociation();
    expect(adapters.windows.getNativeWindow()).toBe(nativeWindow);
    expect(typeof adapters.ingress.listen).toBe('function');
    expect(typeof adapters.ingress.openFileDialog).toBe('function');
    expect(typeof adapters.ingress.getCurrentWebview).toBe('function');
    expect(typeof adapters.ingress.listPendingOpenFileRequests).toBe('function');

    expect(invoke.mock.calls).toEqual([
      ['get_file_content', { path: 'notes.md' }],
      ['save_file_content', { path: 'notes.md', content: 'Updated' }],
      ['get_image_bytes', { documentPath: 'notes.md', relativeSource: 'assets/pixel.png' }],
      ['get_standalone_image_bytes', { path: 'photo.png' }],
      ['open_new_window', { path: 'other.md' }],
      ['acknowledge_open_file_request', { id: 7 }],
      ['get_initial_file_paths', undefined],
      ['list_pending_open_file_requests', undefined],
      ['get_process_instance_mode', undefined],
      ['set_allow_multiple_instances', { value: false }],
      ['get_file_association_status', undefined],
      ['request_file_association', undefined],
    ]);
    expect(nativeWindow.setAlwaysOnTop).toHaveBeenCalledWith(true);
    expect(openUrl).toHaveBeenCalledWith('https://example.com');
  });

  it('exposes browser fallbacks for system settings without invoking Tauri', async () => {
    const view = fixture();
    const invoke = vi.fn();
    const adapters = createApplicationRuntimeAdapters({ window: view.window, invoke });

    await expect(adapters.system.getProcessInstanceMode()).resolves.toEqual({
      allowMultipleInstances: true,
      processAllowsMultipleInstances: true,
      restartRequired: false,
      available: false,
    });
    await expect(adapters.system.getFileAssociationStatus()).resolves.toMatchObject({
      status: 'unavailable',
      available: false,
    });
    await expect(adapters.system.setAllowMultipleInstances(false)).rejects.toMatchObject({
      code: 'NATIVE_ACCESS_UNAVAILABLE',
    });
    await expect(adapters.system.requestFileAssociation()).rejects.toThrow(NATIVE_ACCESS_ERROR);
    expect(invoke).not.toHaveBeenCalled();
  });

  it('loads syntax lazily once and allows retry after a failed import', async () => {
    const view = fixture();
    const firstFailure = new Error('syntax unavailable');
    const highlightCodeBlocks = vi.fn(() => true);
    const syntaxLoader = vi
      .fn()
      .mockRejectedValueOnce(firstFailure)
      .mockResolvedValue({ highlightCodeBlocks });
    const adapters = createApplicationRuntimeAdapters({ window: view.window, syntaxLoader });
    const container = view.window.document.createElement('div');
    container.innerHTML = '<pre><code>const answer = 42;</code></pre>';

    await expect(adapters.syntax.highlight(container)).rejects.toBe(firstFailure);
    await expect(adapters.syntax.highlight(container)).resolves.toBe(true);
    await adapters.syntax.highlight(container);
    expect(syntaxLoader).toHaveBeenCalledTimes(2);
    expect(highlightCodeBlocks).toHaveBeenCalledTimes(2);
  });
});
