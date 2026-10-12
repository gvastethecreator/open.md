import { getDisplayName, getImageSourcePolicy } from './document-path.js';
import { normalizeDocumentPayload } from './document-payload.js';
import { getMarkdownSourceTokenRanges } from './markdown-source.js';
import {
  ImageResourceBudgetError,
  ImageResourcePool,
  getImageMimeType,
  toUint8Array,
} from './image-resources.js';
import {
  getHighlightLanguage,
  getReadRenderer,
  imageMimeForFormat,
  isImageFormat,
  isMarkdownFormat,
  resolveFormatId,
} from './format-registry.js';

const MAX_LOCAL_IMAGES = 100;
const IMAGE_LOAD_CONCURRENCY = 4;

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function renderLoading(document, content, path) {
  const loading = document.createElement('div');
  loading.className = 'loading';
  loading.setAttribute('role', 'status');
  loading.textContent = `Opening ${getDisplayName(path)}…`;
  content.replaceChildren(loading);
}

function renderFailure(document, content, error, chooseAnotherFile) {
  const panel = document.createElement('div');
  panel.className = 'error';

  const title = document.createElement('h1');
  title.textContent = 'Could not open the file';

  const message = document.createElement('p');
  message.textContent = errorMessage(error);
  panel.append(title, message);

  if (typeof chooseAnotherFile === 'function') {
    const retryButton = document.createElement('button');
    retryButton.className = 'primary-button';
    retryButton.type = 'button';
    const retryIcon = document.createElement('i');
    retryIcon.className = 'iconoir-folder';
    retryIcon.setAttribute('aria-hidden', 'true');
    const retryLabel = document.createElement('span');
    retryLabel.textContent = 'Choose another file';
    retryButton.append(retryIcon, retryLabel);
    retryButton.addEventListener('click', chooseAnotherFile);
    panel.append(retryButton);
  }

  content.replaceChildren(panel);
}

function renderImageError(document, image, reason) {
  const message = document.createElement('span');
  message.className = 'image-error';
  message.setAttribute('role', 'status');
  const label = image.getAttribute('alt')?.trim();
  message.textContent = label ? `${label}: ${reason}` : reason;
  image.replaceWith(message);
}

function enhanceTables(document, content) {
  content.querySelectorAll('table').forEach((table) => {
    if (table.parentElement?.classList.contains('table-scroll')) return;

    const wrapper = document.createElement('div');
    wrapper.className = 'table-scroll';
    wrapper.setAttribute('tabindex', '0');
    wrapper.setAttribute('role', 'region');
    wrapper.setAttribute('aria-label', 'Scrollable table');
    table.before(wrapper);
    wrapper.appendChild(table);
  });
}

function renderSource(document, sourceContent, source, isMarkdown) {
  if (!sourceContent) return;
  if (!isMarkdown) {
    sourceContent.textContent = String(source);
    return;
  }

  const fragment = document.createDocumentFragment();
  const lines = String(source).split('\n');
  lines.forEach((line, lineIndex) => {
    let cursor = 0;
    for (const range of getMarkdownSourceTokenRanges(line)) {
      if (range.start > cursor) {
        fragment.append(document.createTextNode(line.slice(cursor, range.start)));
      }
      const token = document.createElement('strong');
      token.className = 'source-markup-token';
      token.textContent = line.slice(range.start, range.end);
      fragment.append(token);
      cursor = range.end;
    }
    if (cursor < line.length) fragment.append(document.createTextNode(line.slice(cursor)));
    if (lineIndex < lines.length - 1) fragment.append(document.createTextNode('\n'));
  });

  sourceContent.replaceChildren(fragment);
}

function enhanceCodeBlocks({ window, document, content, clipboard, onToast, onDiagnostic, isCurrent }) {
  let disposed = false;
  const cleanups = [];
  content.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code');
    if (!code || pre.querySelector('.copy-code-btn')) return;
    if (pre.dataset.plainText === 'true') return;

    const button = document.createElement('button');
    button.className = 'copy-code-btn';
    button.type = 'button';
    button.setAttribute('aria-label', 'Copy code block');
    button.dataset.tooltip = 'Copy code';
    const icon = document.createElement('i');
    icon.className = 'iconoir-copy';
    icon.setAttribute('aria-hidden', 'true');
    button.appendChild(icon);

    let resetTimer = null;
    let copyRevision = 0;
    const restoreIdle = () => {
      resetTimer = null;
      icon.className = 'iconoir-copy';
      button.classList.remove('is-copied', 'is-copy-error');
      button.setAttribute('aria-label', 'Copy code block');
      button.dataset.tooltip = 'Copy code';
    };

    const copy = async () => {
      if (disposed || !isCurrent()) return;
      const revision = ++copyRevision;
      const active = () => !disposed && isCurrent() && revision === copyRevision;
      if (resetTimer != null) {
        window.clearTimeout?.(resetTimer);
        resetTimer = null;
      }
      try {
        if (typeof clipboard?.writeText !== 'function') {
          throw new Error('Clipboard access is unavailable');
        }
        // Prefer textContent when innerText is empty (common in jsdom / some WebViews).
        const text = String(code.innerText || code.textContent || '');
        await clipboard.writeText(text);
        if (!active()) return;
        icon.className = 'iconoir-check';
        button.classList.add('is-copied');
        button.classList.remove('is-copy-error');
        button.setAttribute('aria-label', 'Code copied');
        button.dataset.tooltip = 'Copied';
        onToast?.('Code copied');
      } catch (error) {
        if (!active()) return;
        onDiagnostic?.('Could not copy code', error);
        icon.className = 'iconoir-refresh';
        button.classList.add('is-copy-error');
        button.classList.remove('is-copied');
        button.setAttribute('aria-label', 'Retry copying code');
        button.dataset.tooltip = 'Retry copy';
        onToast?.('Could not copy the code');
      }

      if (active()) resetTimer = window.setTimeout(restoreIdle, 2000);
    };
    button.addEventListener('click', copy);
    cleanups.push(() => {
      if (resetTimer != null) window.clearTimeout(resetTimer);
      button.removeEventListener('click', copy);
      button.remove();
    });

    pre.appendChild(button);
  });
  return () => {
    disposed = true;
    cleanups.forEach((cleanup) => cleanup());
    cleanups.length = 0;
  };
}

function focusContent({ content, readerPage, sourceView, fragment, sourceActive }) {
  readerPage?.scrollTo?.({ top: 0, behavior: 'auto' });

  if (sourceActive) {
    sourceView?.focus?.({ preventScroll: true });
    return;
  }

  if (fragment) {
    let fragmentId = fragment.slice(1);
    try {
      fragmentId = decodeURIComponent(fragmentId);
    } catch {
      fragmentId = '';
    }

    const target = fragmentId
      ? [...content.querySelectorAll('[id]')].find((element) => element.id === fragmentId)
      : null;
    if (target) {
      target.setAttribute('tabindex', '-1');
      target.focus?.({ preventScroll: true });
      target.scrollIntoView?.({ block: 'start' });
      return;
    }
  }

  content.focus?.({ preventScroll: true });
}

export function enhanceReadSurface({
  window,
  document,
  content,
  clipboard,
  onToast,
  onDiagnostic,
  isCurrent = () => true,
}) {
  if (!content) return;
  enhanceTables(document, content);
  return enhanceCodeBlocks({
    window,
    document,
    content,
    clipboard,
    onToast,
    onDiagnostic,
    isCurrent,
  });
}

export function createDocumentSession({ window, adapters, hooks = {}, elements = {} } = {}) {
  const { document } = window;
  const content = elements.content;
  const sourceContent = elements.sourceContent;
  const sourceView = elements.sourceView;
  const readerPage = elements.readerPage;

  if (!content) {
    throw new Error('Reader shell requires #content');
  }
  if (typeof adapters?.documents?.open !== 'function') {
    throw new Error('Reader shell requires a documents.open adapter');
  }

  const resources = adapters.resources || new ImageResourcePool();
  let generation = 0;
  let disposed = false;
  let imageViewer = null;
  let imageViewerBytes = null;
  let imageViewerMime = null;
  let imageViewerPath = null;
  let disposeReadSurface = null;
  let enrichmentObserver = null;
  let sourceRendered = false;
  let preferencesSnapshot = null;
  let imageHydrator = null;
  const previewImages = new Map();
  let state = Object.freeze({ state: 'idle', path: null, document: null });

  const disposeImageViewer = () => {
    imageViewer?.dispose?.();
    imageViewer = null;
    imageViewerBytes = null;
    imageViewerMime = null;
    imageViewerPath = null;
    hooks.onImageStateChange?.(null);
  };

  const notify = (nextState) => {
    state = Object.freeze(nextState);
    hooks.onStateChange?.(state);
  };
  const isCurrent = (candidate) => !disposed && candidate === generation;
  const clearReadSurface = () => {
    sourceRendered = false;
    imageHydrator = null;
    previewImages.clear();
    enrichmentObserver?.disconnect();
    enrichmentObserver = null;
    disposeReadSurface?.();
    disposeReadSurface = null;
  };

  const ensureSourceView = () => {
    if (disposed || state.state !== 'ready' || sourceRendered) return;
    const format = resolveFormatId(state.path, state.document);
    renderSource(document, sourceContent, state.document.source, isMarkdownFormat(format, { kind: state.document.kind }));
    sourceRendered = true;
  };

  const getPreferences = () => preferencesSnapshot || hooks.getPreferences?.() || adapters.preferences?.current?.();

  const createImageHydrator = (path, candidate) => {
    const pending = [];
    let activeWorkers = 0;

    const worker = async () => {
      try {
        while (pending.length > 0) {
          if (!isCurrent(candidate)) return;
          const image = pending.shift();
          const isCurrentImage = () => isCurrent(candidate) && image.isConnected
            && (content.contains(image) || previewImages.has(image));
          if (!isCurrentImage()) continue;

          const policy = getImageSourcePolicy(image.dataset.documentSource);
          if (policy.type !== 'relative') {
            renderImageError(document, image, policy.reason);
            continue;
          }

          const mimeType = getImageMimeType(policy.source);
          if (!mimeType) {
            renderImageError(document, image, 'This local image format is not supported');
            continue;
          }

          image.removeAttribute('src');
          image.setAttribute('aria-busy', 'true');
          let objectUrl = null;

          try {
            const bytes = await adapters.documents.readImage(path, policy.source);
            if (!isCurrentImage()) continue;
            objectUrl = resources.create(bytes, mimeType);
            if (!isCurrentImage()) {
              resources.revoke(objectUrl);
              continue;
            }

            image.src = objectUrl;
            if (typeof image.decode === 'function') await image.decode();
            if (!isCurrentImage()) {
              resources.revoke(objectUrl);
              continue;
            }
            image.removeAttribute('aria-busy');
          } catch (error) {
            if (objectUrl) resources.revoke(objectUrl);
            if (!isCurrent(candidate)) return;
            const reason = error instanceof ImageResourceBudgetError
              || error?.code === 'IMAGE_RESOURCE_BUDGET_EXCEEDED'
              ? 'Image budget exceeded (64 MiB per document)'
              : 'Image unavailable';
            hooks.onDiagnostic?.('Could not load a relative image', error);
            if (isCurrentImage()) renderImageError(document, image, reason);
          }
        }
      } finally {
        activeWorkers -= 1;
      }
    };

    return (images) => {
      pending.push(...images);
      const workers = Math.min(IMAGE_LOAD_CONCURRENCY - activeWorkers, pending.length);
      for (let index = 0; index < workers; index += 1) {
        activeWorkers += 1;
        void worker();
      }
    };
  };

  const hydrateImagePreviews = (root) => {
    for (const [image, owned] of previewImages) {
      if (root?.contains(image)) continue;
      if (owned && image.getAttribute('src')) resources.revoke(image.getAttribute('src'));
      previewImages.delete(image);
    }
    if (!root || disposed || state.state !== 'ready' || !imageHydrator) return;
    const images = [...root.querySelectorAll('img[data-document-source]')];
    images.slice(MAX_LOCAL_IMAGES).forEach((image) => renderImageError(document, image, 'Image limit exceeded'));
    const pending = [];
    for (const image of images.slice(0, MAX_LOCAL_IMAGES)) {
      if (image.hasAttribute('src') || image.hasAttribute('aria-busy') || previewImages.has(image)) continue;
      const shared = [...content.querySelectorAll('img[src]')].find((current) => (
        current.dataset.documentSource === image.dataset.documentSource && resources.get?.(current.getAttribute('src'))
      ));
      previewImages.set(image, !shared);
      if (shared) image.src = shared.getAttribute('src');
      else pending.push(image);
    }
    imageHydrator(pending);
  };

  const clear = () => {
    if (disposed) return;
    generation += 1;
    clearReadSurface();
    disposeImageViewer();
    resources.clear();
    content.removeAttribute('aria-busy');
    content.replaceChildren();
    if (sourceContent) sourceContent.textContent = '';
    notify({ state: 'idle', path: null, document: null });
  };

  const resolveImageMime = (path, openedDocument) => {
    const fromPayload = imageMimeForFormat(openedDocument?.format);
    if (fromPayload) return fromPayload;
    const shell = content.querySelector('[data-image-document="true"]');
    const fromDom = shell?.getAttribute?.('data-image-mime');
    if (fromDom) return fromDom;
    return getImageMimeType(path);
  };

  const openImageDocument = async ({ path, candidate, openedDocument, quiet = false }) => {
    if (typeof adapters.documents.readImageFile !== 'function') {
      throw new Error('Standalone image loading is unavailable');
    }

    const mimeType = resolveImageMime(path, openedDocument);
    if (!mimeType) {
      throw new Error('This local image format is not supported');
    }

    const shell = content.querySelector('[data-image-document="true"]') || content;
    const bytes = await adapters.documents.readImageFile(path);
    if (!isCurrent(candidate)) return { status: 'superseded', path };

    const objectUrl = resources.create(bytes, mimeType);
    if (!isCurrent(candidate)) {
      resources.revoke(objectUrl);
      return { status: 'superseded', path };
    }

    disposeImageViewer();
    const { createImageDocumentViewer } = await import('./image-document-viewer.js');
    if (!isCurrent(candidate)) {
      resources.revoke(objectUrl);
      return { status: 'superseded', path };
    }
    imageViewer = createImageDocumentViewer({
      window,
      root: shell,
      imageUrl: objectUrl,
      alt: getDisplayName(path),
      padding: 24,
      animateZoom: getPreferences()?.advanced?.imageZoomAnimation !== false,
      defaultZoom: getPreferences()?.advanced?.imageDefaultZoom || 'fit',
      onScaleChange: () => {
        if (!isCurrent(candidate)) return;
        hooks.onImageStateChange?.(imageViewer?.getState?.() || null);
      },
    });
    // Retain a copy of bytes for copy/download while this generation is current.
    imageViewerBytes = toUint8Array(bytes) || bytes;
    imageViewerMime = mimeType;
    imageViewerPath = path;

    if (sourceContent) sourceContent.textContent = '';
    content.removeAttribute('aria-busy');
    const readyState = { state: 'ready', path, document: openedDocument };
    if (quiet) state = Object.freeze(readyState);
    else notify(readyState);
    hooks.onImageStateChange?.(imageViewer?.getState?.() || null);
    if (!quiet) {
      focusContent({
        content,
        readerPage,
        sourceView,
        fragment: '',
        sourceActive: false,
      });
      hooks.onSettled?.(state);
    }
    return { status: 'ready', path, document: openedDocument };
  };

  const open = async ({ path, fragment = '', quiet = false }) => {
    if (disposed) throw new Error('Reader shell is disposed');
    if (typeof path !== 'string' || path.trim() === '') {
      clear();
      return { status: 'idle', path: null };
    }

    const candidate = ++generation;
    clearReadSurface();
    disposeImageViewer();
    resources.clear();
    content.setAttribute('aria-busy', 'true');
    if (!quiet) {
      if (sourceContent) sourceContent.textContent = '';
      renderLoading(document, content, path);
      notify({ state: 'loading', path, document: null });
    }

    try {
      const openedDocument = normalizeDocumentPayload(await adapters.documents.open(path));
      if (!isCurrent(candidate)) return { status: 'superseded', path };

      const format = resolveFormatId(path, openedDocument);
      const isImageDocument = isImageFormat(format, { kind: openedDocument.kind });
      const isMarkdown = isMarkdownFormat(format, { kind: openedDocument.kind });

      let readHtml = openedDocument.html;
      if (!isImageDocument && !isMarkdown) {
        const renderer = getReadRenderer(format, { kind: openedDocument.kind });
        if (renderer !== 'plain' && renderer !== 'markdown' && renderer !== 'image') {
          try {
            const { buildCompanionReadHtml } = await import('./format-readers.js');
            if (!isCurrent(candidate)) return { status: 'superseded', path };
            const built = buildCompanionReadHtml(openedDocument.source, format, {
              rowCap: getPreferences()?.advanced?.csvRowCap,
              highlightLanguage: getHighlightLanguage(format),
            });
            readHtml = built.html;
            if (built.warning) hooks.onWarning?.(built.warning);
          } catch (error) {
            hooks.onDiagnostic?.('Companion rich-read failed; using plain HTML', error);
          }
        }
      }

      content.innerHTML = readHtml;
      if (sourceContent) sourceContent.textContent = '';
      if (!quiet) hooks.onDocumentCommitted?.({ path, document: openedDocument });

      if (isImageDocument) {
        return await openImageDocument({ path, candidate, openedDocument, quiet });
      }

      content.querySelectorAll('img').forEach((image) => {
        image.dataset.documentSource = image.getAttribute('src') || '';
        image.removeAttribute('src');
      });
      if (!isCurrent(candidate)) return { status: 'superseded', path };

      content.removeAttribute('aria-busy');
      const readyState = { state: 'ready', path, document: openedDocument };
      if (quiet) state = Object.freeze(readyState);
      else {
        notify(readyState);
        focusContent({
          content,
          readerPage,
          sourceView,
          fragment,
          sourceActive: Boolean(hooks.isSourceActive?.()),
        });
        hooks.onSettled?.(state);
      }
      if (hooks.isSourceActive?.()) ensureSourceView();

      disposeReadSurface = enhanceReadSurface({
        window,
        document,
        content,
        clipboard: adapters.clipboard || window.navigator?.clipboard,
        onToast: hooks.onToast,
        onDiagnostic: hooks.onDiagnostic,
        isCurrent: () => isCurrent(candidate),
      });

      const images = [...content.querySelectorAll('img')];
      images.slice(MAX_LOCAL_IMAGES).forEach((image) => {
        renderImageError(document, image, 'Image limit exceeded');
      });
      const diagrams = [...content.querySelectorAll('.mermaid')];
      diagrams.forEach((diagram) => { diagram.dataset.mermaidPending = 'true'; });
      const hydrateImages = createImageHydrator(path, candidate);
      imageHydrator = hydrateImages;
      const targets = [...images.slice(0, MAX_LOCAL_IMAGES), ...diagrams];
      if (targets.length > 0) {
        enrichmentObserver = new window.IntersectionObserver((entries) => {
          if (!isCurrent(candidate)) return;
          const visibleImages = [];
          let renderDiagrams = false;
          for (const { target, isIntersecting } of entries) {
            if (!isIntersecting || !target.isConnected) continue;
            enrichmentObserver.unobserve(target);
            if (target.tagName === 'IMG') visibleImages.push(target);
            else {
              delete target.dataset.mermaidPending;
              renderDiagrams = true;
            }
          }
          hydrateImages(visibleImages);
          if (renderDiagrams) {
            void (async () => {
              try {
                const tokens = hooks.getDiagramTokens?.();
                await adapters.diagrams?.render?.(content, {
                  isCurrent: () => isCurrent(candidate),
                  theme: hooks.getDiagramTheme?.() || 'default',
                  ...(tokens ? { tokens } : {}),
                });
              } catch (error) {
                if (!isCurrent(candidate)) return;
                hooks.onDiagnostic?.('Mermaid render error', error);
                hooks.onWarning?.('One or more diagrams could not be rendered');
              }
            })();
          }
        }, { rootMargin: `${window.innerHeight}px 0px` });
        for (const target of targets) {
          enrichmentObserver.observe(target);
        }
      }

      void (async () => {
        try {
          const scope = { isCurrent: () => isCurrent(candidate) };
          const language = getHighlightLanguage(format);
          if (!isMarkdown && language && adapters.syntax?.highlightDocument) {
            await adapters.syntax.highlightDocument(content, language, scope);
          } else {
            await adapters.syntax?.highlight?.(content, scope);
          }
        } catch (error) {
          if (!isCurrent(candidate)) return;
          hooks.onDiagnostic?.('Syntax highlighting error', error);
          hooks.onWarning?.('Code remains readable without syntax colors');
        }
      })();

      return { status: 'ready', path, document: openedDocument };
    } catch (error) {
      if (!isCurrent(candidate)) return { status: 'superseded', path };
      clearReadSurface();
      disposeImageViewer();
      resources.clear();
      content.removeAttribute('aria-busy');
      if (quiet) {
        hooks.onDiagnostic?.('Could not refresh the saved document view', error);
        return { status: 'failed', path, error };
      }
      if (sourceContent) sourceContent.textContent = '';
      renderFailure(document, content, error, hooks.chooseAnotherFile);
      notify({ state: 'failed', path, document: null, error });
      focusContent({ content, readerPage, sourceView, fragment: '', sourceActive: false });
      hooks.onSettled?.(state);
      return { status: 'failed', path, error };
    }
  };

  const refreshDiagrams = async (theme = 'default', tokens = null) => {
    if (disposed || state.state !== 'ready' || !content.querySelector('.mermaid')) return false;
    const candidate = generation;
    try {
      const rendered = await adapters.diagrams?.render?.(content, {
        isCurrent: () => isCurrent(candidate),
        reset: true,
        theme,
        ...(tokens ? { tokens } : {}),
      });
      if (!isCurrent(candidate)) return false;
      return Boolean(rendered);
    } catch (error) {
      if (!isCurrent(candidate)) return false;
      hooks.onDiagnostic?.('Mermaid theme update error', error);
      hooks.onWarning?.('The diagram could not update for this theme');
      return false;
    }
  };

  const prepareDiagrams = async (theme = 'default', tokens = null) => {
    if (disposed || state.state !== 'ready' || !content.querySelector('.mermaid')) return null;
    const candidate = generation;
    try {
      const prepared = await adapters.diagrams?.prepare?.(content, {
        isCurrent: () => isCurrent(candidate),
        reset: true,
        theme,
        ...(tokens ? { tokens } : {}),
      });
      if (!isCurrent(candidate)) return null;
      return prepared || null;
    } catch (error) {
      if (!isCurrent(candidate)) return null;
      hooks.onDiagnostic?.('Mermaid theme preparation error', error);
      hooks.onWarning?.('The diagram could not update for this theme');
      return null;
    }
  };

  const applyPreferences = (snapshot) => {
    if (disposed) return;
    const previous = getPreferences()?.advanced;
    preferencesSnapshot = snapshot;
    imageViewer?.setPreferences(snapshot.advanced);
    if (state.state === 'ready' && resolveFormatId(state.path, state.document) === 'csv'
      && previous?.csvRowCap !== snapshot.advanced?.csvRowCap) {
      return open({ path: state.path, quiet: true });
    }
  };

  return Object.freeze({
    open,
    clear,
    prepareDiagrams,
    refreshDiagrams,
    ensureSourceView,
    applyPreferences,
    hydrateImagePreviews,
    current: () => state,
    getImageViewer: () => imageViewer,
    getImageMedia: (image = null) => {
      if (image) {
        if (disposed || !content.contains(image) || getImageSourcePolicy(image.dataset.documentSource).type !== 'relative') return null;
        const media = resources.get?.(image.getAttribute('src'));
        return media ? Object.freeze({ ...media, path: image.dataset.documentSource }) : null;
      }
      return imageViewerBytes
        ? Object.freeze({ bytes: imageViewerBytes, mimeType: imageViewerMime, path: imageViewerPath })
        : null;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      clearReadSurface();
      disposeImageViewer();
      resources.clear();
    },
  });
}
