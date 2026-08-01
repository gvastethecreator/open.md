import { invoke as defaultInvoke } from '@tauri-apps/api/core';
import { listen as defaultListen } from '@tauri-apps/api/event';
import { getCurrentWebview as defaultGetCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow as defaultGetCurrentWindow } from '@tauri-apps/api/window';
import {
  open as defaultOpenFileDialog,
  save as defaultSaveFileDialog,
} from '@tauri-apps/plugin-dialog';
import {
  createMemoryPreferenceStore,
  createOptionalWebPreferenceStore,
} from './reader-preferences.js';
import { prepareMermaidDiagrams, renderMermaidDiagrams } from './mermaid-renderer.js';
import { toUint8Array } from './image-resources.js';

const NATIVE_ACCESS_ERROR = 'Native file access is unavailable in this browser preview.';

function nativeAccessError() {
  const error = new Error(NATIVE_ACCESS_ERROR);
  error.code = 'NATIVE_ACCESS_UNAVAILABLE';
  return error;
}

function isNativeRuntime(window) {
  return Boolean(window?.__TAURI_INTERNALS__);
}

function getPreviewDocument(window, path) {
  if (!import.meta.env.DEV) return null;
  const previewDocuments = window?.__OPENMD_PREVIEW_DOCUMENTS__;
  const value = previewDocuments && typeof previewDocuments === 'object'
    ? previewDocuments[path]
    : null;
  return value && typeof value.source === 'string' && typeof value.html === 'string'
    ? value
    : null;
}

function previewPayload(source, previous) {
  const escaped = source
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const words = source.trim() ? source.trim().split(/\s+/u).length : 0;
  return {
    ...previous,
    source,
    html: `<pre>${escaped}</pre>`,
    lineCount: source.split('\n').length,
    characterCount: [...source].length,
    wordCount: words,
    readingTimeMinutes: words === 0 ? 0 : Math.max(1, Math.ceil(words / 220)),
  };
}

export function createApplicationRuntimeAdapters({
  window,
  invoke = defaultInvoke,
  getCurrentWindow = defaultGetCurrentWindow,
  listen = defaultListen,
  getCurrentWebview = defaultGetCurrentWebview,
  openFileDialog = defaultOpenFileDialog,
  saveFileDialog = defaultSaveFileDialog,
  openUrl = null,
  syntaxLoader = () => import('./syntax-highlighter.js'),
  diagrams = { prepare: prepareMermaidDiagrams, render: renderMermaidDiagrams },
  storage,
} = {}) {
  if (!window?.document) throw new Error('Application runtime adapters require a window');

  const native = isNativeRuntime(window);
  let syntaxPromise = null;

  const invokeNative = (command, args) => {
    if (!native) return Promise.reject(nativeAccessError());
    return invoke(command, args);
  };

  const open = (path) => {
    const preview = getPreviewDocument(window, path);
    return preview
      ? Promise.resolve({ ...preview })
      : invokeNative('get_file_content', { path });
  };

  const save = async (path, source) => {
    const preview = getPreviewDocument(window, path);
    if (!preview) return invokeNative('save_file_content', { path, content: source });
    if (window.__OPENMD_PREVIEW_SAVE_FAILURE__) throw new Error('Preview save failure');

    const previewDelay = Number(window.__OPENMD_PREVIEW_SAVE_DELAY_MS__) || 0;
    if (previewDelay > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, Math.min(previewDelay, 3_000)));
    }
    const next = previewPayload(source, preview);
    Object.assign(preview, next);
    return { ...next };
  };

  const readImage = (documentPath, relativeSource) => invokeNative('get_image_bytes', {
    documentPath,
    relativeSource,
  });

  const readImageFile = (path) => {
    // Browser/dev smoke only: inject fixture bytes without Tauri IPC.
    if (import.meta.env.DEV) {
      const previewMap = window?.__OPENMD_PREVIEW_IMAGE_BYTES__;
      const preview = previewMap && typeof previewMap === 'object' ? previewMap[path] : null;
      if (preview != null) {
        const bytes = toUint8Array(preview)
          || (Array.isArray(preview) ? Uint8Array.from(preview) : null);
        if (bytes) return Promise.resolve(bytes);
      }
    }
    return invokeNative('get_standalone_image_bytes', { path });
  };

  const extensionForMime = (mimeType = '', path = '') => {
    const fromPath = String(path).match(/\.([a-z0-9]+)$/i)?.[1];
    if (fromPath) return fromPath.toLowerCase();
    if (mimeType.includes('jpeg')) return 'jpg';
    if (mimeType.includes('png')) return 'png';
    if (mimeType.includes('webp')) return 'webp';
    if (mimeType.includes('gif')) return 'gif';
    if (mimeType.includes('bmp')) return 'bmp';
    if (mimeType.includes('avif')) return 'avif';
    return 'png';
  };

  const bytesToUint8Array = (bytes) => {
    const fromHelper = toUint8Array(bytes);
    if (fromHelper) return fromHelper;
    if (Array.isArray(bytes)) return Uint8Array.from(bytes);
    throw new Error('Image bytes are unavailable');
  };

  const downloadImage = async ({
    bytes,
    mimeType = 'image/png',
    path = '',
    defaultName = 'image',
  } = {}) => {
    const payload = bytesToUint8Array(bytes);
    const extension = extensionForMime(mimeType, path);
    const baseName = String(defaultName || 'image').replace(/\.[^.]+$/, '') || 'image';

    if (!native) {
      const blob = new Blob([payload], { type: mimeType || 'application/octet-stream' });
      const url = window.URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = `${baseName}.${extension}`;
      window.document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1_000);
      return { status: 'saved', path: null };
    }

    const destination = await saveFileDialog({
      defaultPath: `${baseName}.${extension}`,
      filters: [{ name: 'Image', extensions: [extension] }],
    });
    if (!destination) return { status: 'cancelled' };

    // Pass Uint8Array through IPC (avoid Array.from on multi-MiB images).
    await invokeNative('save_file_bytes', {
      path: destination,
      contents: payload,
    });
    return { status: 'saved', path: destination };
  };

  const openDocument = (path) => invokeNative('open_new_window', { path });

  const loadSyntax = async () => {
    if (!syntaxPromise) {
      syntaxPromise = Promise.resolve(syntaxLoader()).catch((error) => {
        syntaxPromise = null;
        throw error;
      });
    }
    return syntaxPromise;
  };

  const highlight = async (container) => {
    if (!container?.querySelector?.('pre code')) return false;
    const { highlightCodeBlocks } = await loadSyntax();
    return highlightCodeBlocks(container);
  };

  const highlightDocument = async (container, language) => {
    if (!container || !language) return false;
    const module = await loadSyntax();
    if (typeof module.highlightDocument !== 'function') return false;
    return module.highlightDocument(container, language);
  };

  const setAlwaysOnTop = native
    ? (value) => getCurrentWindow().setAlwaysOnTop(value)
    : undefined;

  const getNativeWindow = () => (native ? getCurrentWindow() : null);

  const openExternalUrl = async (url) => {
    if (!native) return Promise.reject(nativeAccessError());
    if (typeof openUrl === 'function') return openUrl(url);
    const opener = await import('@tauri-apps/plugin-opener');
    return opener.openUrl(url);
  };

  const acknowledgeOpenFile = (id) => invokeNative('acknowledge_open_file_request', { id });

  const getInitialFilePaths = async () => {
    if (!native) return [];
    try {
      const paths = await invokeNative('get_initial_file_paths');
      return Array.isArray(paths) ? paths : [];
    } catch {
      return [];
    }
  };

  const listPendingOpenFileRequests = async () => {
    if (!native) return [];
    try {
      const pending = await invokeNative('list_pending_open_file_requests');
      return Array.isArray(pending) ? pending : [];
    } catch {
      return [];
    }
  };

  const getProcessInstanceMode = async () => {
    if (!native) {
      return {
        allowMultipleInstances: true,
        processAllowsMultipleInstances: true,
        restartRequired: false,
        available: false,
      };
    }
    const mode = await invokeNative('get_process_instance_mode');
    return {
      allowMultipleInstances: mode?.allowMultipleInstances !== false,
      processAllowsMultipleInstances: mode?.processAllowsMultipleInstances !== false,
      restartRequired: Boolean(mode?.restartRequired),
      available: true,
    };
  };

  const setAllowMultipleInstances = async (value) => {
    if (!native) {
      const error = nativeAccessError();
      error.code = 'NATIVE_ACCESS_UNAVAILABLE';
      throw error;
    }
    return invokeNative('set_allow_multiple_instances', { value: Boolean(value) });
  };

  const getFileAssociationStatus = async () => {
    if (!native) {
      return {
        status: 'unavailable',
        platform: 'browser',
        detail: 'File associations require the desktop app.',
        extensions: ['md', 'markdown', 'txt'],
        available: false,
      };
    }
    const status = await invokeNative('get_file_association_status');
    return { ...status, available: true };
  };

  const requestFileAssociation = async () => {
    if (!native) {
      throw nativeAccessError();
    }
    return invokeNative('request_file_association');
  };

  return Object.freeze({
    documents: Object.freeze({ open, save, readImage, readImageFile, downloadImage }),
    diagrams: Object.freeze({
      prepare: diagrams.prepare,
      render: diagrams.render,
    }),
    syntax: Object.freeze({ highlight, highlightDocument }),
    windows: Object.freeze({
      openDocument,
      getNativeWindow,
      openExternalUrl,
      ...(setAlwaysOnTop ? { setAlwaysOnTop } : {}),
    }),
    openRequests: Object.freeze({
      acknowledge: acknowledgeOpenFile,
      getInitialFilePaths,
      listPending: listPendingOpenFileRequests,
    }),
    ingress: Object.freeze({
      listen,
      openFileDialog,
      getCurrentWebview,
      listPendingOpenFileRequests,
    }),
    system: Object.freeze({
      getProcessInstanceMode,
      setAllowMultipleInstances,
      getFileAssociationStatus,
      requestFileAssociation,
    }),
    storage: storage || createOptionalWebPreferenceStore(window) || createMemoryPreferenceStore(),
  });
}

export { NATIVE_ACCESS_ERROR };
