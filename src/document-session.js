import {
  getDisplayName,
  getFileKind,
  getImageSourcePolicy,
  getMarkdownSourceTokenRanges,
  normalizeDocumentPayload,
} from './core/reader.js';
import {
  ImageResourceBudgetError,
  ImageResourcePool,
  getImageMimeType,
} from './image-resources.js';

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
    button.title = 'Copy code';
    const icon = document.createElement('i');
    icon.className = 'iconoir-copy';
    icon.setAttribute('aria-hidden', 'true');
    button.appendChild(icon);

    button.addEventListener('click', async () => {
      try {
        if (typeof clipboard?.writeText !== 'function') {
          throw new Error('Clipboard access is unavailable');
        }
        await clipboard.writeText(code.innerText);
        icon.className = 'iconoir-check';
        button.setAttribute('aria-label', 'Code copied');
        button.title = 'Copied';
        onToast?.('Code copied');
      } catch (error) {
        onDiagnostic?.('Could not copy code', error);
        icon.className = 'iconoir-refresh';
        button.setAttribute('aria-label', 'Retry copying code');
        button.title = 'Retry copy';
        onToast?.('Could not copy the code');
      }

      window.setTimeout(() => {
        icon.className = 'iconoir-copy';
        button.setAttribute('aria-label', 'Copy code block');
        button.title = 'Copy code';
      }, 2000);
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
  let state = Object.freeze({ state: 'idle', path: null, document: null });

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
    resources.clear();
    content.removeAttribute('aria-busy');
    content.replaceChildren();
    if (sourceContent) sourceContent.textContent = '';
    notify({ state: 'idle', path: null, document: null });
  };

  const open = async ({ path, fragment = '' }) => {
    if (disposed) throw new Error('Reader shell is disposed');
    if (typeof path !== 'string' || path.trim() === '') {
      clear();
      return { status: 'idle', path: null };
    }

    const candidate = ++generation;
    resources.clear();
    content.setAttribute('aria-busy', 'true');
    if (sourceContent) sourceContent.textContent = '';
    renderLoading(document, content, path);
    notify({ state: 'loading', path, document: null });

    try {
      const openedDocument = normalizeDocumentPayload(await adapters.documents.open(path));
      if (!isCurrent(candidate)) return { status: 'superseded', path };

      content.innerHTML = openedDocument.html;
      content.querySelectorAll('img').forEach((image) => image.setAttribute('loading', 'lazy'));
      renderSource(
        document,
        sourceContent,
        openedDocument.source,
        getFileKind(path) === 'Markdown'
      );
      hooks.onDocumentCommitted?.({ path, document: openedDocument });

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
        await adapters.diagrams?.render?.(content, { theme: hooks.getDiagramTheme?.() || 'default' });
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

  const refreshDiagrams = async (theme = 'default') => {
    if (disposed || state.state !== 'ready' || !content.querySelector('.mermaid')) return false;
    const candidate = generation;
    try {
      const rendered = await adapters.diagrams?.render?.(content, { reset: true, theme });
      if (!isCurrent(candidate)) return false;
      return Boolean(rendered);
    } catch (error) {
      if (!isCurrent(candidate)) return false;
      hooks.onDiagnostic?.('Mermaid theme update error', error);
      hooks.onWarning?.('The diagram could not update for this theme');
      return false;
    }
  };

  return Object.freeze({
    open,
    clear,
    refreshDiagrams,
    current: () => state,
    dispose() {
      if (disposed) return;
      disposed = true;
      generation += 1;
      resources.clear();
    },
  });
}
