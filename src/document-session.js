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

function enhanceCodeBlocks({ window, document, content, clipboard, onToast, onDiagnostic }) {
  content.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code');
    if (!code || pre.querySelector('.copy-code-btn')) return;

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
    const restoreIdle = () => {
      resetTimer = null;
      icon.className = 'iconoir-copy';
      button.classList.remove('is-copied', 'is-copy-error');
      button.setAttribute('aria-label', 'Copy code block');
      button.dataset.tooltip = 'Copy code';
    };

    button.addEventListener('click', async () => {
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
        icon.className = 'iconoir-check';
        button.classList.add('is-copied');
        button.classList.remove('is-copy-error');
        button.setAttribute('aria-label', 'Code copied');
        button.dataset.tooltip = 'Copied';
        onToast?.('Code copied');
      } catch (error) {
        onDiagnostic?.('Could not copy code', error);
        icon.className = 'iconoir-refresh';
        button.classList.add('is-copy-error');
        button.classList.remove('is-copied');
        button.setAttribute('aria-label', 'Retry copying code');
        button.dataset.tooltip = 'Retry copy';
        onToast?.('Could not copy the code');
      }

      resetTimer = window.setTimeout(restoreIdle, 2000);
    });

    pre.appendChild(button);
  });
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

export function createDocumentSession({ window, adapters, hooks = {} }) {
  const { document } = window;
  const content = document.getElementById('content');
  const sourceContent = document.getElementById('source-content');
  const sourceView = document.getElementById('source-view');
  const readerPage = document.getElementById('reader-page');

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

  const hydrateImages = async (path, candidate) => {
    const images = [...content.querySelectorAll('img')];
    images.slice(MAX_LOCAL_IMAGES).forEach((image) => {
      renderImageError(document, image, 'Image limit exceeded');
    });

    const pending = images.slice(0, MAX_LOCAL_IMAGES);
    let nextIndex = 0;

    const worker = async () => {
      while (nextIndex < pending.length) {
        if (!isCurrent(candidate)) return;
        const image = pending[nextIndex];
        nextIndex += 1;

        const policy = getImageSourcePolicy(image.getAttribute('src'));
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
          if (!isCurrent(candidate) || !image.isConnected) return;
          objectUrl = resources.create(bytes, mimeType);
          if (!isCurrent(candidate) || !image.isConnected) {
            resources.revoke(objectUrl);
            return;
          }

          image.src = objectUrl;
          if (typeof image.decode === 'function') await image.decode();
          if (!isCurrent(candidate) || !image.isConnected) {
            resources.revoke(objectUrl);
            return;
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
          if (image.isConnected) renderImageError(document, image, reason);
        }
      }
    };

    const workers = Math.min(IMAGE_LOAD_CONCURRENCY, pending.length);
    await Promise.all(Array.from({ length: workers }, worker));
  };

  const clear = () => {
    if (disposed) return;
    generation += 1;
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

  const openImageDocument = async ({ path, candidate, openedDocument }) => {
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
      animateZoom: (hooks.getPreferences?.() || adapters.preferences?.current?.())?.advanced?.imageZoomAnimation !== false,
      defaultZoom: (hooks.getPreferences?.() || adapters.preferences?.current?.())?.advanced?.imageDefaultZoom || 'fit',
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
    notify({ state: 'ready', path, document: openedDocument });
    hooks.onImageStateChange?.(imageViewer?.getState?.() || null);
    focusContent({
      content,
      readerPage,
      sourceView,
      fragment: '',
      sourceActive: false,
    });
    hooks.onSettled?.(state);
    return { status: 'ready', path, document: openedDocument };
  };

  const open = async ({ path, fragment = '' }) => {
    if (disposed) throw new Error('Reader shell is disposed');
    if (typeof path !== 'string' || path.trim() === '') {
      clear();
      return { status: 'idle', path: null };
    }

    const candidate = ++generation;
    disposeImageViewer();
    resources.clear();
    content.setAttribute('aria-busy', 'true');
    if (sourceContent) sourceContent.textContent = '';
    renderLoading(document, content, path);
    notify({ state: 'loading', path, document: null });

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
          const rowCap = (hooks.getPreferences?.() || adapters.preferences?.current?.())?.advanced?.csvRowCap;
          try {
            const { buildCompanionReadHtml } = await import('./format-readers.js');
            if (!isCurrent(candidate)) return { status: 'superseded', path };
            const built = buildCompanionReadHtml(openedDocument.source, format, {
              rowCap,
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
      hooks.onDocumentCommitted?.({ path, document: openedDocument });

      if (isImageDocument) {
        return await openImageDocument({ path, candidate, openedDocument });
      }

      content.querySelectorAll('img').forEach((image) => {
        image.setAttribute('loading', 'lazy');
        image.dataset.documentSource = image.getAttribute('src') || '';
      });
      renderSource(
        document,
        sourceContent,
        openedDocument.source,
        isMarkdown
      );

      // Full-document companion source highlight (non-markdown).
      if (!isMarkdown && sourceContent && adapters.syntax?.highlightDocument) {
        try {
          await adapters.syntax.highlightDocument(sourceContent, getHighlightLanguage(format));
        } catch (error) {
          hooks.onDiagnostic?.('Source highlight error', error);
        }
      }

      await hydrateImages(path, candidate);
      if (!isCurrent(candidate)) return { status: 'superseded', path };

      enhanceTables(document, content);
      enhanceCodeBlocks({
        window,
        document,
        content,
        clipboard: adapters.clipboard || window.navigator?.clipboard,
        onToast: hooks.onToast,
        onDiagnostic: hooks.onDiagnostic,
      });

      try {
        await adapters.syntax?.highlight?.(content);
        if (!isMarkdown && adapters.syntax?.highlightDocument) {
          await adapters.syntax.highlightDocument(content, getHighlightLanguage(format));
        }
      } catch (error) {
        if (!isCurrent(candidate)) return { status: 'superseded', path };
        hooks.onDiagnostic?.('Syntax highlighting error', error);
        hooks.onWarning?.('Code remains readable without syntax colors');
      }
      if (!isCurrent(candidate)) return { status: 'superseded', path };

      try {
        const diagramTokens = hooks.getDiagramTokens?.();
        await adapters.diagrams?.render?.(content, {
          theme: hooks.getDiagramTheme?.() || 'default',
          ...(diagramTokens ? { tokens: diagramTokens } : {}),
        });
      } catch (error) {
        if (!isCurrent(candidate)) return { status: 'superseded', path };
        hooks.onDiagnostic?.('Mermaid render error', error);
        hooks.onWarning?.('One or more diagrams could not be rendered');
      }
      if (!isCurrent(candidate)) return { status: 'superseded', path };

      content.removeAttribute('aria-busy');
      notify({ state: 'ready', path, document: openedDocument });
      focusContent({
        content,
        readerPage,
        sourceView,
        fragment,
        sourceActive: Boolean(hooks.isSourceActive?.()),
      });
      hooks.onSettled?.(state);
      return { status: 'ready', path, document: openedDocument };
    } catch (error) {
      if (!isCurrent(candidate)) return { status: 'superseded', path };
      disposeImageViewer();
      resources.clear();
      content.removeAttribute('aria-busy');
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

  return Object.freeze({
    open,
    clear,
    prepareDiagrams,
    refreshDiagrams,
    current: () => state,
    getImageViewer: () => imageViewer,
    getImageMedia: () => (
      imageViewerBytes
        ? Object.freeze({
            bytes: imageViewerBytes,
            mimeType: imageViewerMime,
            path: imageViewerPath,
          })
        : null
    ),
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      disposeImageViewer();
      resources.clear();
    },
  });
}
