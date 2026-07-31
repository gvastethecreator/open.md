import { invoke as defaultInvoke } from '@tauri-apps/api/core';
import { getCurrentWindow as defaultGetCurrentWindow } from '@tauri-apps/api/window';
import {
  createMemoryPreferenceStore,
  createOptionalWebPreferenceStore,
} from './reader-preferences.js';
import { prepareMermaidDiagrams, renderMermaidDiagrams } from './mermaid-renderer.js';

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

  const readImageFile = (path) => invokeNative('get_standalone_image_bytes', { path });

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

  return Object.freeze({
    documents: Object.freeze({ open, save, readImage, readImageFile }),
    diagrams: Object.freeze({
      prepare: diagrams.prepare,
      render: diagrams.render,
    }),
    syntax: Object.freeze({ highlight, highlightDocument }),
    windows: Object.freeze({ openDocument, ...(setAlwaysOnTop ? { setAlwaysOnTop } : {}) }),
    storage: storage || createOptionalWebPreferenceStore(window) || createMemoryPreferenceStore(),
  });
}

export { NATIVE_ACCESS_ERROR };
