const STRICT_MERMAID_OPTIONS = Object.freeze({
  startOnLoad: false,
  securityLevel: 'strict',
});

let mermaidModulePromise = null;
let mermaidRenderQueue = Promise.resolve();

function loadMermaid() {
  if (!mermaidModulePromise) {
    mermaidModulePromise = import('mermaid')
      .then(({ default: mermaid }) => mermaid)
      .catch((error) => {
        mermaidModulePromise = null;
        throw error;
      });
  }
  return mermaidModulePromise;
}

function enqueueMermaidRender(operation) {
  const queuedOperation = mermaidRenderQueue.then(operation);
  mermaidRenderQueue = queuedOperation.catch(() => undefined);
  return queuedOperation;
}

function getMermaidTheme(theme) {
  return theme === 'dark' ? 'dark' : 'default';
}

async function initializeMermaid(theme = 'default') {
  const mermaid = await loadMermaid();
  mermaid.initialize({
    ...STRICT_MERMAID_OPTIONS,
    theme: getMermaidTheme(theme),
  });
  return mermaid;
}

async function resetMermaid(theme = 'default') {
  const mermaid = await loadMermaid();
  mermaid.reset?.();
  mermaid.initialize({
    ...STRICT_MERMAID_OPTIONS,
    theme: getMermaidTheme(theme),
  });
  return mermaid;
}

export async function renderMermaidDiagrams(container, { reset = false, theme = 'default' } = {}) {
  const diagrams = [...(container?.querySelectorAll?.('.mermaid') || [])];
  if (diagrams.length === 0) return false;

  return enqueueMermaidRender(async () => {
    diagrams.forEach((diagram) => {
      if (!diagram.dataset.mermaidSource) {
        diagram.dataset.mermaidSource = diagram.textContent || '';
      }

      if (reset) {
        diagram.textContent = diagram.dataset.mermaidSource;
        diagram.removeAttribute('data-processed');
      }
    });

    const mermaid = reset
      ? await resetMermaid(theme)
      : await initializeMermaid(theme);
    await mermaid.run({ nodes: diagrams, suppressErrors: true });
    return true;
  });
}
